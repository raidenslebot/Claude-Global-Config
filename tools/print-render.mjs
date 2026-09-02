#!/usr/bin/env node
// print-render.mjs — render a design authored at physical size to a file a printer can take.
//
//   node tools/print-render.mjs card.html --size business-card-us --marks --png 300
//   node tools/print-render.mjs poster.svg --trim 18x24in --bleed 0.25in --png 150 --out proofs/poster
//   node tools/print-render.mjs mark.svg --mockup tee --zone left-chest --garment "#1c1c1e" --png 150
//
// Why this exists: the default output of a model asked for a business card is a paragraph, or a
// screenshot of a web layout. Neither is a print file. This turns HTML or SVG written in inches
// and points into a PDF at trim + bleed (with crop marks in a slug when asked) and a PNG proof at
// a real dpi — through the headless Chromium that is already on the machine for the Playwright
// MCP server. No account, no key, nothing fetched.
//
// What it will not pretend to do: Chromium writes RGB. The JSON summary says so, and the
// print-design skill says what to hand an offset shop. Colour intent belongs in the spec sheet.
//
// Portable by construction: the browser is found through the live MCP registration (whatever
// machine this is) with the repo's own install as a fallback; nothing here names a path.

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { realpathSync as __realpath } from 'node:fs'
import { join, resolve, dirname, basename, extname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

// ── units and presets ────────────────────────────────────────────────────────

const IN = { in: 1, mm: 1 / 25.4, cm: 1 / 2.54, pt: 1 / 72, px: 1 / 96 }

/** "3.5x2in" | "85x55mm" -> { w, h } in inches. */
export function parseSize(s) {
  const m = String(s).trim().match(/^([\d.]+)\s*[x×]\s*([\d.]+)\s*(in|mm|cm|pt|px)$/i)
  if (!m) throw new Error(`size must look like 3.5x2in or 85x55mm — got "${s}"`)
  const k = IN[m[3].toLowerCase()]
  return { w: Number(m[1]) * k, h: Number(m[2]) * k }
}

/** "0.125in" | "3mm" -> inches. */
export function parseLength(s) {
  const m = String(s).trim().match(/^([\d.]+)\s*(in|mm|cm|pt|px)$/i)
  if (!m) throw new Error(`length must look like 0.125in or 3mm — got "${s}"`)
  return Number(m[1]) * IN[m[2].toLowerCase()]
}

const mm = (w, h) => ({ w: w / 25.4, h: h / 25.4 })

/** Trim sizes in inches. Same names and values as skills/print-design/references/sizes-and-specs.md. */
export const PRESETS = {
  'business-card-us': { w: 3.5, h: 2 },
  'business-card-eu': mm(85, 55),
  'business-card-jp': mm(91, 55),
  'mini-card': { w: 2.5, h: 1.5 },
  'square-card': { w: 2.5, h: 2.5 },
  'postcard-4x6': { w: 4, h: 6 },
  'postcard-5x7': { w: 5, h: 7 },
  'postcard-a6': mm(105, 148),
  'half-letter': { w: 5.5, h: 8.5 },
  letter: { w: 8.5, h: 11 },
  legal: { w: 8.5, h: 14 },
  tabloid: { w: 11, h: 17 },
  a6: mm(105, 148),
  a5: mm(148, 210),
  a4: mm(210, 297),
  a3: mm(297, 420),
  a2: mm(420, 594),
  a1: mm(594, 841),
  a0: mm(841, 1189),
  dl: mm(99, 210),
  'rack-card': { w: 4, h: 9 },
  'poster-18x24': { w: 18, h: 24 },
  'poster-24x36': { w: 24, h: 36 },
  'sticker-2in': { w: 2, h: 2 },
  'sticker-3in': { w: 3, h: 3 },
}

/** Large format wants more bleed; everything else 0.125in. Strong default, overridable. */
export function defaultBleed(trim) {
  return Math.max(trim.w, trim.h) >= 18 ? 0.25 : 0.125
}

// ── the browser ──────────────────────────────────────────────────────────────

/**
 * Find playwright-core without naming a path. First the live MCP registration in
 * ~/.claude.json (the truth on this machine), then the repo's own install, then whatever
 * plain resolution finds. Returns the module or null.
 */
export function findPlaywright() {
  const require = createRequire(import.meta.url)
  const candidates = []
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8').replace(/^﻿/, ''))
    const entry = cfg?.mcpServers?.playwright?.args?.[0]
    if (entry) candidates.push(resolve(dirname(String(entry)), '..', '..'))
  } catch { /* no live config — fall through */ }
  candidates.push(join(REPO, 'library', 'mcp-servers', 'node_modules'))
  for (const dir of candidates) {
    try {
      return { module: require(require.resolve('playwright-core', { paths: [dir] })), from: dir }
    } catch { /* not here */ }
  }
  try { return { module: require('playwright-core'), from: 'require' } } catch { return null }
}

