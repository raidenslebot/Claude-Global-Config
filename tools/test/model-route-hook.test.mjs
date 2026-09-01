// The PreToolUse hook that applies model routing MECHANICALLY.
//
// The point of this hook is that nothing has to remember the policy: it rewrites the Agent
// tool's input before the call runs. So these tests check behaviour, not advice — does the
// option actually get stripped, filled, or left alone.
//
// The bias under test: a wrong DOWNGRADE produces confident wrong output nobody notices, while
// an unnecessary inherit only costs money. So ambiguity must always resolve to inherit.

import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'

const HOOK = join(REPO, 'config', 'hooks', 'pre-tool-model-route.js')

function run(model, toolInput, t, toolName = 'Agent') {
  const dir = mkdtempSync(join(tmpdir(), 'cgc-route-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const transcript = join(dir, 's.jsonl')
  writeFileSync(transcript, model ? JSON.stringify({ message: { model } }) + '\n' : '')
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      tool_name: toolName,
      tool_input: toolInput,
      transcript_path: transcript,
      hook_event_name: 'PreToolUse',
    }),
    encoding: 'utf8',
    timeout: 20000,
  })
  assert.equal(r.status, 0, 'the hook must always exit 0')
  const out = String(r.stdout || '').trim()
  return out ? JSON.parse(out).hookSpecificOutput.updatedInput : null
}

// ── The exception: a pinned session ─────────────────────────────────────────
for (const model of ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-opus-4-8']) {
  test(`${model}: an explicit model override is STRIPPED so the agent inherits`, (t) => {
    const updated = run(model, { prompt: 'do a thing', model: 'sonnet' }, t)
    assert.ok(updated, 'the hook must rewrite the input')
    assert.equal('model' in updated, false,
      'inheritance is the only mechanism that reproduces an exact version, so the option must go')
    assert.equal(updated.prompt, 'do a thing', 'the rest of the input must be untouched')
  })

  test(`${model}: an input with no model is left alone (already inherits)`, (t) => {
    assert.equal(run(model, { prompt: 'review this diff for bugs' }, t), null,
      'nothing to change means no output — and review must NOT be upgraded on a pinned session')
  })
}

// ── The default: gauge by difficulty ────────────────────────────────────────
test('verification work is routed to opus without being asked', (t) => {
  const updated = run('claude-fable-5', { prompt: 'Review this patch and verify the fix is correct.' }, t)
  assert.equal(updated && updated.model, 'opus')
})

test('a reviewer agent type is routed to opus from its type alone', (t) => {
  const updated = run('claude-opus-5', { subagent_type: 'code-reviewer', prompt: 'look at the diff' }, t)
  assert.equal(updated && updated.model, 'opus')
})

test('purely mechanical retrieval is routed to haiku', (t) => {
  const updated = run('claude-fable-5', { prompt: 'List all files that import the logger.' }, t)
  assert.equal(updated && updated.model, 'haiku')
})

test('the Explore agent type is routed to haiku', (t) => {
  const updated = run('claude-fable-5', { subagent_type: 'Explore', prompt: 'where is auth handled' }, t)
  assert.equal(updated && updated.model, 'haiku')
})

test('implementing an already-specified change is routed to sonnet', (t) => {
  const updated = run('claude-opus-5', { prompt: 'Implement the change according to the spec in the ticket.' }, t)
  assert.equal(updated && updated.model, 'sonnet')
})

// ── The bias: ambiguity inherits, never downgrades ──────────────────────────
test('a search phrased as a decision is NOT downgraded', (t) => {
  // "find the best approach" is judgment wearing the word "find".
  assert.equal(run('claude-fable-5', { prompt: 'Find the best approach for caching here.' }, t), null,
    'a decision verb must veto the mechanical downgrade')
})

test('open-ended design inherits rather than being routed anywhere', (t) => {
  assert.equal(run('claude-opus-5', { prompt: 'Design the data model for this feature.' }, t), null)
})

test('a model the caller passed is OVERRIDDEN — the hook is authoritative', (t) => {
  // The whole point of moving this into a hook is that the caller cannot spawn an agent on a
  // model the policy did not choose. Deferring to a passed value would make the rule advisory
  // again, which is what it was before and what did not work.
  const updated = run('claude-opus-5', { prompt: 'List every test file.', model: 'opus' }, t)
  assert.ok(updated, 'an over-assigned model must be corrected, not accepted')
  assert.equal(updated.model, 'haiku', 'pure retrieval is haiku regardless of what was passed')
})

test('a caller under-assigning a judgment task is corrected upward', (t) => {
  // The dangerous direction. A caller asking haiku to make a design decision must not get it.
  const updated = run('claude-opus-5', { prompt: 'Design the caching strategy for this service.', model: 'haiku' }, t)
  assert.ok(updated, 'an under-assigned model must be corrected')
  assert.equal('model' in updated, false, 'judgment work inherits the session model')
})

// ── Safety ──────────────────────────────────────────────────────────────────
test('a non-agent tool is never touched', (t) => {
  assert.equal(run('claude-opus-5', { file_path: '/x', content: 'y' }, t, 'Write'), null)
})

test('an unknown session model changes nothing', (t) => {
  assert.equal(run(null, { prompt: 'List all the files.' }, t), null,
    'without knowing the session model, guessing is worse than doing nothing')
})

test('the hook never grants permission — it only adjusts an argument', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cgc-route-perm-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const transcript = join(dir, 's.jsonl')
  writeFileSync(transcript, JSON.stringify({ message: { model: 'claude-opus-4-7' } }) + '\n')
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: 'Agent', tool_input: { prompt: 'x', model: 'haiku' }, transcript_path: transcript }),
    encoding: 'utf8',
    timeout: 20000,
  })
  assert.doesNotMatch(String(r.stdout || ''), /permissionDecision/,
    'rewriting an argument must not bypass the user approval flow for spawning agents')
})

test('malformed input never crashes the hook', () => {
  for (const input of ['', 'nonsense', '{}', '{"tool_name":"Agent"}', '{"tool_name":"Agent","tool_input":[1,2]}']) {
    const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', timeout: 20000 })
    assert.equal(r.status, 0, `must survive: ${input}`)
  }
})
