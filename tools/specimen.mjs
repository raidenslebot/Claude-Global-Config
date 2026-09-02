#!/usr/bin/env node
// specimen.mjs — see the faces and the colours before committing to them.
//
//   node tools/specimen.mjs --display "Fraunces:ital,opsz,wght@1,9..144,300" --text "Archivo" \
//        --mono "JetBrains Mono" --italic \
//        --palette "oklch(0.97 0.012 80),oklch(0.22 0.02 60),oklch(0.55 0.17 25)" \
//        --words "A standard nobody checks" --out proofs/specimen
//
// A face is chosen by looking at it set, not by its name in a list; a palette by seeing its
// colours next to each other with type on them. This writes a specimen page — the display line
// at two sizes, the text face at reading size with a real measure, caps labels, figures, the
// pairing on the surface and reversed on the ink, and every colour as a swatch with its
// contrast against the surface and the ink — then renders it through screen-render. Google
// Fonts are loaded by name; add the axis spec after a colon to see the real italic and weights
// rather than a synthesised one. screen-render names any face that failed to load.

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { main as render } from './screen-render.mjs'

const PROSE = 'The face that carries a page is chosen at reading size, on the ground it will sit on, beside the face that will answer it. A display italic that sings at a hundred and twenty pixels can die at eighteen; a grotesque that holds a paragraph can be nothing at a headline. So set both, in the measure the page will use, and read the paragraph rather than admiring the word.'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const family = (spec) => String(spec).split(':')[0].trim()
const gf = (specs) => specs.filter(Boolean).map((s) => 'family=' + String(s).trim().replace(/ /g, '+')).join('&')