// ── wrapper documents ────────────────────────────────────────────────────────
// The source is embedded in an <iframe> at exactly trim + 2×bleed, inside a page that adds the
// slug when marks are wanted. An iframe keeps the source's own @page and CSS isolated from the
// wrapper, works for HTML and SVG alike, and renders in page.pdf() without any change to the
// design file itself.

function cropMarks(trim, bleed, slug) {
  // Marks live in the slug, pointing at the trim corners, and never enter the bleed.
  const L = slug * 0.8          // mark length
  const gap = bleed + slug * 0.15 // distance from the trim to the start of the mark
  const x0 = slug + bleed, x1 = slug + bleed + trim.w
  const y0 = slug + bleed, y1 = slug + bleed + trim.h
  const line = (x, y, w, h) =>
    `<div style="position:absolute;left:${x}in;top:${y}in;width:${w}in;height:${h}in;background:#000"></div>`
  const t = 0.25 / 72 // 0.25pt hairline
  return [
    // top-left
    line(x0 - gap - L, y0, L, t), line(x0, y0 - gap - L, t, L),
    // top-right
    line(x1 + gap, y0, L, t), line(x1, y0 - gap - L, t, L),
    // bottom-left
    line(x0 - gap - L, y1, L, t), line(x0, y1 + gap, t, L),
    // bottom-right
    line(x1 + gap, y1, L, t), line(x1, y1 + gap, t, L),
  ].join('')
}

function printWrapper({ srcUrl, trim, bleed, slug, marks }) {
  const W = trim.w + 2 * (bleed + slug), H = trim.h + 2 * (bleed + slug)
  const iw = trim.w + 2 * bleed, ih = trim.h + 2 * bleed
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${W}in ${H}in; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
body { width: ${W}in; height: ${H}in; position: relative; overflow: hidden; }
iframe { position: absolute; left: ${slug}in; top: ${slug}in; width: ${iw}in; height: ${ih}in; border: 0; display: block; }
</style></head><body>
<iframe src="${srcUrl}"></iframe>${marks ? cropMarks(trim, bleed, slug) : ''}
</body></html>`
}

/** Relative luminance of a CSS hex colour, or null when it is not a hex. */
function luminance(css) {
  const m = String(css).trim().match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i)
  if (!m) return null
  let h = m[1]; if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin(parseInt(h.slice(0, 2), 16)) + 0.7152 * lin(parseInt(h.slice(2, 4), 16)) + 0.0722 * lin(parseInt(h.slice(4, 6), 16))
}

function mockupWrapper({ flatSvg, flatW, flatH, zone, artUrl, artW, artH, garment, showZones, presentation }) {
  const svg = flatSvg
    .replace(/<svg\b([^>]*)\swidth="[^"]*"/, '<svg$1 width="__W__"')
    .replace(/<svg\b([^>]*)\sheight="[^"]*"/, '<svg$1 height="__H__"')
    .replace('__W__', `${flatW}in`).replace('__H__', `${flatH}in`)
  // A zone may lie along a sleeve; the art rotates about the zone's centre with it.
  const rot = zone.rotate ? ` transform: rotate(${zone.rotate}deg); transform-origin: 50% 50%;` : ''
  const artLeft = zone.x + (zone.w - artW) / 2
  const artTop = zone.rotate ? zone.y + (zone.h - artH) / 2 : zone.y
  // Ink on a light garment reads as multiply (it soaks in); on a dark one an opaque ink sits on
  // top, so no blend. Decided from the garment colour, not guessed.
  const lum = luminance(garment)
  const blend = presentation && lum !== null && lum > 0.35 ? ' mix-blend-mode: multiply;' : ''
  // Presentation: a neutral studio ground, a soft cast shadow, a fabric grain on the garment
  // only, and a slight fall-off toward the edges. Restrained on purpose — this is a review
  // tool, not a marketing render, and the art must stay judgeable.
  const pres = presentation ? `
body { background: radial-gradient(ellipse at 50% 35%, #efece6 0%, #dcd8cf 70%, #cfcabf 100%); }
.flat { filter: drop-shadow(0.10in 0.14in 0.28in rgba(20, 18, 14, 0.30)); }
.flat #garment { filter: url(#fabric); }
.vignette { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.10) 100%); }` : ''
  const fabric = presentation ? `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<filter id="fabric" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="2.4 2.4" numOctaves="3" seed="7" result="noise"/>
  <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.07 0" result="grain"/>
  <feBlend in="SourceGraphic" in2="grain" mode="multiply"/>
</filter></defs></svg>` : ''
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; background: #f4f2ee; }
body { width: ${flatW}in; height: ${flatH}in; position: relative; overflow: hidden; }
.flat { position: absolute; left: 0; top: 0; width: ${flatW}in; height: ${flatH}in; --garment: ${garment}; }
.flat #zones { display: ${showZones ? 'block' : 'none'}; }
.art { position: absolute; left: ${artLeft}in; top: ${artTop}in; width: ${artW}in; height: ${artH}in;${rot}${blend} }
.art img { width: 100%; height: 100%; display: block; }${pres}
</style></head><body>
${fabric}<div class="flat">${svg}</div>
<div class="art"><img src="${artUrl}" alt=""></div>${presentation ? '<div class="vignette"></div>' : ''}
</body></html>`
}

