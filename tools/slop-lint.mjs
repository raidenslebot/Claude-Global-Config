#!/usr/bin/env node
// slop-lint.mjs — the fingerprint of AI-made screen design, found mechanically.
//
//   node tools/slop-lint.mjs page.html [more files or directories] [--json]
//
// A model's first design is the centroid of every design it has seen, and the centroid has a
// fingerprint: Inter alone, the purple-to-pink gradient, the glass card, three feature cards,
// the centred hero with two buttons, emoji for icons, a lone acid accent on near-black, the
// blurred blob behind everything, and copy that says "seamless". None is wrong alone; four of
// them together is the template. This finds them by pattern, names each with the line it sits
// on, and says what a decision would look like instead. Exit 1 when a file is the centroid.
//
// Honest limit: the absence of fingerprints is not the presence of design. This catches the
// average; it cannot see the good. The review loop in creative-divergence is for that.

import { readFileSync, statSync, readdirSync, existsSync, realpathSync } from 'node:fs'
import { join, extname, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pageWithStyles } from './paths.mjs'

export const EXTS = new Set(['.html', '.htm', '.css', '.scss', '.jsx', '.tsx', '.vue', '.svelte', '.astro'])
const MOVES = 'visual-design-mastery/references/signature-moves.md'

// ── colour ───────────────────────────────────────────────────────────────────
const NAMED = {
  purple: 280, violet: 270, indigo: 250, fuchsia: 300, pink: 330, rose: 350, blue: 230,
  green: 140, emerald: 160, lime: 90, cyan: 190, teal: 175,
}
/** Hue, saturation and lightness of a CSS colour literal, or null. Enough for a fingerprint. */
export function hsl(str) {
  let r, g, b
  let m
  if ((m = /^#([0-9a-f]{3,8})$/i.exec(str))) {
    let h = m[1]
    if (h.length <= 4) h = [...h].map((c) => c + c).join('')
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16)
  } else if ((m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(str))) {
    r = +m[1]; g = +m[2]; b = +m[3]
  } else if ((m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i.exec(str))) {
    return { h: +m[1], s: +m[2] / 100, l: +m[3] / 100 }
  } else if ((m = /^oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)/i.exec(str))) {
    // oklch hue is not hsl hue, but the purple band and the acid band land in the same place.
    const L = +m[1] > 1 ? +m[1] / 100 : +m[1]
    return { h: +m[3], s: Math.min(1, +m[2] / 0.3), l: L }
  } else return null
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: h * 60, s, l }
}
const COLOUR = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)/gi
// indigo-500 (#6366f1) sits at 239° and the canonical #667eea at 229°; the band starts in
// blue-violet so those pairs count. A gradient is the tell when one stop is in the band and
// the other is any saturated blue-to-pink partner (200–345°), which covers #667eea→#764ba2 and
// #6a11cb→#2575fc — the two most copied gradients on the web.
const inPurple = (c) => c && c.s >= 0.35 && c.h >= 225 && c.h <= 345
const purplePartner = (c) => c && c.s >= 0.35 && c.h >= 200 && c.h <= 345
const purplePair = (cols) => cols.some(inPurple) && cols.filter(purplePartner).length >= 2
const isAcid = (c) => c && c.s >= 0.6 && c.l >= 0.4 && c.h >= 70 && c.h <= 195
const nearBlack = (c) => c && c.l <= 0.12

