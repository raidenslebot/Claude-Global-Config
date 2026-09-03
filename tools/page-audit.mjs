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
import { resolve, basename } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { findPlaywright } from './print-render.mjs'
import { DESKTOP, MOBILE } from './screen-render.mjs'
import { unrenderable } from './paths.mjs'

// ── the in-page audit ─────────────────────────────────────────────────────────
// Serialised into the page by Playwright, so it must be self-contained: no outer references.
function auditInPage({ mobile }) {
  const out = []
  const push = (rule, level, msg, sample) => out.push({ rule, level, msg, sample: sample == null ? '' : String(sample).replace(/\s+/g, ' ').trim().slice(0, 70) })
  const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong|-apple-system|BlinkMacSystemFont|inherit|initial)$/i
  const HTML = 'http://www.w3.org/1999/xhtml'

  // Any CSS colour → sRGB. Computed values of oklch()/color-mix() stay in their own space, so a
  // canvas does the conversion the browser already knows.
  // Namespaced deliberately: in an SVG document createElement makes an SVG element called
  // "canvas", which has no getContext, and auditing any .svg threw a stack trace.
  const cv = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas'); cv.width = cv.height = 1
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

  const deep = (root, into) => {
    for (const el of root.querySelectorAll('*')) {
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue
      into.push(el)
      if (el.shadowRoot) deep(el.shadowRoot, into)
    }
    return into
  }
  const everything = deep(document, [document.body || document.documentElement].filter(Boolean))
  const all = everything.filter((el) => el.namespaceURI === HTML)
  // One character is a badge, a counter, a close glyph or a chevron — exactly the runs most
  // likely to be too small or too faint, and they were all being skipped.
  const textEls = everything.filter((el) => ownText(el).length >= 1 && visible(el))

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
  // Contrast is measured from the painted pixels instead (see measureInkFromPixels); these
  // computed-style figures are kept only as the fallback when that pass cannot run.
  void low; void unknownGround

  // 2. Faces that fell back. A face that is not available renders exactly as its fallback —
  // measured with the page's own text in that face, so an icon face or a CJK face with no
  // Latin glyphs is judged on what it is asked to draw, not on an alphabet it does not have.
  const faces = new Map()
  for (const el of textEls) {
    const f = getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '')
    if (f && !GENERIC.test(f) && !faces.has(f)) faces.set(f, el)
  }
  // A raw SVG document has no <body> and its createElement makes a namespace-less element
  // with no .style — the probe has to be built as HTML and hung on whatever root exists.
  const root = document.body || document.documentElement
  const probe = document.createElementNS('http://www.w3.org/1999/xhtml', 'span')
  // Wide and narrow glyphs, upper, lower and figures — the fallback sample when an element's
  // own text is too short. (Built from pieces: one long alphabet string reads as a secret to
  // the entropy scanner.)
  const ALPHABET = ['mmmmmmmmmm', 'lllllllllll', 'ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz', '0123456789'].join('')
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;font-size:40px;white-space:nowrap;visibility:hidden'
  root.appendChild(probe)
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

  // 6. Tap targets (phone only). WCAG exempts a target that sits IN A SENTENCE — which needs
  // both halves: the control flows inline, and what surrounds it is running text rather than a
  // label or a separator. "Any parent with any text" exempted a × beside the word Menu.
  if (mobile) {
    const inSentence = (el) => {
      if (!el.parentElement) return false
      // Anything that flows in a line of text: inline, inline-block, inline-flex. A link styled
      // inline-block for its underline offset is still a link inside a sentence.
      if (!/^inline/.test(getComputedStyle(el).display)) return false
      // Twenty characters is about four words: a sentence, not a label and not a bullet.
      return ownText(el.parentElement).replace(/\s+/g, ' ').trim().length >= 20
    }
    const targets = [...document.querySelectorAll('a[href], button, input, select, textarea, [role="button"]')].filter(visible)
      .filter((el) => !inSentence(el))
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
  add(groundChain(document.body || document.documentElement).g, pageArea, 'ground')
  for (const el of all) {
    if (!visible(el)) continue
    const cs = getComputedStyle(el)
    const bg = rgba(cs.backgroundColor)
    if (bg[3] > 0.5 && el !== (document.body || document.documentElement)) { const r = el.getBoundingClientRect(); add(over(bg, groundChain(el.parentElement || el).g), r.width * r.height, 'ground') }
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
  // An outline that is transparent, or zero-width, is not a focus state anybody can see.
  const noRing = cs.outlineStyle === 'none' || parseFloat(cs.outlineWidth) === 0
    || cs.outlineColor === 'transparent' || /rgba?\([^)]*,\s*0(?:\.0+)?\s*\)/.test(cs.outlineColor)
  const changed = now.some((v, i) => v !== el.__rest[i]) && !(noRing && now.slice(3).every((v, i) => v === el.__rest[i + 3]))
  return { changed, sample: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40) }
}
function runningAnimationsInPage() {
  return document.getAnimations().filter((a) => a.playState === 'running').length
}

