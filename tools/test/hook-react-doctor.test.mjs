// The react-doctor hook runs on every write in every project, so its gate has to be exact: a
// markdown, SVG, CSS or JSON write is not React work, and scanning the whole project for one
// told the turn nothing and buried it in warnings about code it never touched. These check the
// gate alone — the scan itself needs a JS project and a runner, which a fixture cannot promise.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'

const HOOK = join(REPO, 'config', 'hooks', 'react-doctor.mjs')

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hook-rd-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
/** Runs the hook on a written file in an empty directory: silent means the gate said no. */
// CLAUDE_PROJECT_DIR is always set in a real session, and it is the value the hook used to fall
// back to — so every case here sets it to a real project. Leaving it unset would let a test pass
// because nothing was there to scan rather than because the gate said no.
function fire(payload, cwd) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 120000, cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: REPO },
  })
  assert.equal(r.status, 0, `hook must always exit 0: ${r.stderr}`)
  return r.stdout.trim()
}

test('a write to a file react-doctor cannot read is not scanned', (t) => {
  const d = scratch(t)
  for (const name of ['README.md', 'mark.svg', 'deck.css', 'data.json', 'notes.txt', 'card.html']) {
    const f = join(d, name); writeFileSync(f, '# nothing to see\n')
    assert.equal(fire({ tool_name: 'Write', tool_input: { file_path: f } }, d), '', `scanned on a write to ${name}`)
  }
})

test('a tool that is not a write is not scanned, whatever the file', (t) => {
  const d = scratch(t)
  const f = join(d, 'app.tsx'); writeFileSync(f, 'export const A = () => null\n')
  assert.equal(fire({ tool_name: 'Read', tool_input: { file_path: f } }, d), '')
  assert.equal(fire({ tool_name: 'Bash', tool_input: { command: 'ls' } }, d), '')
})

test('a batch is scanned only when one of its writes is a JS or TS file', (t) => {
  const d = scratch(t)
  const md = join(d, 'a.md'), tsx = join(d, 'a.tsx')
  writeFileSync(md, '# a\n'); writeFileSync(tsx, 'export const A = () => null\n')
  assert.equal(fire({ hook_event_name: 'PostToolBatch', tool_calls: [{ tool_name: 'Write', tool_input: { file_path: md } }] }, d), '',
    'a batch of markdown writes is not React work')
  // The JS case may or may not produce output (no runner, no project) — it must not throw.
  fire({ hook_event_name: 'PostToolBatch', tool_calls: [{ tool_name: 'Write', tool_input: { file_path: tsx } }] }, d)
})

test("a JS file with no package.json above it is not a project, and is not scanned", (t) => {
  const d = scratch(t)
  const f = join(d, 'loose.mjs'); writeFileSync(f, 'export const a = 1\n')
  // The session's own directory is a real project; the hook must still not scan it for a file
  // that belongs to no project — that is how a report ends up naming code the edit never touched.
  assert.equal(fire({ tool_name: 'Write', tool_input: { file_path: f } }, REPO), '')
})

test('never crashes on a null, empty or malformed payload', (t) => {
  const d = scratch(t)
  for (const input of ['null', '', '{', '{}']) {
    const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', timeout: 120000, cwd: d })
    assert.equal(r.status, 0, `input ${JSON.stringify(input)}: ${r.stderr}`)
  }
})
