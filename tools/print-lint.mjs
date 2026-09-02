#!/usr/bin/env node
// print-lint.mjs — refuse a design that would not survive the press.
//
//   node tools/print-lint.mjs card.html --size business-card-us
//   node tools/print-lint.mjs poster.svg --trim 18x24in --bleed 0.25in
//   node tools/print-lint.mjs mark.svg --method embroidery
//
// A design can look finished on a screen and be unprintable: 5pt contact lines, a 0.1pt rule
// that drops out, a 900px photo placed at 6 inches, a page sized in pixels. Nobody notices
// until the box of cards arrives. This is the gate the print-design skill promises: it reads
// the HTML or SVG, converts every size it finds to points and inches, and fails on the
// violations that are mechanically certain. Judgement calls (is this beautiful) stay with the
// taste layer; physics stays here.
//
// Static and regex-based on purpose — no DOM, no dependencies — so it runs anywhere node does.
// That means it sees declared values, not computed ones: a font-size set in a stylesheet it
// cannot follow is a warning, not a pass.

import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PT = { pt: 1, px: 0.75, in: 72, mm: 72 / 25.4, cm: 72 / 2.54, pc: 12 }
const IN = { in: 1, mm: 1 / 25.4, cm: 1 / 2.54, pt: 1 / 72, px: 1 / 96 }

/** Minimums in points, by method. Sources: skills/print-design and skills/apparel-design references. */
export const MINIMUMS = {
  paper:      { text: 6,  reversedText: 7,  line: 0.25, reversedLine: 0.5, raster: 300, label: 'paper (offset/digital)' },
  screen:     { text: 8,  reversedText: 10, line: 1,    reversedLine: 1,   raster: 300, label: 'screen print' },
  dtg:        { text: 8,  reversedText: 8,  line: 1,    reversedLine: 1,   raster: 300, label: 'DTG' },
  embroidery: { text: 18, reversedText: 18, line: 2.83, reversedLine: 2.83, raster: null, label: 'embroidery (0.25in letters, 1mm lines)' },
  htv:        { text: 8,  reversedText: 8,  line: 2.83, reversedLine: 2.83, raster: 300, label: 'heat-transfer vinyl' },
}

const mm = (w, h) => ({ w: w / 25.4, h: h / 25.4 })
export const PRESETS = {
  'business-card-us': { w: 3.5, h: 2 }, 'business-card-eu': mm(85, 55), 'business-card-jp': mm(91, 55),
  'mini-card': { w: 2.5, h: 1.5 }, 'square-card': { w: 2.5, h: 2.5 },
  'postcard-4x6': { w: 4, h: 6 }, 'postcard-5x7': { w: 5, h: 7 }, 'postcard-a6': mm(105, 148),
  'half-letter': { w: 5.5, h: 8.5 }, letter: { w: 8.5, h: 11 }, legal: { w: 8.5, h: 14 }, tabloid: { w: 11, h: 17 },
  a6: mm(105, 148), a5: mm(148, 210), a4: mm(210, 297), a3: mm(297, 420), a2: mm(420, 594), a1: mm(594, 841), a0: mm(841, 1189),
  dl: mm(99, 210), 'rack-card': { w: 4, h: 9 }, 'poster-18x24': { w: 18, h: 24 }, 'poster-24x36': { w: 24, h: 36 },
  'sticker-2in': { w: 2, h: 2 }, 'sticker-3in': { w: 3, h: 3 },
}

const toPt = (num, unit) => Number(num) * (PT[unit.toLowerCase()] ?? NaN)
const toIn = (num, unit) => Number(num) * (IN[unit.toLowerCase()] ?? NaN)

// ── colour: sRGB -> OKLCH chroma, to flag what CMYK will not reach ───────────

function srgbToOklch(r, g, b) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  return { L, C: Math.hypot(a, bb) }
}

/** Every colour literal in the text with its OKLCH chroma. */
export function colours(text) {
  const out = []
  for (const m of text.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    let h = m[1]; if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    const { C } = srgbToOklch(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16))
    out.push({ literal: m[0], chroma: C })
  }
  for (const m of text.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/gi)) {
    out.push({ literal: m[0] + ')', chroma: srgbToOklch(+m[1], +m[2], +m[3]).C })
  }
  for (const m of text.matchAll(/oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+[\d.]+/gi)) {
    out.push({ literal: m[0] + ')', chroma: Number(m[2]) })
  }
  return out
}

// ── the checks ───────────────────────────────────────────────────────────────