// ── families ─────────────────────────────────────────────────────────────────
// Each returns null, or { line, sample } for the first place it was seen. `t` is the whole
// text; `at(i)` turns an index into a line number.
const DEFAULT_FACES = /^(inter|roboto|poppins|montserrat|open sans|lato|raleway|nunito( sans)?|arial|helvetica( neue)?|segoe ui|system-ui|-apple-system|blinkmacsystemfont|ui-sans-serif|ui-serif|ui-monospace|sans-serif|serif|monospace|cursive|inherit|initial)$/i
const SLOGAN_FACES = /\b(bebas neue|impact|anton|oswald)\b/i
const STOCK = [
  'lightning[- ]fast', 'blazing[- ]fast', 'seamless(ly)?', 'effortless(ly)?', 'supercharge', 'unleash',
  'elevate your', 'next[- ]gen(eration)?', 'built for the modern', 'trusted by', 'get started for free',
  'no credit card', 'join thousands', 'powered by ai', 'revolutioni[sz]', 'game[- ]chang', 'to the next level',
  'streamline your', 'boost (your )?productivity', 'all[- ]in[- ]one', 'cutting[- ]edge', 'state[- ]of[- ]the[- ]art',
  'unlock (the|your)', 'empower(ing)? (your|teams)', 'one platform',
]
// No trailing boundary: several entries are stems, and a stem cannot have one.
const STOCK_RE = new RegExp(`\\b(?:${STOCK.join('|')})`, 'gi')

function count(re, t) { return (t.match(re) || []).length }
function first(re, t) { const m = new RegExp(re.source, re.flags.replace('g', '')).exec(t); return m ? { i: m.index, s: m[0] } : null }

