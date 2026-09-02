#!/usr/bin/env node
// page-audit.mjs — the rendered page, measured against the professional's questions a machine
// can answer.
//
//   node tools/page-audit.mjs page.html [--mobile] [--viewport WxH] [--json]
//   node tools/page-audit.mjs https://localhost:5173 --mobile
//
// slop-lint reads the source and finds the template. This renders the page and measures what a
// reader gets: the contrast of every text run against its real ground; faces that fell back to
// a system font; the measure of body text; text too small to read; a widow at the end of a
// heading; a page that scrolls sideways on a phone; tap targets too small for a thumb; a focus
// nobody can see; animations that ignore prefers-reduced-motion; images without alt; and the
// palette by area — how many saturated hues there are and how much of the page they cover.
// FAILs on what a reader would suffer; warns on what a professional would fix; informs on the
// rest. It cannot tell whether the page is good — the loop in creative-divergence does that —
// but a page that fails here is not finished, whatever it looks like.

import { existsSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { findPlaywright } from './print-render.mjs'
import { DESKTOP, MOBILE } from './screen-render.mjs'

// ── the in-page audit ─────────────────────────────────────────────────────────
// Serialised into the page by Playwright, so it must be self-contained: no outer references.
function auditInPage({ mobile }) {
  const out = []
  const push = (rule, level, msg, sample) => out.push({ rule, level, msg, sample: sample == null ? '' : String(sample).replace(/\s+/g, ' ').trim().slice(0, 70) })
  const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong|-apple-system|BlinkMacSystemFont|inherit|initial)$/i
  const HTML = 'http://www.w3.org/1999/xhtml'

  // Any CSS colour → sRGB. Computed values of oklch()/color-mix() stay in their own space, so a
  // canvas does the conversion the browser already knows.
  const cv = document.createElement('canvas'); cv.width = cv.height = 1
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  const rgba = (c) => {
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c
    if (c === 'transparent' || /rgba?\([^)]*,\s*0\)$/.test(c) || ctx.fillStyle === '#000000' && /^(transparent|rgba\(0, 0, 0, 0\))$/.test(c)) return [0, 0, 0, 0]
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2], d[3] / 255]
  }
  const over = (top, ground) => {
    const a = top[3]
    return [top[0] * a + ground[0] * (1 - a), top[1] * a + ground[1] * (1 - a), top[2] * a + ground[2] * (1 - a), 1]
  }
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05) }
  const hex = (c) => '#' + [0, 1, 2].map((i) => Math.round(c[i]).toString(16).padStart(2, '0')).join('')
  // OKLab, for chroma and hue — the palette rule is stated in OKLCH.
  const oklab = (c) => {
    const r = lin(c[0]), g = lin(c[1]), b = lin(c[2])
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    return { L, C: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180 / Math.PI) + 360) % 360 }
  }

  const visible = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  // The ground by ancestry: every ancestor's background composited, top down. Cheap, and right
  // for the palette by area; wrong for contrast when something positioned is painted under the
  // text, which is what every hero does.
  const groundChain = (el) => {
    const chain = []
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) chain.push(e)
    let g = [255, 255, 255, 1], unknown = false
    for (let i = chain.length - 1; i >= 0; i--) {
      const cs = getComputedStyle(chain[i])
      if (cs.backgroundImage && cs.backgroundImage !== 'none') unknown = true
      const bg = rgba(cs.backgroundColor)
      if (bg[3] > 0) g = over(bg, g)
    }
    return { g, unknown }
  }
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
  // The ground as painted: the stack of elements under a point inside the text's first line
  // box, composited from the bottom up to the text element itself. A positioned image or a
  // sibling block behind the text is part of it; an image, video, canvas or background image
  // in the stack makes it unknowable. The element is scrolled into view first — the stack is
  // only answerable inside the viewport.
  const groundPainted = (el) => {
    el.scrollIntoView({ block: 'center', inline: 'nearest' })
    const tn = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim())
    let box = null
    if (tn) { const rg = document.createRange(); rg.selectNodeContents(tn); box = [...rg.getClientRects()].find((r) => r.width > 0 && r.height > 0) || null }
    if (!box) box = el.getBoundingClientRect()
    const x = Math.min(innerWidth - 1, Math.max(0, box.left + Math.min(box.width / 2, 8)))
    const y = Math.min(innerHeight - 1, Math.max(0, box.top + box.height / 2))
    const stack = document.elementsFromPoint(x, y)
    const i = stack.indexOf(el)
    if (i < 0) return groundChain(el)
    let g = [255, 255, 255, 1], unknown = false
    for (let k = stack.length - 1; k >= i; k--) {
      const e = stack[k]
      if (/^(IMG|VIDEO|CANVAS|PICTURE|IFRAME|OBJECT|svg)$/i.test(e.tagName)) { unknown = true; continue }
      const cs = getComputedStyle(e)
      if (cs.backgroundImage && cs.backgroundImage !== 'none') unknown = true
      const bg = rgba(cs.backgroundColor)
      if (bg[3] > 0) g = over(bg, g)
    }
    return { g, unknown }
  }
  // Opacity dims the ink as surely as alpha does, all the way up the tree.
  const alphaOf = (el) => { let a = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) a *= Math.min(1, Math.max(0, +getComputedStyle(e).opacity)); return a }

  const all = [...document.querySelectorAll('body *')].filter((el) => el.namespaceURI === HTML && !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName))
  const textEls = all.filter((el) => ownText(el).length >= 2 && visible(el))

  // 1. Contrast.
  let unknownGround = 0, low = []
  const scroll0 = [scrollX, scrollY]
  for (const el of textEls) {
    const cs = getComputedStyle(el)
    const { g, unknown } = groundPainted(el)
    if (unknown) { unknownGround++; continue }
    let fg = rgba(cs.color); if (fg[3] === 0) continue
    fg = [fg[0], fg[1], fg[2], fg[3] * alphaOf(el)]
    fg = over(fg, g)
    const fs = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700
    const large = fs >= 24 || (fs >= 18.66 && bold)
    const r = ratio(fg, g)
    if (r < (large ? 3 : 4.5)) low.push({ r, el, fg, g, fs })
  }
  scrollTo(scroll0[0], scroll0[1])
  low.sort((a, b) => a.r - b.r)
  for (const x of low.slice(0, 6)) push('contrast', 'fail', `${x.r.toFixed(2)}:1 — ${hex(x.fg)} on ${hex(x.g)} at ${x.fs.toFixed(0)}px; needs ${x.fs >= 24 ? 3 : 4.5}:1`, ownText(x.el))
  if (low.length > 6) push('contrast', 'fail', `… and ${low.length - 6} more text runs below the minimum`)
  if (unknownGround) push('contrast', 'info', `${unknownGround} text run(s) sit on an image or a background image — contrast not measurable, check by eye`)

  // 2. Faces that fell back. A face that is not available renders exactly as its fallback —
  // measured with the page's own text in that face, so an icon face or a CJK face with no
  // Latin glyphs is judged on what it is asked to draw, not on an alphabet it does not have.
  const faces = new Map()
  for (const el of textEls) {
    const f = getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '')
    if (f && !GENERIC.test(f) && !faces.has(f)) faces.set(f, el)
  }
  const probe = document.createElement('span')
  // Wide and narrow glyphs, upper, lower and figures — the fallback sample when an element's
  // own text is too short. (Built from pieces: one long alphabet string reads as a secret to
  // the entropy scanner.)
  const ALPHABET = ['mmmmmmmmmm', 'lllllllllll', 'ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz', '0123456789'].join('')
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;font-size:40px;white-space:nowrap;visibility:hidden'
  document.body.appendChild(probe)
  const width = (fam) => { probe.style.fontFamily = fam; return probe.getBoundingClientRect().width }
  for (const [face, el] of faces) {
    const own = ownText(el).replace(/\s+/g, ' ')
    probe.textContent = own.length >= 3 ? own.slice(0, 60) : ALPHABET
    const same = ['monospace', 'serif', 'sans-serif'].every((gen) => Math.abs(width(`"${face}", ${gen}`) - width(gen)) < 0.5)
    if (same) push('font', 'fail', `"${face}" is not available — the page rendered in a fallback, so the design judged is not the one shipped`, ownText(el))
  }
  probe.remove()

  // 3. Measure and small text.
  let tiny = []
  for (const el of textEls) {
    const cs = getComputedStyle(el)
    const fs = parseFloat(cs.fontSize)
    if (fs < 12 && !/^(SUP|SUB)$/.test(el.tagName)) tiny.push({ fs, el })
    if (/^(P|LI|DD|DT|BLOCKQUOTE|FIGCAPTION)$/.test(el.tagName)) {
      const text = el.textContent.trim()
      if (text.length < 100) continue
      const lh = parseFloat(cs.lineHeight) || fs * 1.2
      const lines = Math.max(1, Math.round(el.getBoundingClientRect().height / lh))
      const cpl = text.length / lines
      if (lines >= 2 && cpl > 90) push('measure', 'warn', `~${Math.round(cpl)} characters per line — 45–75 reads; set max-width in ch`, text)
      else if (lines >= 4 && cpl < 30) push('measure', 'warn', `~${Math.round(cpl)} characters per line — too narrow to read as prose`, text)
      if (lines >= 2 && lh / fs < 1.3) push('leading', 'warn', `line-height ${(lh / fs).toFixed(2)} on ${fs.toFixed(0)}px body text — 1.4–1.6 for prose`, text)
    }
  }
  tiny.sort((a, b) => a.fs - b.fs)
  if (tiny.length) push('small-text', tiny[0].fs < 10 ? 'fail' : 'warn', `${tiny.length} text run(s) under 12px (smallest ${tiny[0].fs.toFixed(1)}px)`, ownText(tiny[0].el))

  // 4. Widows in headings: a last line holding one word.
  for (const h of [...document.querySelectorAll('h1, h2, h3')].filter(visible)) {
    const range = document.createRange(); range.selectNodeContents(h)
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
    if (!rects.length) continue
    // Line boxes by vertical overlap, so a smaller inline run on the same line is the same line.
    const lines = []
    for (const r of rects.slice().sort((a, b) => a.top - b.top || a.left - b.left)) {
      const L = lines[lines.length - 1]
      if (L && Math.min(L.bottom, r.bottom) - Math.max(L.top, r.top) > 0.5 * Math.min(L.bottom - L.top, r.height)) {
        L.left = Math.min(L.left, r.left); L.right = Math.max(L.right, r.right); L.top = Math.min(L.top, r.top); L.bottom = Math.max(L.bottom, r.bottom)
      } else lines.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })
    }
    if (lines.length < 2) continue
    // width of the last word alone
    const walker = document.createTreeWalker(h, NodeFilter.SHOW_TEXT)
    let last = null; while (walker.nextNode()) if (walker.currentNode.textContent.trim()) last = walker.currentNode
    if (!last) continue
    const m = /(\S+)\s*$/.exec(last.textContent); if (!m) continue
    const wr = document.createRange(); wr.setStart(last, m.index); wr.setEnd(last, m.index + m[1].length)
    const w = wr.getBoundingClientRect().width
    const lastLine = lines[lines.length - 1]
    if (lastLine.right - lastLine.left <= w + 4) push('widow', 'warn', `the last line of a heading is one word ("${m[1]}") — text-wrap: balance, or rewrite`, h.textContent)
  }

  // 5. Horizontal overflow.
  const de = document.documentElement
  if (de.scrollWidth > de.clientWidth + 1) push('overflow', mobile ? 'fail' : 'warn', `the page is ${de.scrollWidth}px wide in a ${de.clientWidth}px viewport — it scrolls sideways`)

  // 6. Tap targets (phone only). A link inside running text is exempt, as WCAG exempts it —
  // judged by whether the parent carries other text, not by its tag: a nav's <li><a> is a control.
  if (mobile) {
    const targets = [...document.querySelectorAll('a[href], button, input, select, textarea, [role="button"]')].filter(visible)
      .filter((el) => !(el.parentElement && ownText(el.parentElement).length > 0))
    const small = targets.map((el) => ({ el, r: el.getBoundingClientRect() })).filter((x) => x.r.width < 44 || x.r.height < 44)
    const bad = small.filter((x) => x.r.width < 24 || x.r.height < 24)
    if (bad.length) push('tap-target', 'fail', `${bad.length} control(s) under 24×24px — a thumb cannot hit them`, ownText(bad[0].el) || bad[0].el.tagName.toLowerCase())
    else if (small.length) push('tap-target', 'warn', `${small.length} control(s) under 44×44px`, ownText(small[0].el) || small[0].el.tagName.toLowerCase())
  }

  // 7. Images without alt.
  const noAlt = [...document.images].filter((i) => !i.hasAttribute('alt') && visible(i))
  if (noAlt.length) push('alt', 'warn', `${noAlt.length} image(s) without an alt attribute (alt="" when decorative)`, noAlt[0].getAttribute('src'))

  // 8. The palette by area: grounds by rectangle, ink by the text it carries.
  const pal = new Map()
  const add = (c, w, role) => { const k = hex(c); const e = pal.get(k) || { c, w: 0, roles: new Set() }; e.w += w; e.roles.add(role); pal.set(k, e) }
  const pageArea = Math.max(1, de.scrollWidth * de.scrollHeight)
  // The page's own ground: html's background under body's, over the canvas white.
  add(groundChain(document.body).g, pageArea, 'ground')
  for (const el of all) {
    if (!visible(el)) continue
    const cs = getComputedStyle(el)
    const bg = rgba(cs.backgroundColor)
    if (bg[3] > 0.5 && el !== document.body) { const r = el.getBoundingClientRect(); add(over(bg, groundChain(el.parentElement || el).g), r.width * r.height, 'ground') }
  }
  for (const el of textEls) {
    const cs = getComputedStyle(el); const fg = rgba(cs.color); if (fg[3] === 0) continue
    const fs = parseFloat(cs.fontSize)
    add(over(fg, groundChain(el).g), ownText(el).length * fs * fs * 0.55, 'ink')
  }
  const total = [...pal.values()].reduce((a, e) => a + e.w, 0) || 1
  const rows = [...pal.entries()].map(([k, e]) => ({ hex: k, share: e.w / total, roles: [...e.roles].join('+'), ...oklab(e.c) })).sort((a, b) => b.share - a.share)
  const saturated = rows.filter((r) => r.C > 0.08 && r.share > 0.002)
  const hues = []
  for (const r of saturated) if (!hues.some((h) => Math.min(Math.abs(h - r.h), 360 - Math.abs(h - r.h)) < 25)) hues.push(r.h)
  const satShare = saturated.reduce((a, r) => a + r.share, 0)
  // A grey used for one small label is still a grey chosen; the floor is lower than for hues.
  const greys = rows.filter((r) => r.C < 0.004 && r.L > 0.15 && r.L < 0.92 && r.share > 0.0005)
  push('palette', 'info', rows.slice(0, 6).map((r) => `${r.hex} ${(r.share * 100).toFixed(1)}% ${r.roles} C${r.C.toFixed(2)}`).join(' · '))
  if (hues.length > 3) push('palette', 'warn', `${hues.length} saturated hues cover ${(satShare * 100).toFixed(0)}% of the page — three roles, one signal; the rest is noise`)
  else if (saturated.length) push('palette', 'info', `${hues.length} saturated hue(s), ${(satShare * 100).toFixed(1)}% of the page — ${satShare <= 0.08 ? 'a signal' : 'a colour field'}`)
  if (greys.length >= 3) push('palette', 'warn', `${greys.length} pure greys (zero chroma): ${greys.slice(0, 3).map((g) => g.hex).join(' ')} — give the neutrals a hue`)

  return out
}

