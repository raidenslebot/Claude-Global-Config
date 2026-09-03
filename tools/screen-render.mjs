#!/usr/bin/env node
// screen-render.mjs — look at a screen design before showing it.
//
//   node tools/screen-render.mjs page.html                       # <page>-1440.png at 1440×900
//   node tools/screen-render.mjs page.html --mobile --full       # plus <page>-390.png, full-page
//   node tools/screen-render.mjs https://localhost:5173 --dark --out proofs/home --json
//
// The review loop needs the render, not the source: a design is judged by looking at it at
// the sizes people use, and the first render is never the one to show. This writes PNGs at a
// desktop and (with --mobile) a phone width through the same local headless Chromium the print
// pipeline uses, waits for web fonts, and names any @font-face that failed to load — the
// commonest way a designed page ships looking like the default. It cannot tell whether a
// LOCAL font resolved; only the render can, so look at it.

import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { join, resolve, dirname, basename, extname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { findPlaywright } from './print-render.mjs'
import { unrenderable } from './paths.mjs'

export const DESKTOP = { width: 1440, height: 900 }
export const MOBILE = { width: 390, height: 844 }

// Exact-pixel canvases for the fields that are delivered as a picture. Strong defaults [D] —
// platforms move their specs; the numbers are the widely published ones as of 2026 and the
// safe zones are conservative. A preset captures exactly the viewport, never the full page.
export const PRESETS = {
  'ig-post': { width: 1080, height: 1350, note: '4:5 — safe everywhere; the feed and grid tile are 3:4 since 2025' },
  'ig-34': { width: 1080, height: 1440, note: '3:4 — the tallest feed image and the grid tile since 2025; confirm the scheduler takes it' },
  'ig-square': { width: 1080, height: 1080 },
  'story': { width: 1080, height: 1920, note: '9:16 — keep text 250px from the top and 340px from the bottom' },
  'x-post': { width: 1600, height: 900, note: '16:9' },
  'yt-thumb': { width: 1280, height: 720, note: '16:9; YouTube now recommends 3840×2160, minimum width 640; 2MB is the safe ceiling; it is chosen at ~168px wide in the sidebar' },
  'linkedin': { width: 1200, height: 627 },
  'og': { width: 1200, height: 630, note: 'link previews everywhere' },
  'pinterest': { width: 1000, height: 1500, note: '2:3' },
  'slide': { width: 1920, height: 1080, note: '16:9; title-safe inset 5%' },
  'slide-4x3': { width: 1600, height: 1200 },
  'email': { width: 640, height: 1200, note: 'a 600–640px canvas; capture with --full' },
  'app-icon': { width: 1024, height: 1024, note: 'the master; platforms mask it' },
}

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[k] = argv[++i]
      else out[k] = true
    } else out._.push(a)
  }
  return out
}

const HELP = `usage:
  cgc render <page.html | url> [--viewport WxH | --preset <name>] [--mobile] [--full] [--dark] [--scale N] [--out <base>] [--json]

Writes <base>-<width>.png for each viewport (default 1440×900; --mobile adds 390×844).
--full captures the whole page, --dark emulates prefers-color-scheme: dark, --scale 2 doubles the pixels.
--preset renders an exact-pixel canvas: ${Object.keys(PRESETS).join(', ')}.
Reports @font-face loads that failed. Exit 2 when no browser is available.
`

/** Families the page ASKS FOR that render exactly as their fallback.
 *
 *  `document.fonts` only knows about faces the page declared. A stylesheet that was never
 *  served — a misspelled Google family answers 400 — declares nothing, so nothing can fail to
 *  load and the render came back in the system serif with no word said about it. The render is
 *  the thing the designer looks at; a silent fallback misleads every judgement after it. */
