#!/usr/bin/env node
// motion-render.mjs — watch the animation instead of reading its CSS.
//
//   cgc motion page.html --duration 900 --frames 14
//   cgc motion page.html --trigger hover:.card --selector .card
//   cgc motion page.html --trigger click:"button.menu" --duration 500
//   cgc motion page.html --trigger scroll --frames 16
//
// Every other check in this package reads the source: the easing keyword, the duration, the
// reduced-motion query. None of them can tell you the thing that matters — that the element
// snaps, that a third of the timeline is dead air, that nothing moved at all because the class
// was never applied. That is only visible in frames.
//
// So this steps the page through its own timeline under a VIRTUAL CLOCK and photographs it.
// performance.now, Date.now and requestAnimationFrame are replaced before a single line of page
// script runs — along with setTimeout and setInterval — so GSAP, Motion, a timer-triggered
// class flip and any hand-rolled rAF loop all advance exactly when told to; CSS
// animations, transitions and Web Animations are paused and scrubbed by currentTime. The result
// is deterministic: the same page yields the same frames on any machine, at any speed.
//
// It writes the frames, a contact sheet with the change under each frame and the progress curve
// plotted against the straight line, and a verdict measured FROM THE PIXELS: whether anything
// moved, what the easing actually is, where the motion settles, whether one frame carries the
// whole change, and whether the page still animates when the viewer has asked it not to.
//
// Exit 1 with --strict when the motion is dead, linear, jump-cut, or ignores reduced motion.

import { existsSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { join, resolve, dirname, basename, extname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { findPlaywright } from './print-render.mjs'
import { DESKTOP, MOBILE } from './screen-render.mjs'
import { unrenderable } from './paths.mjs'

// Replaces the clock before the page's own scripts see one. Everything that animates reads time
// from performance.now (GSAP's ticker, Motion, every rAF loop) or from rAF itself; both now
// advance only when this tool says so.
export const CLOCK = `(() => {
  let now = 0
  let id = 0
  const queue = new Map()
  const EPOCH = 1735689600000
  try { performance.now = () => now } catch {}
  try { Date.now = () => EPOCH + now } catch {}
  window.requestAnimationFrame = (cb) => { const i = ++id; queue.set(i, cb); return i }
  window.cancelAnimationFrame = (i) => { queue.delete(i) }

  // Timers run on the same virtual clock. Without this, an animation triggered by
  // setTimeout advances at whatever speed the capture happens to run at, which is the
  // opposite of the determinism this tool exists to provide.
  const timers = new Map()
  const realTimeout = window.setTimeout.bind(window)
  window.setTimeout = (fn, ms) => {
    const i = ++id
    timers.set(i, { fn, at: now + Math.max(0, Number(ms) || 0), every: 0 })
    return i
  }
  window.setInterval = (fn, ms) => {
    const i = ++id
    const every = Math.max(1, Number(ms) || 1)
    timers.set(i, { fn, at: now + every, every })
    return i
  }
  window.clearTimeout = (i) => { timers.delete(i) }
  window.clearInterval = (i) => { timers.delete(i) }
  void realTimeout
  window.__cgcClock = {
    now: () => now,
    advance(dt) {
      now += dt
      // Timers first, in time order, so a callback that schedules an animation has done so
      // before the frame is drawn. The guard stops a zero-delay interval spinning forever.
      for (let guard = 0; guard < 5000; guard++) {
        let pick = null
        for (const [i, timer] of timers) {
          if (timer.at <= now && (!pick || timer.at < pick.timer.at)) pick = { i, timer }
        }
        if (!pick) break
        if (pick.timer.every) pick.timer.at += pick.timer.every
        else timers.delete(pick.i)
        try { pick.timer.fn() } catch {}
      }
      // A callback that schedules another frame must not run twice in one step.
      const due = [...queue.entries()]
      queue.clear()
      for (const [, cb] of due) { try { cb(now) } catch {} }
      return due.length
    },
  }
  // Scrub every declarative animation to the same instant. A transition that has not started
  // yet has no Animation object, which is why the clock above matters as much as this does.
  const started = new WeakMap()
  window.__cgcScrub = (t) => {
    let n = 0
    for (const a of document.getAnimations()) {
      try {
        // The first instant this animation is seen is the instant it began. Scrubbing it to
        // the absolute capture time would run it as though it had started with the page.
        if (!started.has(a)) started.set(a, t)
        a.pause()
        const local = Math.max(0, t - started.get(a))
        const timing = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null
        const end = timing && Number.isFinite(timing.endTime) ? timing.endTime : local
        a.currentTime = Math.min(local, end)
        n++
      } catch {}
    }
    return n
  }
})()`

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) { const k = a.slice(2); if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[k] = argv[++i]; else out[k] = true }
    else out._.push(a)
  }
  return out
}