// Focus visibility is judged with real Tab presses, so :focus-visible behaves as it does for a
// keyboard user. Before pressing, every focusable's resting styles are recorded and tagged.
function recordFocusablesInPage() {
  const els = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 })
  const keys = ['outlineStyle', 'outlineWidth', 'outlineColor', 'boxShadow', 'borderColor', 'backgroundColor', 'color', 'textDecorationLine', 'textDecorationColor']
  els.forEach((el, i) => { el.setAttribute('data-page-audit', String(i)); const cs = getComputedStyle(el); el.__rest = keys.map((k) => cs[k]) })
  return els.length
}
function checkActiveInPage() {
  const el = document.activeElement
  if (!el || !el.hasAttribute('data-page-audit') || !el.__rest) return null
  const keys = ['outlineStyle', 'outlineWidth', 'outlineColor', 'boxShadow', 'borderColor', 'backgroundColor', 'color', 'textDecorationLine', 'textDecorationColor']
  const cs = getComputedStyle(el)
  const now = keys.map((k) => cs[k])
  const changed = now.some((v, i) => v !== el.__rest[i]) && !(cs.outlineStyle === 'none' && now.slice(3).every((v, i) => v === el.__rest[i + 3]))
  return { changed, sample: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40) }
}
function runningAnimationsInPage() {
  return document.getAnimations().filter((a) => a.playState === 'running').length
}

