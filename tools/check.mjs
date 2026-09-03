#!/usr/bin/env node
// check.mjs — the whole loop, in one command.
//
//   cgc check page.html
//   cgc check ./src --strict
//   cgc check card.html --size business-card-us
//
// The loop is mandatory and has four or five commands in it, which is exactly why it gets run
// once and then remembered as having been run. This runs every gate that applies to the file in
// front of it, in the right order, and prints one verdict with the next action underneath.
//
// It decides what applies from the file itself, not from a flag:
//
//   any design file   → techniques   (what it reaches for, and the dimension it never entered)
//   web source        → lint         (the fingerprint of AI-made design)
//   a page            → audit        (the RENDERED page: contrast, fallbacks, measure, widows,
//                                     sideways scroll, tap targets, focus, reduced motion)
//   a page that moves → motion       (the animation stepped and photographed frame by frame)
//   physical units    → print-lint   (what the press would reject)
//
// Nothing here is new work: it is the existing gates, run together, so that "did you run the
// loop" has one answer instead of five.

import { existsSync, statSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join, extname, resolve, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = new Set(['.html', '.htm', '.css', '.scss', '.jsx', '.tsx', '.vue', '.svelte', '.astro'])
const PAGE = new Set(['.html', '.htm'])
const DESIGN = new Set([...WEB, '.svg', '.glsl', '.frag', '.vert', '.wgsl', '.shader', '.hlsl',
  '.swift', '.kt', '.dart', '.cs', '.gd', '.js', '.ts', '.mjs'])

const PHYSICAL = /@page\s*\{[^}]*\bsize\s*:\s*[\d.]+\s*(?:in|mm|cm|pt)\b/i
const MOVES = /@keyframes\b|\banimation\s*:|animation-timeline\s*:|\btransition\s*:\s*[a-z-]+\s+[\d.]|\.animate\s*\(|\bgsap\s*\.|framer-motion/i

const C = { dim: '\x1b[2m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', off: '\x1b[0m' }

function run(tool, args) {
  const r = spawnSync(process.execPath, [join(HERE, tool), ...args], { encoding: 'utf8', timeout: 180000, windowsHide: true })
  let json = null
  try { json = JSON.parse(r.stdout) } catch { /* not every tool is asked for JSON */ }
  return { status: r.status === null ? 1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '', json }
}

// A gate that cannot run says so. It is never simply absent, because an absent gate reads as a
// gate that passed — which is the one thing a summary must never imply.
function unavailable(gate, r) {
  const why = (r.stderr || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || `exit ${r.status}`
  return {
    gate,
    level: 'skip',
    line: `could not run — ${why.slice(0, 120)}`,
    next: r.status === 2 ? 'cgc install --only=mcp   (playwright-core ships no browsers of its own)' : '',
  }
}

function walk(p, out = []) {
  const st = statSync(p)
  if (st.isDirectory()) {
    for (const e of readdirSync(p)) {
      if (e === 'node_modules' || e === '.git' || e.startsWith('.')) continue
      walk(join(p, e), out)
    }
  } else if (DESIGN.has(extname(p).toLowerCase())) out.push(p)
  return out
}

const HELP = `usage:
  cgc check <file|dir> [<file|dir>…] [--no-mobile] [--size <preset>] [--strict] [--json] [--skip <gate,…>]

Runs every gate that applies to what it is given, in order, and prints one verdict:

  techniques   every design file      what it reaches for, and the dimension it never entered
  lint         web source             the fingerprint of AI-made design
  audit        a page                 the RENDERED page measured, at desktop and phone
  icons        a folder of 3+ SVGs    the set judged as a set: grid, weight, colour, small size
  motion       a page that animates   the animation stepped and photographed frame by frame
  print-lint   physical units         what the press would reject

--strict exits 1 if any gate fails. --skip takes gate names. --size is passed to print-lint.
A directory is walked; each page is checked on its own, and the summary is for all of them.
`

export async function main(argv = process.argv.slice(2)) {
  const args = { _: [], skip: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) { const k = a.slice(2); if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[k] = argv[++i]; else args[k] = true }
    else args._.push(a)
  }
  if (args.help || !args._.length) { console.log(HELP); return args.help ? 0 : 1 }
  const skip = new Set(String(args.skip || '').split(',').map((s) => s.trim()).filter(Boolean))

  const files = []
  for (const p of args._) {
    const abs = resolve(p)
    if (!existsSync(abs)) { console.error(`check: no such file — ${p}`); return 1 }
    walk(abs, files)
  }
  if (!files.length) { console.error('check: nothing to check — no design files at those paths'); return 1 }

  const results = []
  for (const file of files) {
    const ext = extname(file).toLowerCase()
    let text = ''
    try { text = readFileSync(file, 'utf8') } catch { continue }
    const physical = PHYSICAL.test(text)
    // A sprite is how a set is delivered, not a piece in its own right: the icons gate judges it.
    const sprite = ext === '.svg' && /<symbol\b/i.test(text)
    const gates = []

    // Below this a file is a fragment — an icon, a partial, a snippet — and asking a fragment
    // to be ambitious is noise. An icon is judged by the set gate instead.
    if (!skip.has('techniques') && text.length >= 1200 && !sprite) {
      const r = run('techniques.mjs', [file, '--json'])
      const t = r.json
      const applies = t && (WEB.has(ext) || t.detected)
      if (applies) {
        gates.push({
          gate: 'techniques',
          level: t.verdict === 'assembled' ? 'fail' : t.verdict === 'conventional' ? 'warn' : 'ok',
          line: `${t.verdict} · ${t.count} of ${t.pool} · ${t.media.map((m) => m.label).join(' + ')}`,
          next: t.untouched.length
            ? `never entered: ${t.untouched.map((u) => u.dim || u).join(', ')} — decide whether that was a choice (cgc techniques "${file}" --all)`
            : '',
        })
      }
    }

    if (WEB.has(ext) && !physical && !skip.has('lint')) {
      const r = run('slop-lint.mjs', [file, '--json'])
      const f = r.json && r.json.files && r.json.files[0]
      if (f) {
        gates.push({
          gate: 'lint',
          level: f.verdict === 'centroid' ? 'fail' : f.score >= 2 ? 'warn' : 'ok',
          line: `${f.verdict} · score ${f.score} of ${f.max}`,
          next: f.findings.length ? f.findings.slice(0, 3).map((x) => x.id).join(', ') : '',
        })
      }
    }

    if (physical && !skip.has('print-lint')) {
      const r = run('print-lint.mjs', [file, ...(args.size ? ['--size', String(args.size)] : [])])
      gates.push({
        gate: 'print-lint',
        level: r.status === 0 ? 'ok' : 'fail',
        line: r.status === 0 ? 'press-ready' : 'the press would reject this',
        next: r.status === 0 ? '' : `cgc print-lint "${file}"${args.size ? ` --size ${args.size}` : ''}`,
      })
    }

    if (PAGE.has(ext) && !physical && !skip.has('audit')) {
      const r = run('page-audit.mjs', [file, '--json', ...(args['no-mobile'] ? [] : ['--mobile'])])
      const j = r.json
      if (j) {
        const fails = (j.results || []).reduce((n, v) => n + (v.findings || []).filter((f) => f.level === 'fail').length, 0)
        const warns = (j.results || []).reduce((n, v) => n + (v.findings || []).filter((f) => f.level === 'warn').length, 0)
        gates.push({
          gate: 'audit',
          level: fails ? 'fail' : warns ? 'warn' : 'ok',
          line: fails ? `${fails} failure${fails === 1 ? '' : 's'}` : warns ? `${warns} warning${warns === 1 ? '' : 's'}` : 'no failures',
          next: fails || warns ? `cgc audit "${file}" --mobile` : '',
        })
      } else {
        gates.push(unavailable('audit', r))
      }
    }

    if (PAGE.has(ext) && !physical && MOVES.test(text) && !skip.has('motion')) {
      const r = run('motion-render.mjs', [file, '--json'])
      const j = r.json
      if (j) {
        const fails = (j.findings || []).filter((f) => f.level === 'fail')
        gates.push({
          gate: 'motion',
          level: fails.length ? 'fail' : (j.findings || []).length ? 'warn' : 'ok',
          line: j.easing === 'none' ? 'NOTHING MOVED' : `${j.easing} · settles at ${j.settleMs} ms`,
          next: (j.findings || []).length ? (j.findings.map((f) => f.id).join(', ') + ` — look at ${basename(j.sheet)}`) : `look at ${basename(j.sheet)}`,
        })
      } else {
        gates.push(unavailable('motion', r))
      }
    }

    results.push({ file, gates })
  }

  // An icon set is the one thing here that is judged as a SET rather than a file: a single icon
  // is almost never wrong, and a set is wrong constantly. So a directory holding three or more
  // SVGs gets one more gate, over the whole folder.
  if (!skip.has('icons')) {
    for (const p of args._) {
      const abs = resolve(p)
      let isDir = false
      try { isDir = statSync(abs).isDirectory() } catch { continue }
      if (!isDir) continue
      const svgs = walk(abs).filter((f) => extname(f).toLowerCase() === '.svg')
      if (svgs.length < 3) continue
      const r = run('icon-lint.mjs', [abs, '--json', ...(args.size ? [] : [])])
      const j = r.json
      if (!j) continue
      const fails = (j.findings || []).filter((f) => f.level === 'fail')
      const warns = (j.findings || []).filter((f) => f.level === 'warn')
      results.push({
        file: abs + ' (as a set)',
        gates: [{
          gate: 'icons',
          level: fails.length ? 'fail' : warns.length ? 'warn' : 'ok',
          line: `${j.count} icons · grid ${j.grid || '?'} · stroke ${j.stroke || 'n/a'} · at ${j.size}px`,
          next: fails.length || warns.length
            ? [...new Set((j.findings || []).map((f) => f.id))].join(', ') + ` — cgc icons "${abs}"`
            : '',
        }],
      })
    }
  }

  const all = results.flatMap((r) => r.gates)
  const failed = all.filter((g) => g.level === 'fail')
  const warned = all.filter((g) => g.level === 'warn')
  const skipped = all.filter((g) => g.level === 'skip')

  if (args.json) {
    console.log(JSON.stringify({ ok: failed.length === 0, files: results.length, failed: failed.length, warned: warned.length, skipped: skipped.length, results }, null, 2))
    return failed.length && args.strict ? 1 : 0
  }

  for (const r of results) {
    console.log(`\n  ${C.bold}${r.file}${C.off}`)
    if (!r.gates.length) { console.log(`    ${C.dim}no gate applies to this file${C.off}`); continue }
    for (const g of r.gates) {
      const mark = g.level === 'fail' ? `${C.red}✖${C.off}` : g.level === 'warn' ? `${C.yellow}!${C.off}` : g.level === 'skip' ? `${C.dim}·${C.off}` : `${C.green}✔${C.off}`
      console.log(`    ${mark} ${g.gate.padEnd(11)}${g.line}`)
      if (g.next) console.log(`      ${C.dim}${g.next}${C.off}`)
    }
  }

  console.log('')
  if (failed.length) {
    console.log(`  ${C.red}${failed.length} gate${failed.length === 1 ? '' : 's'} failed${C.off}${warned.length ? ` · ${warned.length} warning${warned.length === 1 ? '' : 's'}` : ''}`)
    console.log(`  ${C.dim}Fix the worst one, then run this again. The first render is never the one shown.${C.off}\n`)
  } else if (warned.length) {
    console.log(`  ${C.yellow}no failures${C.off} · ${warned.length} warning${warned.length === 1 ? '' : 's'}${skipped.length ? ` · ${skipped.length} could not run` : ''}`)
    console.log(`  ${C.dim}Nothing here is broken. Now look at the render and name the weakest thing yourself — no gate can do that part.${C.off}\n`)
  } else {
    console.log(`  ${C.green}every gate clean${C.off}${skipped.length ? ` ${C.yellow}· ${skipped.length} could not run${C.off}` : ''}`)
    console.log(`  ${C.dim}Which is the floor, not the finish. Look at it, name the weakest thing, fix it, run this again — until a professional watching would have nothing left to say.${C.off}\n`)
  }
  return failed.length && args.strict ? 1 : 0
}

const isEntry = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false } })()
if (isEntry) main().then((code) => process.exit(code), (e) => { console.error(`check: ${e.message}`); process.exit(1) })