// Installed before any page script runs: samples document.getAnimations() from DOMContentLoaded
// for six seconds, so entrances that finish before the audit looks are still on record, with
// their timing and the properties they animate.
function motionRecorderInit() {
  // A sustained rAF loop that writes style is an animation, whatever it is called.
  const raf = { frames: 0, writes: 0 }
  const orig = window.requestAnimationFrame && window.requestAnimationFrame.bind(window)
  if (orig) {
    window.requestAnimationFrame = (cb) => orig((ts) => { raf.frames++; return cb(ts) })
  }
  try {
    new MutationObserver((ms) => { for (const m of ms) if (m.attributeName === 'style') raf.writes++ })
      // document, not documentElement: this runs before the root element exists.
      .observe(document, { attributes: true, attributeFilter: ['style'], subtree: true })
  } catch { /* no observer, no signal */ }
  window.__pageAuditRaf = () => ({ ...raf })
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
const BOOLEAN_FLAGS = new Set(['mobile', 'json', 'help', 'full'])
function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      // A flag that takes no value must not swallow the path that follows it.
      if (BOOLEAN_FLAGS.has(k)) { out[k] = true; continue }
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[k] = argv[++i]
      else out[k] = true
    } else out._.push(a)
  }
  return out
}

const HELP = `usage:
  cgc audit <page.html | url> [--mobile] [--viewport WxH] [--json]

Renders the page and measures what a reader gets. FAIL: contrast under 4.5:1 (3:1 large), a
face that fell back, text under 10px, sideways scroll on a phone, tap targets under 24px.
WARN: measure outside 45–75 characters, tight leading, text under 12px, a widow in a heading,
tap targets under 44px, images without alt, focus that cannot be seen, animations that run
under prefers-reduced-motion, more than three saturated hues, dead greys; and the motion laws —
linear easing on movement, layout properties animated, entrances over 1.5s, one constant for
every animation, more than three that never stop.
Exit 1 on any FAIL; 2 when no browser is available.
`


// ── Contrast, measured from the pixels ───────────────────────────────────────
// The computed-style chain answers a different question from the one that matters. A gradient,
// an image, a blend mode, a scrim painted over the text, a decorative layer with
// pointer-events: none — in every one of those the declared colours and the painted result
// disagree, and the reader only ever sees the painted result.
//
// So: photograph the page, make every glyph transparent, photograph it again. The pixels that
// changed ARE the ink, and the same pixels in the second shot ARE the ground behind it. That is
// true whatever produced them, and it needs no model of how the page was built.

