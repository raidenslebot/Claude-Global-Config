// Model routing for WORKFLOW agents, and the two gates that keep it honest.
//
// Workflow agents are dispatched by the runtime, never through the Agent tool, so the
// per-dispatch routing hook never fires for them. Observed: a six-worker fan-out ran every
// worker on the session model, including one that edited a single YAML file. The fix is a
// PreToolUse hook on the Workflow tool that injects the session policy into `args`, and a
// helper inside the script that applies the same classifier.
//
// That design has two places to rot, and each has a gate here:
//   1. The hook carries its OWN copy of the signal vocabulary (hooks cannot import each other).
//      Gate: the two copies are deep-equal.
//   2. The script helper re-implements the precedence (scripts cannot import anything).
//      Gate: the SHIPPED helper text, evaluated as-is, agrees with decide() on every corpus case.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { REPO } from '../paths.mjs'

const require = createRequire(import.meta.url)
const route = require('../../config/hooks/pre-tool-model-route.js')
const wf = require('../../config/hooks/pre-tool-workflow-policy.js')

const HOOK = join(REPO, 'config', 'hooks', 'pre-tool-workflow-policy.js')
const WORKFLOW = join(REPO, 'workflows', 'design-divergence.js')
const CORPUS = join(REPO, 'tools', 'test', 'fixtures', 'model-corpus.json')

function run(model, toolInput, t, toolName = 'Workflow') {
  const dir = mkdtempSync(join(tmpdir(), 'cgc-wfpolicy-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const transcript = join(dir, 's.jsonl')
  writeFileSync(transcript, model ? JSON.stringify({ message: { model } }) + '\n' : '')
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput, transcript_path: transcript, hook_event_name: 'PreToolUse' }),
    encoding: 'utf8',
    timeout: 20000,
  })
  assert.equal(r.status, 0, 'the hook must always exit 0')
  const out = String(r.stdout || '').trim()
  return out ? JSON.parse(out) : null
}

// ── Gate 1: the vocabulary cannot drift between the two hooks ───────────────
test('the workflow hook carries a byte-identical copy of the routing vocabulary', () => {
  assert.deepEqual(wf.SIGNAL_SOURCES, route.SIGNAL_SOURCES,
    'SIGNAL_SOURCES differ between pre-tool-model-route.js and pre-tool-workflow-policy.js. '
    + 'Hooks cannot import each other, so the copy must be updated by hand — this test is what '
    + 'makes that safe.')
})

test('both hooks classify pinned and routable models identically', () => {
  for (const id of ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-opus-4-8', 'claude-opus-5',
    'claude-fable-5-1', 'claude-sonnet-5[1m]', 'opus', 'haiku']) {
    assert.equal(wf.classify(id), route.classify(id), `classify(${id}) diverged between the hooks`)
  }
})

// ── The injection itself ────────────────────────────────────────────────────
test('object args receive __modelPolicy with the session model, pinned flag and signals', (t) => {
  const out = run('claude-fable-5-1', { script: 'x', args: { brief: 'hero' } }, t)
  assert.ok(out, 'the hook must rewrite the Workflow input')
  const p = out.hookSpecificOutput.updatedInput.args.__modelPolicy
  assert.equal(p.sessionModel, 'claude-fable-5-1')
  assert.equal(p.pinned, false)
  assert.deepEqual(p.signals, route.SIGNAL_SOURCES)
  assert.equal(out.hookSpecificOutput.updatedInput.args.brief, 'hero', 'existing args must survive')
  assert.equal(out.hookSpecificOutput.updatedInput.script, 'x', 'the script must be untouched')
})

test('absent args receive a fresh object carrying the policy', (t) => {
  const out = run('claude-opus-5', { script: 'x' }, t)
  assert.ok(out)
  assert.equal(out.hookSpecificOutput.updatedInput.args.__modelPolicy.pinned, false)
})

test('a pinned session marks pinned:true so the helper inherits everywhere', (t) => {
  for (const model of ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-opus-4-8']) {
    const out = run(model, { script: 'x', args: {} }, t)
    assert.ok(out, `${model}: policy must still be injected so the script knows it is pinned`)
    assert.equal(out.hookSpecificOutput.updatedInput.args.__modelPolicy.pinned, true, model)
  }
})

