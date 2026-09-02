// outline-text turns text into one SVG path with the font's own kerning, so a wordmark or a
// name can be delivered without a font. These use a font the machine already has and skip, not
// pass, when none of the usual system faces is present. The Google Fonts path needs the network
// and is exercised by hand; the parsing of its stylesheet is tested on a captured sample.

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { findFontkit, outline, svg, main } from '../outline-text.mjs'
import { REPO } from '../paths.mjs'

const FONTS = [
  'C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/segoeui.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf',
]
const FONT = FONTS.find(existsSync)
const fk = findFontkit()
const skip = !fk ? 'fontkit not installed' : !FONT ? 'no system font found to outline' : false

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'outline-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('text becomes one path with real curves, the metrics are the font\'s, and tracking widens it', { skip }, () => {
  const font = fk.module.create(readFileSync(FONT))
  const r = outline(font, 'Harbor', { size: 100 })
  assert.equal(r.glyphs, 6)
  assert.match(r.d, /^M[\d.-]+ [\d.-]+/)
  assert.ok(/[QC]/.test(r.d), 'letters have curves')
  assert.ok((r.d.match(/Z/g) || []).length >= 6, 'every glyph closes')
  assert.ok(r.width > 250 && r.width < 400, `width ${r.width}`)
  assert.ok(r.capHeight > 60 && r.capHeight < 80, `cap height ${r.capHeight} at 100px`)
  assert.ok(r.baseline > r.capHeight)
  const tracked = outline(font, 'Harbor', { size: 100, tracking: 0.1 })
  assert.ok(Math.abs(tracked.width - r.width - 50) < 0.5, 'five gaps of 0.1em at 100px add 50px')
  const doc = svg(r, { fill: '#123' })
  assert.match(doc, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 [\d.]+ [\d.]+">/)
  assert.equal((doc.match(/<path /g) || []).length, 1)
  assert.ok(!/<text/.test(doc), 'no live text')
})

test('the CLI writes the file, gives it a physical size with --units, and prints metrics with --json', { skip }, async (t) => {
  const d = scratch(t)
  const out = join(d, 'mark.svg')
  assert.equal(await main(['--font', FONT, '--text', 'HIGH WATER', '--size', '96', '--tracking', '0.12', '--units', 'in', '--out', out]), 0)
  const doc = readFileSync(out, 'utf8')
  assert.match(doc, /width="[\d.]+in" height="[\d.]+in"/)
  assert.match(doc, /viewBox="0 0 [\d.]+ [\d.]+"/)
  const r = spawnSync(process.execPath, [join(REPO, 'tools', 'outline-text.mjs'), '--font', FONT, '--text', 'Ab', '--json'], { encoding: 'utf8', timeout: 60000 })
  assert.equal(r.status, 0, r.stderr)
  const j = JSON.parse(r.stdout)
  assert.equal(j.glyphs, 2)
  assert.ok(j.capHeight > 0 && j.width > 0 && j.d === undefined)
})

const ITALIC = [
  'C:/Windows/Fonts/timesi.ttf', 'C:/Windows/Fonts/georgiai.ttf',
  '/System/Library/Fonts/Supplemental/Times New Roman Italic.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf',
].find(existsSync)

test('ink that hangs left of the origin is not clipped, and a glyph the font lacks is an error, never a box', { skip }, () => {
  const font = fk.module.create(readFileSync(FONT))
  assert.throws(() => outline(font, 'Tokyo 東京', { size: 50 }), /no glyph for "東", "京"/)
  if (!ITALIC) return
  const it = fk.module.create(readFileSync(ITALIC))
  const r = outline(it, 'fjord', { size: 96 })
  const xs = [...r.d.matchAll(/[MLQC]?(-?\d+\.?\d*) (-?\d+\.?\d*)/g)].map((m) => Number(m[1]))
  assert.ok(Math.min(...xs) >= -0.01, `minimum x ${Math.min(...xs)} — the path must start at the ink, not at the advance origin`)
  assert.ok(r.width > 0 && r.advance > 0)
})

test('usage on a missing argument, an error on a missing file — never a stack trace', async () => {
  assert.equal(await main(['--text', 'x']), 1)
  if (fk) assert.equal(await main(['--font', join(tmpdir(), 'nope-' + process.pid + '.ttf'), '--text', 'x']), 1)
})
