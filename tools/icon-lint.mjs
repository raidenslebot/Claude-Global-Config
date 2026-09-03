#!/usr/bin/env node
// icon-lint.mjs — an icon SET is judged as a set, not as icons.
//
//   cgc icons ./icons
//   cgc icons ./icons --size 16 --strict
//   cgc icons sprite.svg --json
//
// A single icon is almost never wrong. A set is wrong constantly, and always in the same ways:
// one icon drawn on a 20 grid while the rest are on 24, one at stroke 1.5 among stroke 2, one
// with a hardcoded colour so it cannot be recoloured, one with live text so it depends on a font
// the viewer does not have, one traced from artwork so its coordinates sit between pixels and it
// renders soft at the size it is actually used. None of those is visible when you look at the
// icons one at a time, which is how they are always looked at.
//
// PARSING. This reads SVG with a small scanner rather than an XML parser, and the rule it obeys
// is that **not finding something is never the same as it not being there**. Comments are
// removed before anything is read, so a rejected variant in a comment is not mistaken for live
// artwork and a comment mentioning <symbol> does not turn a plain icon into a sprite. Tags are
// scanned with quote awareness, so an attribute value containing ">" does not truncate the tag.
// A sprite's symbols inherit the root element's attributes and the document's <style>, because
// that is where a set states its rules. A file that yields no icon at all is reported, not
// dropped: a silent omission from a set report is the one thing this must never do.

import { readFileSync, statSync, readdirSync, existsSync, realpathSync } from 'node:fs'
import { join, extname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const C = { dim: '\x1b[2m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', off: '\x1b[0m' }

// ── Scanning ─────────────────────────────────────────────────────────────────────────────────

export const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, ' ')

/** The index just past the end of a tag that starts at `from`, respecting quoted ">". */
function tagEnd(text, from) {
  let quote = null
  for (let i = from; i < text.length; i++) {
    const ch = text[i]
    if (quote) { if (ch === quote) quote = null; continue }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '>') return i + 1
  }
  return -1
}

/** Every occurrence of <name …> in `text`, with its attribute string and its body. */
export function tags(text, name) {
  const out = []
  const open = new RegExp(`<${name}\\b`, 'gi')
  let m
  while ((m = open.exec(text))) {
    const end = tagEnd(text, m.index)
    if (end < 0) break
    const head = text.slice(m.index + name.length + 1, end - 1)
    const selfClosing = /\/\s*$/.test(head)
    let body = ''
    let after = end
    if (!selfClosing) {
      const close = new RegExp(`</${name}\\s*>`, 'gi')
      close.lastIndex = end
      const c = close.exec(text)
      body = c ? text.slice(end, c.index) : text.slice(end)
      after = c ? c.index + c[0].length : text.length
    }
    out.push({ head, body, selfClosing, start: m.index, end: after })
    open.lastIndex = after
  }
  return out
}

export function attr(head, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(head)
  return m ? (m[2] ?? m[3]) : null
}

/** Split a document into icons. A sprite is its symbols; anything else is one icon. */
export function icons(text, name) {
  const clean = stripComments(text)
  const roots = tags(clean, 'svg')
  const root = roots[0]
  // Everything the set states once, at the top: the root attributes and any stylesheet.
  const styles = tags(clean, 'style').map((s) => s.body).join('\n')
  const inherited = (root ? root.head : '') + '\n' + styles

  const symbols = tags(clean, 'symbol')
  if (symbols.length) {
    return symbols.map((s, i) => ({
      name: `${name}#${attr(s.head, 'id') || `symbol ${i + 1}`}`,
      head: s.head,
      body: s.body,
      inherited,
    }))
  }
  if (!root) return []
  return [{ name, head: root.head, body: root.body, inherited: styles }]
}

const NUMBER = /-?(?:\d+\.\d+|\.\d+|\d+(?:\.\d+)?[eE][-+]?\d+|\d+\.\d+[eE][-+]?\d+)/g
const ON_GRID = (n) => {
  const frac = Math.abs(n % 1)
  return frac < 0.001 || Math.abs(frac - 0.5) < 0.001 || Math.abs(frac - 0.25) < 0.001 || Math.abs(frac - 0.75) < 0.001
}
/** A length as a number, whatever unit it is written in. `2px` and `2` are the same weight. */
export const length = (v) => {
  if (v === null || v === undefined) return null
  const m = /^\s*(-?[\d.]+)\s*(px|pt|em|rem)?\s*$/i.exec(String(v))
  return m ? Number(m[1]) : null
}