// Installed before any page script runs: samples document.getAnimations() from DOMContentLoaded
// for six seconds, so entrances that finish before the audit looks are still on record, with
// their timing and the properties they animate.
function motionRecorderInit() {
  const seen = new Map()
  const rec = () => {
    let anims = []
    try { anims = document.getAnimations() } catch { return }
    for (const a of anims) {
      const eff = a.effect
      if (!eff || !eff.target) continue
      let t = {}
      try { t = eff.getTiming() } catch { /* no timing */ }
      const el = eff.target
      const cls = typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/)[0] : ''
      const name = a.animationName || a.transitionProperty || a.id || ''
      const key = `${name}@${el.tagName}${cls}:${t.duration}`
      if (seen.has(key)) continue
      let props = [], easing = String(t.easing || '')
      try {
        const kf = eff.getKeyframes()
        props = [...new Set(kf.flatMap((k) => Object.keys(k).filter((p) => !/^(offset|easing|composite|computedOffset)$/.test(p))))]
        // A CSS animation's timing function lives on its keyframes; the effect's own easing is
        // always "linear" for them, which would call every eased entrance linear.
        if (easing === 'linear' && kf[0] && kf[0].easing) easing = String(kf[0].easing)
      } catch { /* none */ }
      seen.set(key, {
        kind: a.constructor.name, name, duration: Number(t.duration) || 0, delay: Number(t.delay) || 0,
        easing, iterations: t.iterations === Infinity ? 'infinite' : Number(t.iterations) || 1,
        props, target: (el.tagName || '').toLowerCase() + cls,
      })
    }
  }
  document.addEventListener('DOMContentLoaded', rec)
  const iv = setInterval(rec, 50)
  setTimeout(() => clearInterval(iv), 6000)
  window.__pageAuditMotion = () => { rec(); return [...seen.values()] }
}