/** Several designs as one PDF: each page is a section at page size, breaking after it. */
function pagesWrapper({ srcUrls, trim, bleed, slug, marks }) {
  const W = trim.w + 2 * (bleed + slug), H = trim.h + 2 * (bleed + slug)
  const iw = trim.w + 2 * bleed, ih = trim.h + 2 * bleed
  const sections = srcUrls.map((u, i) =>
    `<section${i < srcUrls.length - 1 ? ' style="page-break-after: always; break-after: page;"' : ''}>` +
    `<iframe src="${u}"></iframe>${marks ? cropMarks(trim, bleed, slug) : ''}</section>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${W}in ${H}in; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
section { width: ${W}in; height: ${H}in; position: relative; overflow: hidden; display: block; }
iframe { position: absolute; left: ${slug}in; top: ${slug}in; width: ${iw}in; height: ${ih}in; border: 0; display: block; }
</style></head><body>${sections}</body></html>`
}

// ── art dimensions ───────────────────────────────────────────────────────────

/** Intrinsic size of an SVG (physical units, or viewBox aspect) or PNG (pixels) as { w, h, unit }. */
export function artSize(file) {
  const ext = extname(file).toLowerCase()
  if (ext === '.svg') {
    const t = readFileSync(file, 'utf8')
    const attr = (n) => (t.match(new RegExp(`<svg\\b[^>]*\\s${n}="([^"]+)"`)) || [])[1]
    const w = attr('width'), h = attr('height')
    const phys = (v) => { const m = String(v || '').match(/^([\d.]+)\s*(in|mm|cm|pt)$/i); return m ? Number(m[1]) * IN[m[2].toLowerCase()] : null }
    if (phys(w) && phys(h)) return { w: phys(w), h: phys(h), unit: 'in' }
    const vb = (attr('viewBox') || '').trim().split(/[\s,]+/).map(Number)
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { w: vb[2], h: vb[3], unit: 'ratio' }
    return { w: 1, h: 1, unit: 'ratio' }
  }
  if (ext === '.png') {
    const b = readFileSync(file)
    if (b.length > 24 && b.toString('latin1', 1, 4) === 'PNG') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), unit: 'px' }
  }
  return { w: 1, h: 1, unit: 'ratio' }
}

// ── main ─────────────────────────────────────────────────────────────────────

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