export function lint(file, opts = {}) {
  const text = readFileSync(file, 'utf8')
  const isSvg = extname(file).toLowerCase() === '.svg'
  const method = MINIMUMS[opts.method || 'paper']
  if (!method) throw new Error(`unknown --method "${opts.method}" — one of ${Object.keys(MINIMUMS).join(', ')}`)
  const findings = []
  const fail = (rule, msg) => findings.push({ level: 'fail', rule, msg })
  const warn = (rule, msg) => findings.push({ level: 'warn', rule, msg })

  // 1. A physical size is declared, in physical units.
  let declared = null
  if (isSvg) {
    const w = (text.match(/<svg\b[^>]*\swidth="([^"]+)"/) || [])[1]
    const h = (text.match(/<svg\b[^>]*\sheight="([^"]+)"/) || [])[1]
    const p = (v) => { const m = String(v || '').match(/^([\d.]+)\s*(in|mm|cm|pt)$/i); return m ? toIn(m[1], m[2]) : null }
    if (p(w) && p(h)) declared = { w: p(w), h: p(h) }
    else if (w && h) fail('size', `SVG width/height are "${w}" × "${h}" — give them physical units (in, mm, pt) or the printer gets pixels`)
    else fail('size', 'SVG has no width/height — a print file needs a physical size')
  } else {
    const m = text.match(/@page\s*\{[^}]*\bsize\s*:\s*([\d.]+)\s*(in|mm|cm|pt|px)\s+([\d.]+)\s*(in|mm|cm|pt|px)/i)
    if (!m) fail('size', 'no `@page { size: W H }` rule — the document has no physical size')
    else if (/px/i.test(m[2]) || /px/i.test(m[4])) fail('size', `@page size is in pixels (${m[0].match(/size[^;]*/)[0]}) — use in, mm or pt`)
    else declared = { w: toIn(m[1], m[2]), h: toIn(m[3], m[4]) }
  }

  // 2. It matches trim + 2×bleed, when the caller says what those are.
  if (declared && (opts.trim || opts.size)) {
    const trim = opts.size ? PRESETS[opts.size] : opts.trim
    if (!trim) fail('size', `unknown preset "${opts.size}"`)
    else {
      const bleed = opts.bleed ?? (Math.max(trim.w, trim.h) >= 18 ? 0.25 : 0.125)
      const want = { w: trim.w + 2 * bleed, h: trim.h + 2 * bleed }
      const off = (a, b) => Math.abs(a - b) > 0.01
      if (off(declared.w, want.w) || off(declared.h, want.h)) {
        if (!off(declared.w, trim.w) && !off(declared.h, trim.h)) fail('bleed', `document is exactly the trim size (${trim.w.toFixed(3)} × ${trim.h.toFixed(3)} in) — no bleed. Author at trim + ${bleed} in on every side: ${want.w.toFixed(3)} × ${want.h.toFixed(3)} in`)
        else fail('size', `document is ${declared.w.toFixed(3)} × ${declared.h.toFixed(3)} in; trim ${trim.w.toFixed(3)} × ${trim.h.toFixed(3)} + ${bleed} in bleed wants ${want.w.toFixed(3)} × ${want.h.toFixed(3)} in`)
      }
    }
  }

  // 3. Pixel units on anything physical.
  const pxDims = [...text.matchAll(/\b(width|height|margin|padding|top|left|right|bottom|inset)\s*:\s*([\d.]+)px/gi)]
  if (pxDims.length > 0 && !isSvg) warn('units', `${pxDims.length} physical dimension(s) in px (first: ${pxDims[0][0]}) — pixels have no size on paper; use in, mm or pt`)

  // 4. Type below the minimum.
  const sizes = []
  for (const m of text.matchAll(/font-size\s*[:=]\s*"?([\d.]+)\s*(pt|px|mm|in|cm|pc|em|rem)/gi)) sizes.push({ src: m[0], v: m[1], u: m[2] })
  for (const m of text.matchAll(/\bfont\s*:\s*(?:[a-z-]+\s+)*?([\d.]+)(pt|px|mm|in|cm|pc)(?:\/[\d.]+)?\s/gi)) sizes.push({ src: m[0].trim(), v: m[1], u: m[2] })
  for (const m of text.matchAll(/font-size="([\d.]+)(pt|px|mm|in|cm|pc)?"/gi)) sizes.push({ src: m[0], v: m[1], u: m[2] || (isSvg ? 'svg' : 'px') })
  const rootPt = (() => { const m = text.match(/html\s*\{[^}]*font-size\s*:\s*([\d.]+)(pt|px)/i); return m ? toPt(m[1], m[2]) : 12 })()
  for (const s of sizes) {
    let pt
    if (s.u === 'em' || s.u === 'rem') { warn('type', `${s.src} — relative unit; cannot verify against ${method.text}pt (root assumed ${rootPt}pt → ${(Number(s.v) * rootPt).toFixed(1)}pt)`); continue }
    if (s.u === 'svg') { if (!declared) { warn('type', `${s.src} — unitless SVG font-size; declare the SVG in physical units to check it`); continue } pt = svgUserToPt(text, declared, Number(s.v)); if (pt == null) continue }
    else pt = toPt(s.v, s.u)
    if (pt < method.text) fail('type', `${s.src} = ${pt.toFixed(1)}pt, below the ${method.text}pt minimum for ${method.label}`)
    else if (pt < method.reversedText) warn('type', `${s.src} = ${pt.toFixed(1)}pt — fine positive; too small if reversed (light on dark) for ${method.label}`)
  }
  if (sizes.length === 0) warn('type', 'no font-size found — if type is set by an external stylesheet this lint cannot see it')

  // 5. Lines below the minimum.
  for (const m of text.matchAll(/\b(?:border(?:-(?:top|right|bottom|left))?(?:-width)?|outline(?:-width)?)\s*:\s*([\d.]+)(pt|px|mm|in)/gi)) {
    const pt = toPt(m[1], m[2])
    if (pt > 0 && pt < method.line) fail('line', `${m[0]} = ${pt.toFixed(2)}pt, below the ${method.line}pt minimum for ${method.label} — it will drop out`)
  }
  for (const m of text.matchAll(/stroke-width\s*[:=]\s*"?([\d.]+)(pt|px|mm|in)?/gi)) {
    let pt
    if (m[2]) pt = toPt(m[1], m[2])
    else if (isSvg && declared) { pt = svgUserToPt(text, declared, Number(m[1])); if (pt == null) continue }
    else pt = toPt(m[1], 'px')
    if (pt > 0 && pt < method.line) fail('line', `${m[0]} = ${pt.toFixed(2)}pt, below the ${method.line}pt minimum for ${method.label} — it will drop out`)
  }

  // 6. Rasters placed below the required dpi.
  if (method.raster) {
    for (const m of text.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)) {
      const tag = m[0]
      const srcRaw = m[1]
      if (/^(https?:|data:)/i.test(srcRaw)) { warn('raster', `${srcRaw.slice(0, 40)}… — remote or inline image; cannot verify resolution`); continue }
      const p = resolve(dirname(file), decodeURIComponent(srcRaw.replace(/^file:\/\/\/?/, '')))
      const px = rasterWidth(p)
      if (!px) continue
      // The placed width: an inline style or width attribute on the tag, else a stylesheet
      // rule whose selector actually targets this image — `img`, one of its classes, or its
      // id. Never "the first width in the file", which is usually the sheet itself.
      let wm = tag.match(/width\s*[:=]\s*"?([\d.]+)\s*(in|mm|cm|pt)/i)
      if (!wm) {
        const selectors = ['img']
        for (const c of ((tag.match(/class="([^"]+)"/i) || [])[1] || '').split(/\s+/).filter(Boolean)) selectors.push(`\\.${c}`)
        const id = (tag.match(/id="([^"]+)"/i) || [])[1]
        if (id) selectors.push(`#${id}`)
        for (const sel of selectors) {
          wm = text.match(new RegExp(`(?:^|[\\s,}])${sel}\\s*(?:,[^{]*)?\\{[^}]*?\\bwidth\\s*:\\s*([\\d.]+)(in|mm|cm|pt)`, 'i'))
          if (wm) break
        }
      }
      if (!wm) { warn('raster', `${srcRaw} — placed width not found in physical units; cannot verify its ${px}px against ${method.raster}dpi`); continue }
      const inches = toIn(wm[1], wm[2])
      const dpi = px / inches
      if (dpi < method.raster) fail('raster', `${srcRaw} is ${px}px placed at ${inches.toFixed(2)}in = ${dpi.toFixed(0)}dpi, below ${method.raster} — it will print soft`)
    }
  }

  // 7. Colours CMYK may not reach. Warning only, and hue-dependent: yellows and warm oranges
  //    print well above this chroma, saturated blues fail below it. The spec sheet may name a spot.
  const hot = colours(text).filter((c) => c.chroma > 0.14)
  if (hot.length) warn('gamut', `${hot.length} colour(s) with OKLCH chroma > 0.14 (${[...new Set(hot.map((c) => c.literal))].slice(0, 4).join(', ')}) — may be outside the CMYK gamut (hue-dependent: check these hues); name a Pantone for anything that must match`)

  // 8. Method-specific. Thread and cut vinyl cannot make a gradient; a screen can, as halftone
  //    or simulated-process separations — real work, extra screens, a separator. Warn, not fail.
  const gradient = /gradient\(|<linearGradient|<radialGradient/i.test(text)
  if ((opts.method === 'embroidery' || opts.method === 'htv') && gradient) {
    fail('method', `a gradient in artwork for ${method.label} — this method cannot print one; flat colour only`)
  }
  if (opts.method === 'screen' && gradient) {
    warn('method', 'a gradient in screen-print artwork — printable only as a halftone or simulated-process separations (4–8 screens, an experienced separator); confirm with the shop and cost it before committing')
  }
  if (opts.method === 'embroidery' && /<image\b|<img\b/i.test(text)) fail('method', 'a raster image in embroidery artwork — embroidery is stitched from vector')

  return { file, method: method.label, findings, ok: !findings.some((f) => f.level === 'fail') }
}

/** SVG user units -> points, via the declared physical size and the viewBox. */
function svgUserToPt(text, declared, v) {
  const vb = ((text.match(/<svg\b[^>]*\sviewBox="([^"]+)"/) || [])[1] || '').trim().split(/[\s,]+/).map(Number)
  if (vb.length !== 4 || !(vb[2] > 0)) return null
  return v * (declared.w / vb[2]) * 72
}

function rasterWidth(p) {
  if (!existsSync(p)) return null
  const b = readFileSync(p)
  if (b.length > 24 && b.toString('latin1', 1, 4) === 'PNG') return b.readUInt32BE(16)
  if (b[0] === 0xff && b[1] === 0xd8) { // JPEG: walk to a SOF marker
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const marker = b[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return b.readUInt16BE(i + 7)
      i += 2 + b.readUInt16BE(i + 2)
    }
  }
  return null
}

// ── cli ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s)
      if (v !== undefined) out[k] = v
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[k] = argv[++i]
      else out[k] = true
    } else out._.push(a)
  }
  return out
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help || !args._.length) {
    console.log(`print-lint — refuse a design that would not survive the press

usage: print-lint <design.html|svg> [--size <preset> | --trim WxH<unit>] [--bleed <len>] [--method paper|screen|dtg|embroidery|htv] [--json]
exit:  0 clean · 1 a finding that would fail on press · 2 bad input`)
    return args.help ? 0 : 2
  }
  const file = resolve(args._[0])
  if (!existsSync(file)) { console.error(`print-lint: no such file — ${file}`); return 2 }
  const opts = { method: args.method || 'paper' }
  if (args.size) opts.size = String(args.size)
  if (args.trim) { const m = String(args.trim).match(/^([\d.]+)\s*[x×]\s*([\d.]+)\s*(in|mm|cm|pt)$/i); if (!m) { console.error('print-lint: --trim wants WxH<unit>, e.g. 3.5x2in'); return 2 } opts.trim = { w: toIn(m[1], m[3]), h: toIn(m[2], m[3]) } }
  if (args.bleed) { const m = String(args.bleed).match(/^([\d.]+)\s*(in|mm|cm|pt)$/i); if (!m) { console.error('print-lint: --bleed wants a length, e.g. 0.125in'); return 2 } opts.bleed = toIn(m[1], m[2]) }
  let r
  try { r = lint(file, opts) } catch (e) { console.error(`print-lint: ${e.message}`); return 2 }
  if (args.json) console.log(JSON.stringify(r, null, 2))
  else {
    console.log(`PRINT-LINT  ${file}  ·  ${r.method}`)
    for (const f of r.findings) console.log(`  ${f.level === 'fail' ? 'FAIL' : 'warn'}  ${f.rule.padEnd(7)} ${f.msg}`)
    const fails = r.findings.filter((f) => f.level === 'fail').length
    const warns = r.findings.length - fails
    console.log(`\n  ${fails} would fail on press · ${warns} to check\n  ${r.ok ? 'Passes the physical checks. The taste layer decides the rest.' : 'Not print-ready. Fix every FAIL before rendering.'}`)
  }
  return r.ok ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main())
