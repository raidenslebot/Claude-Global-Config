// print-lint is the gate the print-design skill promises: a file that would not survive the
// press does not leave the machine. Each case plants one specific physical violation and asserts
// the lint names it — and that a clean file passes, because a gate with false positives gets
// switched off.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { lint, colours, MINIMUMS, PRESETS } from '../print-lint.mjs'
import { PRESETS as RENDER_PRESETS } from '../print-render.mjs'
import { REPO } from '../paths.mjs'

const require_child = () => createRequire(import.meta.url)('node:child_process')

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'print-lint-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
function file(dir, name, body) { const p = join(dir, name); writeFileSync(p, body, 'utf8'); return p }
const rules = (r, level) => r.findings.filter((f) => f.level === level).map((f) => f.rule)

const GOOD_CARD = `<!doctype html><style>
@page { size: 3.75in 2.25in; margin: 0; }
html, body { margin: 0; }
.sheet { width: 3.75in; height: 2.25in; position: relative; overflow: hidden; background: #1b1b1f; }
.safe { position: absolute; inset: 0.25in; color: #f2ede4; }
h1 { font: 500 14pt/1.1 Georgia, serif; margin: 0; }
p { font: 7.5pt/1.35 Georgia, serif; margin: 0.1in 0 0; }
.rule { border-top: 0.5pt solid #f2ede4; margin-top: 0.15in; }
</style><div class="sheet"><div class="safe"><h1>Ada Vance</h1><div class="rule"></div><p>ada@example.com</p></div></div>`

test('a print-ready card passes with no failures', (t) => {
  const r = lint(file(scratch(t), 'good.html', GOOD_CARD), { size: 'business-card-us' })
  assert.deepEqual(rules(r, 'fail'), [], JSON.stringify(r.findings))
  assert.equal(r.ok, true)
})

test('type below 6pt fails and is named; 6–7pt only warns', (t) => {
  const d = scratch(t)
  const bad = lint(file(d, 'small.html', GOOD_CARD.replace('font: 7.5pt/1.35', 'font: 5pt/1.35')), { size: 'business-card-us' })
  assert.ok(rules(bad, 'fail').includes('type'), JSON.stringify(bad.findings))
  assert.match(bad.findings.find((f) => f.rule === 'type').msg, /5\.0pt.*below the 6pt minimum/)
  const edge = lint(file(d, 'edge.html', GOOD_CARD.replace('font: 7.5pt/1.35', 'font: 6.5pt/1.35')), { size: 'business-card-us' })
  assert.deepEqual(rules(edge, 'fail'), [])
  assert.ok(rules(edge, 'warn').includes('type'), 'reversed-type warning at 6.5pt')
})

test('a hairline below 0.25pt fails; a 0.5pt rule passes', (t) => {
  const d = scratch(t)
  const bad = lint(file(d, 'hair.html', GOOD_CARD.replace('border-top: 0.5pt', 'border-top: 0.1pt')), { size: 'business-card-us' })
  assert.ok(rules(bad, 'fail').includes('line'))
  assert.match(bad.findings.find((f) => f.rule === 'line').msg, /0\.10pt.*drop out/)
})

test('no @page size, pixel page size, trim-only size, and wrong size each fail with the right rule', (t) => {
  const d = scratch(t)
  const none = lint(file(d, 'none.html', GOOD_CARD.replace(/@page[^}]*\}/, '')), { size: 'business-card-us' })
  assert.ok(rules(none, 'fail').includes('size'))
  assert.match(none.findings.find((f) => f.rule === 'size').msg, /no `@page/)

  const px = lint(file(d, 'px.html', GOOD_CARD.replace('size: 3.75in 2.25in', 'size: 360px 216px')), { size: 'business-card-us' })
  assert.match(px.findings.find((f) => f.rule === 'size').msg, /pixels/)

  // Exactly the trim size means the author forgot the bleed — the most common real mistake.
  const noBleed = lint(file(d, 'nobleed.html', GOOD_CARD.replace('size: 3.75in 2.25in', 'size: 3.5in 2in')), { size: 'business-card-us' })
  assert.ok(rules(noBleed, 'fail').includes('bleed'), JSON.stringify(noBleed.findings))
  assert.match(noBleed.findings.find((f) => f.rule === 'bleed').msg, /no bleed.*3\.750 × 2\.250/)

  const wrong = lint(file(d, 'wrong.html', GOOD_CARD.replace('size: 3.75in 2.25in', 'size: 4in 3in')), { size: 'business-card-us' })
  assert.ok(rules(wrong, 'fail').includes('size'))
})

test('a raster placed below 300dpi fails, with the arithmetic in the message', (t) => {
  const d = scratch(t)
  // A 600px-wide PNG (IHDR only — the lint reads the header) placed at 4in = 150dpi.
  const png = Buffer.alloc(33)
  png.write('\x89PNG\r\n\x1a\n', 0, 'latin1'); png.writeUInt32BE(13, 8); png.write('IHDR', 12, 'latin1')
  png.writeUInt32BE(600, 16); png.writeUInt32BE(400, 20)
  writeFileSync(join(d, 'photo.png'), png)
  const html = GOOD_CARD.replace('</style>', 'img { width: 4in; }</style>').replace('<h1>', '<img src="photo.png"><h1>')
  const r = lint(file(d, 'raster.html', html), { trim: { w: 3.5, h: 2 } })
  assert.ok(rules(r, 'fail').includes('raster'), JSON.stringify(r.findings))
  assert.match(r.findings.find((f) => f.rule === 'raster').msg, /600px placed at 4\.00in = 150dpi/)
})

test('an SVG in physical units is checked through its viewBox; one in pixels fails', (t) => {
  const d = scratch(t)
  // 3.75in wide over a 375-unit viewBox → 1 unit = 0.01in = 0.72pt. font-size 8 = 5.76pt: fails.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="3.75in" height="2.25in" viewBox="0 0 375 225">
    <rect width="375" height="225" fill="#111"/><text x="25" y="60" font-size="8" fill="#eee">Ada</text>
    <line x1="25" y1="70" x2="200" y2="70" stroke="#eee" stroke-width="0.2"/></svg>`
  const r = lint(file(d, 'card.svg', svg), { size: 'business-card-us' })
  assert.ok(rules(r, 'fail').includes('type'), JSON.stringify(r.findings))
  assert.ok(rules(r, 'fail').includes('line'))
  const px = lint(file(d, 'px.svg', svg.replace('width="3.75in" height="2.25in"', 'width="360" height="216"')), {})
  assert.ok(rules(px, 'fail').includes('size'))
})