const HELP = `print-render — HTML/SVG at physical size -> PDF (+ PNG proof), or a true-scale garment mockup

usage:
  print-render <design.html|svg> (--size <preset> | --trim WxH<unit>) [--bleed <len>] [--marks]
               [--png <dpi>] [--out <base>] [--json]
  print-render <front.html> <back.html> [...]  same flags — one multi-page PDF, one PNG per page
  print-render <art.svg|png> --mockup <garment> --zone <zone> [--garment <css colour>]
               [--art-width <len>] [--show-zones] [--presentation] [--png <dpi>] [--out <base>] [--json]

  presets:  ${Object.keys(PRESETS).join(', ')}
  garments: read from skills/apparel-design/assets/zones.json (tee, tee-back, long-sleeve, hoodie,
            polo, jersey, cap, beanie, tote); --presentation adds a studio ground, cast shadow and
            fabric grain for review, and multiplies ink into light garments

exit: 0 rendered · 1 bad input · 2 no browser available (install the Playwright MCP server first)`

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help || args._.length === 0) { console.log(HELP); return args.help ? 0 : 1 }
  const srcs = args._.map((p) => resolve(p))
  const src = srcs[0]
  for (const s of srcs) if (!existsSync(s)) { console.error(`print-render: no such file — ${s}`); return 1 }
  if (srcs.length > 1 && args.mockup) { console.error('print-render: a mockup takes one artwork file'); return 1 }

  const pw = findPlaywright()
  if (!pw) {
    console.error('print-render: playwright-core not found. Install the Playwright MCP server (node tools/install.mjs --only=mcp) — it brings the browser this tool renders with.')
    return 2
  }

  const outBase = args.out ? resolve(String(args.out))
    : srcs.length > 1 ? join(dirname(src), srcs.map((s) => basename(s, extname(s))).join('+'))
      : join(dirname(src), basename(src, extname(src)))
  mkdirSync(dirname(outBase), { recursive: true })
  const dpi = args.png === true ? 300 : args.png ? Number(args.png) : 0
  if (args.png && !(dpi > 0)) { console.error('print-render: --png wants a dpi, e.g. --png 300'); return 1 }
  const scratch = join(tmpdir(), `print-render-${process.pid}-${Date.now()}`)
  mkdirSync(scratch, { recursive: true })

  let html, pageW, pageH, summary
  if (args.mockup) {
    const zonesFile = join(REPO, 'skills', 'apparel-design', 'assets', 'zones.json')
    const zones = JSON.parse(readFileSync(zonesFile, 'utf8'))
    const g = zones[String(args.mockup)]
    if (!g) { console.error(`print-render: unknown garment "${args.mockup}" — one of ${Object.keys(zones).filter((k) => !k.startsWith('_')).join(', ')}`); return 1 }
    const zone = g.zones[String(args.zone)]
    if (!zone) { console.error(`print-render: unknown zone "${args.zone}" for ${args.mockup} — one of ${Object.keys(g.zones).join(', ')}`); return 1 }
    const flatSvg = readFileSync(join(dirname(zonesFile), g.file), 'utf8')
    const size = artSize(src)
    let artW = args['art-width'] ? parseLength(String(args['art-width'])) : zone.w
    let artH = artW * (size.h / size.w)
    if (artH > zone.h) { artH = zone.h; artW = artH * (size.w / size.h) }
    html = mockupWrapper({
      flatSvg, flatW: g.width, flatH: g.height, zone, artUrl: pathToFileURL(src).href,
      artW, artH, garment: String(args.garment || '#d9d6cf'), showZones: Boolean(args['show-zones']),
      presentation: Boolean(args.presentation),
    })
    pageW = g.width; pageH = g.height
    summary = { mode: 'mockup', garment: args.mockup, zone: args.zone, garmentColour: String(args.garment || '#d9d6cf'), artInches: { w: +artW.toFixed(3), h: +artH.toFixed(3) }, zoneInches: zone, presentation: Boolean(args.presentation) }
  } else {
    let trim
    if (args.size) { trim = PRESETS[String(args.size)]; if (!trim) { console.error(`print-render: unknown preset "${args.size}" — one of ${Object.keys(PRESETS).join(', ')}`); return 1 } }
    else if (args.trim) trim = parseSize(String(args.trim))
    else { console.error('print-render: give --size <preset> or --trim WxH<unit>'); return 1 }
    const bleed = args.bleed !== undefined ? parseLength(String(args.bleed)) : defaultBleed(trim)
    const slug = args.marks ? 0.25 : 0
    const urls = srcs.map((s) => pathToFileURL(s).href)
    html = srcs.length > 1
      ? pagesWrapper({ srcUrls: urls, trim, bleed, slug, marks: Boolean(args.marks) })
      : printWrapper({ srcUrl: urls[0], trim, bleed, slug, marks: Boolean(args.marks) })
    pageW = trim.w + 2 * (bleed + slug); pageH = trim.h + 2 * (bleed + slug)
    summary = { mode: 'print', pages: srcs.length, trimInches: { w: +trim.w.toFixed(4), h: +trim.h.toFixed(4) }, bleedInches: bleed, slugInches: slug, marks: Boolean(args.marks), colourSpace: 'RGB (Chromium) — state CMYK/Pantone intent in the spec sheet' }
  }

  const wrapper = join(scratch, 'wrapper.html')
  writeFileSync(wrapper, html, 'utf8')

  const { chromium } = pw.module
  const browser = await chromium.launch({ headless: true })
  try {
    const outputs = {}
    if (summary.mode === 'print') {
      const page = await browser.newPage()
      await page.goto(pathToFileURL(wrapper).href, { waitUntil: 'load' })
      // Fonts in the iframe may still be loading; give the document its own say.
      await page.evaluate(() => document.fonts ? document.fonts.ready : null)
      const pdf = `${outBase}.pdf`
      await page.pdf({ path: pdf, width: `${pageW}in`, height: `${pageH}in`, printBackground: true, preferCSSPageSize: false, margin: { top: 0, right: 0, bottom: 0, left: 0 } })
      outputs.pdf = pdf
      await page.close()
    }
    if (dpi > 0) {
      const scale = dpi / 96
      const pages = summary.pages || 1
      const vw = Math.round(pageW * 96), vh = Math.round(pageH * 96)
      const ctx = await browser.newContext({ deviceScaleFactor: scale, viewport: { width: vw, height: vh * pages } })
      const page = await ctx.newPage()
      await page.goto(pathToFileURL(wrapper).href, { waitUntil: 'load' })
      await page.evaluate(() => document.fonts ? document.fonts.ready : null)
      if (pages === 1) {
        const png = `${outBase}.png`
        await page.screenshot({ path: png, type: 'png', clip: { x: 0, y: 0, width: vw, height: vh } })
        outputs.png = png
      } else {
        outputs.png = []
        for (let i = 0; i < pages; i++) {
          const png = `${outBase}-${i + 1}.png`
          await page.screenshot({ path: png, type: 'png', clip: { x: 0, y: i * vh, width: vw, height: vh } })
          outputs.png.push(png)
        }
      }
      await ctx.close()
    }
    const result = { ...summary, pageInches: { w: +pageW.toFixed(4), h: +pageH.toFixed(4) }, dpi: dpi || null, ...outputs, browserFrom: pw.from }
    if (args.json) console.log(JSON.stringify(result, null, 2))
    else {
      for (const v of Object.values(outputs).flat()) console.log(`  wrote ${v}  (${(statSync(v).size / 1024).toFixed(0)} KB)`)
      if (summary.mode === 'print') console.log(`  page ${result.pageInches.w} × ${result.pageInches.h} in · trim ${summary.trimInches.w} × ${summary.trimInches.h} · bleed ${summary.bleedInches} · ${summary.colourSpace}`)
      else console.log(`  ${summary.garment} / ${summary.zone} · art ${summary.artInches.w} × ${summary.artInches.h} in on ${summary.garmentColour}`)
    }
    return 0
  } finally {
    await browser.close()
  }
}

const isEntry = (() => { try { return Boolean(process.argv[1]) && __realpath(process.argv[1]) === __realpath(fileURLToPath(import.meta.url)) } catch { return false } })()
if (isEntry) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(`print-render: ${e.message}`); process.exit(1) })
}