export function specimenHtml({ display, text, mono = '', italic = false, palette = [], words = 'Handgloves & Quartz' } = {}) {
  const [surface = '#f7f4ee', ink = '#1a1815', ...rest] = palette
  const link = `https://fonts.googleapis.com/css2?${gf([display, text, mono])}&display=swap`
  const swatches = palette.map((c, i) => `<div class="sw" style="background:${esc(c)}" data-c="${esc(c)}"><b>${esc(c)}</b><span class="k">${i === 0 ? 'surface' : i === 1 ? 'ink' : i === 2 ? 'signal' : 'colour ' + (i + 1)}</span><span class="cr"></span><i>Aa 0123</i></div>`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Specimen — ${esc(family(display))} + ${esc(family(text))}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${link}" rel="stylesheet">
<style>
  :root { --surface: ${esc(surface)}; --ink: ${esc(ink)}; --display: "${esc(family(display))}", serif; --text: "${esc(family(text))}", sans-serif; --mono: ${mono ? `"${esc(family(mono))}", ` : ''}ui-monospace, Menlo, Consolas, monospace; }
  * { box-sizing: border-box } html { background: var(--surface); color: var(--ink) } body { margin: 0; font-family: var(--text); font-optical-sizing: auto; line-height: 1.5 }
  .page { padding: 48px 64px 72px; max-width: 1440px }
  .label { font: 500 11px/1 var(--mono); letter-spacing: .14em; text-transform: uppercase; opacity: .6; margin: 36px 0 10px; border-top: .5px solid color-mix(in srgb, var(--ink) 25%, transparent); padding-top: 10px }
  .label:first-child { margin-top: 0; border: 0; padding: 0 }
  .d1 { font-family: var(--display); font-size: 128px; line-height: .9; letter-spacing: -.03em; margin: 0; font-weight: 300; ${italic ? 'font-style: italic;' : ''} font-variation-settings: "opsz" 144; text-wrap: balance }
  .d2 { font-family: var(--display); font-size: 64px; line-height: .95; letter-spacing: -.02em; margin: 0 0 14px; font-weight: 400; font-variation-settings: "opsz" 72 }
  .d3 { font-family: var(--display); font-size: 64px; line-height: .95; letter-spacing: -.02em; margin: 0; font-weight: 700 }
  .prose { max-width: 62ch; font-size: 18px; line-height: 1.55; margin: 0; text-wrap: pretty }
  .prose + .prose { margin-top: 1em }
  .row { display: flex; gap: 40px; flex-wrap: wrap; align-items: baseline }
  .caps { font: 500 12px/1 var(--text); letter-spacing: .14em; text-transform: uppercase }
  .fig { font-family: var(--text); font-size: 28px; font-variant-numeric: tabular-nums }
  .figm { font-family: var(--mono); font-size: 22px }
  .glyphs { font-family: var(--display); font-size: 36px; line-height: 1.2 }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0 } .pair > div { padding: 40px 44px } .pair .rev { background: var(--ink); color: var(--surface) }
  .pair h2 { font-family: var(--display); font-weight: 400; font-size: 40px; line-height: 1; letter-spacing: -.02em; margin: 0 0 16px; ${italic ? 'font-style: italic;' : ''} }
  .pair p { font-size: 17px; line-height: 1.5; margin: 0; max-width: 46ch }
  .sws { display: flex; gap: 12px; flex-wrap: wrap } .sw { width: 210px; height: 140px; padding: 12px; display: flex; flex-direction: column; font: 12px/1.35 var(--mono) }
  .sw b { font-weight: 500; word-break: break-all } .sw .k { opacity: .7 } .sw .cr { margin-top: auto; opacity: .85 } .sw i { font: italic 26px/1 var(--display); margin-top: 2px }
  .foot { font: 11px/1.6 var(--mono); opacity: .55; margin-top: 40px }
</style></head><body><div class="page">
  <div class="label">Display — ${esc(display)}</div>
  <h1 class="d1">${esc(words)}</h1>
  <div class="label">Display at 64 · regular and bold</div>
  <p class="d2">${esc(words)}</p><p class="d3">${esc(words)}</p>
  <div class="label">Text — ${esc(text)} · 18px / 1.55 · 62ch</div>
  <p class="prose">${esc(PROSE)}</p>
  <div class="label">Labels, figures, glyphs</div>
  <div class="row"><span class="caps">Caps label · tracked 0.14em</span><span class="fig">0123456789 · 4.4× · $1,250.00</span><span class="figm">${mono ? esc(family(mono)) : 'mono'} 0123456789 {x} =&gt;</span></div>
  <p class="glyphs">fi fl ff — “quotes” ‘single’ ½ ¾ § ¶ &amp; @ ? ! → Qu Ty AV</p>
  <div class="label">The pairing — on the surface, and reversed</div>
  <div class="pair"><div><h2>${esc(words)}</h2><p>${esc(PROSE.slice(0, 190))}…</p></div><div class="rev"><h2>${esc(words)}</h2><p>${esc(PROSE.slice(0, 190))}…</p></div></div>
  ${palette.length ? `<div class="label">Palette — contrast against the surface and the ink</div><div class="sws">${swatches}</div>` : ''}
  <p class="foot">Set with tools/specimen.mjs · ${esc(family(display))} + ${esc(family(text))}${mono ? ' + ' + esc(family(mono)) : ''} · fonts.googleapis.com</p>
</div>
<script>
  // Contrast of each swatch against the surface and the ink, in the browser's own colour maths.
  (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1; const ctx = cv.getContext('2d', { willReadFrequently: true })
    const rgb = (c) => { ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]] }
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
    const cs = getComputedStyle(document.documentElement)
    const S = rgb(cs.getPropertyValue('--surface').trim()), I = rgb(cs.getPropertyValue('--ink').trim())
    for (const el of document.querySelectorAll('.sw')) {
      const c = rgb(el.dataset.c)
      const rs = ratio(c, S), ri = ratio(c, I)
      el.style.color = ratio(c, I) >= ratio(c, S) ? cs.getPropertyValue('--ink') : cs.getPropertyValue('--surface')
      el.querySelector('.cr').textContent = 'vs surface ' + rs.toFixed(1) + ':1 · vs ink ' + ri.toFixed(1) + ':1'
    }
  })()
</script></body></html>`
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
  specimen --display <Google Fonts family[:axes]> --text <family[:axes]> [--mono <family>] [--italic]
           [--palette "<css colour>,<css colour>,…"] [--words "<display line>"] [--out <base>] [--no-render]

Writes <base>.html and renders <base>-1440.png (full page). The first palette colour is the
surface, the second the ink, the third the signal. Axis specs: "Fraunces:ital,opsz,wght@1,9..144,300".
`

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help || !args.display || !args.text) { console.log(HELP); return args.help ? 0 : 1 }
  const palette = args.palette ? String(args.palette).split(/\s*,(?![^(]*\))\s*/).map((s) => s.trim()).filter(Boolean) : []
  const out = resolve(String(args.out || `specimen-${family(args.display).replace(/\W+/g, '-').toLowerCase()}`))
  mkdirSync(dirname(out), { recursive: true })
  const html = specimenHtml({ display: String(args.display), text: String(args.text), mono: args.mono ? String(args.mono) : '', italic: Boolean(args.italic), palette, words: args.words ? String(args.words) : undefined })
  writeFileSync(`${out}.html`, html, 'utf8')
  console.log(`  wrote ${out}.html`)
  if (args['no-render']) return 0
  return render([`${out}.html`, '--full', '--out', out])
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (e) => { console.error(`specimen: ${e.message}`); process.exit(1) })
}
