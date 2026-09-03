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
// So this reads every icon in the set, derives what the SET does, and reports every icon that
// disagrees with it — plus the things that are wrong at any size, and the stroke that will not
// survive the size the set is really used at.

import { readFileSync, statSync, readdirSync, existsSync, realpathSync } from 'node:fs'
import { join, extname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const C = { dim: '\x1b[2m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', off: '\x1b[0m' }

const attr = (s, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"|\\b${name}\\s*=\\s*'([^']*)'`, 'i').exec(s)
  return m ? (m[1] ?? m[2]) : null
}

// Split a sprite into its symbols; a plain icon file is one "icon" with the whole document.
export function icons(text, name) {
  const out = []
  const symbols = [...text.matchAll(/<symbol\b([^>]*)>([\s\S]*?)<\/symbol>/gi)]
  if (symbols.length) {
    for (const s of symbols) {
      const id = attr(s[1], 'id') || `symbol ${out.length + 1}`
      out.push({ name: `${name}#${id}`, head: s[1], body: s[2] })
    }
    return out
  }
  const open = /<svg\b([^>]*)>/i.exec(text)
  if (!open) return out
  out.push({ name, head: open[1], body: text.slice(open.index + open[0].length) })
  return out
}

// What one icon declares. Everything is read from the root attributes first, then from the body,
// because an icon set states its rules once at the top and a stray override is the defect.
export function read(icon) {
  const { head, body } = icon
  const box = (attr(head, 'viewBox') || '').trim().split(/[\s,]+/).map(Number)
  const grid = box.length === 4 && box.every(Number.isFinite) ? Math.max(box[2], box[3]) : null

  const widths = new Set()
  const rootW = attr(head, 'stroke-width')
  if (rootW) widths.add(rootW.trim())
  for (const m of body.matchAll(/stroke-width\s*=\s*["']([^"']+)["']|stroke-width\s*:\s*([^;"'}]+)/gi)) {
    widths.add(String(m[1] ?? m[2]).trim())
  }

  const caps = new Set([attr(head, 'stroke-linecap'), ...[...body.matchAll(/stroke-linecap\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])].filter(Boolean))
  const joins = new Set([attr(head, 'stroke-linejoin'), ...[...body.matchAll(/stroke-linejoin\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])].filter(Boolean))

  // Any colour that is not currentColor or none pins the icon to one palette.
  const colours = new Set()
  for (const m of [head + ' ' + body].join(' ').matchAll(/\b(?:stroke|fill)\s*[=:]\s*["']?\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|[a-z]+)/gi)) {
    const v = m[1].toLowerCase()
    if (v === 'currentcolor' || v === 'none' || v === 'inherit' || v.startsWith('url(')) continue
    colours.add(v)
  }

  const stroked = /stroke\s*[=:]/i.test(head + body) && !/stroke\s*[=:]\s*["']?none/i.test(head)
  const filled = /fill\s*[=:]\s*["']?\s*(?!none)(?!currentcolor)?/i.test(body) || /<(?:circle|rect|path|polygon)\b[^>]*\bfill\s*=\s*["'](?!none)/i.test(body)

  // Coordinates with long decimals are traced artwork, not drawing on the grid: they land
  // between pixels and the icon renders soft at the size it is used.
  const nums = [...body.matchAll(/-?\d+\.\d+/g)].map((m) => m[0])
  const offGrid = nums.filter((n) => {
    const frac = Math.abs(Number(n) % 1)
    return frac > 0.001 && Math.abs(frac - 0.5) > 0.001 && Math.abs(frac - 0.25) > 0.001 && Math.abs(frac - 0.75) > 0.001
  }).length

  return {
    name: icon.name,
    grid,
    viewBox: box.length === 4 ? box.join(' ') : null,
    widths: [...widths],
    caps: [...caps],
    joins: [...joins],
    colours: [...colours],
    stroked,
    filled,
    text: /<text\b/i.test(body),
    raster: /<image\b/i.test(body) || /data:image\/(?:png|jpe?g|gif|webp)/i.test(body),
    offGrid,
    numbers: nums.length,
  }
}

const mode = (xs) => {
  const n = new Map()
  for (const x of xs) n.set(x, (n.get(x) || 0) + 1)
  let best = null, count = 0
  for (const [k, v] of n) if (v > count) { best = k; count = v }
  return { value: best, count, total: xs.length }
}

export function lintSet(read_, { size = 16 } = {}) {
  const findings = []
  const add = (level, id, icon, note) => findings.push({ level, id, icon, note })

  // What the set does, taken from the majority. A set of one has no majority and no consistency
  // to break, so only the absolute rules apply to it.
  const boxes = mode(read_.map((i) => i.viewBox).filter(Boolean))
  const strokes = mode(read_.flatMap((i) => i.widths))
  const caps = mode(read_.flatMap((i) => i.caps))
  const joins = mode(read_.flatMap((i) => i.joins))

  for (const i of read_) {
    if (i.text) add('fail', 'live-text', i.name, 'live <text> depends on a font the viewer may not have, and will reflow or fall back. Convert it to a path (cgc outline) or draw it.')
    if (i.raster) add('fail', 'raster', i.name, 'an embedded bitmap cannot scale, cannot be recoloured and defeats the point of an icon. Draw it.')
    if (!i.viewBox) add('fail', 'no-viewbox', i.name, 'no viewBox, so the icon cannot scale to the box it is given.')
    if (i.colours.length) add('fail', 'hardcoded-colour', i.name, `colour is pinned (${i.colours.slice(0, 3).join(', ')}) — an icon set uses currentColor so it takes the colour of the text it sits beside.`)

    if (boxes.total > 1 && i.viewBox && i.viewBox !== boxes.value) {
      add('fail', 'off-grid-set', i.name, `viewBox ${i.viewBox} against the set's ${boxes.value} — the whole set has to be drawn on one grid or the weights will never match.`)
    }
    if (strokes.total > 1 && i.widths.length && !i.widths.includes(strokes.value)) {
      add('fail', 'stroke-weight', i.name, `stroke ${i.widths.join('/')} against the set's ${strokes.value} — a single icon at a different weight reads as a different set.`)
    }
    if (caps.total > 1 && i.caps.length && !i.caps.includes(caps.value)) {
      add('warn', 'linecap', i.name, `stroke-linecap ${i.caps.join('/')} against the set's ${caps.value}.`)
    }
    if (joins.total > 1 && i.joins.length && !i.joins.includes(joins.value)) {
      add('warn', 'linejoin', i.name, `stroke-linejoin ${i.joins.join('/')} against the set's ${joins.value}.`)
    }

    // The stroke that will not survive the size the set is actually used at.
    const w = Number(i.widths[0] ?? strokes.value)
    if (i.grid && Number.isFinite(w) && w > 0) {
      const rendered = w / i.grid * size
      if (rendered < 1) {
        add('fail', 'thin-at-size', i.name, `stroke ${w} on a ${i.grid} grid renders ${rendered.toFixed(2)}px at ${size}px — under one pixel, so it will be grey and soft. Either thicken the stroke or draw a separate small-size cut.`)
      }
    }

    if (i.numbers >= 8 && i.offGrid / i.numbers > 0.6) {
      add('warn', 'traced', i.name, `${i.offGrid} of ${i.numbers} coordinates sit off the grid — this looks traced rather than drawn, and lands between pixels at small sizes.`)
    }
  }

  const mixed = read_.filter((i) => i.stroked).length && read_.filter((i) => i.filled && !i.stroked).length
  if (mixed && read_.length > 1) {
    add('warn', 'mixed-idiom', '(set)', 'the set mixes stroked and filled icons — that is a decision when it is one, and an accident when it is two of twelve.')
  }

  return { findings, grid: boxes.value, stroke: strokes.value, count: read_.length }
}

function walk(p, out = []) {
  const st = statSync(p)
  if (st.isDirectory()) {
    for (const e of readdirSync(p)) {
      if (e.startsWith('.') || e === 'node_modules') continue
      walk(join(p, e), out)
    }
  } else if (extname(p).toLowerCase() === '.svg') out.push(p)
  return out
}

const HELP = `usage:
  cgc icons <dir|file.svg> [<…>] [--size <px>] [--strict] [--json]

Reads every icon in the set (a sprite's <symbol>s count individually), derives what the SET
does — its grid, its stroke weight, its caps and joins — and reports every icon that disagrees,
plus the things that are wrong at any size: live text, an embedded bitmap, a missing viewBox, a
hardcoded colour. --size is the size the set is really used at (default 16); a stroke that
renders under one pixel there fails. --strict exits 1 on any failure.
`

export function main(argv = process.argv.slice(2)) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) { const k = a.slice(2); if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[k] = argv[++i]; else args[k] = true }
    else args._.push(a)
  }
  if (args.help || !args._.length) { console.log(HELP); return args.help ? 0 : 1 }

  const files = []
  for (const p of args._) {
    const abs = resolve(p)
    if (!existsSync(abs)) { console.error(`icons: no such file — ${p}`); return 1 }
    walk(abs, files)
  }
  if (!files.length) { console.error('icons: no .svg files at those paths'); return 1 }

  const parsed = []
  for (const f of files) {
    let text = ''
    try { text = readFileSync(f, 'utf8') } catch { continue }
    for (const icon of icons(text, basename(f))) parsed.push(read(icon))
  }
  if (!parsed.length) { console.error('icons: nothing parsed — are these SVG documents?'); return 1 }

  const size = Number(args.size) || 16
  const r = lintSet(parsed, { size })
  const fails = r.findings.filter((f) => f.level === 'fail')
  const warns = r.findings.filter((f) => f.level === 'warn')

  if (args.json) {
    console.log(JSON.stringify({ ok: fails.length === 0, count: r.count, grid: r.grid, stroke: r.stroke, size, findings: r.findings }, null, 2))
    return fails.length && args.strict ? 1 : 0
  }

  console.log(`\n  ${r.count} icon${r.count === 1 ? '' : 's'} · grid ${r.grid || '?'} · stroke ${r.stroke || 'n/a'} · judged at ${size}px`)
  if (!r.findings.length) {
    console.log(`  ${C.green}the set agrees with itself${C.off}`)
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
if (isEntry) process.exit(main())