// The motion laws a machine can check: linear easing on movement, layout properties animated,
// entrances that are waits, one constant for every event, garnish that never stops.
function motionFindings(list) {
  const out = []
  if (!list.length) return out
  // Keyframe property names are camelCase.
  const LAYOUT = /^(width|height|top|left|right|bottom|margin|padding|inset|fontSize|lineHeight|border\w*Width|min\w+|max\w+|flex|gap|columnGap|rowGap)/
  const MOVE = /^(transform|translate|scale|rotate|left|top|right|bottom|offset)/
  const inf = list.filter((a) => a.iterations === 'infinite')
  const finite = list.filter((a) => a.iterations !== 'infinite')
  const sample = (xs) => xs.slice(0, 2).map((a) => `${a.name || a.kind} on ${a.target}: ${a.duration}ms ${a.easing}`).join('; ')
  out.push({ rule: 'motion', level: 'info', msg: `${list.length} animation(s): ${finite.length} finite, ${inf.length} infinite`, sample: sample(list) })
  const linear = finite.filter((a) => a.easing === 'linear' && a.props.some((p) => MOVE.test(p)))
  if (linear.length) out.push({ rule: 'motion-linear', level: 'warn', msg: `${linear.length} movement(s) with linear easing — nothing physical moves at constant speed; ease-out in, ease-in out`, sample: sample(linear) })
  const layout = list.filter((a) => a.props.some((p) => LAYOUT.test(p)))
  if (layout.length) out.push({ rule: 'motion-layout', level: 'warn', msg: `${layout.length} animation(s) of a layout property (${[...new Set(layout.flatMap((a) => a.props.filter((p) => LAYOUT.test(p))))].join(', ')}) — every frame re-lays out the page; animate transform and opacity`, sample: sample(layout) })
  const long = finite.filter((a) => a.delay + a.duration > 1500)
  if (long.length) out.push({ rule: 'motion-long', level: 'warn', msg: `${long.length} entrance(s) over 1.5s (longest ${Math.round(Math.max(...long.map((a) => a.delay + a.duration)))}ms) — an entrance is 300–700ms; longer is a wait`, sample: sample(long) })
  const laws = new Set(finite.map((a) => `${a.duration}ms ${a.easing}`))
  if (finite.length >= 3 && laws.size === 1) out.push({ rule: 'motion-uniform', level: 'warn', msg: `${finite.length} animations share one duration and easing (${[...laws][0]}) — one law is good; one constant for every event is a default`, sample: '' })
  if (inf.length > 3) out.push({ rule: 'motion-noise', level: 'warn', msg: `${inf.length} animations run forever — motion as garnish; one thing moves, and says why`, sample: sample(inf) })
  return out
}

