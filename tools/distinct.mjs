#!/usr/bin/env node
// distinct.mjs — does this piece look like the last piece?
//
//   cgc distinct hero.html
//   cgc distinct ./work --corpus ./past-work
//   cgc distinct poster.svg --json
//
// WHY THIS IS NOT ANOTHER LIST. Everything else here judges a design against a fixed set: the
// slop lint against 23 fingerprints, the ambition measure against 62 named techniques. A list
// tells you what to avoid and what to reach for, and both directions converge — avoid the
// blacklist and you land where everyone else who avoided it landed; score against a menu and
// the menu becomes the target. That is how a package meant to raise the ceiling ends up making
// everything look the same, and it is a fair description of what this one shipped: six example
// designs, six different fields, ONE palette — the same cream ground in all six and the same
// burnt orange in five.
//
// This measures something a list cannot: SELF-SIMILARITY. It extracts a signature from a piece
// — the ground and accent hues in a perceptual space, the type pairing, the layout grammar, the
// motion law, the shape of the composition — and compares it against a corpus of other work.
// It never says a signature is wrong. It says: you have made this before, here, and these are
// the axes you repeated. What is good is not on the list, because there is no list. The only
// claim is that the fourth cream-and-orange piece is a habit rather than a decision, and the
// author is the one who decides whether the habit is the point.
//
// The corpus is the tree the piece lives in — YOUR other work — and it gets sharper as a body
// of work grows. Point it somewhere else with --corpus. A corpus of one says so rather than
// pretending to a verdict, because one piece is no evidence of originality.

import { readFileSync, existsSync, statSync, readdirSync, realpathSync } from 'node:fs'
import { join, extname, resolve, dirname, basename, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPO, askedForHelp } from './paths.mjs'
import { hsl, resolveVars } from './slop-lint.mjs'

const C = { dim: '\x1b[2m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', off: '\x1b[0m' }
const DESIGN = new Set(['.html', '.htm', '.css', '.scss', '.svg', '.jsx', '.tsx', '.vue', '.svelte', '.astro'])

const HELP = `
  cgc distinct <file|dir> [--corpus <dir>] [--json] [--quiet]

  Does this look like the last thing you made? Compares a piece's signature — ground and accent
  hue, type pairing, layout grammar, motion, composition — against a corpus of other work, and
  names the axes it repeats. Not a list of good and bad: a mirror.

  --corpus <dir>   what to compare against (repeatable). Defaults to the piece's own siblings
                   and this package's shipped examples.
  --json           the signatures and the distances
  --quiet          only the verdict line
`

// ── the signature ────────────────────────────────────────────────────────────────────────────

/** Perceptual buckets, coarse enough that two hand-picked creams count as one cream. */
function bucketColour(c) {
  if (!c) return null
  // Near-black and near-white are grounds everywhere and say nothing about a point of view.
  if (c.l <= 0.08) return 'ink:black'
  if (c.l >= 0.94 && c.s <= 0.06) return 'ground:white'
  if (c.s <= 0.08) return `neutral:${Math.round(c.l * 4)}`
  // 30° of hue is about as fine as a person distinguishes when naming a colour.
  return `${Math.round(c.h / 30) * 30}:${c.s >= 0.5 ? 'sat' : 'muted'}:${Math.round(c.l * 3)}`
}

const COLOUR_RE = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)/gi

/** Faces actually asked for, in the order they are declared: the first is usually the display. */
function faces(text) {
  const out = []
  for (const m of text.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^["']|["']$/g, '').toLowerCase()
      if (!name || /^(var\(|inherit|initial|unset)/.test(name)) continue
      // A generic is a fallback, not a choice.
      if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-\w+|-apple-system|blinkmacsystemfont)$/.test(name)) continue
      if (!out.includes(name)) out.push(name)
      break
    }
  }
  return out
}

/** Blank the bodies of visually-hidden utilities. Every accessible page carries one, and it is
 *  absolutely positioned and clipped — so reading it as composition told every page it was
 *  "placed" and "cut", which is a fact about the a11y helper and not about the design. */