test('a primitive args value is left untouched — rewriting a string brief would break the script', (t) => {
  assert.equal(run('claude-opus-5', { script: 'x', args: 'a plain brief' }, t), null)
  assert.equal(run('claude-opus-5', { script: 'x', args: ['a', 'b'] }, t), null)
})

test('a workflow that already carries a policy is not re-injected', (t) => {
  assert.equal(run('claude-opus-5', { script: 'x', args: { __modelPolicy: { pinned: true } } }, t), null)
})

test('non-Workflow tools and an unknown session model produce no output', (t) => {
  assert.equal(run('claude-opus-5', { script: 'x', args: {} }, t, 'Agent'), null)
  assert.equal(run(null, { script: 'x', args: {} }, t), null)
})

test('the hook never returns a permission decision', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cgc-wfpolicy-perm-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const transcript = join(dir, 's.jsonl')
  writeFileSync(transcript, JSON.stringify({ message: { model: 'claude-opus-5' } }) + '\n')
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: 'Workflow', tool_input: { script: 'x', args: {} }, transcript_path: transcript }),
    encoding: 'utf8', timeout: 20000,
  })
  assert.doesNotMatch(String(r.stdout || ''), /permissionDecision/)
})

test('malformed stdin never crashes the hook', () => {
  for (const input of ['', 'nonsense', '{}', '{"tool_name":"Workflow"}', '{"tool_name":"Workflow","tool_input":[1]}']) {
    const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', timeout: 20000 })
    assert.equal(r.status, 0, `must survive: ${input}`)
  }
})

// ── Gate 2: the SHIPPED helper agrees with decide() on the whole corpus ──────
/** Pull routeModel out of the shipped workflow by its markers and evaluate that exact text. */
function shippedHelper() {
  const src = readFileSync(WORKFLOW, 'utf8')
  const m = src.match(/function routeModel\(policy, input\) \{[\s\S]*?\n\}\n\/\/ end routeModel/)
  assert.ok(m, 'workflows/design-divergence.js must define routeModel between its markers')
  // eslint-disable-next-line no-new-func
  return new Function(`${m[0]}\nreturn routeModel`)()
}

test('the shipped workflow helper routes every corpus case exactly as the routing hook does', () => {
  if (!existsSync(CORPUS)) return
  const routeModel = shippedHelper()
  const policy = { sessionModel: 'claude-fable-5-1', pinned: false, signals: route.SIGNAL_SOURCES }
  const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'))
  const mismatches = []
  for (const c of corpus) {
    const expected = route.decide(c.input)          // null means inherit
    const actual = routeModel(policy, c.input)      // undefined means inherit
    const e = expected === null ? 'inherit' : expected
    const a = actual === undefined ? 'inherit' : actual
    if (e !== a) mismatches.push(`${c.id}: hook=${e} helper=${a}`)
  }
  assert.deepEqual(mismatches, [],
    `the script helper and the routing hook disagree — fix the helper, never the hook:\n  ${mismatches.join('\n  ')}`)
})

test('on a pinned policy the shipped helper returns undefined for every corpus case', () => {
  if (!existsSync(CORPUS)) return
  const routeModel = shippedHelper()
  const policy = { sessionModel: 'claude-opus-4-7', pinned: true, signals: route.SIGNAL_SOURCES }
  const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'))
  const leaked = corpus.filter((c) => routeModel(policy, c.input) !== undefined).map((c) => c.id)
  assert.deepEqual(leaked, [],
    `a pinned session must never assign a model; these cases did:\n  ${leaked.join('\n  ')}`)
})

test('without an injected policy the shipped helper inherits — the safe default', () => {
  const routeModel = shippedHelper()
  assert.equal(routeModel(null, { prompt: 'List every file that imports the logger.' }), undefined)
  assert.equal(routeModel({ pinned: false }, { prompt: 'List every file.' }), undefined, 'no signals -> no routing')
})
