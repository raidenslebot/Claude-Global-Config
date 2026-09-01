// The one-turn gap after `/model`, and the version shapes a switch can produce.
//
// Found live: the user ran `/model claude-fable-5-1`, and the very next prompt's policy hook
// reported `claude-opus-5`. Both hooks read the model from the last assistant message in the
// transcript, and on the first prompt after a switch no assistant turn on the new model exists
// yet. For the advisory hook that is a stale sentence. For the ROUTING hook it would be a real
// violation: a switch TO a pinned version would route by difficulty for one turn.
//
// The `/model` command is recorded as a user-side record the instant it runs, so scanning
// backwards it is the most recent fact about the model. These tests pin that both hooks read it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { REPO } from '../paths.mjs'

const require = createRequire(import.meta.url)
const { classify } = require('../../config/hooks/pre-tool-model-route.js')

const POLICY = join(REPO, 'config', 'hooks', 'user-prompt-model-policy.js')
const ROUTE = join(REPO, 'config', 'hooks', 'pre-tool-model-route.js')

/** A transcript shaped like the real one: an assistant turn on `before`, then a /model
 *  command switching to `after`, and NO assistant turn yet on the new model. */
function switchedTranscript(t, before, after) {
  const dir = mkdtempSync(join(tmpdir(), 'cgc-switch-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const p = join(dir, 's.jsonl')
  const assistant = JSON.stringify({ type: 'assistant', message: { model: before, content: 'earlier answer' } })
  // The real record embeds the command markup inside a JSON string with literal \n escapes.
  const command = JSON.stringify({
    type: 'user',
    message: {
      content: `<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args>${after}</command-args>`,
    },
  })
  writeFileSync(p, `${assistant}\n${command}\n`)
  return p
}

function policyOutput(transcript) {
  const r = spawnSync(process.execPath, [POLICY], {
    input: JSON.stringify({ transcript_path: transcript, hook_event_name: 'UserPromptSubmit' }),
    encoding: 'utf8', timeout: 20000,
  })
  assert.equal(r.status, 0)
  return String(r.stdout || '')
}

function routeOutput(transcript, toolInput) {
  const r = spawnSync(process.execPath, [ROUTE], {
    input: JSON.stringify({ tool_name: 'Agent', tool_input: toolInput, transcript_path: transcript }),
    encoding: 'utf8', timeout: 20000,
  })
  assert.equal(r.status, 0)
  const out = String(r.stdout || '').trim()
  return out ? JSON.parse(out).hookSpecificOutput.updatedInput : null
}

// ── The gap, in the dangerous direction ─────────────────────────────────────
test('switching TO a pinned model is honoured on the very next prompt, before any assistant turn', (t) => {
  const p = switchedTranscript(t, 'claude-opus-5', 'claude-opus-4-7')
  assert.match(policyOutput(p), /runs `claude-opus-4-7`/, 'the advisory hook must name the NEW model')
  assert.match(policyOutput(p), /PINNED/)
  // The routing hook must STRIP an override immediately — not one turn later.
  const updated = routeOutput(p, { prompt: 'List every file that imports the logger.', model: 'haiku' })
  assert.ok(updated, 'a passed model on a freshly pinned session must be corrected')
  assert.equal('model' in updated, false, 'inheritance is the only correct action on a pinned session')
})

test('switching AWAY from a pinned model routes by difficulty on the very next prompt', (t) => {
  const p = switchedTranscript(t, 'claude-opus-4-7', 'claude-fable-5-1')
  assert.match(policyOutput(p), /runs `claude-fable-5-1`/)
  assert.doesNotMatch(policyOutput(p), /PINNED/)
  const updated = routeOutput(p, { prompt: 'List every file that imports the logger.' })
  assert.equal(updated && updated.model, 'haiku', 'a mechanical task routes down once the session is routable')
})

test('the command record beats an OLDER assistant message, never a newer one', (t) => {
  // After the switch, the assistant answers on the new model. From then on the assistant
  // message is the most recent fact and must win — a stale command record further back must
  // not keep reporting a model the session has since left.
  const dir = mkdtempSync(join(tmpdir(), 'cgc-switch-order-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const p = join(dir, 's.jsonl')
  const cmd = JSON.stringify({ type: 'user', message: { content: '<command-name>/model</command-name>\n<command-args>claude-opus-4-7</command-args>' } })
  const later = JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5' } })
  writeFileSync(p, `${cmd}\n${later}\n`)
  assert.match(policyOutput(p), /runs `claude-sonnet-5`/, 'the newer assistant message wins')
})

test('a "Set model to" confirmation quoted inside tool output is NOT mistaken for a switch', (t) => {
  // This session's own tool output echoed `Set model to \`claude-fable-5-1\``. Only the
  // structured command markup is trusted; the confirmation text alone must be ignored.
  const dir = mkdtempSync(join(tmpdir(), 'cgc-switch-quote-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const p = join(dir, 's.jsonl')
  const assistant = JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5' } })
  const echoed = JSON.stringify({ type: 'tool_result', content: 'Set model to `claude-opus-4-7`' })
  writeFileSync(p, `${assistant}\n${echoed}\n`)
  assert.match(policyOutput(p), /runs `claude-opus-5`/, 'echoed confirmation text must not change the model')
})

// ── Version shapes a switch can produce ─────────────────────────────────────
test('fable-5-1 is routable: the user expects difficulty routing under it', () => {
  assert.equal(classify('claude-fable-5-1'), 'routable')
})

test('a 1M-context suffix does not change the classification', () => {
  // The picker lists entries like claude-fable-5-1[1m]. The suffix names a context variant,
  // not a different generation, so it must classify exactly as the bare id does.
  assert.equal(classify('claude-fable-5-1[1m]'), 'routable')
  assert.equal(classify('claude-sonnet-5[1m]'), 'routable')
  assert.equal(classify('claude-opus-4-8[1m]'), 'pinned')
})

test('every pinned version the user named stays pinned under any spelling the picker uses', () => {
  for (const id of ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-opus-4-8', 'claude-opus-4-7[1m]', 'claude-sonnet-4-6[1m]']) {
    assert.equal(classify(id), 'pinned', `${id} must force inheritance`)
  }
})

test('a bare alias typed into /model is treated as routable', () => {
  // `/model opus` selects the current-generation alias target, which the coarse aliases CAN
  // express — so routing is meaningful and the pin rule does not apply.
  for (const alias of ['opus', 'sonnet', 'fable', 'haiku']) {
    assert.equal(classify(alias), 'routable', `alias ${alias}`)
  }
})