/** Tag every text run and return its box in PAGE coordinates. */
export const tagTextRunsInPage = (opts) => {
  // In pinned mode the shot is of the VIEWPORT, so the rects are viewport-relative and only
  // text that travels with the viewport is worth measuring.
  const pinnedOnly = Boolean(opts && opts.pinned)
  const pinned = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement || (n.getRootNode() || {}).host) {
      const p = getComputedStyle(n).position
      if (p === 'fixed' || p === 'sticky') return true
    }
    return false
  }
  const HTML = 'http://www.w3.org/1999/xhtml'
  const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
  const deep = (root, into) => {
    for (const el of root.querySelectorAll('*')) {
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue
      into.push(el)
      if (el.shadowRoot) deep(el.shadowRoot, into)
    }
    return into
  }
  const runs = []
  const els = deep(document, [document.body || document.documentElement].filter(Boolean))
  for (const el of els) {
    const text = own(el)
    if (!text) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue
    // Text explicitly hidden from assistive technology is decoration, not reading matter: a
    // submerged gauge numeral or a decorative watermark is meant to be illegible, and the
    // information it stands for is carried in text that is not hidden.
    if (el.closest && el.closest('[aria-hidden="true"], [role="presentation"], [role="none"]')) continue
    if (pinnedOnly && !pinned(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    // Off-screen after the scroll: not what the reader is looking at.
    if (pinnedOnly && (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth)) continue
    const fs = parseFloat(cs.fontSize) || 16
    const weight = Number(cs.fontWeight) || 400
    runs.push({
      x: Math.round(r.left + (pinnedOnly ? 0 : window.scrollX)), y: Math.round(r.top + (pinnedOnly ? 0 : window.scrollY)),
      w: Math.round(r.width), h: Math.round(r.height),
      fs, large: fs >= 24 || (fs >= 18.66 && weight >= 700),
      // SVG text is painted with `fill`; `color` on it is whatever it inherited and is usually
      // the page's, so a cream label inside a chart reported as navy-on-navy — a failure that
      // was really the audit reading the wrong property, on text that is perfectly legible.
      colour: (el.namespaceURI !== HTML && cs.fill && cs.fill !== 'none' ? cs.fill : cs.color),
      text: text.replace(/\s+/g, ' ').slice(0, 70),
      svg: el.namespaceURI !== HTML,
    })
  }
  return runs
}

/** Put every animation where it comes to rest, so the two shots are of the same page. A finite
 *  animation is finished — its settled state IS the design; an endless one is only paused,
 *  because it has no end to go to. */
export const settleAnimationsInPage = () => {
  let n = 0
  for (const a of document.getAnimations()) {
    try {
      let iterations = 1
      try { iterations = a.effect.getTiming().iterations } catch { /* assume finite */ }
      if (iterations === Infinity) a.pause()
      else a.finish()
      n++
    } catch { /* one that will not settle keeps running, and the shots differ where it is */ }
  }
  return n
}

/** Make every glyph transparent without disturbing anything that is painted behind it. */
export const hideGlyphsInPage = () => {
  const s = document.createElementNS('http://www.w3.org/1999/xhtml', 'style')
  s.id = '__cgc_hide_glyphs'
  s.textContent = '*, *::before, *::after { color: transparent !important;'
    + ' -webkit-text-fill-color: transparent !important; text-shadow: none !important;'
    + ' text-decoration-color: transparent !important; caret-color: transparent !important; }'
    // SVG glyphs are painted with fill, not color, so a colour-only rule leaves them on the
    // page — and text that does not vanish looks exactly like text that was never there.
    + ' text, tspan, textPath { fill: transparent !important; stroke: transparent !important; }'
  document.documentElement.appendChild(s)
  return true
}

/** Compare the two shots inside the page, where a canvas can decode them. */
export const measureInkFromPixels = async ([withGlyphs, ground, runs]) => {
  const load = (src) => new Promise((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = () => rej(new Error('the screenshot could not be decoded'))
    i.src = src
  })
  const [a, b] = await Promise.all([load(withGlyphs), load(ground)])
  const cv = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas')
  const cx = cv.getContext('2d', { willReadFrequently: true })

  const lum = (r, g, bl) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl)
  }
  const ratio = (p, q) => {
    const x = lum(p[0], p[1], p[2]), y = lum(q[0], q[1], q[2])
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }
  const hex = (p) => '#' + p.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

  const out = []
  for (const run of runs) {
    // Clamped to the canvas rather than refused. A headline that bleeds off the edge — the
    // commonest deliberate move there is — has a negative left, and refusing it reported the
    // biggest word on the piece as "could not be measured".
    const x0 = Math.max(0, run.x), y0 = Math.max(0, run.y)
    // The intersection of the two shots. Cleared canvas reads as opaque black, so a region
    // present in one image and not the other invents a ground that is nowhere on the page.
    const iw = Math.min(a.width, b.width), ih = Math.min(a.height, b.height)
    const w = Math.min(run.x + run.w, iw) - x0, h = Math.min(run.y + run.h, ih) - y0
    if (w < 2 || h < 2) { out.push({ ...run, measured: false }); continue }
    cv.width = w; cv.height = h
    cx.clearRect(0, 0, w, h); cx.drawImage(a, x0, y0, w, h, 0, 0, w, h)
    const A = cx.getImageData(0, 0, w, h).data
    cx.clearRect(0, 0, w, h); cx.drawImage(b, x0, y0, w, h, 0, 0, w, h)
    const B = cx.getImageData(0, 0, w, h).data

    // The glyph pixels are the ones that changed, and they are used to find the GROUND — the
    // thing the computed-style chain gets wrong whenever there is an image, a gradient, a scrim
    // or a blend. The INK stays the declared colour, because that is what the contrast standard
    // is defined on and because no pixel of a small glyph is ever fully ink: measuring the
    // render for ink would fail every 11px run on earth.
    let maxDiff = 0
    const diffs = new Float32Array(w * h)
    for (let p = 0, q = 0; p < A.length; p += 4, q++) {
      const d = Math.abs(A[p] - B[p]) + Math.abs(A[p + 1] - B[p + 1]) + Math.abs(A[p + 2] - B[p + 2])
      diffs[q] = d
      if (d > maxDiff) maxDiff = d
    }
    // Glyphs that changed nothing between the two renders did not fail to be measured —
    // they are INVISIBLE. That is a contrast of about 1:1, which is the finding, not an
    // absence of one. It is how a blend mode, a matching colour or a covered layer reads.
    if (maxDiff < 12) { out.push({ ...run, measured: true, invisible: true, ratio: 1, ink: "(nothing painted)", ground: "(unchanged)" }); continue }
    const floor = maxDiff * 0.6

    // The declared ink, composited over whatever it turns out to be sitting on.
    const m = /rgba?\(([^)]+)\)/.exec(run.colour || '')
    const parts = m ? m[1].split(',').map((s) => parseFloat(s)) : [0, 0, 0, 1]
    const inkRGB = [parts[0] || 0, parts[1] || 0, parts[2] || 0]
    const inkA = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1

    // The worst legible point in the run: a gradient is fine at one end and gone at the other.
    let worst = Infinity, worstInk = null, worstGround = null, cores = 0
    // The BEST-inked pixel, not the worst: every glyph has antialiased edges that are half
    // ground, and if any pixel of the stroke reaches the declared colour the ink got through.
    let painted = 0, paintedInk = null
    for (let q = 0; q < diffs.length; q++) {
      if (diffs[q] < floor) continue
      cores++
      const p = q * 4
      const bg = [B[p], B[p + 1], B[p + 2]]
      const ink = inkA >= 1 ? inkRGB : inkRGB.map((v, k) => v * inkA + bg[k] * (1 - inkA))
      const r = ratio(ink, bg)
      if (r < worst) { worst = r; worstInk = ink; worstGround = bg }
      // What the reader sees, from the glyph core as it was actually painted.
      const seen = ratio([A[p], A[p + 1], A[p + 2]], bg)
      if (seen > painted) { painted = seen; paintedInk = [A[p], A[p + 1], A[p + 2]] }
    }
    if (cores < 6) { out.push({ ...run, measured: false }); continue }
    out.push({
      ...run, measured: true, ratio: worst, ink: hex(worstInk), ground: hex(worstGround),
      painted, paintedInk: paintedInk ? hex(paintedInk) : null,
    })
  }
  return out
}