export const FAMILIES = [
  {
    id: 'type-default', weight: 1,
    why: 'the only faces are defaults — nothing was typeset. Choose a display face with a point of view and a text face to hold it',
    find(orig, resolved) {
      // A face, a colour or a ground named through a token is still what is on the page.
      const t = resolved || orig
      const fams = new Set()
      let firstAt = null
      for (const m of t.matchAll(/font-family\s*:\s*([^;}\n]+)|fontFamily\s*:\s*["'`]([^"'`]+)|family=([A-Za-z+ ]+)/g)) {
        const list = (m[1] || m[2] || m[3] || '').replace(/\+/g, ' ')
        for (let f of list.split(',')) {
          f = f.trim().replace(/^["']|["']$/g, '').replace(/:.*$/, '').trim()
          if (!f || /^var\(/.test(f)) continue
          fams.add(f); if (firstAt === null) firstAt = m.index
        }
      }
      const tw = first(/\bfont-(sans|serif|mono)\b/, t)
      if (!fams.size) return tw && !/@font-face|fonts\.googleapis|fontshare|font-\[/.test(t) ? { i: tw.i, s: tw.s + ' (the framework stack)' } : null
      const chosen = [...fams].filter((f) => !DEFAULT_FACES.test(f))
      return chosen.length ? null : { i: firstAt, s: [...fams].slice(0, 3).join(', ') }
    },
  },
  {
    id: 'slogan-face', weight: 1,
    why: 'the slogan faces (Bebas, Impact, Anton, Oswald) say "poster" without an idea. If condensed caps are the move, choose the face for the subject and set it at one size only',
    find(t) { const m = first(SLOGAN_FACES, t); return m && { i: m.i, s: m.s } },
  },
  {
    id: 'gradient-purple', weight: 2,
    why: 'the purple→pink/indigo gradient is the single most recognisable tell. A gradient can stay; this one cannot. Take the hue from the subject and use one colour flat, or a two-ink overprint',
    find(orig, resolved) {
      // A face, a colour or a ground named through a token is still what is on the page.
      const t = resolved || orig
      const tw = first(/\bfrom-(purple|violet|indigo|fuchsia|pink)-\d+\b[^"'`]*\b(via|to)-(purple|violet|indigo|fuchsia|pink|blue|rose)-\d+\b/, t)
      if (tw) return { i: tw.i, s: tw.s.slice(0, 60) }
      for (const m of t.matchAll(/(?:linear|radial|conic)-gradient\(((?:[^()]|\([^()]*\))*)\)/g)) {
        const cols = (m[1].match(COLOUR) || []).map(hsl).filter(Boolean)
        if (purplePair(cols)) return { i: m.index, s: m[0].slice(0, 60) }
      }
      const clip = first(/bg-clip-text\b[^"'`]*text-transparent|text-transparent\b[^"'`]*bg-clip-text|-webkit-background-clip\s*:\s*text/, t)
      return clip && /gradient/.test(t) ? { i: clip.i, s: 'gradient-clipped heading text' } : null
    },
  },
  {
    id: 'glass', weight: 2,
    why: 'the glass card (backdrop blur over translucent white) is decoration standing in for structure. Give the surface a real material — paper, ink, a rule — or no card at all',
    find(t) {
      const TRANSLUCENT = /bg-white\/\d+|bg-black\/\d+|border-white\/\d+|rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.\d+|rgba?\(\s*255\s+255\s+255\s*\/\s*0?\.\d+/
      const BLUR = /backdrop-blur(-\w+)?\b|backdrop-filter\s*:\s*[^;]*blur\(/g
      // The two have to be on the same thing. A translucent sticky nav elsewhere on the page is
      // a different decision, and often a good one.
      // A sticky or fixed bar with a blur behind it is a navigation bar, not a glass card, and
      // it is one of the few genuinely good uses of backdrop-filter there is.
      const BAR = /position\s*:\s*(sticky|fixed)|\bsticky\b|\bfixed\s+top-0|<nav\b|<header\b|\bnav\s*\{|\bheader\s*\{/
      for (const m of t.matchAll(BLUR)) {
        const near = t.slice(Math.max(0, m.index - 220), m.index + 220)
        if (TRANSLUCENT.test(near) && !BAR.test(near)) return { i: m.index, s: m[0] }
      }
      return null
    },
  },
  {
    id: 'three-grid', weight: 1,
    why: 'three identical cards in a row is the feature grid every template ships. State one thing at full width, or set the rest as a list with a real hierarchy',
    find(t) {
      const m = first(/\bgrid-cols-3\b|grid-template-columns\s*:\s*repeat\(\s*3\s*,|grid-template-columns\s*:\s*(?:1fr\s+){2}1fr\b|grid-template-columns\s*:\s*(?:minmax\([^)]*\)\s*){3}/, t)
      return m && /\bcards?\b|\bfeatures?\b/i.test(t) ? { i: m.i, s: m.s } : null
    },
  },
  {
    id: 'hero-centroid', weight: 2,
    why: 'the centred hero — headline, paragraph, two buttons — is the shape of every landing page the model has seen. Decide what the two-second glance should learn and build the top of the page around only that',
    find(t) {
      const h = first(/<h1\b/, t)
      if (!h) return null
      const win = t.slice(Math.max(0, h.i - 800), h.i + 1800)
      const ctas = count(/<(a|button)\b[^>]*(btn|button|cta|rounded-full|rounded-(md|lg|xl)|px-\d)/gi, win)
      // Centring is declared in the head of a single-file page, not beside the h1 — but the
      // STRUCTURE (a headline, a paragraph, two calls to action) still has to be in the window.
      const centred = /text-center\b|text-align\s*:\s*center|items-center[^"']*justify-center/.test(t)
      return /<p\b/.test(win) && ctas >= 2 && centred ? { i: h.i, s: 'h1, a paragraph, two buttons, centred' } : null
    },
  },
  {
    id: 'pill-and-shadow', weight: 1,
    why: 'one large radius and one heavy shadow on every surface flattens all depth into one plane. Radius is a hierarchy signal — vary it or drop it; shadows belong to the thing that floats',
    find(t) {
      const r = count(/\brounded-(xl|2xl|3xl)\b/g, t) + count(/border-radius\s*:\s*(1rem|16px|20px|24px|1\.5rem|2rem)\b/g, t)
      const s = count(/\bshadow-(lg|xl|2xl)\b/g, t) + count(/box-shadow\s*:\s*0\s+\d+px\s+\d{2,}px/g, t)
      if (r < 6 || s < 3) return null
      const m = first(/\brounded-(xl|2xl|3xl)\b|border-radius\s*:\s*(1rem|16px|20px|24px|1\.5rem|2rem)\b/, t)
      return { i: m.i, s: `${r} large radii, ${s} heavy shadows` }
    },
  },
  {
    id: 'emoji-icons', weight: 2,
    why: 'emoji as section markers read as a pitch deck. Draw a mark, set a numeral, or use nothing',
    find(t) {
      const body = t.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|(?<=^|\s)\/\/[^\n]*/g, '')
        // &#128640; renders as 🚀 and was invisible to a scan over code points.
        .replace(/&#(\d+);|&#x([0-9a-f]+);/gi, (whole, dec, hex) => {
          const n = dec ? Number(dec) : parseInt(hex, 16)
          return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole
        })
      // Emoji_Presentation, not Extended_Pictographic: © ® ™ ↗ ✔ are typography, not icons.
      const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/gu
      const all = body.match(EMOJI) || []
      if (all.length < 3) return null
      const m = first(/\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u, body)
      return { i: t.indexOf(m.s), s: `${all.length} emoji, first ${m.s}` }
    },
  },
  {
    id: 'hover-scale', weight: 1,
    why: 'scale-on-hover on every card is motion as garnish. Motion carries meaning; choose one thing that moves and say why',
    find(t) {
      const n = count(/hover:scale-1(05|10)\b|:hover\s*\{[^}]*scale\(1\.(05|1)\)/g, t)
      const m = first(/hover:scale-1(05|10)\b|:hover\s*\{[^}]*scale\(1\.(05|1)\)/, t)
      return n >= 2 ? { i: m.i, s: `${n}× ${m.s.slice(0, 30)}` } : null
    },
  },
  {
    id: 'acid-on-black', weight: 1,
    why: 'one electric green/cyan glowing on near-black is the dev-tool default. Dark is not #0a0a0a and an accent is not a palette — build neutrals with a hue and choose an accent from the subject',
    find(orig, resolved) {
      // A face, a colour or a ground named through a token is still what is on the page.
      const t = resolved || orig
      const dark = first(/\bbg-(black|(gray|zinc|neutral|slate|stone)-950)\b/, t)
        || [...t.matchAll(/background(?:-color)?\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\))/gi)].map((m) => ({ i: m.index, s: m[1], c: hsl(m[1]) })).find((x) => nearBlack(x.c))
      if (!dark) return null
      const tw = first(/\b(text|bg|border|from|to)-(green|emerald|lime|cyan)-(400|500)\b/, t)
      if (tw) return { i: dark.i, s: `${dark.s} + ${tw.s}` }
      const acid = (t.match(COLOUR) || []).find((c) => isAcid(hsl(c)))
      if (!acid) return null
      // Saturated hues, bucketed at 40° so a tint and its shade count once.
      const hues = new Set()
      // Gradient stops are one gesture, and a token DECLARATION is not a use — the resolved
      // text already carries the colour everywhere it is actually painted.
      const flat = t.replace(/(?:linear|radial|conic)-gradient\((?:[^()]|\([^()]*\))*\)/gi, ' ')
        .replace(/--[\w-]+\s*:[^;}]*/g, ' ')
      for (const c of flat.match(COLOUR) || []) {
        const k = hsl(c)
        if (k && k.s >= 0.35 && k.l >= 0.15 && k.l <= 0.9) hues.add(Math.round(k.h / 40))
      }
      for (const m of flat.matchAll(/\b(green|emerald|lime|cyan|red|rose|amber|orange|yellow|blue|indigo|violet|purple|pink|teal|sky)-(4|5|6)00\b/gi)) {
        hues.add('tw:' + m[1].toLowerCase())
      }
      if (hues.size >= 3) return null
      return { i: dark.i, s: `${dark.s} + ${acid}` }
    },
  },
  {
    id: 'blob-blur', weight: 2,
    why: 'the blurred coloured blob behind the hero is a background pretending to be an idea. Remove it; if the page needs a field, draw one with a rule the subject supplies',
    find(t) {
      for (const m of t.matchAll(/<(div|span)\b[^>]{0,400}>/g)) {
        const tag = m[0]
        if (/blur-(2xl|3xl)|blur\(\s*(?:\d{2,3}px|[4-9](?:\.\d+)?r?em|\d\d+(?:\.\d+)?r?em)/.test(tag) && /rounded-full|border-radius\s*:\s*(50%|9999px)/.test(tag) && /absolute|fixed/.test(tag)) return { i: m.index, s: tag.slice(0, 60) }
      }
      const css = first(/filter\s*:\s*blur\(\s*(\d+(?:\.\d+)?)(px|r?em)\s*\)/, t)
      const cssPx = css ? (/r?em/.test(css.s) ? parseFloat(css.s.match(/[\d.]+/)[0]) * 16 : parseFloat(css.s.match(/[\d.]+/)[0])) : 0
      if (css && cssPx >= 40 && /border-radius\s*:\s*(50%|9999px)/.test(t) && /position\s*:\s*absolute/.test(t)) return { i: css.i, s: css.s }
      return null
    },
  },
  {
    id: 'stock-copy', weight: 2,
    why: 'the copy is the design too, and "seamless / effortless / supercharge / trusted by" is the copy of no one. Say the specific thing the subject does, in its own vernacular',
    find(t) {
      const text = t.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|(?<=\s)\/\/[^\n]*/gi, '')
      const hits = text.match(STOCK_RE) || []
      if (hits.length < 2) return null
      const m = first(STOCK_RE, text)
      return { i: t.indexOf(m.s), s: hits.slice(0, 3).join(', ') }
    },
  },
  {
    id: 'uniform-motion', weight: 1,
    why: '`transition: all` on everything is one easing and one duration for every event. Exits faster than entrances; each property gets its own reason to move',
    find(t) {
      const n = count(/\btransition-all\b|transition\s*:\s*all\b/g, t)
      const m = first(/\btransition-all\b|transition\s*:\s*all\b/, t)
      return n >= 3 ? { i: m.i, s: `${n}× ${m.s}` } : null
    },
  },
  {
    id: 'dark-saas', weight: 1,
    why: 'gray-900 page, gray-400 body, gray-800 borders: the dark SaaS default with no hue in any neutral. Real neutrals lean warm or cool — pick one and commit',
    find(t) {
      const bg = first(/\bbg-(gray|slate|zinc|neutral)-(900|950)\b|#(0f172a|111827|18181b|0a0a0a|09090b)\b/, t)
      if (!bg) return null
      return /\btext-(gray|slate|zinc|neutral)-(400|500)\b/.test(t) && /\bborder-(gray|slate|zinc|neutral)-(700|800)\b/.test(t) ? { i: bg.i, s: bg.s } : null
    },
  },
  {
    id: 'grey-neutrals', weight: 1,
    why: 'four or more pure greys (#888, #ccc, #333…) — dead neutrals with zero hue. Push a little chroma at one hue through the whole ramp',
    find(t) {
      const greys = new Set()
      let at = null
      for (const m of t.matchAll(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi)) {
        const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
        const [r, g, b] = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)]
        if (r === g && g === b && !/^(00|ff)$/i.test(r)) { greys.add(h.toLowerCase()); at ??= m.index }
      }
      if (greys.size < 4) return null
      // Neutrals that are nearly grey but not quite: a channel spread of 1–24 of 255 is the
      // signature of a ramp built at one hue, which is exactly what the fix asks for.
      let hued = 0
      for (const m of t.matchAll(/#([0-9a-f]{6})\b/gi)) {
        const [r, g, b] = [0, 2, 4].map((k) => parseInt(m[1].slice(k, k + 2), 16))
        const spread = Math.max(r, g, b) - Math.min(r, g, b)
        if (spread > 0 && spread <= 24) hued++
      }
      // hsl()/oklch() neutrals say it outright.
      for (const m of t.matchAll(/hsla?\(\s*[\d.]+(?:deg)?[\s,]+([\d.]+)%/gi)) if (Number(m[1]) > 0 && Number(m[1]) <= 20) hued++
      for (const m of t.matchAll(/oklch\(\s*[\d.%]+[\s,]+([\d.]+)/gi)) if (Number(m[1]) > 0 && Number(m[1]) <= 0.04) hued++
      if (hued >= greys.size) return null
      return { i: at, s: [...greys].slice(0, 4).map((g) => '#' + g).join(' ') }
    },
  },
  {
    id: 'placeholder', weight: 2,
    why: 'placeholder text or a placeholder image shipped. The design is not finished until the real words and the real image are in it',
    find(t) {
      // A placeholder SERVICE, a bracketed stub or a copy TODO is never anything else.
      const hard = first(/placehold(er)?\.(co|it|com)|via\.placeholder|\[insert [^\]]+\]|TODO: copy/i, t)
      if (hard) return { i: hard.i, s: hard.s }
      // "lorem ipsum" is also the name of the thing, and a page arguing against filler text says
      // it once in an English sentence. Shipped filler comes with its own tail, or comes twice.
      const named = [...t.matchAll(/lorem ipsum/gi)]
      if (!named.length) return null
      const filler = named.some((m) => /^\s*(dolor|sit amet|consectetur|adipiscing|elit)/i.test(t.slice(m.index + m[0].length, m.index + m[0].length + 24)))
      if (filler || named.length >= 2) return { i: named[0].index, s: t.slice(named[0].index, named[0].index + 40) }
      return null
    },
  },
]

export const MAX_SCORE = FAMILIES.reduce((a, f) => a + f.weight, 0)

/** Lint one text. `name` is for the report only. */
/** Blank the content of code samples, keeping the length so positions stay exact. */
export function blankQuotedCode(text) {
  return text.replace(/(<(pre|code|textarea|samp)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi,
    (whole, open, tag, body, close) => open + ' '.repeat(body.length) + close)
}

/** Substitute `--x: value` definitions into their var() uses. Two passes: tokens that point
 *  at tokens are the normal shape of a real token file. */
export function resolveVars(text) {
  const defs = new Map()
  for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) defs.set(m[1], m[2].trim())
  if (!defs.size) return text
  let out = text
  for (let pass = 0; pass < 2; pass++) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/g, (whole, name) => {
      const v = defs.get(name)
      return v && !/var\(/.test(v) ? v : whole
    })
  }
  return out
}

export function lintText(text, name = 'text') {
  const lineOf = (i) => (i == null || i < 0 ? 0 : text.slice(0, i).split('\n').length)
  const findings = []
  // What is linted is the file with its code samples blanked and its tokens resolved: a design
  // is what the page does, not what it quotes, and a token is still the value it stands for.
  const scan = blankQuotedCode(text)
  const resolved = resolveVars(scan)
  for (const f of FAMILIES) {
    let hit = null
    try { hit = f.find(scan, resolved) } catch { hit = null }
    if (hit) findings.push({ id: f.id, weight: f.weight, line: lineOf(hit.i), sample: String(hit.s).replace(/\s+/g, ' ').trim(), why: f.why })
  }
  const score = findings.reduce((a, f) => a + f.weight, 0)
  const verdict = score >= 4 ? 'centroid' : score >= 2 ? 'fingerprints' : 'clean'
  return { file: name, score, max: MAX_SCORE, verdict, findings }
}

export function lint(file) {
  // A page is judged with the stylesheets it links, because that is the design. The pieces are
  // joined with a marker of exactly one newline per piece boundary so a position can be mapped
  // back to the file it came from — a line number counted through a concatenation is a lie.
  const pieces = pageWithStyles(file, readFileSync(file, 'utf8'))
  if (pieces.length === 1) return lintText(pieces[0].text, file)
  const joined = pieces.map((p) => p.text).join('\n')
  const r = lintText(joined, file)
  // Map every finding back to its own file and its own line.
  const bounds = []
  let at = 0
  for (const p of pieces) { bounds.push({ file: p.file, start: at, text: p.text }); at += p.text.length + 1 }
  const lines = (s) => s.split(/\r?\n/).length
  const upTo = joined.split(/\r?\n/)
  for (const f of r.findings) {
    // lintText already turned the index into a line of the joined text; find which piece owns it.
    const charIndex = upTo.slice(0, Math.max(0, f.line - 1)).reduce((n, l) => n + l.length + 1, 0)
    const piece = [...bounds].reverse().find((b) => charIndex >= b.start) || bounds[0]
    if (piece.file !== file) {
      f.file = piece.file
      f.line = lines(joined.slice(piece.start, charIndex))
    }
  }
  return r
}

function expand(paths) {
  const out = []
  for (const p of paths) {
    const abs = resolve(p)
    if (!existsSync(abs)) { out.push({ missing: abs }); continue }
    if (statSync(abs).isDirectory()) {
      for (const f of readdirSync(abs).sort()) if (EXTS.has(extname(f).toLowerCase())) out.push(join(abs, f))
    } else out.push(abs)
  }
  return out
}

const HELP = `usage:
  cgc lint <file|dir> [more…] [--json]

Files: ${[...EXTS].join(' ')}. A directory lints every such file in it.
Verdicts: clean (score < 2) · fingerprints (2–3) · centroid (4+, exit 1).
${FAMILIES.map((f) => `  ${f.id.padEnd(16)} ${f.weight}  ${f.why.split('.')[0]}`).join('\n')}
`

export function main(argv = process.argv.slice(2)) {
  const json = argv.includes('--json')
  const paths = argv.filter((a) => !a.startsWith('--'))
  // --help is a request that was answered: exit 0. No paths at all is a usage error: exit 1.
  if (!paths.length || argv.includes('--help')) { console.log(HELP); return argv.includes('--help') ? 0 : 1 }
  const results = []
  for (const p of expand(paths)) {
    if (typeof p === 'object') { results.push({ file: p.missing, error: 'no such file' }); continue }
    results.push(lint(p))
  }
  const bad = results.filter((r) => r.verdict === 'centroid' || r.error).length
  if (json) { console.log(JSON.stringify({ ok: bad === 0, files: results }, null, 2)); return bad ? 1 : 0 }
  for (const r of results) {
    if (r.error) { console.log(`\x1b[31m${basename(r.file)}\x1b[0m — ${r.error}`); continue }
    const colour = r.verdict === 'centroid' ? '\x1b[31m' : r.verdict === 'fingerprints' ? '\x1b[33m' : '\x1b[32m'
    console.log(`\n${colour}${basename(r.file)}\x1b[0m — ${r.verdict.toUpperCase()} (score ${r.score} of ${r.max})`)
    for (const f of r.findings) {
      // A finding from a linked stylesheet names that file: "L4" printed under the page's own
      // heading sends the reader to line 4 of the markup, where there is nothing to see.
      const where = f.file ? `${basename(f.file)}:${f.line}` : `L${f.line}`
      console.log(`  ${f.weight === 2 ? '\x1b[31m✖\x1b[0m' : '\x1b[33m!\x1b[0m'} ${f.id.padEnd(16)} ${where.padEnd(13)} ${f.sample.slice(0, 66)}`)
      console.log(`      → ${f.why} (${MOVES}).`)
    }
    if (r.verdict === 'centroid') console.log('  This is the template. Do not decorate it — change the structure with the divergence protocol, then lint again.')
    else if (r.verdict === 'fingerprints') console.log('  Each of these is a default, not a decision. Replace it, or state why it stays.')
    else console.log('  No fingerprints. That is not design yet — look at the render before showing it.')
  }
  return bad ? 1 : 0
}

const isEntry = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false } })()
if (isEntry) {
  process.exit(main())
}
