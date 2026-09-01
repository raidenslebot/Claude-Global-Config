// Model routing policy, and the invariant that makes the pin rule work.
//
// The rule: when a session is pinned to a specific model version, every spawned agent must
// INHERIT it. That is not a preference — the model option accepts coarse aliases only
// (sonnet/opus/haiku/fable), so an alias cannot express "the version I chose" and overriding is
// guaranteed to run something else, silently.
//
// Two things therefore have to hold, and both are gated here:
//   1. the hook classifies a pinned session as pinned, and
//   2. nothing this package ships sets `model:` in agent frontmatter, because frontmatter
//      overrides inheritance for EVERY session including pinned ones.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'

const HOOK = join(REPO, 'config', 'hooks', 'user-prompt-model-policy.js')

/** Run the hook against a transcript whose last message names `model`. */
function classify(model, t) {
  const dir = mkdtempSync(join(tmpdir(), 'cgc-model-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const transcript = join(dir, 'session.jsonl')
  writeFileSync(transcript, model === null ? '' : JSON.stringify({ message: { model } }) + '\n')
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ transcript_path: transcript, hook_event_name: 'UserPromptSubmit' }),
    encoding: 'utf8',
    timeout: 20000,
  })
  assert.equal(r.status, 0, 'the hook must always exit 0 — it advises, it never blocks')
  return String(r.stdout || '')
}

// The three versions the user pins by hand. Each must force inheritance.
for (const model of ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-opus-4-8']) {
  test(`a session on ${model} forces every agent to inherit`, (t) => {
    const out = classify(model, t)
    assert.match(out, /PINNED/, `${model} must be treated as a pinned selection`)
    assert.match(out, /Do NOT\s+pass a `model` option|Do NOT pass a `model` option/,
      'the instruction must be to omit the option, not to pass a matching alias')
    // An alias cannot name a version, so suggesting one would be actively wrong.
    assert.doesNotMatch(out, /use `opus`|pass `opus`|model: *['"]?opus/i,
      'a pinned session must never be told to pass an alias')
  })
}

for (const model of ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5', 'claude-haiku-4-5-20251001']) {
  test(`a session on ${model} routes spawned agents by task difficulty`, (t) => {
    const out = classify(model, t)
    assert.doesNotMatch(out, /PINNED/, `${model} is a current-generation model and is routable`)
    assert.match(out, /TASK DIFFICULTY/, 'routing must be gauged by difficulty, not by role label')
    assert.match(out, /haiku/, 'the trivial tier must be named')
    assert.match(out, /sonnet/, 'the specified-work tier must be named')
    assert.match(out, /opus/, 'the verification tier must be named')
    assert.match(out, /INHERIT/, 'genuinely hard work must inherit the session model')
    // The four tiers must be offered for EVERY routable model. An earlier version capped
    // routing at the session's own model, which silently removed the verification tier from
    // a cheaper main and is not what was asked for.
    assert.doesNotMatch(out, /ceiling|never route[^.]*above/i,
      'no ceiling: difficulty decides, not the session model')
  })
}

test('an unreadable or unknown transcript produces silence, never a guess', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cgc-model-none-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const payload of [
    { transcript_path: join(dir, 'missing.jsonl') },
    { transcript_path: '' },
    {},
  ]) {
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', timeout: 20000 })
    assert.equal(r.status, 0)
    assert.equal(String(r.stdout || '').trim(), '',
      'a wrong routing instruction is worse than none — say nothing when the model is unknown')
  }
})

test('malformed stdin does not crash the hook', () => {
  for (const input of ['', 'not json', '[1,2,3]', '{"transcript_path":42}']) {
    const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', timeout: 20000 })
    assert.equal(r.status, 0, `hook must survive: ${input}`)
  }
})

test('no shipped agent sets a model in frontmatter, which would break the pin rule', () => {
  // Frontmatter `model:` overrides inheritance for EVERY session, including a pinned one —
  // so a single "helpful" pin in an agent definition silently defeats the whole rule.
  const offenders = []
  const roots = [join(REPO, 'argo', 'plugin', 'agents'), join(REPO, 'agents')]
  for (const dir of roots) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
      const fm = (readFileSync(join(dir, name), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/) || [, ''])[1]
      if (/^model:/m.test(fm)) offenders.push(`${dir}/${name}`)
    }
  }
  assert.deepEqual(offenders, [],
    `these agents pin a model and would ignore a pinned session:\n  ${offenders.join('\n  ')}`)
})

test('the shipped workflow does not hardcode a model for its agents', () => {
  // Same reasoning one layer up: a workflow that passes `model:` to agent() overrides
  // inheritance, so a pinned session silently runs a different model inside the fan-out.
  const dir = join(REPO, 'workflows')
  if (!existsSync(dir)) return
  const offenders = []
  for (const name of readdirSync(dir).filter((n) => /\.m?js$/.test(n))) {
    const text = readFileSync(join(dir, name), 'utf8')
    for (const m of text.matchAll(/model\s*:\s*['"](sonnet|opus|haiku|fable)['"]/g)) {
      offenders.push(`workflows/${name}: model: '${m[1]}'`)
    }
  }
  assert.deepEqual(offenders, [],
    `hardcoded agent models defeat inheritance on a pinned session:\n  ${offenders.join('\n  ')}`)
})