export function read(icon) {
  const { head, body, inherited = '' } = icon
  const declared = `${inherited}\n${head}`          // what the set and the icon state at the top
  const all = `${declared}\n${body}`

  const box = (attr(head, 'viewBox') || attr(inherited, 'viewBox') || '').trim().split(/[\s,]+/).map(Number)
  const grid = box.length === 4 && box.every(Number.isFinite) ? Math.max(box[2], box[3]) : null

  // Every stroke width anywhere: the root, the stylesheet, an attribute, an inline style.
  const widths = []
  for (const m of all.matchAll(/stroke-width\s*=\s*["']([^"']+)["']|stroke-width\s*:\s*([^;"'}]+)/gi)) {
    const n = length(m[1] ?? m[2])
    if (n !== null && n > 0) widths.push(n)
  }

  const caps = new Set([...all.matchAll(/stroke-linecap\s*[=:]\s*["']?\s*([a-z]+)/gi)].map((m) => m[1].toLowerCase()))
  const joins = new Set([...all.matchAll(/stroke-linejoin\s*[=:]\s*["']?\s*([a-z]+)/gi)].map((m) => m[1].toLowerCase()))

  // A colour that is pinned. Functions that DEFER the colour — url() for a gradient, var() for a
  // token, currentColor — are the opposite of pinned and must never be reported as such.
  const colours = new Set()
  for (const m of all.matchAll(/\b(?:stroke|fill|stop-color|flood-color|lighting-color)\s*[=:]\s*["']?\s*(#[0-9a-f]{3,8}|(?:rgba?|hsla?|oklch|oklab|color)\([^)]*\)|url\([^)]*\)|var\([^)]*\)|[a-z]+)/gi)) {
    const v = m[1].trim().toLowerCase()
    if (/^(?:currentcolor|none|inherit|transparent|unset|initial|context-fill|context-stroke)$/.test(v)) continue
    if (v.startsWith('url(') || v.startsWith('var(')) continue
    colours.add(v)
  }

  const stroked = /\bstroke\s*[=:]/i.test(all) && !/\bstroke\s*[=:]\s*["']?\s*none/i.test(declared)
  const filled = /\bfill\s*[=:]\s*["']?\s*(?!none\b)(?!currentcolor\b)[a-z#(]/i.test(all)

  // Only real geometry counts as coordinates. An opacity of 0.87 is not a traced coordinate.
  const geometry = [...all.matchAll(/\b(?:d|points)\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]).join(' ')
  const nums = (geometry.match(NUMBER) || []).map(Number).filter(Number.isFinite)
  const offGrid = nums.filter((n) => !ON_GRID(n)).length

  return {
    name: icon.name,
    grid,
    viewBox: box.length === 4 ? box.join(' ') : null,
    widths,
    caps: [...caps],
    joins: [...joins],
    colours: [...colours],
    stroked,
    filled,
    text: /<text\b/i.test(body),
    raster: /<image\b/i.test(body) || /data:image\/(?:png|jpe?g|gif|webp)/i.test(all),
    offGrid,
    numbers: nums.length,
  }
}

/** The set's rule, from the majority. A tie has no majority and states no rule. */
const mode = (xs) => {
  const n = new Map()
  for (const x of xs) n.set(x, (n.get(x) || 0) + 1)
  let best = null, count = 0, tied = false
  for (const [k, v] of [...n.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
    if (v > count) { best = k; count = v; tied = false }
    else if (v === count) tied = true
  }
  return { value: tied ? null : best, count, total: xs.length, tied }
}

export function lintSet(read_, { size = 16 } = {}) {
  const findings = []
  const add = (level, id, icon, note) => findings.push({ level, id, icon, note })

  const boxes = mode(read_.map((i) => i.viewBox).filter(Boolean))
  // Two thirds on one grid is a set. Below that these are separate drawings that happen to
  // share a folder, and the questions a set answers are not questions about them.
  const withBox = read_.filter((i) => i.viewBox).length
  const coherent = withBox > 0 && boxes.count / withBox >= 0.66
  const strokes = mode(read_.flatMap((i) => i.widths))
  const caps = mode(read_.flatMap((i) => i.caps))
  const joins = mode(read_.flatMap((i) => i.joins))

  for (const i of read_) {
    if (i.text) add('fail', 'live-text', i.name, 'live <text> depends on a font the viewer may not have, and will reflow or fall back. Convert it to a path (cgc outline) or draw it.')
    if (i.raster) add('fail', 'raster', i.name, 'an embedded bitmap cannot scale, cannot be recoloured and defeats the point of an icon. Draw it.')
    if (!i.viewBox) add('fail', 'no-viewbox', i.name, 'no viewBox, so the icon cannot scale to the box it is given.')
    if (coherent && i.colours.length) add('fail', 'hardcoded-colour', i.name, `colour is pinned (${i.colours.slice(0, 3).join(', ')}) — an icon set uses currentColor, or a var() or gradient it can be handed, so it takes the colour of the text it sits beside.`)

    if (coherent && boxes.value && i.viewBox && i.viewBox !== boxes.value) {
      add('fail', 'off-grid-set', i.name, `viewBox ${i.viewBox} against the set's ${boxes.value} — the whole set has to be drawn on one grid or the weights will never match.`)
    }
    // EVERY width has to belong to the set, not just one of them: an icon that is stroke 2 at
    // the root and 0.4 on two of its paths passed while drawing real hairlines.
    if (coherent && strokes.value !== null && strokes.total > 1) {
      const strays = [...new Set(i.widths.filter((w) => w !== strokes.value))]
      if (strays.length) {
        add('fail', 'stroke-weight', i.name, `stroke ${strays.join(', ')} against the set's ${strokes.value} — a single icon, or a single path inside one, at a different weight reads as a different set.`)
      }
    }
    if (coherent && caps.value && i.caps.length && !i.caps.includes(caps.value)) {
      add('warn', 'linecap', i.name, `stroke-linecap ${i.caps.join('/')} against the set's ${caps.value}.`)
    }
    if (coherent && joins.value && i.joins.length && !i.joins.includes(joins.value)) {
      add('warn', 'linejoin', i.name, `stroke-linejoin ${i.joins.join('/')} against the set's ${joins.value}.`)
    }

    // The THINNEST stroke decides whether this icon survives the size it is used at.
    const thinnest = i.widths.length ? Math.min(...i.widths) : strokes.value
    if (coherent && i.grid && Number.isFinite(thinnest) && thinnest > 0) {
      const rendered = thinnest / i.grid * size
      if (rendered < 1) {
        add('fail', 'thin-at-size', i.name, `stroke ${thinnest} on a ${i.grid} grid renders ${rendered.toFixed(2)}px at ${size}px — under one pixel, so it will be grey and soft. Either thicken the stroke or draw a separate small-size cut.`)
      }
    }

    // Outlined lettering is off-grid by nature — every curve of a letterform is. This asks
    // whether an ICON was drawn on its grid or traced from something else.
    if (coherent && i.numbers >= 8 && i.offGrid / i.numbers > 0.6) {
      add('warn', 'traced', i.name, `${i.offGrid} of ${i.numbers} path coordinates sit off the grid — this looks traced rather than drawn, and lands between pixels at small sizes.`)
    }
  }

  if (!coherent && read_.length > 1) {
    const grids = [...new Set(read_.map((i) => i.viewBox).filter(Boolean))]
    add('warn', 'not-a-set', '(set)', `these ${read_.length} drawings do not share a grid (${grids.slice(0, 4).join(' · ')}${grids.length > 4 ? ' …' : ''}) — that is an identity system or a folder of separate pieces, not an icon set. The set questions were not asked of them: one grid, one stroke weight, currentColor, legible at 16px. Live text, a missing viewBox and an embedded raster still were.`)
  }
  if (coherent && boxes.tied && boxes.total > 1) {
    add('warn', 'no-grid', '(set)', `the set is split evenly between grids (${[...new Set(read_.map((i) => i.viewBox).filter(Boolean))].join(' and ')}), so there is no majority to judge against. Pick one.`)
  }
  const mixed = read_.filter((i) => i.stroked).length && read_.filter((i) => i.filled && !i.stroked).length
  if (coherent && mixed && read_.length > 1) {
    add('warn', 'mixed-idiom', '(set)', 'the set mixes stroked and filled icons — that is a decision when it is one, and an accident when it is two of twelve.')
  }

  return { findings, grid: boxes.value, stroke: strokes.value, count: read_.length }
}

function walk(p, out = [], seen = new Set()) {
  let st
  try { st = statSync(p) } catch { return out }
  if (st.isDirectory()) {
    let key = p
    try { key = realpathSync(p) } catch { /* a dangling link is skipped */ }
    if (seen.has(key)) return out
    seen.add(key)
    let entries = []
    try { entries = readdirSync(p) } catch { return out }
    for (const e of entries) {
      if (e.startsWith('.') || e === 'node_modules') continue
      walk(join(p, e), out, seen)
    }
  } else if (extname(p).toLowerCase() === '.svg') out.push(p)
  return out
}

const HELP = `usage:
  cgc icons <dir|file.svg> [<…>] [--size <px>] [--strict] [--json]

Reads every icon in the set (a sprite's <symbol>s count individually, and inherit the root
element's attributes and the document's <style>), derives what the SET does — its grid, its
stroke weight, its caps and joins — from the majority, and reports every icon that disagrees,
plus the things that are wrong at any size: live text, an embedded bitmap, a missing viewBox, a
hardcoded colour. --size is the size the set is really used at (default 16); the THINNEST stroke
in an icon that renders under one pixel there fails. --strict exits 1 on any failure.

A file that yields no icon is reported, never dropped.
`

export function main(argv = process.argv.slice(2)) {
  const BOOLEAN = new Set(['strict', 'json', 'help'])
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      if (BOOLEAN.has(k)) { args[k] = true; continue }
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[k] = argv[++i]
      else { console.error(`icons: --${k} wants a value`); return 1 }
    } else args._.push(a)
  }
  if (args.help || !args._.length) { console.log(HELP); return args.help ? 0 : 1 }

  const size = args.size === undefined ? 16 : Number(args.size)
  if (!Number.isFinite(size) || size <= 0) { console.error(`icons: --size wants a positive number of pixels, got "${args.size}"`); return 1 }

  const files = []
  for (const p of args._) {
    const abs = resolve(p)
    if (!existsSync(abs)) { console.error(`icons: no such file — ${p}`); return 1 }
    walk(abs, files)
  }
  if (!files.length) { console.error('icons: no .svg files at those paths'); return 1 }

  const parsed = []
  const unreadable = []
  for (const f of [...new Set(files)]) {
    let text
    try { text = readFileSync(f, 'utf8') } catch (e) { unreadable.push({ file: basename(f), why: e.message }); continue }
    const found = icons(text, basename(f))
    if (!found.length) { unreadable.push({ file: basename(f), why: 'no <svg> element could be read from it' }); continue }
    for (const icon of found) parsed.push(read(icon))
  }
  if (!parsed.length && !unreadable.length) { console.error('icons: nothing parsed — are these SVG documents?'); return 1 }

  const r = parsed.length ? lintSet(parsed, { size }) : { findings: [], grid: null, stroke: null, count: 0 }
  // A file that could not be read is a hole in the report, and a hole reads as a pass.
  for (const u of unreadable) {
    r.findings.push({ level: 'fail', id: 'unreadable', icon: u.file, note: `this file is in the set and could not be read as an icon — ${u.why}. It has not been judged, which is not the same as it being fine.` })
  }
  const fails = r.findings.filter((f) => f.level === 'fail')
  const warns = r.findings.filter((f) => f.level === 'warn')

  if (args.json) {
    console.log(JSON.stringify({ ok: fails.length === 0, count: r.count, unreadable: unreadable.length, grid: r.grid, stroke: r.stroke, size, findings: r.findings }, null, 2))
    return fails.length && args.strict ? 1 : 0
  }

  console.log(r.coherent === false
    ? `\n  ${r.count} drawings that do not share a grid — judged as separate pieces, not as a set`
    : `\n  ${r.count} icon${r.count === 1 ? '' : 's'} · grid ${r.grid || '?'} · stroke ${r.stroke ?? 'n/a'} · judged at ${size}px`)
  if (!r.findings.length) {
    // "The set agrees with itself" is true of one icon by arithmetic, and this tool exists
    // because a single icon is almost never wrong while a set is wrong constantly. Saying the
    // vacuous thing reads as a pass on the questions that were never asked.
    console.log(r.count === 1
      ? `  ${C.yellow}one icon is not a set${C.off} — nothing here could disagree with anything. The grid, the`
        + `
  weight, the colour and the small size are questions about a SET; point this at the folder.`
      : `  ${C.green}the set agrees with itself${C.off}`)
    console.log(`  ${C.dim}Now look at the contact sheet at ${size}px: consistency is the floor, and it cannot tell you whether the metaphors are any good.${C.off}\n`)
    return 0
  }
  for (const f of r.findings) {
    const mark = f.level === 'fail' ? `${C.red}✖${C.off}` : `${C.yellow}!${C.off}`
    console.log(`  ${mark} ${f.id.padEnd(17)}${C.bold}${f.icon}${C.off}`)
    console.log(`      ${C.dim}${f.note}${C.off}`)
  }
  console.log(`\n  ${fails.length ? C.red + fails.length + ' failed' + C.off : C.green + 'no failures' + C.off}${warns.length ? ` · ${warns.length} warning${warns.length === 1 ? '' : 's'}` : ''}`)
  console.log(`  ${C.dim}A set is judged as a set. One icon at the wrong weight is not a small problem, it is the whole set looking bought rather than drawn.${C.off}\n`)
  return fails.length && args.strict ? 1 : 0
}

const isEntry = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false } })()
if (isEntry) {
  let code = 1
  try { code = main() } catch (e) { console.error(`icons: ${e.message}`) }
  process.exit(code)
}