export const fellBackInPage = () => {
  const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-(serif|sans-serif|monospace|rounded)|-apple-system|BlinkMacSystemFont|inherit|initial|unset|revert|emoji|math|fangsong)$/i
  const asked = new Map()
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      if (own) {
        const f = getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '')
        if (f && !GENERIC.test(f) && !asked.has(f)) asked.set(f, el)
      }
      if (el.shadowRoot) walk(el.shadowRoot)
    }
  }
  walk(document)
  if (!asked.size) return []
  const probe = document.createElement('span')
  // Wide and narrow glyphs, upper, lower and figures, in pieces so the string is not one
  // long alphabet literal.
  const SAMPLE = ['mmmmmmmmmm', 'lllllllllll', 'ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz', '0123456789'].join('')
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;font-size:40px;white-space:nowrap;visibility:hidden'
  document.body.appendChild(probe)
  const width = (fam) => { probe.style.fontFamily = fam; return probe.getBoundingClientRect().width }
  const out = []
  for (const [face, el] of asked) {
    // Measured with the element's OWN text, so an icon face or a CJK face with no Latin glyphs
    // is judged on what it is actually asked to draw.
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim()
    probe.textContent = own.length >= 3 ? own.slice(0, 60) : SAMPLE
    const same = ['monospace', 'serif', 'sans-serif'].every((gen) => Math.abs(width(`"${face}", ${gen}`) - width(gen)) < 0.5)
    if (same) out.push(face)
  }
  probe.remove()
  return out
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help || args._.length !== 1) { console.log(HELP); return args.help ? 0 : 1 }
  const src = args._[0]
  const url = /^https?:\/\//i.test(src) ? src : pathToFileURL(resolve(src)).href
  if (!/^https?:/i.test(src) && !existsSync(resolve(src))) { console.error(`screen-render: no such file — ${src}`); return 1 }
  { const why = unrenderable(resolve(src)); if (why) { console.error(`screen-render: ${why}`); return 1 } }

  const pw = findPlaywright()
  if (!pw) {
    console.error('screen-render: playwright-core not found. Install the Playwright MCP server (node tools/install.mjs --only=mcp) — it brings the browser this tool renders with.')
    return 2
  }
  const outBase = args.out ? resolve(String(args.out))
    : /^https?:/i.test(src) ? resolve('screen') : join(dirname(resolve(src)), basename(src, extname(src)))
  mkdirSync(dirname(outBase), { recursive: true })

  const viewports = []
  if (args.preset) {
    const p = PRESETS[String(args.preset)]
    if (!p) { console.error(`screen-render: unknown preset "${args.preset}" — one of ${Object.keys(PRESETS).join(', ')}`); return 1 }
    viewports.push({ width: p.width, height: p.height, tag: String(args.preset) })
  } else if (args.viewport) {
    const m = /^(\d+)x(\d+)$/i.exec(String(args.viewport))
    if (!m) { console.error('screen-render: --viewport wants WxH, e.g. 1440x900'); return 1 }
    viewports.push({ width: +m[1], height: +m[2] })
  } else viewports.push(DESKTOP)
  if (args.mobile) viewports.push(MOBILE)
  const scale = args.scale ? Number(args.scale) : 1

  const { chromium } = pw.module
  let browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch (e) {
    console.error(`screen-render: the browser could not be launched — ${String(e.message || e).split('\n')[0]}`)
    console.error('Install it with: cgc install --only=mcp   (playwright-core ships no browsers of its own)')
    return 2
  }
  const shots = []
  try {
    for (const vp of viewports) {
      const mobile = vp.width < 768
      const ctx = await browser.newContext({
        viewport: vp, deviceScaleFactor: scale, colorScheme: args.dark ? 'dark' : 'light',
        isMobile: mobile, hasTouch: mobile,
      })
      const page = await ctx.newPage()
      try { await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 }) }
      catch { await page.goto(url, { waitUntil: 'load', timeout: 20000 }) }
      const fonts = await page.evaluate(async () => {
        await document.fonts.ready
        return [...document.fonts].map((f) => ({ family: f.family, status: f.status, weight: f.weight, style: f.style }))
      })
      await page.waitForTimeout(300)
      // A face the page asks for that measures exactly as its fallback never arrived, whether or
      // not anything declared it. document.fonts cannot see a stylesheet that was never served.
      const fellBack = await page.evaluate(fellBackInPage).catch(() => [])
      const png = `${outBase}-${vp.tag || vp.width}.png`
      // A preset is an exact canvas: it never captures past its own pixels, whatever --full says.
      await page.screenshot({ path: png, type: 'png', fullPage: Boolean(args.full) && !vp.tag })
      const height = await page.evaluate(() => document.documentElement.scrollHeight)
      shots.push({
        viewport: `${vp.width}x${vp.height}`, png, pageHeight: height,
        fontsLoaded: [...new Set(fonts.filter((f) => f.status === 'loaded').map((f) => f.family))],
        fontsFailed: [...new Set(fonts.filter((f) => f.status === 'error').map((f) => f.family))],
        fontsFellBack: fellBack,
      })
      await ctx.close()
    }
  } finally { await browser.close() }

  const failed = [...new Set([...shots.flatMap((s) => s.fontsFailed), ...shots.flatMap((s) => s.fontsFellBack)])]
  // A render in the wrong face is not a render of this design, so it is not a success. The
  // JSON already said ok:false here while the exit code said 0, and a gate reads the code.
  if (args.json) { console.log(JSON.stringify({ ok: failed.length === 0, url, shots }, null, 2)); return failed.length ? 1 : 0 }
  for (const s of shots) {
    console.log(`  ${s.viewport.padEnd(9)} ${s.png}  (page ${s.pageHeight}px tall${s.fontsLoaded.length ? `; fonts: ${s.fontsLoaded.join(', ')}` : ''})`)
  }
  if (failed.length) console.log(`  \x1b[31mfont failed to load\x1b[0m: ${failed.join(', ')} — the page rendered in a fallback; the design you judged is not the one that shipped`)
  else console.log('  Look at them. Then name the weakest thing, fix it, and render again.')
  return failed.length ? 1 : 0
}

const isEntry = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false } })()
if (isEntry) {
  main().then((code) => process.exit(code), (e) => { console.error(`screen-render: ${e.message}`); process.exit(1) })
}