export async function audit(src, { mobile = false, viewport = null, pw = findPlaywright() } = {}) {
  if (!pw) throw new Error('playwright-core not found')
  const url = /^https?:\/\//i.test(src) ? src : pathToFileURL(resolve(src)).href
  const { chromium } = pw.module
  let browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch (e) {
    const err = new Error(`the browser could not be launched — ${String(e.message || e).split('\n')[0]}`)
    err.code = 2
    throw err
  }
  const results = []
  try {
    const vps = [viewport || DESKTOP]
    if (mobile) vps.push(MOBILE)
    for (const vp of vps) {
      const isMobile = vp.width < 768
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile, hasTouch: isMobile })
      const page = await ctx.newPage()
      await page.addInitScript(motionRecorderInit)
      let response = null
      try { response = await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 }) } catch {
        try { response = await page.goto(url, { waitUntil: 'load', timeout: 20000 }) } catch (e) {
          // Never loading is not a finding about the design. It is the audit not happening.
          const err = new Error(`${url} never finished loading — ${String(e.message || e).split('\n')[0]}`)
          err.code = 2
          throw err
        }
      }
      const status = response && typeof response.status === 'function' ? response.status() : 0
      if (status >= 400) {
        results.push({ viewport: `${vp.width}x${vp.height}`, findings: [{ rule: 'page', level: 'fail', sample: url,
          msg: `the server answered ${status} — this is an error page, not the page you meant to audit` }] })
        await ctx.close()
        continue
      }
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(250)
      const findings = await page.evaluate(auditInPage, { mobile: isMobile })

      // Contrast from the painted pixels. Two full-page shots, one with the glyphs and one
      // without, and the difference between them is the ink on its real ground.
      try {
        // Settled first: the pair has to be two shots of one page.
        await page.evaluate(settleAnimationsInPage)
        const runs = await page.evaluate(tagTextRunsInPage)
        if (runs.length) {
          const shotWith = await page.screenshot({ type: 'png', fullPage: true })
          await page.evaluate(hideGlyphsInPage)
          const shotGround = await page.screenshot({ type: 'png', fullPage: true })
          await page.evaluate(() => { const s = document.getElementById('__cgc_hide_glyphs'); if (s) s.remove() })
          const uri = (buf) => 'data:image/png;base64,' + buf.toString('base64')
          const measured = await page.evaluate(measureInkFromPixels, [uri(shotWith), uri(shotGround), runs])
          const bad = measured.filter((m) => m.measured && m.ratio < (m.large ? 3 : 4.5)).sort((a, b) => a.ratio - b.ratio)
          for (const m of bad.slice(0, 6)) {
            findings.push({ rule: 'contrast', level: 'fail', sample: m.text,
              msg: m.invisible
                ? `the glyphs changed nothing in the render at ${m.fs.toFixed(0)}px — this text is invisible where it sits (about 1:1)`
                : `${m.ratio.toFixed(2)}:1 — ${m.ink} on ${m.ground} on its PAINTED ground, at ${m.fs.toFixed(0)}px; needs ${m.large ? 3 : 4.5}:1` })
          }
          if (bad.length > 6) findings.push({ rule: 'contrast', level: 'fail', sample: '', msg: `… and ${bad.length - 6} more text runs below the minimum` })
          // Legible by its declaration and not by its render: something is painted over it.
          const covered = measured.filter((m) => m.measured && !m.invisible
            && m.ratio >= (m.large ? 3 : 4.5)
            // Antialiasing alone roughly halves the painted ratio at small sizes, so only a
            // COLLAPSE counts: a quarter of the declared ratio is a scrim, not a soft edge.
            && Number.isFinite(m.painted) && m.painted < 3 && m.painted < m.ratio * 0.25)
          for (const m of covered.slice(0, 4)) {
            findings.push({ rule: 'contrast', level: 'fail', sample: m.text,
              msg: `declared ${m.ratio.toFixed(2)}:1 but painted ${m.painted.toFixed(2)}:1 — something is drawn over this text (a scrim, an overlay, a blend, an opacity). The declaration passes and the reader cannot read it.` })
          }
          const unmeasured = measured.filter((m) => !m.measured)
          if (unmeasured.length) {
            findings.push({ rule: 'contrast', level: 'warn', sample: unmeasured[0].text,
              msg: `${unmeasured.length} text run(s) could not be measured — nothing of them changed between the two renders. Unmeasured is not the same as passing: look at them.` })
          }
        }
      } catch (e) {
        findings.push({ rule: 'contrast', level: 'warn', sample: '',
          msg: `contrast could not be measured from the pixels — ${String(e.message || e).slice(0, 80)}. Unmeasured is not the same as passing.` })
      }
      // Pinned text meets content that was not under it at the top of the page. A header that
      // is legible over its own hero and illegible over the article is the commonest version of
      // this, and a full-page shot photographs it exactly once, at scroll 0.
      try {
        const room = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
        if (room > 200) {
          // All the way down: the position furthest from the one the full-page shot already
          // photographed, and the one place a pinned bar is certain not to be over its own hero.
          await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
          await page.waitForTimeout(400)
          const pin = await page.evaluate(tagTextRunsInPage, { pinned: true })
          if (pin.length) {
            const uri = (buf) => 'data:image/png;base64,' + buf.toString('base64')
            const shot = await page.screenshot({ type: 'png' })
            await page.evaluate(hideGlyphsInPage)
            const bare = await page.screenshot({ type: 'png' })
            await page.evaluate(() => { const s = document.getElementById('__cgc_hide_glyphs'); if (s) s.remove() })
            const measured = await page.evaluate(measureInkFromPixels, [uri(shot), uri(bare), pin])
            const bad = measured.filter((m) => m.measured && m.ratio < (m.large ? 3 : 4.5)).sort((a, b) => a.ratio - b.ratio)
            for (const m of bad.slice(0, 4)) {
              findings.push({ rule: 'contrast', level: 'fail', sample: m.text,
                msg: `${m.ratio.toFixed(2)}:1 once the page is scrolled — this text is pinned (fixed or sticky) and now sits over content that was not under it at the top; needs ${m.large ? 3 : 4.5}:1` })
            }
          }
          await page.evaluate(() => scrollTo(0, 0))
          await page.waitForTimeout(150)
        }
      } catch (e) {
        findings.push({ rule: 'contrast', level: 'warn', sample: '',
          msg: `pinned text could not be measured while scrolled — ${String(e.message || e).slice(0, 80)}. Unmeasured is not the same as passing.` })
      }

      const motion = await page.evaluate(() => (window.__pageAuditMotion ? window.__pageAuditMotion() : [])).catch(() => [])
      findings.push(...motionFindings(motion))
      // A page can animate entirely from requestAnimationFrame — GSAP's default path and every
      // hand-rolled loop — where document.getAnimations() reports nothing. Saying nothing here
      // would read as "nothing moves", which is the one thing this must never say.
      const raf = await page.evaluate(() => (window.__pageAuditRaf ? window.__pageAuditRaf() : null)).catch(() => null)
      // Half a second of frames that each write style is a loop, not a one-off. Headless
      // Chromium paces rAF slower than a screen does, so the bar is frames, not seconds.
      if (raf && raf.frames >= 30 && raf.writes >= 15 && motion.length === 0) {
        findings.push({ rule: 'motion', level: 'warn', sample: '',
          msg: `${raf.frames} animation frames wrote inline style, and nothing appears in document.getAnimations() — this page animates from JavaScript and its timing cannot be read from here. Look at it with cgc motion.` })
      }
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
      // A rAF loop honours the query only if its author asked, and no CSS API reports one. Two
      // shots a second apart do — whatever is driving them.
      try {
        await p2.waitForTimeout(500)
        const s1 = await p2.screenshot({ type: 'png' })
        await p2.waitForTimeout(900)
        const s2 = await p2.screenshot({ type: 'png' })
        if (!s1.equals(s2)) {
          findings.push({ rule: 'reduced-motion', level: 'warn', sample: '',
            msg: 'the page is still changing a second apart under prefers-reduced-motion: reduce — something animates from JavaScript, canvas or media that the CSS animation API does not report. Playing video is allowed; a decorative loop is not.' })
        }
      } catch (e) {
        findings.push({ rule: 'reduced-motion', level: 'warn', sample: '',
          msg: `the page could not be photographed under reduce — ${String(e.message || e).slice(0, 60)}. Unmeasured is not the same as passing.` })
      }
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
  { const why = unrenderable(resolve(src)); if (why) { console.error(`page-audit: ${why}`); return 1 } }
  // Every question here is an HTML-page question, and a raw SVG document answers none of them
  // honestly: it has no body, an HTML probe hung inside it is never laid out, so the face check
  // reports every face as missing. A false failure is worse than no answer, so say where to go.
  if (/\.svgz?$/i.test(src)) {
    console.error(`page-audit: ${basename(src)} is an SVG document, and these are questions about a page — measure, tap targets, viewport overflow, a face falling back.`)
    console.error('  A set of them: cgc icons <folder>.  One going to press: cgc print-lint <file>.')
    console.error('  To audit the drawing as the reader meets it, put it in the page it belongs to and audit that.')
    return 1
  }
  const pw = findPlaywright()
  if (!pw) { console.error('page-audit: playwright-core not found. Install the Playwright MCP server (node tools/install.mjs --only=mcp) — it brings the browser this tool renders with.'); return 2 }
  let viewport = null
  if (args.viewport) {
    const m = /^(\d+)x(\d+)$/i.exec(String(args.viewport))
    if (!m) { console.error('page-audit: --viewport wants WxH, e.g. 1440x900'); return 1 }
    viewport = { width: +m[1], height: +m[2] }
  }
  let r
  try {
    r = await audit(src, { mobile: Boolean(args.mobile), viewport, pw })
  } catch (e) {
    if (e && e.code === 2) {
      console.error(`page-audit: ${e.message}`)
      console.error('Install it with: cgc install --only=mcp   (playwright-core ships no browsers of its own)')
      return 2
    }
    throw e
  }
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