test('an SVG whose comment holds a double hyphen fails as malformed XML — Chromium would refuse it silently', (t) => {
  const d = scratch(t)
  const good = `<svg xmlns="http://www.w3.org/2000/svg" width="4in" height="4in" viewBox="0 0 400 400"><!-- mockup: print-render mark.svg, zone left-chest --><text font-size="40" x="20" y="200">Mark</text></svg>`
  const bad = good.replace('zone left-chest', '--zone left-chest')
  assert.deepEqual(rules(lint(file(d, 'good.svg', good), {}), 'fail'), [])
  const r = lint(file(d, 'bad.svg', bad), {})
  assert.ok(rules(r, 'fail').includes('xml'), JSON.stringify(r.findings))
  assert.match(r.findings.find((f) => f.rule === 'xml').msg, /"--"/)
})

test('the method raises the bar: 7.5pt type passes on paper and fails for screen print and embroidery', (t) => {
  const d = scratch(t)
  const p = file(d, 'tee.html', GOOD_CARD)
  assert.deepEqual(rules(lint(p, { method: 'paper' }), 'fail'), [])
  assert.ok(rules(lint(p, { method: 'screen' }), 'fail').includes('type'))
  assert.ok(rules(lint(p, { method: 'embroidery' }), 'fail').includes('type'))
  assert.ok(rules(lint(p, { method: 'embroidery' }), 'fail').includes('line'), 'a 0.5pt rule is thinner than a 1mm satin stitch')
})

test('a gradient fails for embroidery and HTV, warns for screen print (sim-process exists), passes for DTG', (t) => {
  const d = scratch(t)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4in" height="4in" viewBox="0 0 400 400"><defs><linearGradient id="g"><stop offset="0"/><stop offset="1"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><text font-size="40" x="20" y="200">Mark</text></svg>`
  const p = file(d, 'mark.svg', svg)
  assert.ok(rules(lint(p, { method: 'embroidery' }), 'fail').includes('method'))
  assert.ok(rules(lint(p, { method: 'htv' }), 'fail').includes('method'))
  const screen = lint(p, { method: 'screen' })
  assert.ok(!rules(screen, 'fail').includes('method'), 'a screen printer CAN print this — as simulated process')
  assert.ok(rules(screen, 'warn').includes('method'), 'but it costs screens and a separator, so it is flagged')
  assert.match(screen.findings.find((f) => f.rule === 'method').msg, /simulated-process/)
  assert.deepEqual(rules(lint(p, { method: 'dtg' }), 'fail'), [])
})

test('high-chroma colours warn about the CMYK gamut, muted ones do not', () => {
  const hot = colours('color: #00ffff; background: rgb(255, 0, 200); fill: oklch(0.7 0.25 30)')
  assert.equal(hot.filter((c) => c.chroma > 0.14).length, 3)
  const calm = colours('color: #1b1b1f; background: #f2ede4; fill: oklch(0.7 0.05 30)')
  assert.equal(calm.filter((c) => c.chroma > 0.14).length, 0)
})

test('a directory lints every design in it, and one bad side fails the whole piece', (t) => {
  const d = scratch(t)
  file(d, 'front.html', GOOD_CARD)
  file(d, 'back.html', GOOD_CARD.replace('font: 7.5pt/1.35', 'font: 5pt/1.35'))
  file(d, 'directions.md', '# not a design')
  const { spawnSync } = require_child()
  const r = spawnSync(process.execPath, [join(REPO, 'tools', 'print-lint.mjs'), d, '--size', 'business-card-us'], { encoding: 'utf8', timeout: 60000 })
  assert.equal(r.status, 1, r.stdout)
  assert.match(r.stdout, /1\/2 files pass/)
  assert.match(r.stdout, /back\.html/)
  assert.match(r.stdout, /front\.html/)
  const ok = spawnSync(process.execPath, [join(REPO, 'tools', 'print-lint.mjs'), join(d, 'front.html'), '--size', 'business-card-us'], { encoding: 'utf8', timeout: 60000 })
  assert.equal(ok.status, 0, ok.stdout)
})

test('the lint and the renderer agree on every preset, and each matches the documented table', () => {
  assert.deepEqual(Object.keys(PRESETS).sort(), Object.keys(RENDER_PRESETS).sort())
  for (const k of Object.keys(PRESETS)) {
    assert.ok(Math.abs(PRESETS[k].w - RENDER_PRESETS[k].w) < 1e-9 && Math.abs(PRESETS[k].h - RENDER_PRESETS[k].h) < 1e-9, k)
  }
  assert.equal(Object.keys(MINIMUMS).length, 5)
})
