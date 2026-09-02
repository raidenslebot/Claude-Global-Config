#!/usr/bin/env node
// outline-text.mjs — text as vector paths, so a wordmark, a name on a jersey or a sign can be
// delivered without depending on a font being installed anywhere.
//
//   node tools/outline-text.mjs --font "Fraunces:ital,opsz,wght@1,9..144,300" --text "Harbor" --size 96 --out mark.svg
//   node tools/outline-text.mjs --font ./Archivo.ttf --text "HIGH WATER" --size 40 --tracking 0.12 --wght 700 --json
//
// Every identity reference says it and every print shop asks for it: outline the fonts. A
// screen printer's RIP, a vinyl cutter, an embroidery digitiser and a signage shop take paths,
// not font names. This takes a font — a local TTF/OTF/WOFF/WOFF2, or a Google Fonts family with
// its axis spec — lays the text out with the font's own kerning and ligatures, and writes an SVG
// whose only element is one <path>. Variable axes are applied when the font carries them.
// Google fonts are fetched once and cached under <config>/.cgc/fonts.

import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { REPO, CONFIG_ROOT } from './paths.mjs'

const CACHE = join(CONFIG_ROOT, '.cgc', 'fonts')
// A browser-like UA gets woff2 from the CSS API; fontkit reads woff2 directly.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'

export function findFontkit() {
  const require = createRequire(import.meta.url)
  for (const dir of [join(REPO, 'node_modules'), join(REPO, 'library', 'mcp-servers', 'node_modules')]) {
    try { return { module: require(require.resolve('fontkit', { paths: [dir] })), from: dir } } catch { /* not here */ }
  }
  try { return { module: require('fontkit'), from: 'require' } } catch { return null }
}

/** A Google Fonts family spec ("Fraunces:ital,opsz,wght@1,9..144,300") → a cached woff2 path.
 *  With `text`, the request asks for a subset covering exactly those characters, so a face is
 *  fetched with the glyphs the text needs — the latin slice alone has no ő and no 東. */
export async function fetchGoogleFont(spec, text = '') {
  mkdirSync(CACHE, { recursive: true })
  const key = createHash('sha1').update(spec + '\n' + text).digest('hex').slice(0, 16)
  const file = join(CACHE, `${spec.split(':')[0].replace(/\W+/g, '-').toLowerCase()}-${key}.woff2`)
  if (existsSync(file)) return file
  const url = `https://fonts.googleapis.com/css2?family=${spec.trim().replace(/ /g, '+')}&display=swap${text ? `&text=${encodeURIComponent(text)}` : ''}`
  const css = await fetch(url, { headers: { 'User-Agent': UA } }).then((r) => { if (!r.ok) throw new Error(`Google Fonts answered ${r.status} for "${spec}" — check the family name and axis spec`); return r.text() })
  // The latin block first; any woff2 otherwise.
  const m = /\/\* latin \*\/\s*@font-face\s*\{[^}]*?src:\s*url\(([^)]+\.woff2)\)/.exec(css) || /src:\s*url\(([^)]+\.woff2)\)/.exec(css)
  if (!m) throw new Error(`no woff2 in the stylesheet for "${spec}"`)
  const buf = Buffer.from(await fetch(m[1], { headers: { 'User-Agent': UA } }).then((r) => { if (!r.ok) throw new Error(`font download failed (${r.status})`); return r.arrayBuffer() }))
  writeFileSync(file, buf)
  return file
}

