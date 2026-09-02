// The directions gate: a physical design written with no directions.md beside it is reported.
// The requirement was advisory and was skipped by the author of the skill that states it — the
// first card made with print-design was the centroid — so it is a hook now. These run the
// shipped hook with a real PostToolUse payload and assert on the three cases that matter: a
// physical design without directions fires; with directions it is silent; a screen page is
// silent. False positives would get the hook deleted, so the silent cases are the real tests.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'

const HOOK = join(REPO, 'config', 'hooks', 'post-tool-print-directions.js')

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hook-directions-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function fire(file, tool = 'Write') {
  const payload = JSON.stringify({ tool_name: tool, tool_input: { file_path: file } })
  const r = spawnSync(process.execPath, [HOOK], { input: payload, encoding: 'utf8', timeout: 20000 })
  assert.equal(r.status, 0, `hook must always exit 0: ${r.stderr}`)
  if (!r.stdout.trim()) return null
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext
}

const CARD = '<!doctype html><style>@page { size: 3.75in 2.25in; margin: 0 }</style><div>card</div>'
const SVG_PHYS = '<svg xmlns="http://www.w3.org/2000/svg" width="4in" height="2in" viewBox="0 0 400 200"></svg>'
const SCREEN = '<!doctype html><style>body { width: 1200px }</style><div>landing page</div>'
const SVG_SCREEN = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"></svg>'

test('a physical HTML design with no directions.md beside it is reported, naming the file and the missing artifact', (t) => {
  const d = scratch(t)
  const f = join(d, 'front.html'); writeFileSync(f, CARD)
  const ctx = fire(f)
  assert.ok(ctx, 'expected the hook to speak')
  assert.match(ctx, /PHYSICAL DESIGN WITHOUT DIRECTIONS/)
  assert.match(ctx, /front\.html/)
  assert.match(ctx, /directions\.md/)
  assert.match(ctx, /swap/i, 'the message carries the test, not just the demand')
})

test('a physical SVG is treated the same way', (t) => {
  const d = scratch(t)
  const f = join(d, 'mark.svg'); writeFileSync(f, SVG_PHYS)
  assert.match(fire(f, 'Edit') || '', /PHYSICAL DESIGN WITHOUT DIRECTIONS/)
})

test('silent once directions.md exists beside the design', (t) => {
  const d = scratch(t)
  writeFileSync(join(d, 'directions.md'), '# Directions\n')
  const f = join(d, 'front.html'); writeFileSync(f, CARD)
  assert.equal(fire(f), null)
})

test('silent on a screen page, a pixel-sized SVG, a non-design file, and a tool that is not a write', (t) => {
  const d = scratch(t)
  const a = join(d, 'index.html'); writeFileSync(a, SCREEN)
  const b = join(d, 'icon.svg'); writeFileSync(b, SVG_SCREEN)
  const c = join(d, 'notes.md'); writeFileSync(c, '@page { size: 3.75in 2.25in }')
  assert.equal(fire(a), null, 'a screen layout is not a print design')
  assert.equal(fire(b), null, 'an SVG in pixels is not a print design')
  assert.equal(fire(c), null, 'only .html/.svg are inspected')
  const f = join(d, 'front.html'); writeFileSync(f, CARD)
  assert.equal(fire(f, 'Read'), null, 'a read is not a write')
})

test('never crashes on a missing file, bad JSON, or an empty payload', () => {
  for (const input of ['', '{', JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(tmpdir(), 'nope-does-not-exist.html') } })]) {
    const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', timeout: 20000 })
    assert.equal(r.status, 0)
    assert.equal(r.stdout.trim(), '')
  }
})
