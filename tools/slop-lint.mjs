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
  } else if ((m = /^hsla?\(\s*([\d.]+)[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i.exec(str))) {
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
// indigo-500 (#6366f1) sits at 239°; the band starts in blue-violet so the indigo→pink pair counts.
const inPurple = (c) => c && c.s >= 0.35 && c.h >= 232 && c.h <= 345
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
const STOCK_RE = new RegExp(`\\b(${STOCK.join('|')})\\b`, 'gi')

function count(re, t) { return (t.match(re) || []).length }
function first(re, t) { const m = new RegExp(re.source, re.flags.replace('g', '')).exec(t); return m ? { i: m.index, s: m[0] } : null }

export const FAMILIES = [
  {
    id: 'type-default', weight: 1,
    why: 'the only faces are defaults — nothing was typeset. Choose a display face with a point of view and a text face to hold it',
    find(t) {
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
    find(t) {
      const tw = first(/\bfrom-(purple|violet|indigo|fuchsia|pink)-\d+\b[^"'`]*\b(via|to)-(purple|violet|indigo|fuchsia|pink|blue|rose)-\d+\b/, t)
      if (tw) return { i: tw.i, s: tw.s.slice(0, 60) }
      for (const m of t.matchAll(/(?:linear|radial|conic)-gradient\(((?:[^()]|\([^()]*\))*)\)/g)) {
        const cols = (m[1].match(COLOUR) || []).map(hsl).filter(inPurple)
        if (cols.length >= 2) return { i: m.index, s: m[0].slice(0, 60) }
      }
      const clip = first(/bg-clip-text\b[^"'`]*text-transparent|text-transparent\b[^"'`]*bg-clip-text|-webkit-background-clip\s*:\s*text/, t)
      return clip && /gradient/.test(t) ? { i: clip.i, s: 'gradient-clipped heading text' } : null
    },
  },
  {
    id: 'glass', weight: 2,
    why: 'the glass card (backdrop blur over translucent white) is decoration standing in for structure. Give the surface a real material — paper, ink, a rule — or no card at all',
    find(t) {
      const m = first(/backdrop-blur(-\w+)?\b|backdrop-filter\s*:\s*[^;]*blur\(/, t)
      if (!m) return null
      return /bg-white\/\d+|bg-black\/\d+|rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.\d+|border-white\/\d+/.test(t) ? { i: m.i, s: m.s } : null
    },
  },
  {
    id: 'three-grid', weight: 1,
    why: 'three identical cards in a row is the feature grid every template ships. State one thing at full width, or set the rest as a list with a real hierarchy',
    find(t) {
      const m = first(/\bgrid-cols-3\b|grid-template-columns\s*:\s*repeat\(\s*3\s*,/, t)
      return m && /\bcard|feature/i.test(t) ? { i: m.i, s: m.s } : null
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
      const centred = /text-center|text-align\s*:\s*center|items-center[^"']*justify-center|mx-auto/.test(win)
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
      const body = t.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
      const all = body.match(/\p{Extended_Pictographic}/gu) || []
      if (all.length < 3) return null
      const m = first(/\p{Extended_Pictographic}/u, body)
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
    find(t) {
      const dark = first(/\bbg-(black|(gray|zinc|neutral|slate|stone)-950)\b/, t)
        || [...t.matchAll(/background(?:-color)?\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\))/gi)].map((m) => ({ i: m.index, s: m[1], c: hsl(m[1]) })).find((x) => nearBlack(x.c))
      if (!dark) return null
      const tw = first(/\b(text|bg|border|from|to)-(green|emerald|lime|cyan)-(400|500)\b/, t)
      if (tw) return { i: dark.i, s: `${dark.s} + ${tw.s}` }
      const acid = (t.match(COLOUR) || []).find((c) => isAcid(hsl(c)))
      return acid ? { i: dark.i, s: `${dark.s} + ${acid}` } : null
    },
  },
  {
    id: 'blob-blur', weight: 2,
    why: 'the blurred coloured blob behind the hero is a background pretending to be an idea. Remove it; if the page needs a field, draw one with a rule the subject supplies',
    find(t) {
      for (const m of t.matchAll(/<(div|span)\b[^>]{0,400}>/g)) {
        const tag = m[0]
        if (/blur-(2xl|3xl)|blur\(\s*(\d{2,3})px/.test(tag) && /rounded-full|border-radius\s*:\s*(50%|9999px)/.test(tag) && /absolute|fixed/.test(tag)) return { i: m.index, s: tag.slice(0, 60) }
      }
      const css = first(/filter\s*:\s*blur\(\s*(\d{2,3})px\s*\)/, t)
      if (css && +css.s.match(/\d+/)[0] >= 40 && /border-radius\s*:\s*(50%|9999px)/.test(t) && /position\s*:\s*absolute/.test(t)) return { i: css.i, s: css.s }
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
      return greys.size >= 4 ? { i: at, s: [...greys].slice(0, 4).map((g) => '#' + g).join(' ') } : null
    },
  },
  {
    id: 'placeholder', weight: 2,
    why: 'placeholder text or a placeholder image shipped. The design is not finished until the real words and the real image are in it',
    find(t) { const m = first(/lorem ipsum|placehold(er)?\.(co|it|com)|via\.placeholder|\[insert [^\]]+\]|TODO: copy/i, t); return m && { i: m.i, s: m.s } },
  },
]

export const MAX_SCORE = FAMILIES.reduce((a, f) => a + f.weight, 0)

/** Lint one text. `name` is for the report only. */
export function lintText(text, name = 'text') {
  const lineOf = (i) => (i == null || i < 0 ? 0 : text.slice(0, i).split('\n').length)
  const findings = []
  for (const f of FAMILIES) {
    let hit = null
    try { hit = f.find(text) } catch { hit = null }
    if (hit) findings.push({ id: f.id, weight: f.weight, line: lineOf(hit.i), sample: String(hit.s).replace(/\s+/g, ' ').trim(), why: f.why })
  }
  const score = findings.reduce((a, f) => a + f.weight, 0)
  const verdict = score >= 4 ? 'centroid' : score >= 2 ? 'fingerprints' : 'clean'
  return { file: name, score, max: MAX_SCORE, verdict, findings }
}

export function lint(file) {
  return lintText(readFileSync(file, 'utf8'), file)
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
  slop-lint <file|dir> [more…] [--json]

Files: ${[...EXTS].join(' ')}. A directory lints every such file in it.
Verdicts: clean (score < 2) · fingerprints (2–3) · centroid (4+, exit 1).
${FAMILIES.map((f) => `  ${f.id.padEnd(16)} ${f.weight}  ${f.why.split('.')[0]}`).join('\n')}
`

export function main(argv = process.argv.slice(2)) {
  const json = argv.includes('--json')
  const paths = argv.filter((a) => !a.startsWith('--'))
  if (!paths.length || argv.includes('--help')) { console.log(HELP); return paths.length ? 0 : 1 }
  const results = []
  for (const p of expand(paths)) {
    if (typeof p === 'object') { results.push({ file: p.missing, error: 'no such file' }); continue }
    results.push(lint(p))
  }
  const bad = results.filter((r) => r.verdict === 'centroid').length
  if (json) { console.log(JSON.stringify({ ok: bad === 0, files: results }, null, 2)); return bad ? 1 : 0 }
  for (const r of results) {
    if (r.error) { console.log(`\x1b[31m${basename(r.file)}\x1b[0m — ${r.error}`); continue }
    const colour = r.verdict === 'centroid' ? '\x1b[31m' : r.verdict === 'fingerprints' ? '\x1b[33m' : '\x1b[32m'
    console.log(`\n${colour}${basename(r.file)}\x1b[0m — ${r.verdict.toUpperCase()} (score ${r.score} of ${r.max})`)
    for (const f of r.findings) {
      console.log(`  ${f.weight === 2 ? '\x1b[31m✖\x1b[0m' : '\x1b[33m!\x1b[0m'} ${f.id.padEnd(16)} L${String(f.line).padEnd(5)} ${f.sample.slice(0, 70)}`)
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