// ── driver ───────────────────────────────────────────────────────────────────
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
  page-audit <page.html | url> [--mobile] [--viewport WxH] [--json]

Renders the page and measures what a reader gets. FAIL: contrast under 4.5:1 (3:1 large), a
face that fell back, text under 10px, sideways scroll on a phone, tap targets under 24px.
WARN: measure outside 45–75 characters, tight leading, text under 12px, a widow in a heading,
tap targets under 44px, images without alt, focus that cannot be seen, animations that run
under prefers-reduced-motion, more than three saturated hues, dead greys; and the motion laws —
linear easing on movement, layout properties animated, entrances over 1.5s, one constant for
every animation, more than three that never stop.
Exit 1 on any FAIL; 2 when no browser is available.
`

export async function audit(src, { mobile = false, viewport = null, pw = findPlaywright() } = {}) {
  if (!pw) throw new Error('playwright-core not found')
  const url = /^https?:\/\//i.test(src) ? src : pathToFileURL(resolve(src)).href
  const { chromium } = pw.module
  const browser = await chromium.launch({ headless: true })
  const results = []
  try {
    const vps = [viewport || DESKTOP]
    if (mobile) vps.push(MOBILE)
    for (const vp of vps) {
      const isMobile = vp.width < 768
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile, hasTouch: isMobile })
      const page = await ctx.newPage()
      await page.addInitScript(motionRecorderInit)
      try { await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 }) } catch { await page.goto(url, { waitUntil: 'load', timeout: 20000 }) }
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(250)
      const findings = await page.evaluate(auditInPage, { mobile: isMobile })
      const motion = await page.evaluate(() => (window.__pageAuditMotion ? window.__pageAuditMotion() : [])).catch(() => [])
      findings.push(...motionFindings(motion))
      // focus
      const n = await page.evaluate(recordFocusablesInPage)
      const unseen = []
      for (let i = 0; i < Math.min(n, 8); i++) {
        await page.keyboard.press('Tab')
        const r = await page.evaluate(checkActiveInPage)
        if (r && !r.changed) unseen.push(r.sample)
      }
      if (unseen.length) findings.push({ rule: 'focus', level: 'warn', msg: `${unseen.length} of the first ${Math.min(n, 8)} focusable controls show no visible focus state`, sample: unseen[0] })
      await ctx.close()
      // reduced motion
      const ctx2 = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile, hasTouch: isMobile, reducedMotion: 'reduce' })
      const p2 = await ctx2.newPage()
      try { await p2.goto(url, { waitUntil: 'load', timeout: 20000 }) } catch { /* audited anyway */ }
      await p2.waitForTimeout(400)
      const running = await p2.evaluate(runningAnimationsInPage).catch(() => 0)
      if (running) findings.push({ rule: 'reduced-motion', level: 'warn', msg: `${running} animation(s) still run under prefers-reduced-motion: reduce`, sample: '' })
      await ctx2.close()
      results.push({ viewport: `${vp.width}x${vp.height}`, findings })
    }
  } finally { await browser.close() }
  const ok = results.every((r) => !r.findings.some((f) => f.level === 'fail'))
  return { ok, url, results }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help || args._.length !== 1) { console.log(HELP); return args.help ? 0 : 1 }
  const src = args._[0]
  if (!/^https?:/i.test(src) && !existsSync(resolve(src))) { console.error(`page-audit: no such file — ${src}`); return 1 }
  const pw = findPlaywright()
  if (!pw) { console.error('page-audit: playwright-core not found. Install the Playwright MCP server (node tools/install.mjs --only=mcp) — it brings the browser this tool renders with.'); return 2 }
  let viewport = null
  if (args.viewport) {
    const m = /^(\d+)x(\d+)$/i.exec(String(args.viewport))
    if (!m) { console.error('page-audit: --viewport wants WxH, e.g. 1440x900'); return 1 }
    viewport = { width: +m[1], height: +m[2] }
  }
  const r = await audit(src, { mobile: Boolean(args.mobile), viewport, pw })
  if (args.json) { console.log(JSON.stringify(r, null, 2)); return r.ok ? 0 : 1 }
  for (const v of r.results) {
    const fails = v.findings.filter((f) => f.level === 'fail').length, warns = v.findings.filter((f) => f.level === 'warn').length
    console.log(`\n\x1b[1m${v.viewport}\x1b[0m — ${fails ? `\x1b[31m${fails} FAIL\x1b[0m` : '\x1b[32mno failures\x1b[0m'}, ${warns} warning(s)`)
    for (const f of v.findings) {
      const mark = f.level === 'fail' ? '\x1b[31m✖\x1b[0m' : f.level === 'warn' ? '\x1b[33m!\x1b[0m' : '\x1b[90m·\x1b[0m'
      console.log(`  ${mark} ${f.rule.padEnd(15)} ${f.msg}${f.sample ? `  \x1b[90m“${f.sample}”\x1b[0m` : ''}`)
    }
  }
  console.log(r.ok ? '\n  No failures. That is the floor, not the ceiling — the loop decides whether it is good.' : '\n  A page that fails here is not finished, whatever it looks like.')
  return r.ok ? 0 : 1
}

// Compared by real path, so the tool also runs when invoked through a symlink.
const isEntry = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false } })()
if (isEntry) {
  main().then((code) => process.exit(code), (e) => { console.error(`page-audit: ${e.message}`); process.exit(1) })
}