/** Path commands (font units, y up) → SVG path data at `s` scale, translated to (dx, dy), y flipped. */
function pathData(commands, s, dx, dy, precision = 2) {
  const X = (x) => (x * s + dx).toFixed(precision)
  const Y = (y) => (-y * s + dy).toFixed(precision)
  const out = []
  for (const c of commands) {
    const a = c.args
    switch (c.command) {
      case 'moveTo': out.push(`M${X(a[0])} ${Y(a[1])}`); break
      case 'lineTo': out.push(`L${X(a[0])} ${Y(a[1])}`); break
      case 'quadraticCurveTo': out.push(`Q${X(a[0])} ${Y(a[1])} ${X(a[2])} ${Y(a[3])}`); break
      case 'bezierCurveTo': out.push(`C${X(a[0])} ${Y(a[1])} ${X(a[2])} ${Y(a[3])} ${X(a[4])} ${Y(a[5])}`); break
      case 'closePath': out.push('Z'); break
      default: break
    }
  }
  return out.join('')
}

/**
 * Lay out `text` in `font` at `size` px and return { d, width, height, baseline, capHeight, xHeight }.
 * `tracking` is in em (0.02 = 2%), applied between glyphs. `variation` is { wght, wdth, opsz, … }.
 */
export function outline(font, text, { size = 96, tracking = 0, variation = null, features = undefined } = {}) {
  let f = font
  if (variation && f.variationAxes && Object.keys(f.variationAxes).length) {
    const v = {}
    for (const [axis, val] of Object.entries(variation)) if (axis in f.variationAxes && val != null) v[axis] = Number(val)
    if (Object.keys(v).length) f = f.getVariation(v)
  }
  const s = size / f.unitsPerEm
  // A glyph the font lacks lays out as .notdef — a box — and a box in a wordmark is a defect
  // nobody should discover at the shop. Name the characters instead.
  const missing = [...new Set([...text].filter((ch) => /\S/.test(ch) && !f.hasGlyphForCodePoint(ch.codePointAt(0))))]
  const run = f.layout(text, features)
  if (missing.length || run.glyphs.some((g) => g.id === 0)) {
    throw new Error(`"${f.familyName || 'this font'}" has no glyph for ${missing.length ? missing.map((c) => `"${c}"`).join(', ') : 'part of the text'} — choose a face that covers the script (a Google fetch subsets to the text you pass)`)
  }
  const ascent = f.ascent * s, descent = f.descent * s
  const baseline = ascent
  const track = tracking * size
  // The ink, not the advance: an italic f or a J hangs left of its origin, and a viewBox that
  // starts at the advance origin clips it. The run's bbox is in font units.
  const bb = run.bbox
  const dx = bb && Number.isFinite(bb.minX) ? -bb.minX * s : 0
  let x = 0
  const parts = []
  run.glyphs.forEach((g, i) => {
    const p = run.positions[i]
    parts.push(pathData(g.path.commands, s, x + p.xOffset * s + dx, baseline - p.yOffset * s))
    x += p.xAdvance * s + (i < run.glyphs.length - 1 ? track : 0)
  })
  const tracked = Math.max(0, run.glyphs.length - 1) * track
  const width = bb && Number.isFinite(bb.maxX) ? (bb.maxX - bb.minX) * s + tracked : x
  return {
    d: parts.join(''), width, advance: x, height: ascent - descent, baseline,
    capHeight: (f.capHeight || 0) * s, xHeight: (f.xHeight || 0) * s, glyphs: run.glyphs.length, family: f.familyName || '',
  }
}

export function svg({ d, width, height }, { fill = '#000', pad = 0, units = '' } = {}) {
  const w = (width + pad * 2), h = (height + pad * 2)
  const attrs = units ? ` width="${(w).toFixed(2)}${units}" height="${(h).toFixed(2)}${units}"` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg"${attrs} viewBox="0 0 ${w.toFixed(2)} ${h.toFixed(2)}">\n  <path d="${d}" fill="${fill}"${pad ? ` transform="translate(${pad} ${pad})"` : ''}/>\n</svg>\n`
}

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) { const k = a.slice(2); if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[k] = argv[++i]; else out[k] = true }
    else out._.push(a)
  }
  return out
}

