// print-lint is the gate the print-design skill promises: a file that would not survive the
// press does not leave the machine. Each case plants one specific physical violation and asserts
// the lint names it — and that a clean file passes, because a gate with false positives gets
// switched off.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
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
  assert.match(bad.findings.find((f) => f.rule === 'line').msg, /0\.1pt.*drop out/)
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

test('the cases a review found passing clean: a raster inside an SVG, an SVG with no viewBox, an image that cannot be read', (t) => {
  const d = scratch(t)
  // A 900px PNG placed 12in wide inside an 18×24 SVG = 75dpi.
  const png = Buffer.alloc(33)
  png.write('\x89PNG\r\n\x1a\n', 0, 'latin1'); png.writeUInt32BE(13, 8); png.write('IHDR', 12, 'latin1')
  png.writeUInt32BE(900, 16); png.writeUInt32BE(600, 20)
  writeFileSync(join(d, 'photo.png'), png)
  const svgImage = `<svg xmlns="http://www.w3.org/2000/svg" width="18.5in" height="24.5in" viewBox="0 0 1850 2450"><image href="photo.png" width="1200" height="800"/><text font-size="60" x="20" y="200">Night</text></svg>`
  const r = lint(file(d, 'poster.svg', svgImage), { size: 'poster-18x24' })
  assert.ok(rules(r, 'fail').includes('raster'), JSON.stringify(r.findings))
  assert.match(r.findings.find((f) => f.rule === 'raster').msg, /900px placed at 12\.00in = 75dpi/)

  // No viewBox: a user unit is a CSS pixel, so font-size 5 is 3.75pt and a 0.1 stroke is 0.08pt.
  const noViewBox = `<svg xmlns="http://www.w3.org/2000/svg" width="4in" height="2in"><text font-size="5" x="10" y="40">Ada</text><line x1="0" y1="50" x2="100" y2="50" stroke="#000" stroke-width="0.1"/></svg>`
  const n = lint(file(d, 'novb.svg', noViewBox), {})
  assert.ok(rules(n, 'fail').includes('type'), JSON.stringify(n.findings))
  assert.ok(rules(n, 'fail').includes('line'))

  // An image that is not there is a warning, never silence.
  const missing = GOOD_CARD.replace('</style>', 'img { width: 2in; }</style>').replace('<h1>', '<img src="nowhere.png"><h1>')
  const w = lint(file(d, 'missing.html', missing), { size: 'business-card-us' })
  assert.ok(rules(w, 'warn').includes('raster'), JSON.stringify(w.findings))
  assert.match(w.findings.find((f) => f.rule === 'raster').msg, /not found/)

  // The attribute form of font-size is reported once, and --json keeps the file that follows it.
  const attr = lint(file(d, 'attr.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="4in" height="2in" viewBox="0 0 400 200"><text font-size="4pt" x="10" y="40">Ada</text></svg>`), {})
  assert.equal(attr.findings.filter((f) => f.rule === 'type').length, 1, JSON.stringify(attr.findings))
  const { spawnSync } = require_child()
  const cli = spawnSync(process.execPath, [join(REPO, 'tools', 'print-lint.mjs'), '--json', join(d, 'attr.svg')], { encoding: 'utf8', timeout: 60000 })
  assert.equal(cli.status, 1, cli.stdout + cli.stderr)
  assert.doesNotThrow(() => JSON.parse(cli.stdout), 'the file after --json was linted, and the output is JSON')
  assert.match(cli.stdout, /"rule":\s*"type"/)
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

test('a raster placed as a background is checked, and a bare run says the bleed was not', (t) => {
  const d = scratch(t)
  // 900px across 4.25in is 212dpi. It only ever appeared in a background-image before.
  const png = Buffer.alloc(33)
  png.write('\x89PNG\r\n\x1a\n', 0, 'latin1'); png.writeUInt32BE(13, 8); png.write('IHDR', 12, 'latin1')
  png.writeUInt32BE(900, 16); png.writeUInt32BE(600, 20)
  writeFileSync(join(d, 'photo.png'), png)
  const bg = lint(file(d, 'bg.html', `<!doctype html><style>@page{size:8.5in 11in;margin:0}
    body{font-family:Archivo;font-size:10pt}
    .cover{width:4.25in;height:3in;background-image:url("photo.png")}</style><div class="cover"></div>`), {})
  assert.ok(rules(bg, 'fail').includes('raster'), 'a background raster under 300dpi has to fail')
  assert.match(bg.findings.find((f) => f.rule === 'raster').msg, /212dpi/)

  // The same image placed wide enough is fine, and a missing one is a warning, not silence.
  const wide = lint(file(d, 'wide.html', `<!doctype html><style>@page{size:8.5in 11in;margin:0}
    body{font-family:Archivo;font-size:10pt}
    .cover{width:2in;background-image:url('photo.png')}</style><div class="cover"></div>`), {})
  assert.ok(!rules(wide, 'fail').includes('raster'))
  const gone = lint(file(d, 'gone.html', `<!doctype html><style>@page{size:8.5in 11in;margin:0}
    body{font-family:Archivo;font-size:10pt}
    .cover{width:4in;background-image:url(missing.png)}</style><div class="cover"></div>`), {})
  assert.match(gone.findings.find((f) => f.rule === 'raster').msg, /not found|cannot be verified/)
})

test('the same finding a thousand times is one line, and a failing size prints below its limit', (t) => {
  const d = scratch(t)
  const hair = '<line stroke-width="0.1"/>'.repeat(500)
  const r = lint(file(d, 'hair.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="3.5in" height="2in" viewBox="0 0 252 144">${hair}</svg>`), {})
  const lines = r.findings.filter((f) => f.rule === 'line')
  assert.equal(lines.length, 1, 'five hundred identical hairlines are one problem')
  assert.equal(lines[0].n, 500)
  assert.match(lines[0].msg, /stroke-width="0\.1"/, 'the sample closes its quote')

  // 2.1mm is 5.95pt: rounded to one place it printed as "6.0pt, below the 6pt minimum".
  const small = lint(file(d, 'small.html', '<!doctype html><style>@page{size:8.5in 11in;margin:0}.f{font-size:2.1mm}</style><p class="f">x</p>'), {})
  const msg = small.findings.find((f) => f.rule === 'type' && f.level === 'fail').msg
  assert.match(msg, /5\.95pt/)
  assert.ok(!/6\.0pt, below/.test(msg))
})

test('a bare run says what it could not check; with a size it says it passed', (t) => {
  const d = scratch(t)
  const p = file(d, 'trim.html', '<!doctype html><style>@page{size:3.5in 2in;margin:0}body{font-family:Archivo;font-size:9pt}</style><p>x</p>')
  const cli = (args) => require_child().spawnSync(process.execPath, [join(REPO, 'tools', 'print-lint.mjs'), p, ...args], { encoding: 'utf8' })
  const bare = cli([])
  assert.equal(bare.status, 0)
  assert.doesNotMatch(bare.stdout, /Passes the physical checks/, 'nothing checked the bleed')
  assert.match(bare.stdout, /bleed was never checked/)
  // The same file with the size given does fail — which is what the bare run could not say.
  assert.match(cli(['--size', 'business-card-us']).stdout, /FAIL\s+bleed/)
})

// THE NEAR-MISS CORPUS. The tests above ask whether each rule fires. These ask what else it
// fires on — and every one of them sits exactly ON a threshold, where a rule one comparison out
// rejects a piece that is precisely right. A press gate that fails correct work is a gate the
// shop learns to override.
test('every rule passes the legitimate version, and the piece that sits exactly on the line', (t) => {
  const d = scratch(t)
  const png = (w, h) => {
    const b = Buffer.alloc(33)
    b.write('\x89PNG\r\n\x1a\n', 0, 'latin1'); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1')
    b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20)
    return b
  }
  writeFileSync(join(d, 'p300.png'), png(1200, 800))   // 1200px at 4in = exactly 300dpi
  const file = (name, body) => { const p = join(d, name); writeFileSync(p, body); return p }
  const card = (style, body = '<p>Harbour Swim Club</p>') =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>C</title><style>${style}</style></head><body>${body}</body></html>`
  
  const cases = [
    // Flush trim: the piece IS the trim size, and no bleed was asked for. Correct, not "no bleed".
    ['flush trim, bleed 0', file('flush.html', card('@page{size:3.5in 2in;margin:0}body{font-family:Archivo;font-size:9pt}')),
      { trim: { w: 3.5, h: 2 }, bleed: 0 }],
    // Exactly the minimum type: 6pt on paper is the floor, and the floor passes.
    ['type at exactly 6pt', file('six.html', card('@page{size:8.5in 11in;margin:0}.f{font-size:6pt}', '<p class="f">legal line</p>')), {}],
    // Exactly the minimum rule weight.
    ['rule at exactly 0.25pt', file('rule.html', card('@page{size:8.5in 11in;margin:0}body{font-size:10pt}.r{border-top:0.25pt solid}', '<div class="r"></div>')), {}],
    // Exactly 300dpi, placed as a background and as an image.
    ['raster at exactly 300dpi', file('r300.html', card('@page{size:8.5in 11in;margin:0}body{font-size:10pt}.c{width:4in;background-image:url("p300.png")}', '<div class="c"></div>')), {}],
    ['image tag at exactly 300dpi', file('i300.html', card('@page{size:8.5in 11in;margin:0}body{font-size:10pt}img{width:4in}', '<img src="p300.png">')), {}],
    // A named page size, which is how most people write it.
    ['a named page size', file('a4.html', card('@page{size:A4;margin:0}body{font-family:Archivo;font-size:10pt}')), {}],
    // A safety cap is not the placed width.
    ['max-width is not the placed width', file('cap.html', card('@page{size:8.5in 11in;margin:0}body{font-size:10pt}img{max-width:8in;width:4in}', '<img src="p300.png">')), {}],
    // A muted colour, inside the CMYK gamut.
    ['a muted ink', file('muted.html', card('@page{size:8.5in 11in;margin:0}body{font-size:10pt;color:#5f5a51;background:#f4f1ea}')), {}],
    // A gradient is fine for DTG — the method decides, and this one can print one.
    ['a gradient for DTG', file('dtg.html', card('@page{size:12in 16in;margin:0}body{font-size:14pt}.g{background:linear-gradient(#b4451f,#e0a33c)}', '<div class="g">art</div>')), { method: 'dtg' }],
    // A single hyphen in an SVG comment is legal; it is the double that breaks the parser.
    ['one hyphen in an SVG comment', file('svg.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" width="3.5in" height="2in" viewBox="0 0 252 144"><!-- a note - with one hyphen -->'
      + '<rect width="252" height="144" fill="#f4f1ea"/><path d="M20 20 L60 60" stroke="#1d2530" stroke-width="2" fill="none"/></svg>'), {}],
  ]

  const fired = []
  for (const [name, path, opts] of cases) {
    const bad = lint(path, opts).findings.filter((f) => f.level === 'fail')
    if (bad.length) fired.push(name + ' → ' + bad.map((f) => f.rule).join(', '))
  }
  assert.deepEqual(fired, [], 'press-ready files the gate rejected')
  assert.ok(cases.length >= 10)
})

test('a page is linted with the stylesheets it links, because that is what goes to press', (t) => {
  // This read the markup only. For any piece whose CSS lives in a separate file — nearly all
  // real print work — it measured no type, no line weights and no rasters, and reported "no
  // @page rule, the document has no physical size" for a document that declares one. Worse, it
  // could report a pass having checked almost nothing.
  const d = scratch(t)
  writeFileSync(join(d, 'sheet.css'), [
    '@page { size: 3.5in 2in; margin: 0 }',
    'body { font-family: Archivo; font-size: 9pt }',
    '.fine { font-size: 3pt }',                       // below every minimum
    '.hair { border-top: 0.05pt solid }',             // a hairline that would drop out
  ].join('\n'), 'utf8')
  const p = file(d, 'card.html', '<!doctype html><html><head><link rel="stylesheet" href="sheet.css">'
    + '</head><body><p class="fine">tiny</p><div class="hair"></div></body></html>')

  const r = lint(p, {})
  const rules = r.findings.map((f) => f.rule)
  assert.ok(!rules.includes('size'), 'the @page rule is in the stylesheet, and it counts')
  assert.ok(rules.includes('type'), 'type set in the stylesheet is measured')
  assert.ok(rules.includes('line'), 'a hairline in the stylesheet is measured')
  assert.match(r.findings.find((f) => f.rule === 'type').msg, /3pt/)

  // A stylesheet that is missing, remote, or unreadable is skipped rather than fatal — the
  // markup is still linted, and the page is not failed for something it does not control.
  const q = file(d, 'remote.html', '<!doctype html><html><head>'
    + '<link rel="stylesheet" href="https://example.invalid/x.css">'
    + '<link rel="stylesheet" href="gone.css">'
    + '<style>@page{size:3.5in 2in;margin:0}body{font-family:Archivo;font-size:9pt}</style>'
    + '</head><body><p>x</p></body></html>')
  const r2 = lint(q, {})
  assert.ok(!r2.findings.some((f) => f.rule === 'size'), 'an unreachable stylesheet is not a size failure')

  // An href carrying a query or a fragment still names a real file.
  const s = file(d, 'q.html', '<!doctype html><html><head>'
    + '<link rel="stylesheet" href="sheet.css?v=3#top"></head><body><p class="fine">x</p></body></html>')
  assert.ok(lint(s, {}).findings.some((f) => f.rule === 'type'), 'a cache-busted href is the same file')
})

test('a url() in a stylesheet resolves against that stylesheet, and @import is followed', (t) => {
  // Two regressions introduced by teaching this to read linked stylesheets. A raster in the
  // ordinary css/ + css/photo.png layout became unfindable — reported as a warning, which is a
  // pass — and a @page two files away through an @import still read as "no physical size".
  const d = scratch(t)
  mkdirSync(join(d, 'css'), { recursive: true })
  const png = Buffer.alloc(33)
  png.write('\x89PNG\r\n\x1a\n', 0, 'latin1'); png.writeUInt32BE(13, 8); png.write('IHDR', 12, 'latin1')
  png.writeUInt32BE(1200, 16); png.writeUInt32BE(800, 20)
  writeFileSync(join(d, 'css', 'photo.png'), png)
  writeFileSync(join(d, 'css', 'sheet.css'), '@page{size:8.5in 11in;margin:0}body{font-family:Archivo;font-size:10pt}'
    + '.cover{width:4.25in;height:3in;background-image:url("photo.png")}', 'utf8')
  const page = file(d, 'page.html', '<!doctype html><html><head><link rel="stylesheet" href="css/sheet.css"></head><body><div class="cover"></div></body></html>')
  const r = lint(page, {})
  const raster = r.findings.find((f) => f.rule === 'raster')
  assert.ok(raster, 'the raster beside its stylesheet is found')
  assert.equal(raster.level, 'fail', `1200px at 4.25in is 282dpi: ${raster.msg}`)
  assert.match(raster.msg, /282dpi/)

  // @import: the page size lives two files away, which is how a shared spec is normally kept.
  writeFileSync(join(d, 'base.css'), '@page{size:3.5in 2in;margin:0}body{font-family:Archivo;font-size:9pt}', 'utf8')
  writeFileSync(join(d, 'imp.css'), '@import "base.css";\n.x{color:#222}', 'utf8')
  const card = file(d, 'card.html', '<!doctype html><html><head><link rel="stylesheet" href="imp.css"></head><body><p>x</p></body></html>')
  assert.ok(!lint(card, {}).findings.some((f) => f.rule === 'size'), 'the @page arrives through the @import')

  // A cycle terminates rather than hanging.
  writeFileSync(join(d, 'a.css'), '@import "b.css";', 'utf8')
  writeFileSync(join(d, 'b.css'), '@import "a.css";\n@page{size:3.5in 2in;margin:0}body{font-family:Archivo;font-size:9pt}', 'utf8')
  const cyc = file(d, 'cyc.html', '<!doctype html><html><head><link rel="stylesheet" href="a.css"></head><body><p>x</p></body></html>')
  assert.ok(!lint(cyc, {}).findings.some((f) => f.rule === 'size'))
})

test('a shared stylesheet is read for the page it is on, not for the whole set', (t) => {
  // A set-wide stylesheet carries every piece's rules. Reading it whole failed a business card
  // for a .legal-footnote at 4pt that is printed on the letterhead and appears nowhere on the
  // card — a FAIL for something that does not exist on the page being judged.
  const d = scratch(t)
  writeFileSync(join(d, 'shared.css'), [
    '@page{size:3.5in 2in;margin:0}',
    'body{font-family:Archivo;font-size:9pt}',
    '.legal-footnote{font-size:4pt}',
    '.hairline-divider{border-top:0.1pt solid}',
  ].join('\n'), 'utf8')
  const link = '<link rel="stylesheet" href="shared.css">'

  const card = file(d, 'card.html', `<!doctype html><html><head>${link}</head><body><p class="name">Harbour Swim Club</p></body></html>`)
  // Nothing is deleted — deleting is how a card with a REAL hairline passed clean. The
  // measurement stays on the page, graded down, because a selector misread then costs severity
  // rather than visibility.
  const cardFindings = lint(card, {}).findings
  const cardFails = cardFindings.filter((f) => f.level === 'fail').map((f) => f.rule)
  assert.ok(!cardFails.includes('type'), 'the card is not FAILED for a footnote it does not have')
  assert.ok(!cardFails.includes('line'), 'nor for a divider it does not have')
  const downgraded = cardFindings.filter((f) => f.level === 'warn' && /names nothing on this page/.test(f.msg))
  assert.ok(downgraded.length >= 2, 'but both are still reported, with the reason')

  // The page that DOES carry them still fails, which is the whole point of the gate.
  const sheet = file(d, 'letterhead.html', `<!doctype html><html><head>${link}</head><body>`
    + '<p class="legal-footnote">tiny</p><div class="hairline-divider"></div></body></html>')
  const sheetFails = lint(sheet, {}).findings.filter((f) => f.level === 'fail').map((f) => f.rule)
  assert.ok(sheetFails.includes('type'), '4pt type FAILS on the page that has it')
  assert.ok(sheetFails.includes('line'), 'and so does the hairline')

  // Conservative by design: anything the scanner cannot resolve is kept, because the cost of
  // missing a real hairline is a box of cards.
  writeFileSync(join(d, 'odd.css'), '@page{size:3.5in 2in;margin:0}body{font-family:Archivo;font-size:9pt}'
    + '[data-fine]{font-size:3pt}\n@media print{.x{border-top:0.05pt solid}}', 'utf8')
  const odd = file(d, 'odd.html', '<!doctype html><html><head><link rel="stylesheet" href="odd.css">'
    + '</head><body><p>x</p></body></html>')
  const oddFails = lint(odd, {}).findings.filter((f) => f.level === 'fail').map((f) => f.rule)
  assert.ok(oddFails.includes('type'), 'an attribute selector is not resolvable, so it still fails')
  assert.ok(oddFails.includes('line'), 'and a rule inside @media is never graded down')
})

test('the selector test reads selectors, and never blanks a rule that applies', (t) => {
  // The worst possible outcome for a press gate: a card with a real 0.15pt hairline and 3pt
  // type reported "0 would fail on press", exit 0. The slice handed to the selector test ran
  // from the previous } to this {, so a comment above a rule became part of its selector, and
  // the argument of :not() was read as a requirement of the subject.
  const d = scratch(t)
  writeFileSync(join(d, 'set.css'), [
    '@page{size:3.5in 2in;margin:0}',
    'body{font-family:Archivo;font-size:9pt}',
    '/* .letterhead-foot lives elsewhere */',
    '.hairline-rule { border-top: 0.15pt solid #000; }',
    '.fine:not(.thick) { font-size: 3pt; }',
  ].join('\n'), 'utf8')
  const card = file(d, 'card.html', '<!doctype html><html><head><link rel="stylesheet" href="set.css">'
    + '</head><body><div class="hairline-rule"></div><p class="fine">x</p></body></html>')
  const rules = lint(card, {}).findings.map((f) => f.rule)
  assert.ok(rules.includes('line'), 'a real hairline must never be blanked by a comment')
  assert.ok(rules.includes('type'), 'nor by a :not() argument')

  // A JSX page writes className=, and reading only class= emptied the set and blanked the sheet.
  const jsx = file(d, 'jsx.html', '<!doctype html><html><head><link rel="stylesheet" href="set.css">'
    + '</head><body><div className="hairline-rule"></div></body></html>')
  assert.ok(lint(jsx, {}).findings.some((f) => f.rule === 'line'), 'className is a class')

  // An escaped selector is unreadable, and unreadable is not absent.
  writeFileSync(join(d, 'tw.css'), '@page{size:3.5in 2in;margin:0}body{font-family:Archivo;font-size:9pt}'
    + '.text-\[3pt\]{font-size:3pt}', 'utf8')
  const tw = file(d, 'tw.html', '<!doctype html><html><head><link rel="stylesheet" href="tw.css">'
    + '</head><body><p class="text-[3pt]">x</p></body></html>')
  assert.ok(lint(tw, {}).findings.some((f) => f.rule === 'type'), 'an escaped class is kept')

  // And what IS set aside is named, because a silent omission is the shape of a false pass.
  const other = file(d, 'other.html', '<!doctype html><html><head><link rel="stylesheet" href="set.css">'
    + '</head><body><p class="name">x</p></body></html>')
  const scope = lint(other, {}).findings.find((f) => f.rule === 'scope')
  assert.ok(scope, 'the rules not measured are reported')
  assert.match(scope.msg, /hairline-rule|fine/)
})

test('a stylesheet is found whatever order its attributes are in', (t) => {
  // rel had to come before href, so the commonest other order was ignored entirely and every
  // gate quietly went back to judging the markup alone — with no warning, because a link nobody
  // found looks exactly like a page with no CSS.
  const d = scratch(t)
  writeFileSync(join(d, 's.css'), '@page{size:3.5in 2in;margin:0}body{font-family:Archivo;font-size:3pt}', 'utf8')
  const forms = {
    'rel-first': '<link rel="stylesheet" href="s.css">',
    'href-first': '<link href="s.css" rel="stylesheet">',
    unquoted: '<link href=s.css rel=stylesheet>',
    preload: '<link rel="preload stylesheet" href="s.css">',
  }
  for (const [name, tag] of Object.entries(forms)) {
    const p = file(d, `${name}.html`, `<!doctype html><html><head>${tag}</head><body><p>x</p></body></html>`)
    assert.ok(lint(p, {}).findings.some((f) => f.rule === 'type'), `${name} must be read`)
  }
  // A link inside a comment is not a link.
  const commented = file(d, 'commented.html', '<!doctype html><html><head><!-- <link rel="stylesheet" href="s.css"> -->'
    + '<style>@page{size:3.5in 2in;margin:0}body{font-family:Archivo;font-size:9pt}</style></head><body><p>x</p></body></html>')
  assert.ok(!lint(commented, {}).findings.some((f) => f.rule === 'type'))

  // A screen-only sheet is not part of the press file.
  writeFileSync(join(d, 'screen.css'), '.t{font-size:3pt}', 'utf8')
  const scoped = file(d, 'scoped.html', '<!doctype html><html><head>'
    + '<style>@page{size:3.5in 2in;margin:0}body{font-family:Archivo;font-size:9pt}</style>'
    + '<link rel="stylesheet" media="screen" href="screen.css"></head><body><p class="t">x</p></body></html>')
  assert.ok(!lint(scoped, {}).findings.some((f) => f.rule === 'type'), 'media="screen" is not the press file')
})

test('a misread selector costs severity, never the measurement', (t) => {
  // The structural point of grading rather than deleting. Whatever this scanner gets wrong about
  // a selector, the measurement stays on the page: the worst case is a warning where a failure
  // belonged, not a card with a real hairline reported as clean.
  const d = scratch(t)
  // Selectors chosen to defeat the scanner in every way found so far, all of them applying.
  writeFileSync(join(d, 'tricky.css'), [
    '@page{size:3.5in 2in;margin:0}',
    'body{font-family:Archivo;font-size:9pt}',
    '/* a comment naming .some-other-page */',
    '.rule-a:not(.never){ border-top: 0.1pt solid }',
    '.rule-b[data-x]{ font-size: 2pt }',
    '@media print { .rule-c { border-top: 0.08pt solid } }',
  ].join('\n'), 'utf8')
  const p = file(d, 'tricky.html', '<!doctype html><html><head><link href="tricky.css" rel="stylesheet">'
    + '</head><body><div class="rule-a"></div><p class="rule-b">x</p><div class="rule-c"></div></body></html>')

  const findings = lint(p, {}).findings
  // Every one of the three is reported somehow — that is the invariant that matters.
  for (const needle of [/0\.1pt/, /2pt/, /0\.08pt/]) {
    assert.ok(findings.some((f) => needle.test(f.msg)), `${needle} must appear somewhere in the report`)
  }
  // And because all three really do apply, all three are failures.
  const fails = findings.filter((f) => f.level === 'fail')
  assert.ok(fails.some((f) => /0\.1pt/.test(f.msg)), 'a comment above a rule does not soften it')
  assert.ok(fails.some((f) => /2pt/.test(f.msg)), 'an attribute selector does not soften it')
  assert.ok(fails.some((f) => /0\.08pt/.test(f.msg)), 'a rule inside @media does not soften it')
})