// The contact sheet doubles as the measuring instrument: it decodes every frame into a canvas,
// diffs each against the one before it, and reports the numbers back through a global. Doing it
// in the browser keeps this tool at zero image dependencies.
export function sheetHtml(frames, { title, trigger, viewport }) {
  const cols = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(frames.length))))
  const cells = frames.map((f, i) => `<figure><img src="${f.url}" alt="frame ${i}" data-i="${i}"><figcaption><b>${f.t} ms</b><span class="bar"><i style="width:0"></i></span><span class="pct">·</span></figcaption></figure>`).join('')
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>
  :root { --ink:#14161a; --dim:#6b7280; --line:#d8d5cd; --hot:#b4541f; --paper:#f4f1ea }
  * { box-sizing: border-box }
  body { margin:0; background:var(--paper); color:var(--ink); font:13px/1.4 ui-monospace,Menlo,Consolas,monospace }
  header { padding:20px 24px 14px; border-bottom:1px solid var(--line); display:flex; gap:28px; align-items:baseline; flex-wrap:wrap }
  h1 { font-size:15px; margin:0; letter-spacing:.02em }
  header span { color:var(--dim) }
  .grid { display:grid; grid-template-columns:repeat(${cols},1fr); gap:14px; padding:20px 24px }
  figure { margin:0 }
  img { width:100%; display:block; border:1px solid var(--line); background:#fff }
  figcaption { display:flex; align-items:center; gap:8px; padding-top:6px; font-size:11px; color:var(--dim) }
  figcaption b { color:var(--ink); font-weight:500; min-width:52px }
  .bar { flex:1; height:4px; background:var(--line); position:relative }
  .bar i { position:absolute; inset:0 auto 0 0; background:var(--hot) }
  .pct { min-width:30px; text-align:right }
  .curve { padding:8px 24px 26px }
  .curve svg { width:100%; height:170px; border:1px solid var(--line); background:#fff }
</style>
<header><h1>${title}</h1><span>${trigger}</span><span>${viewport}</span><span id="verdict">measuring…</span></header>
<div class="grid">${cells}</div>
<div class="curve"><svg viewBox="0 0 1000 170" preserveAspectRatio="none" id="plot"></svg></div>
<script>
window.__cgcMeasured = (async () => {
  const imgs = [...document.images]
  await Promise.all(imgs.map((i) => i.decode().catch(() => {})))
  const W = 320
  // Namespaced deliberately: in an SVG document createElement makes an SVG element called
  // "canvas", which has no getContext, and auditing any .svg threw a stack trace.
  const cv = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas'), cx = cv.getContext('2d', { willReadFrequently: true })
  const lumas = []
  for (const img of imgs) {
    const h = Math.max(1, Math.round(W * (img.naturalHeight || 1) / (img.naturalWidth || 1)))
    cv.width = W; cv.height = h
    cx.clearRect(0, 0, W, h)
    cx.drawImage(img, 0, 0, W, h)
    const d = cx.getImageData(0, 0, W, h).data
    const l = new Float32Array(W * h)
    for (let p = 0, q = 0; p < d.length; p += 4, q++) l[q] = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]
    lumas.push(l)
  }
  const change = [0]
  let maxDelta = 0
  // The first frame against the last: the only quantity that can be compared like for like
  // between a full capture and a two-frame reduced-motion capture.
  let endDelta = 0
  if (lumas.length > 1) {
    const a = lumas[0], b = lumas[lumas.length - 1]
    if (a.length === b.length && a.length) {
      let s = 0
      for (let p = 0; p < a.length; p++) s += Math.abs(a[p] - b[p])
      endDelta = s / a.length / 255
    }
  }
  for (let i = 1; i < lumas.length; i++) {
    const a = lumas[i - 1], b = lumas[i]
    const n = Math.min(a.length, b.length)
    if (!n || a.length !== b.length) { change.push(0); continue }
    let s = 0
    for (let p = 0; p < n; p++) {
      const d = Math.abs(a[p] - b[p])
      s += d
      if (d > maxDelta) maxDelta = d
    }
    change.push(s / n / 255)
  }
  const total = change.reduce((x, y) => x + y, 0)
  const peak = Math.max(...change)
  const cum = []
  let run = 0
  for (const c of change) { run += c; cum.push(total ? run / total : 0) }
  document.querySelectorAll('figure').forEach((fig, i) => {
    fig.querySelector('.bar i').style.width = (peak ? change[i] / peak * 100 : 0).toFixed(1) + '%'
    fig.querySelector('.pct').textContent = (cum[i] * 100).toFixed(0) + '%'
  })
  const pts = cum.map((c, i) => [i / Math.max(1, cum.length - 1) * 1000, 170 - c * 160 - 5])
  const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  document.getElementById('plot').innerHTML =
    '<path d="M0 165 L1000 5" stroke="#c9c5bb" stroke-width="1.5" fill="none" stroke-dasharray="5 5"/>'
    + '<path d="' + path + '" stroke="#b4541f" stroke-width="2.5" fill="none"/>'
    + pts.map((p) => '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" fill="#b4541f"/>').join('')
  document.getElementById('verdict').textContent = (total < 0.0008 && maxDelta < 10) ? 'NOTHING MOVED' : 'change ' + total.toFixed(3) + ' · peak Δ ' + maxDelta.toFixed(0)
  return { change, cum, total, peak, maxDelta, endDelta }
})()
</script>`
}

// Everything below reads the curve, never the source. A straight cumulative line is linear
// motion; a single tall bar is a jump cut; a flat tail is padding at the end of the duration.
export function readCurve({ change, cum, total, maxDelta = 0 }, { duration, frames, scroll = false }) {
  const findings = []
  const n = cum.length
  const at = (frac) => {
    const i = cum.findIndex((c) => c >= frac)
    return i < 0 ? duration : Math.round(duration * i / Math.max(1, n - 1))
  }
  // Moved at all is the largest change ANYWHERE, not the average change everywhere: a waterline
  // rising inside one column of a wide page barely shifts the mean and is plainly not dead.
  const moved = total >= 0.0008 || maxDelta >= 10
  if (!moved) {
    findings.push({ id: 'dead', level: 'fail', note: 'nothing moved across the whole capture — the animation never ran. The trigger did not fire, the class was never applied, the library did not load, or the element is not in view. This is the failure that reads as "the animation is subtle" and ships broken.' })
    return { findings, moved, easing: 'none', settle: 0, deadHead: 0, deadTail: 0 }
  }
  // Deviation of the measured cumulative curve from the straight line through it.
  let dev = 0
  let signed = 0
  for (let i = 0; i < n; i++) {
    const lin = i / Math.max(1, n - 1)
    dev = Math.max(dev, Math.abs(cum[i] - lin))
    signed += cum[i] - lin
  }
  signed /= n
  const half = cum.findIndex((c) => c >= 0.5) / Math.max(1, n - 1)
  let easing = 'custom'
  if (dev < 0.07) easing = 'linear'
  else if (signed > 0.04 && half < 0.42) easing = 'ease-out'
  else if (signed < -0.04 && half > 0.58) easing = 'ease-in'
  else easing = 'ease-in-out'
  // A scroll capture is sampled at even scroll positions, so its cumulative curve is a straight
  // line BY CONSTRUCTION, and it has no duration to be too slow or too fast against. Only the
  // findings that are true of any capture apply to it.
  if (easing === 'linear' && !scroll) {
    findings.push({ id: 'linear', level: 'fail', note: `the measured curve is a straight line (deviation ${dev.toFixed(3)}) — nothing in the physical world starts and stops at full speed. Give it an ease: cubic-bezier(.2,.8,.2,1) for something arriving, cubic-bezier(.4,0,1,1) for something leaving.` })
  }
  const settle = at(0.95)
  const still = (c) => c < total * 0.005
  const steps = Math.max(1, n - 1)
  let tailFrames = 0
  for (let i = n - 1; i > 0 && still(change[i]); i--) tailFrames++
  let headFrames = 0
  for (let i = 1; i < n && still(change[i]); i++) headFrames++
  const deadTail = Math.round(tailFrames / steps * 100)
  const deadHead = Math.round(headFrames / steps * 100)
  if (deadTail >= 40 && !scroll) findings.push({ id: 'dead-tail', level: 'warn', note: `the last ${deadTail}% of the timeline is frozen — ${tailFrames} of ${steps} frames show no change at all. The animation is finished well before the duration is; shorten it to what the eye actually sees.` })
  if (deadHead >= 25 && !scroll) findings.push({ id: 'dead-head', level: 'warn', note: `the first ${deadHead}% of the timeline is frozen. A delay before a response reads as lag, not as choreography — unless it is a stagger, in which case stagger it visibly.` })
  const peakShare = Math.max(...change) / total
  if (peakShare > 0.6 && n >= 6) findings.push({ id: 'jump-cut', level: 'fail', note: `one frame carries ${Math.round(peakShare * 100)}% of the whole change — this snaps, it does not move. Whatever changes state is switching, not animating: check for display, or a property that cannot be interpolated.` })
  if (duration <= 90 && !scroll) findings.push({ id: 'too-fast', level: 'warn', note: `${duration} ms is below the threshold where the eye reads motion as motion — it registers as a flicker. 120–200 ms for a small state change, 200–400 ms for something entering.` })
  if (duration >= 1400 && settle >= 1200 && !scroll) findings.push({ id: 'too-slow', level: 'warn', note: `${settle} ms of motion is long enough to be waited on. Anything the user triggered should be finished inside 400 ms; reserve the long timeline for something they chose to watch.` })
  return { findings, moved, easing, settle, deadHead, deadTail, deviation: +dev.toFixed(3) }
}

const HELP = `usage:
  cgc motion <file|url> [--frames 12] [--duration 1000] [--trigger load|hover:<sel>|click:<sel>|scroll]
             [--viewport WxH] [--mobile] [--dark] [--out <base>] [--strict] [--json]

Steps the page under a virtual clock and photographs it, then measures the motion from the
pixels: whether anything moved, the easing the frames actually show, where it settles, whether
one frame carries the change, and whether it still animates under prefers-reduced-motion.

Writes <base>-motion.png (the contact sheet — look at this) and the frames beside it.
--trigger scroll scrubs the scroll position instead of the clock, for scroll-driven work.
--strict exits 1 on a dead, linear, jump-cut or reduced-motion failure. Exit 2 with no browser.
`

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help || args._.length !== 1) { console.log(HELP); return args.help ? 0 : 1 }
  const src = args._[0]
  const isUrl = /^https?:\/\//i.test(src)
  if (!isUrl && !existsSync(resolve(src))) { console.error(`motion-render: no such file — ${src}`); return 1 }
  if (!isUrl) { const why = unrenderable(resolve(src)); if (why) { console.error(`motion-render: ${why}`); return 1 } }
  const url = isUrl ? src : pathToFileURL(resolve(src)).href

  const pw = findPlaywright()
  if (!pw) {
    console.error('motion-render: playwright-core not found. Install the Playwright MCP server (cgc install --only=mcp) — it brings the browser this tool renders with.')
    return 2
  }

  const frames = Math.max(3, Math.min(48, Number(args.frames) || 12))
  const duration = Math.max(50, Math.min(20000, Number(args.duration) || 1000))
  const trigger = String(args.trigger || 'load')
  const scrolling = trigger === 'scroll'
  const outBase = args.out ? resolve(String(args.out))
    : isUrl ? resolve('motion') : join(dirname(resolve(src)), basename(src, extname(src)))
  const frameDir = `${outBase}-frames`
  mkdirSync(frameDir, { recursive: true })

  let vp = { ...DESKTOP }
  if (args.mobile) vp = { ...MOBILE }
  if (args.viewport) {
    const m = /^(\d+)x(\d+)$/i.exec(String(args.viewport))
    if (!m) { console.error('motion-render: --viewport wants WxH, e.g. 1440x900'); return 1 }
    vp = { width: +m[1], height: +m[2] }
  }

  const { chromium } = pw.module
  let browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch (e) {
    console.error(`motion-render: the browser could not be launched — ${String(e.message || e).split('\n')[0]}`)
    console.error('Install it with: cgc install --only=mcp   (playwright-core ships no browsers of its own)')
    return 2
  }
  const shot = []
  const reducedShot = []
  // A scroll capture legitimately changes as the page moves, so there is nothing to compare.
  const checkReduced = !scrolling
  try {
    // The capture, and then the same capture again with reduced motion asked for. The second
    // run is the only way to know the media query is honoured rather than merely present.
    for (const reduced of checkReduced ? [false, true] : [false]) {
      const ctx = await browser.newContext({
        viewport: vp, colorScheme: args.dark ? 'dark' : 'light',
        reducedMotion: reduced ? 'reduce' : 'no-preference',
        isMobile: vp.width < 768, hasTouch: vp.width < 768,
      })
      if (!scrolling) await ctx.addInitScript(CLOCK)
      const page = await ctx.newPage()
      try { await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 }) }
      catch { await page.goto(url, { waitUntil: 'load', timeout: 20000 }) }
      await page.evaluate(() => document.fonts.ready).catch(() => {})
      // Let anything that waits a frame before initialising have its frames, at time zero.
      if (!scrolling) await page.evaluate(() => { for (let i = 0; i < 3; i++) window.__cgcClock.advance(0) })

      const m = /^(hover|click):(.+)$/.exec(trigger)
      if (m) {
        const sel = m[2].replace(/^["']|["']$/g, '')
        try { await (m[1] === 'hover' ? page.hover(sel, { timeout: 4000 }) : page.click(sel, { timeout: 4000 })) }
        catch { if (!reduced) console.error(`motion-render: --trigger ${trigger} — no element matched "${sel}"; captured the page untriggered.`) }
      }

      const height = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - window.innerHeight))
      const count = frames
      let prev = 0
      for (let i = 0; i < count; i++) {
        const t = Math.round(duration * i / (count - 1))
        if (scrolling) {
          await page.evaluate((y) => window.scrollTo(0, y), Math.round(height * i / (count - 1)))
          await page.waitForTimeout(90)
        } else {
          await page.evaluate(([dt, at]) => {
            window.__cgcClock.advance(dt)
            if (window.__cgcScrub) window.__cgcScrub(at)
          }, [t - prev, t])
          prev = t
        }
        const file = join(frameDir, `${reduced ? 'r' : 'f'}${String(i).padStart(2, '0')}.png`)
        // The sheet carries the frames as data URIs: a file:// image taints the canvas it is
        // measured in, and an inlined sheet is one file that opens anywhere.
        const buf = await page.screenshot({ path: file, type: 'png' })
        const entry = { t: scrolling ? Math.round(height * i / (count - 1)) : t, path: file, url: 'data:image/png;base64,' + buf.toString('base64') }
        if (reduced) reducedShot.push(entry); else shot.push(entry)
      }
      await ctx.close()
    }
  } finally { await browser.close() }

  // Measure: the sheet decodes the frames and hands back the change curve.
  const title = `${basename(src)} · ${frames} frames`
  const sheetFile = join(frameDir, 'sheet.html')
  writeFileSync(sheetFile, sheetHtml(shot, {
    title, viewport: `${vp.width}×${vp.height}`,
    trigger: scrolling ? 'scroll-driven' : trigger === 'load' ? `0–${duration} ms` : `${trigger} · 0–${duration} ms`,
  }), 'utf8')

  // The reduced-motion pair goes through the same instrument: two frames, one number.
  let reducedSheet = null
  if (checkReduced && reducedShot.length >= 2) {
    reducedSheet = join(frameDir, 'sheet-reduced.html')
    writeFileSync(reducedSheet, sheetHtml(reducedShot, { title: 'reduced motion', viewport: '', trigger: '' }), 'utf8')
  }

  let browser2
  try {
    browser2 = await chromium.launch({ headless: true })
  } catch (e) {
    console.error(`motion-render: the browser could not be launched — ${String(e.message || e).split('\n')[0]}`)
    return 2
  }
  let measured
  let reducedTotal = null
  const sheetPng = `${outBase}-motion.png`
  try {
    const page = await browser2.newPage({ viewport: { width: 1400, height: 900 } })
    await page.goto(pathToFileURL(sheetFile).href, { waitUntil: 'load', timeout: 30000 })
    measured = await page.evaluate(() => window.__cgcMeasured)
    await page.screenshot({ path: sheetPng, type: 'png', fullPage: true })
    if (reducedSheet) {
      await page.goto(pathToFileURL(reducedSheet).href, { waitUntil: 'load', timeout: 30000 })
      reducedTotal = (await page.evaluate(() => window.__cgcMeasured)).total
    }
  } finally { await browser2.close() }

  const read = readCurve(measured, { duration, frames, scroll: scrolling })
  // It moved for everyone, and it moved JUST AS MUCH for the viewer who asked it not to. Both
  // sides of this comparison are first-frame-against-last, because the reduced capture is two
  // frames and the full one is a dozen: comparing a single difference against a sum of twelve
  // would fail every page that reduces its motion instead of removing it, which is the remedy
  // this finding recommends.
  const fullPath = measured.total || 0
  if (reducedTotal !== null && read.moved && fullPath > 0.0008) {
    const ratio = reducedTotal / fullPath
    if (reducedTotal > 0.0008 && ratio >= 0.5) {
      read.findings.push({
        id: 'reduced-motion',
        level: 'fail',
        note: `under prefers-reduced-motion the page still travels ${Math.round(ratio * 100)}% as far as it does normally (${reducedTotal.toFixed(3)} against ${fullPath.toFixed(3)}, summed across the same frames). For a viewer with a vestibular disorder that is not a preference being ignored, it is symptoms. Wrap the movement in @media (prefers-reduced-motion: no-preference), or reduce it to an opacity change. Cutting the animation so the element simply arrives passes this, because there is then no path to travel.`,
      })
    }
  }

  const result = {
    ok: !read.findings.some((f) => f.level === 'fail'),
    src, trigger, frames, duration, sheet: sheetPng, frameDir,
    total: +measured.total.toFixed(4), easing: read.easing, settleMs: read.settle,
    deviation: read.deviation, reducedMotionChange: reducedTotal === null ? null : +reducedTotal.toFixed(4),
    findings: read.findings,
  }
  if (args.json) { console.log(JSON.stringify(result, null, 2)); return result.ok || !args.strict ? 0 : 1 }

  console.log(`  ${sheetPng}`)
  console.log(`  ${frames} frames · ${scrolling ? 'scroll-driven' : `${duration} ms`} · ${trigger}`)
  if (read.moved && scrolling) {
    console.log(`  the page changes as it scrolls (total ${measured.total.toFixed(3)}) — a scroll capture has no duration, so easing and settle do not apply to it`)
  } else if (read.moved) {
    console.log(`  measured easing: \x1b[1m${read.easing}\x1b[0m (deviation from linear ${read.deviation}) · settles at ${read.settle} ms`)
  }
  for (const f of read.findings) {
    const tag = f.level === 'fail' ? '\x1b[31mFAIL\x1b[0m' : '\x1b[33mwarn\x1b[0m'
    console.log(`  ${tag} ${f.id} — ${f.note}`)
  }
  if (!read.findings.length) console.log('  Nothing measured is wrong. Now open the sheet and watch it: the numbers cannot tell you whether it has any character.')
  else console.log('  Open the sheet. The frames are the argument; fix what you can see and capture it again.')
  return result.ok || !args.strict ? 0 : 1
}

const isEntry = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false } })()
if (isEntry) {
  main().then((code) => process.exit(code), (e) => { console.error(`motion-render: ${e.message}`); process.exit(1) })
}