const HELP = `usage:
  outline-text --font <file.ttf|otf|woff|woff2 | "Google Family[:axes]"> --text "<string>" [--size <px>]
               [--tracking <em>] [--wght N] [--wdth N] [--opsz N] [--ital 0|1] [--fill <colour>] [--pad <px>]
               [--units in|mm|pt] [--out <file.svg>] [--json]

Writes an SVG whose only element is one <path>: the text as outlines, laid out with the font's own
kerning and ligatures, the viewBox starting at the ink. --units gives the SVG a physical size at
96 px per inch (so pt: 1 px = 0.75 pt). A Google family is fetched subset to the text and cached.
--json prints the metrics (width, advance, height, baseline, capHeight, xHeight) instead of writing.
A character the face has no glyph for is an error, never a box. Exit 2 when fontkit is not
installed (npm i in the repo, or node tools/install.mjs --only=deps).
`

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help || !args.font || !args.text) { console.log(HELP); return args.help ? 0 : 1 }
  const fk = findFontkit()
  if (!fk) { console.error('outline-text: fontkit not found — run npm i in the repo, or node tools/install.mjs --only=deps'); return 2 }
  let file = String(args.font)
  if (!/\.(ttf|otf|woff2?)$/i.test(file) && !existsSync(file)) {
    try { file = await fetchGoogleFont(file, String(args.text)) } catch (e) { console.error(`outline-text: ${e.message}`); return 1 }
  } else if (!existsSync(file)) { console.error(`outline-text: no such font file — ${file}`); return 1 }
  let font
  try { font = fk.module.create(readFileSync(file)) } catch (e) { console.error(`outline-text: cannot read ${basename(file)} — ${e.message}`); return 1 }
  if (font.fonts && font.fonts.length) font = font.fonts[0] // a collection: the first face
  const variation = {}
  for (const axis of ['wght', 'wdth', 'opsz', 'ital', 'slnt', 'SOFT', 'WONK']) if (args[axis] !== undefined) variation[axis] = Number(args[axis])
  const size = args.size ? Number(args.size) : 96
  let res
  try { res = outline(font, String(args.text), { size, tracking: args.tracking ? Number(args.tracking) : 0, variation }) }
  catch (e) { console.error(`outline-text: ${e.message}`); return 1 }
  if (args.json) { console.log(JSON.stringify({ font: basename(file), family: res.family, size, ...res, d: undefined }, null, 2)); return 0 }
  let units = ''
  if (args.units) {
    const u = String(args.units)
    if (!/^(in|mm|pt)$/.test(u)) { console.error('outline-text: --units wants in, mm or pt'); return 1 }
    units = u
  }
  // With physical units the viewBox stays in px; the width/height attributes carry the size at
  // 96 px/in (72 px/pt when pt), so a 96 px cap set for print lands at 1 in.
  const scale = units === 'in' ? 1 / 96 : units === 'mm' ? 25.4 / 96 : units === 'pt' ? 72 / 96 : 1
  const pad = args.pad ? Number(args.pad) : 0
  const out = String(args.out || `${String(args.text).replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'text'}.svg`)
  let doc = svg(res, { fill: String(args.fill || '#000'), pad, units })
  if (units) doc = doc.replace(/ width="([\d.]+)(in|mm|pt)" height="([\d.]+)(in|mm|pt)"/, (_m, w, u1, h, u2) => ` width="${(Number(w) * scale).toFixed(3)}${u1}" height="${(Number(h) * scale).toFixed(3)}${u2}"`)
  mkdirSync(dirname(resolve(out)), { recursive: true })
  writeFileSync(out, doc, 'utf8')
  console.log(`  ${out}  ${res.glyphs} glyphs as one path · ${res.width.toFixed(1)} × ${res.height.toFixed(1)} px · cap ${res.capHeight.toFixed(1)} px · ${res.family || basename(file)}`)
  return 0
}

const isEntry = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false } })()
if (isEntry) {
  main().then((code) => process.exit(code), (e) => { console.error(`outline-text: ${e.message}`); process.exit(1) })
}
