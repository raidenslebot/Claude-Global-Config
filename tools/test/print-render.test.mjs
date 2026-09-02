// print-render turns a design at physical size into a PDF a printer can take and a PNG proof at
// a real dpi. These run the real tool through the real browser and check the numbers a print
// shop would check: the PDF's MediaBox in points, the PNG's pixel dimensions against inches × dpi,
// and that a mockup lands the art at true scale on the garment flat. Skipped, and said so, when
// no browser is installed — a test that cannot render must not report a pass.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'
import { findPlaywright, parseSize, parseLength, defaultBleed, artSize, PRESETS } from '../print-render.mjs'

const TOOL = join(REPO, 'tools', 'print-render.mjs')
const BROWSER = Boolean(findPlaywright())

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'print-render-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
function render(args, cwd) {
  const r = spawnSync(process.execPath, [TOOL, ...args, '--json'], { cwd, encoding: 'utf8', timeout: 120000 })
  let json = null
  try { json = JSON.parse(r.stdout) } catch { /* not json */ }
  return { ...r, json }
}
/** MediaBox of the first page, in points. Chromium writes it uncompressed. */
function mediaBox(pdf) {
  const m = readFileSync(pdf, 'latin1').match(/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/)
  assert.ok(m, 'no MediaBox found in the PDF')
  return { w: Number(m[3]) - Number(m[1]), h: Number(m[4]) - Number(m[2]) }
}
function pngSize(png) {
  const b = readFileSync(png)
  assert.equal(b.toString('latin1', 1, 4), 'PNG')
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

const CARD = `<!doctype html><style>@page{size:3.75in 2.25in;margin:0}html,body{margin:0}
.s{width:3.75in;height:2.25in;background:#1b1b1f;color:#f2ede4;font:12pt Georgia,serif;position:relative}
.i{position:absolute;inset:.25in}</style><div class="s"><div class="i">Ada Vance</div></div>`

test('units and presets parse the way the docs say', () => {
  assert.deepEqual(parseSize('3.5x2in'), { w: 3.5, h: 2 })
  assert.ok(Math.abs(parseSize('85x55mm').w - 3.3465) < 1e-3)
  assert.equal(parseLength('0.125in'), 0.125)
  assert.ok(Math.abs(parseLength('3mm') - 0.11811) < 1e-4)
  assert.equal(defaultBleed(PRESETS['business-card-us']), 0.125)
  assert.equal(defaultBleed(PRESETS['poster-18x24']), 0.25, 'large format gets more bleed')
  assert.throws(() => parseSize('3.5x2'), /size must look like/)
})

test('artSize reads physical SVG units, a viewBox ratio, and a PNG header', (t) => {
  const d = scratch(t)
  writeFileSync(join(d, 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="4in" height="2in" viewBox="0 0 400 200"/>')
  assert.deepEqual(artSize(join(d, 'a.svg')), { w: 4, h: 2, unit: 'in' })
  writeFileSync(join(d, 'b.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"/>')
  assert.deepEqual(artSize(join(d, 'b.svg')), { w: 300, h: 100, unit: 'ratio' })
  const png = Buffer.alloc(33); png.write('\x89PNG\r\n\x1a\n', 0, 'latin1'); png.writeUInt32BE(13, 8); png.write('IHDR', 12, 'latin1'); png.writeUInt32BE(1200, 16); png.writeUInt32BE(600, 20)
  writeFileSync(join(d, 'c.png'), png)
  assert.deepEqual(artSize(join(d, 'c.png')), { w: 1200, h: 600, unit: 'px' })
})

test('a business card renders to a PDF at trim + bleed, and to a PNG at 300dpi', { skip: !BROWSER && 'no browser installed — install the Playwright MCP server' }, (t) => {
  const d = scratch(t)
  writeFileSync(join(d, 'card.html'), CARD)
  const r = render(['card.html', '--size', 'business-card-us', '--png', '300'], d)
  assert.equal(r.status, 0, r.stderr)
  assert.ok(existsSync(join(d, 'card.pdf')) && existsSync(join(d, 'card.png')))
  // 3.75 × 2.25 in = 270 × 162 pt
  const mb = mediaBox(join(d, 'card.pdf'))
  assert.ok(Math.abs(mb.w - 270) < 1 && Math.abs(mb.h - 162) < 1, `MediaBox ${mb.w} × ${mb.h}`)
  const px = pngSize(join(d, 'card.png'))
  assert.ok(Math.abs(px.w - 1125) <= 2 && Math.abs(px.h - 675) <= 2, `PNG ${px.w} × ${px.h} — expected 3.75×300 by 2.25×300`)
  assert.equal(r.json.colourSpace.startsWith('RGB'), true, 'the summary states the colour space honestly')
})

test('--marks adds a 0.25in slug on every side and the page grows to match', { skip: !BROWSER && 'no browser installed' }, (t) => {
  const d = scratch(t)
  writeFileSync(join(d, 'card.html'), CARD)
  const r = render(['card.html', '--size', 'business-card-us', '--marks'], d)
  assert.equal(r.status, 0, r.stderr)
  const mb = mediaBox(join(d, 'card.pdf'))
  // (3.5 + 2×(0.125+0.25)) × (2 + 2×0.375) in = 4.25 × 2.75 in = 306 × 198 pt
  assert.ok(Math.abs(mb.w - 306) < 1 && Math.abs(mb.h - 198) < 1, `MediaBox ${mb.w} × ${mb.h}`)
  assert.equal(r.json.slugInches, 0.25)
})

test('a mockup places the art at true scale in the named zone on the garment flat', { skip: !BROWSER && 'no browser installed' }, (t) => {
  const d = scratch(t)
  writeFileSync(join(d, 'mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="4in" height="2in" viewBox="0 0 400 200"><rect width="400" height="200" fill="#f2ede4"/></svg>')
  const r = render(['mark.svg', '--mockup', 'tee', '--zone', 'left-chest', '--garment', '#1c1c1e', '--png', '50'], d)
  assert.equal(r.status, 0, r.stderr)
  // zone is 4in wide; a 4×2 mark fits at 4 × 2 in
  assert.deepEqual(r.json.artInches, { w: 4, h: 2 })
  const px = pngSize(join(d, 'mark.png'))
  assert.ok(Math.abs(px.w - 22 * 50) <= 2 && Math.abs(px.h - 29 * 50) <= 2, `flat is 22×29in at 50dpi — got ${px.w}×${px.h}`)
  // An oversized mark is scaled down to the zone, never over it.
  const big = render(['mark.svg', '--mockup', 'cap', '--zone', 'cap-front', '--png', '20'], d)
  assert.equal(big.status, 0, big.stderr)
  assert.ok(big.json.artInches.w <= 4 && big.json.artInches.h <= 2.25, JSON.stringify(big.json.artInches))
})

test('two designs render to one two-page PDF with a PNG per page', { skip: !BROWSER && 'no browser installed' }, (t) => {
  const d = scratch(t)
  writeFileSync(join(d, 'front.html'), CARD)
  writeFileSync(join(d, 'back.html'), CARD.replace('Ada Vance', 'back'))
  const r = render(['front.html', 'back.html', '--size', 'business-card-us', '--marks', '--png', '40', '--out', 'card'], d)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.json.pages, 2)
  const pdf = readFileSync(join(d, 'card.pdf'), 'latin1')
  const pageObjects = (pdf.match(/\/Type\s*\/Page\b/g) || []).length
  assert.equal(pageObjects, 2, `expected two /Page objects, found ${pageObjects}`)
  for (const n of [1, 2]) {
    const px = pngSize(join(d, `card-${n}.png`))
    assert.ok(Math.abs(px.w - 4.25 * 40) <= 2 && Math.abs(px.h - 2.75 * 40) <= 2, `page ${n} PNG ${px.w}×${px.h}`)
  }
})

test('a rotated zone and --presentation render, and the summary records both', { skip: !BROWSER && 'no browser installed' }, (t) => {
  const d = scratch(t)
  writeFileSync(join(d, 'mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="3in" height="1in" viewBox="0 0 300 100"><rect width="300" height="100" fill="#f2ede4"/></svg>')
  const r = render(['mark.svg', '--mockup', 'long-sleeve', '--zone', 'sleeve-long', '--garment', '#f4efe4', '--presentation', '--png', '20'], d)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.json.presentation, true)
  assert.equal(r.json.zoneInches.rotate, -16, 'the sleeve zone is rotated in zones.json and that reaches the render')
  const px = pngSize(join(d, 'mark.png'))
  assert.ok(Math.abs(px.w - 26 * 20) <= 2 && Math.abs(px.h - 29 * 20) <= 2, `flat is 26×29in — got ${px.w}×${px.h}`)
})

test('bad input is refused with a reason, not rendered wrong', { skip: !BROWSER && 'no browser installed' }, (t) => {
  const d = scratch(t)
  writeFileSync(join(d, 'card.html'), CARD)
  assert.equal(render(['card.html'], d).status, 1, 'no size given')
  assert.match(render(['card.html', '--size', 'nope'], d).stderr, /unknown preset/)
  assert.match(render(['card.html', '--mockup', 'tee', '--zone', 'nowhere'], d).stderr, /unknown zone/)
  assert.equal(render(['missing.html', '--size', 'a5'], d).status, 1)
})

test('every garment in zones.json has a flat on disk and every zone fits inside it', () => {
  const zonesFile = join(REPO, 'skills', 'apparel-design', 'assets', 'zones.json')
  const zones = JSON.parse(readFileSync(zonesFile, 'utf8'))
  for (const [name, g] of Object.entries(zones)) {
    if (name.startsWith('_')) continue
    const flat = join(REPO, 'skills', 'apparel-design', 'assets', g.file)
    assert.ok(existsSync(flat), `${name}: ${g.file} missing`)
    const svg = readFileSync(flat, 'utf8')
    assert.match(svg, new RegExp(`width="${g.width}in"`), `${name}: flat width must equal zones.json`)
    assert.match(svg, new RegExp(`height="${g.height}in"`), `${name}: flat height must equal zones.json`)
    for (const [z, r] of Object.entries(g.zones)) {
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= g.width && r.y + r.h <= g.height, `${name}/${z} runs off the flat`)
    }
  }
})