function withoutHiddenUtilities(text) {
  return text.replace(/\{([^{}]*)\}/g, (whole, body) => {
    const srOnly = /clip-path\s*:\s*inset\(\s*50%/i.test(body)
      || (/(?:^|[;\s])width\s*:\s*1px/i.test(body) && /(?:^|[;\s])height\s*:\s*1px/i.test(body))
    return srOnly ? '{' + ' '.repeat(body.length) + '}' : whole
  })
}

/** The layout grammar, as coarse shapes rather than as a checklist. */
function grammar(raw) {
  const text = withoutHiddenUtilities(raw)
  const g = new Set()
  // A grid whose tracks or placements are COMPUTED is a coordinate system, not a container —
  // the piece is drawn on a scale rather than stacked. Missing it meant the one structural
  // decision a piece had made was the one thing this could not see.
  if (/grid-template-(?:rows|columns)\s*:[^;}]*calc\(|grid-row\s*:\s*calc\(|grid-column\s*:\s*calc\(/i.test(text)) g.add('computed-grid')
  if (/display\s*:\s*contents/i.test(text)) g.add('regridded')
  if (/grid-template-(?:areas|columns)\s*:\s*\[/i.test(text)) g.add('named-lines')
  if (/grid-template-columns\s*:\s*repeat\(\s*(\d)/i.test(text)) {
    const n = /grid-template-columns\s*:\s*repeat\(\s*(\d)/i.exec(text)[1]
    g.add(`grid-${n}up`)
  }
  if (/grid-template-columns\s*:\s*[^;}]*(?:fr\s+[\d.]*fr|fr\s+auto|auto\s+[\d.]*fr)/i.test(text)) g.add('asymmetric-grid')
  if (/display\s*:\s*flex/i.test(text) && !/grid-template/i.test(text)) g.add('flex-stack')
  if (/text-align\s*:\s*center/i.test(text)) g.add('centred')
  if (/position\s*:\s*absolute/i.test(text)) g.add('placed')
  if (/writing-mode\s*:/i.test(text)) g.add('vertical')
  if (/grid-column\s*:[^;}]*span|grid-area/i.test(text)) g.add('spanning')
  if (/clip-path|mask-image|mask\s*:/i.test(text)) g.add('cut')
  if (/border-radius\s*:\s*(?:50%|9999px|999px)/i.test(text)) g.add('pill')
  return [...g]
}

function motion(text) {
  const m = new Set()
  if (/@keyframes/i.test(text)) m.add('keyframes')
  if (/transition\s*:/i.test(text)) m.add('transition')
  if (/animation-timeline|view\(\)|scroll\(\)/i.test(text)) m.add('scroll-driven')
  if (/cubic-bezier\(([^)]*)\)/i.test(text)) m.add('custom-ease')
  else if (/\b(ease-in-out|ease-out|ease-in|linear)\b/i.test(text) && m.size) m.add('stock-ease')
  return [...m]
}

/** Everything that identifies a piece's look, with nothing normative in it. */
export function signature(raw, name = '') {
  // A face or a colour named through a token is still the face and the colour on the page.
  const text = resolveVars(raw)
  const counts = new Map()
  for (const raw of text.match(COLOUR_RE) || []) {
    const b = bucketColour(hsl(raw))
    if (b) counts.set(b, (counts.get(b) || 0) + 1)
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  // The GROUND is what the page is painted on, which is a property of one rule rather than of
  // how often a colour is mentioned: a ground declared once covers everything, and an accent
  // repeated in nine rules covers almost nothing. Counting occurrences got this backwards.
  let ground = null
  for (const m of text.matchAll(/(?:^|[\s,{}>])(?:html|body|:root|\.slide|\.post|\.page|\.sheet)\b[^{}]*\{([^{}]*)\}/gi)) {
    const bg = /(?:^|[;\s])background(?:-color)?\s*:\s*([^;}]+)/i.exec(m[1])
    if (!bg) continue
    const first = (bg[1].match(COLOUR_RE) || [])[0]
    const b = first && bucketColour(hsl(first))
    if (b) { ground = b; break }
  }
  if (!ground) ground = ranked[0] || null
  // The accent is the saturated colour that is NOT the ground — the one choice that carries a
  // piece's identity, and the one that repeats without anyone noticing.
  //
  // It is identified by HUE, without the lightness step. A ground's lightness is its identity —
  // cream and charcoal are not the same decision — but two hand-picked oranges a few percent
  // apart are one orange to any eye, and splitting them on a bucket boundary would let the
  // habit this exists to catch walk straight through it.
  const coarse = (k) => (k ? k.replace(/:(\d+)$/, '') : k)
  const pick = ranked.find((k) => k !== ground && /:sat:/.test(k))
    || ranked.find((k) => k !== ground && /:muted:/.test(k)) || null
  const accent = coarse(pick)
  return {
    name,
    palette: ranked.slice(0, 5),
    ground,
    accent,
    faces: faces(text).slice(0, 3),
    grammar: grammar(text),
    motion: motion(text),
  }
}

// ── the comparison ───────────────────────────────────────────────────────────────────────────

const overlap = (a, b) => {
  const B = new Set(b)
  const shared = a.filter((x) => B.has(x))
  const union = new Set([...a, ...b]).size
  return { shared, ratio: union ? shared.length / union : 0 }
}

/** The axes two pieces share. Five axes, each worth naming on its own. */
export function compare(a, b) {
  const axes = []
  if (a.ground && a.ground === b.ground) axes.push({ axis: 'ground', what: a.ground })
  if (a.accent && a.accent === b.accent) axes.push({ axis: 'accent', what: a.accent })
  const f = overlap(a.faces, b.faces)
  if (f.shared.length) axes.push({ axis: 'type', what: f.shared.join(' + ') })
  const g = overlap(a.grammar, b.grammar)
  if (g.ratio >= 0.6 && g.shared.length >= 2) axes.push({ axis: 'layout', what: g.shared.join(', ') })
  const m = overlap(a.motion, b.motion)
  if (m.ratio >= 0.6 && m.shared.length >= 1) axes.push({ axis: 'motion', what: m.shared.join(', ') })
  return { axes, score: axes.length }
}

/** The body of work a folder belongs to. Two folders whose names share a run of two or more
 *  leading words are one project: `harbor-swim-club-deck` and `harbor-swim-club-icons` are an
 *  identity system delivered across fields, not two designs that happen to agree. */
export function projectKey(dir) {
  const name = basename(dir)
  const parts = name.split(/[-_]/).filter(Boolean)
  // Two words is enough to be a name and not a category: `deck` and `icons` share nothing,
  // `harbor-swim-club-deck` and `harbor-swim-club-icons` share three.
  return parts.length >= 3 ? join(dirname(dir), parts.slice(0, parts.length - 1).join('-')) : dir
}

// ── files ────────────────────────────────────────────────────────────────────────────────────

function walk(p, out = [], seen = new Set()) {
  let st
  try { st = statSync(p) } catch { return out }
  const real = (() => { try { return realpathSync(p) } catch { return p } })()
  if (seen.has(real)) return out
  seen.add(real)
  if (st.isDirectory()) {
    let entries = []
    try { entries = readdirSync(p) } catch { return out }
    for (const e of entries) {
      if (e === 'node_modules' || e.startsWith('.') || /-frames$/.test(e)) continue
      walk(join(p, e), out, seen)
    }
  } else if (DESIGN.has(extname(p).toLowerCase())) out.push(p)
  return out
}

/** A piece is judged whole: a page plus the stylesheets it links, as the browser assembles it. */
function readPiece(file) {
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch { return null }
  for (const m of text.matchAll(/<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["']([^"']+)["']/gi)) {
    if (/^(?:https?:)?\/\//i.test(m[1])) continue
    try { text += '\n' + readFileSync(resolve(dirname(file), decodeURIComponent(m[1].split('?')[0])), 'utf8') } catch { /* not ours */ }
  }
  return text
}

const SHIPPED = join(REPO, 'skills', 'design-fields', 'examples')

export function corpusFor(target, extra = []) {
  const files = new Set()
  const t = resolve(target)
  const base = statSync(t).isDirectory() ? t : dirname(t)
  for (const f of walk(base)) files.add(resolve(f))
  for (const dir of extra) for (const f of walk(resolve(dir))) files.add(resolve(f))
  // The corpus is YOUR body of work. Folding this package's own examples in by default would
  // tell a stranger their page resembles a swimming club they have never heard of — a
  // comparison against someone else's taste, which is the opposite of the point. They are
  // included only when the piece being judged is one of them.
  if (!extra.length && t.startsWith(resolve(SHIPPED))) {
    for (const f of walk(SHIPPED)) files.add(resolve(f))
  }
  return [...files]
}

// ── the report ───────────────────────────────────────────────────────────────────────────────

export function judge(targets, corpusFiles) {
  const sigs = new Map()
  const sig = (f) => {
    if (!sigs.has(f)) {
      const text = readPiece(f)
      sigs.set(f, text === null ? null : signature(text, f))
    }
    return sigs.get(f)
  }
  const out = []
  for (const file of targets) {
    const mine = sig(file)
    if (!mine) { out.push({ file, unreadable: true }); continue }
    const others = corpusFiles.filter((f) => resolve(f) !== resolve(file))
    const matches = others.map((f) => {
      const s = sig(f)
      return s ? { file: f, ...compare(mine, s) } : null
    }).filter(Boolean).sort((a, b) => b.score - a.score)
    // A piece in the same PROJECT is supposed to look like itself: a three-post series, and a
    // brand's deck and its icon set, are consistent on purpose, and calling that a repeat is
    // crying wolf at the one place consistency is the job. The habit shows ACROSS projects.
    //
    // A project is a folder — and also a family of folders that share a name. An identity
    // system is delivered as brand-deck, brand-email, brand-icons, and treating those as three
    // separate works would report the very consistency they exist to demonstrate.
    const here = dirname(resolve(file))
    const same = (a, b) => a === b || projectKey(a) === projectKey(b)
    const elsewhere = matches.filter((m) => !same(dirname(resolve(m.file)), here))
    const nearest = elsewhere[0] || null
    const sibling = matches.find((m) => same(dirname(resolve(m.file)), here) && resolve(m.file) !== resolve(file)) || null
    // How many other PROJECTS, not how many other files: ten pages of one site is one look, and
    // "distinct against one other project" is barely evidence of anything. A thin corpus is
    // reported as thin rather than dressed up as a clean bill.
    const projectsSeen = new Set(elsewhere.map((m) => projectKey(dirname(resolve(m.file)))))
    const verdict = !elsewhere.length ? 'alone'
      : !nearest || nearest.score <= 1 ? 'distinct'
        : nearest.score === 2 ? 'familiar'
          : 'repeat'
    out.push({
      file, signature: mine, nearest, sibling, verdict,
      corpus: elsewhere.length, projects: projectsSeen.size,
      thin: projectsSeen.size < 3 && verdict === 'distinct',
    })
  }
  return out
}

function report(results, { quiet = false } = {}) {
  let worst = 'distinct'
  const rank = { alone: 0, distinct: 0, familiar: 1, repeat: 2 }
  for (const r of results) {
    if (r.unreadable) { console.log(`  ${C.yellow}?${C.off}  ${r.file} could not be read`); continue }
    if (rank[r.verdict] > rank[worst]) worst = r.verdict
    if (quiet) continue
    const colour = { alone: C.dim, distinct: C.green, familiar: C.yellow, repeat: C.red }[r.verdict]
    const s = r.signature
    console.log(`\n  ${C.bold}${relative(process.cwd(), r.file) || r.file}${C.off}`)
    console.log(`    ${C.dim}ground ${s.ground || '—'} · accent ${s.accent || '—'} · ${s.faces.join(' + ') || 'no face chosen'}`
      + ` · ${s.grammar.join(' ') || 'no grammar'}${s.motion.length ? ' · ' + s.motion.join(' ') : ''}${C.off}`)
    if (r.verdict === 'alone') {
      console.log(`    ${C.dim}no other project to compare it with — a corpus of one says nothing about whether this is a habit${C.off}`)
      continue
    }
    console.log(`    ${colour}${r.verdict}${C.off} ${C.dim}against ${r.projects} other project(s), ${r.corpus} piece(s)${C.off}`)
    if (r.thin) {
      console.log(`    ${C.yellow}thin evidence${C.off} ${C.dim}— looking unlike one or two other things is not range.`
        + ` This says almost nothing until there is more work to compare against.${C.off}`)
    }
    if (r.nearest && r.nearest.score) {
      console.log(`    ${C.dim}nearest: ${relative(process.cwd(), r.nearest.file) || r.nearest.file}${C.off}`)
      for (const a of r.nearest.axes) console.log(`      ${C.dim}same ${a.axis}: ${a.what}${C.off}`)
    }
  }
  const line = {
    alone: 'Nothing to compare against. Judge it on its own terms.',
    distinct: 'This does not look like the other work here. That is the floor, not proof it is good — and if the corpus is two projects wide, it is barely even the floor.',
    familiar: 'This shares two axes with something you have already made. Deliberate, or a reflex?',
    repeat: 'You have made this before. Three or more of five axes are the same piece wearing a different subject — if the repetition is the identity, say so; if it is not, change the one that carries the most meaning.',
  }[worst]
  console.log(`\n  ${{ alone: C.dim, distinct: C.green, familiar: C.yellow, repeat: C.red }[worst]}${line}${C.off}\n`)
  return worst
}

export function main(argv = process.argv.slice(2)) {
  if (askedForHelp(import.meta.url, argv) || !argv.length) { console.log(HELP); return argv.length ? 0 : 1 }
  const args = { _: [], corpus: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json' || a === '--quiet') args[a.slice(2)] = true
    else if (a === '--corpus') args.corpus.push(argv[++i])
    else if (a.startsWith('--')) { console.error(`distinct: unknown flag ${a}`); return 2 }
    else args._.push(a)
  }
  if (!args._.length) { console.log(HELP); return 1 }
  for (const p of args._) if (!existsSync(resolve(p))) { console.error(`distinct: no such path — ${p}`); return 2 }

  const targets = args._.flatMap((p) => walk(resolve(p)))
  if (!targets.length) { console.error('distinct: nothing to judge — no design files at those paths'); return 2 }
  const corpus = corpusFor(args._[0], args.corpus)
  const results = judge(targets, corpus)
  if (args.json) { console.log(JSON.stringify(results, null, 2)); return 0 }
  const worst = report(results, { quiet: args.quiet })
  return worst === 'repeat' ? 1 : 0
}

const isEntry = (() => {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false }
})()
if (isEntry) process.exit(main())
