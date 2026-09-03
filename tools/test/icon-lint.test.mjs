// An icon SET is judged as a set. A single icon is almost never wrong; a set is wrong
// constantly, and always in ways that are invisible when the icons are looked at one at a time
// — which is how they are always looked at.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'
import { icons, read, lintSet } from '../icon-lint.mjs'

const TOOL = join(REPO, 'tools', 'icon-lint.mjs')
const SHIPPED = join(REPO, 'skills', 'design-fields', 'examples', 'harbor-swim-club-icons')

const ok = (extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"${extra}><path d="M4 12h16"/></svg>`

function set(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'icons-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body, 'utf8')
  return dir
}
function lint(dir, args = []) {
  const r = spawnSync(process.execPath, [TOOL, dir, '--json', ...args], { encoding: 'utf8', timeout: 60000 })
  return { status: r.status, json: JSON.parse(r.stdout) }
}
const ids = (j) => j.findings.map((f) => f.id)

test('a sprite is read as its symbols, and a plain file as one icon', () => {
  const sprite = '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="a" viewBox="0 0 24 24"><path d="M0 0"/></symbol><symbol id="b" viewBox="0 0 24 24"><path d="M1 1"/></symbol></svg>'
  assert.equal(icons(sprite, 's.svg').length, 2)
  assert.deepEqual(icons(sprite, 's.svg').map((i) => i.name), ['s.svg#a', 's.svg#b'])
  assert.equal(icons(ok(), 'one.svg').length, 1)
  assert.equal(icons('not an svg at all', 'x.svg').length, 0)
})

test('the set that ships agrees with itself', () => {
  const r = lint(SHIPPED)
  assert.equal(r.json.ok, true, JSON.stringify(r.json.findings, null, 1))
  assert.equal(r.json.grid, '0 0 24 24')
  assert.equal(r.json.stroke, '2')
  assert.ok(r.json.count >= 8)
})

test('the majority is the rule, and every icon that breaks it is named', (t) => {
  const dir = set(t, {
    'a.svg': ok(), 'b.svg': ok(), 'c.svg': ok(),
    'grid.svg': ok().replace('0 0 24 24', '0 0 20 20'),
    'weight.svg': ok().replace('stroke-width="2"', 'stroke-width="1.5"'),
  })
  const { json, status } = lint(dir)
  assert.ok(ids(json).includes('off-grid-set'), 'a different grid is named')
  assert.ok(ids(json).includes('stroke-weight'), 'a different weight is named')
  assert.equal(json.grid, '0 0 24 24', 'the majority sets the rule')
  assert.equal(status, 0, 'without --strict it reports rather than fails')
  assert.equal(lint(dir, ['--strict']).status, 1)
})

test('what is wrong at any size is wrong in a set of one', (t) => {
  const text = set(t, { 'a.svg': '<svg viewBox="0 0 24 24" stroke="currentColor"><text x="4" y="16">A</text></svg>' })
  assert.ok(ids(lint(text).json).includes('live-text'))

  const raster = set(t, { 'a.svg': '<svg viewBox="0 0 24 24"><image href="data:image/png;base64,iVBOR" width="24"/></svg>' })
  assert.ok(ids(lint(raster).json).includes('raster'))

  const pinned = set(t, { 'a.svg': ok().replace('stroke="currentColor"', 'stroke="#ff5a1f"') })
  assert.ok(ids(lint(pinned).json).includes('hardcoded-colour'))

  const noBox = set(t, { 'a.svg': '<svg xmlns="http://www.w3.org/2000/svg" stroke="currentColor"><path d="M0 0"/></svg>' })
  assert.ok(ids(lint(noBox).json).includes('no-viewbox'))
})

test('a stroke is judged at the size the set is actually used at', (t) => {
  const dir = set(t, { 'a.svg': ok().replace('0 0 24 24', '0 0 64 64') })
  assert.ok(ids(lint(dir, ['--size', '16']).json).includes('thin-at-size'),
    'stroke 2 on a 64 grid is half a pixel at 16px')
  assert.ok(!ids(lint(dir, ['--size', '64']).json).includes('thin-at-size'),
    'at the size it was drawn for it is fine')
})

test('drawn on the grid passes; traced off it is reported', () => {
  const drawn = read(icons(ok(), 'a.svg')[0])
  assert.equal(drawn.offGrid, 0)
  const traced = read(icons('<svg viewBox="0 0 64 64" stroke="currentColor" stroke-width="2"><path d="M8.137 32.482c3.229-1.884 7.913-4.221 11.664.918 2.774 3.117 5.331 1.006 8.42-.774"/></svg>', 'b.svg')[0])
  assert.ok(traced.offGrid >= 8)
  assert.ok(lintSet([traced], { size: 16 }).findings.some((f) => f.id === 'traced'))
  // Halves and quarters are drawing on the grid, not off it.
  const halves = read(icons('<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M4.5 12.5h15.5m-8-8.25v16.25M2.75 6.5h18.25m-9 .75v9.5"/></svg>', 'c.svg')[0])
  assert.equal(halves.offGrid, 0, 'a half or a quarter is on the grid')
})

test('--help exits 0 and a missing path is a failure', () => {
  const help = spawnSync(process.execPath, [TOOL, '--help'], { encoding: 'utf8', timeout: 30000 })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /cgc icons/)
  const missing = spawnSync(process.execPath, [TOOL, join(tmpdir(), 'no-icons-here-8812')], { encoding: 'utf8', timeout: 30000 })
  assert.equal(missing.status, 1)
})
