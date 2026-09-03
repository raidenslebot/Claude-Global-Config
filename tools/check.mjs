#!/usr/bin/env node
// check.mjs — the whole loop, in one command.
//
//   cgc check page.html
//   cgc check ./src --strict
//   cgc check card.html --size business-card-us
//
// The loop is mandatory and has five commands in it, which is exactly why it gets run once and
// then remembered as having been run. This runs every gate that applies to the file in front of
// it and prints one verdict with the next action underneath.
//
//   any design file   → techniques   (what it reaches for, and the dimension it never entered)
//   web source        → lint         (the fingerprint of AI-made design)
//   a page            → audit        (the RENDERED page: contrast, fallbacks, measure, widows,
//                                     sideways scroll, tap targets, focus, reduced motion)
//   a page that moves → motion       (the animation stepped and photographed frame by frame)
//   physical units    → print-lint   (what the press would reject)
//   a folder of icons → icons        (the SET judged as a set)
//
// THE ONE RULE THIS FILE OBEYS. A gate that produced nothing has not passed — it has not run.
// Every path where a child crashes, times out, is missing, prints something unparseable, or
// exits non-zero while claiming to be clean, produces a visible row saying so, and that row
// makes --strict non-zero and `ok` false. An absent gate reads as a gate that passed, and a
// summary that implies it is worse than no summary at all.

import { existsSync, statSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join, extname, resolve, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = new Set(['.html', '.htm', '.css', '.scss', '.jsx', '.tsx', '.vue', '.svelte', '.astro'])
const PAGE = new Set(['.html', '.htm'])
const DESIGN = new Set([...WEB, '.svg', '.glsl', '.frag', '.vert', '.wgsl', '.shader', '.hlsl',
  '.swift', '.kt', '.dart', '.cs', '.gd', '.js', '.ts', '.mjs'])

// A page size, named or measured. `size: A4` is the commonest form there is and was invisible.
export const PAGE_SIZE = /@page[^{]*\{[^}]*\bsize\s*:\s*(?:[\d.]+\s*(?:in|mm|cm|pt|q)\b|a[0-9]\b|b[0-9]\b|letter\b|legal\b|ledger\b|tabloid\b|executive\b)/i
// Anything that animates. The library the global stack mandates by default is `animate(…)`
// from motion.dev, which the old pattern could not see at all.
export const MOVES = /@keyframes\b|\banimation(?:-name|-duration)?\s*:|animation-timeline\s*:|\btransition(?:-property|-duration)?\s*:|\banimate\s*\(|\bgsap\s*\.|ScrollTrigger|framer-motion|from\s+["']motion|useSpring|new\s+Animation\s*\(|KeyframeEffect/i
// Below this a file is a fragment — an icon, a partial — and asking a fragment to be ambitious
// is noise. An icon is judged by the set gate instead.
const SUBSTANTIAL = 1200
const CHILD_TIMEOUT = 180000

const C = { dim: '\x1b[2m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', off: '\x1b[0m' }

/** Markup that only TALKS about code is not code: a docs page showing `@page` is not a poster. */
export function withoutQuotedCode(text) {
  return text
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<pre\b[\s\S]*?<\/pre>/gi, ' ')
    .replace(/<code\b[\s\S]*?<\/code>/gi, ' ')
    .replace(/<textarea\b[\s\S]*?<\/textarea>/gi, ' ')
}

function run(tool, args) {
  const path = join(HERE, tool)
  if (!existsSync(path)) {
    return { status: 127, stdout: '', stderr: `${tool} is not installed in ${HERE} — re-run the install`, json: null }
  }
  const r = spawnSync(process.execPath, [path, ...args], { encoding: 'utf8', timeout: CHILD_TIMEOUT, windowsHide: true })
  let json = null
  // A child may print a warning before its JSON; take the first line that parses as an object.
  const out = r.stdout || ''
  try { json = JSON.parse(out) } catch {
    const brace = out.indexOf('{')
    if (brace >= 0) { try { json = JSON.parse(out.slice(brace)) } catch { json = null } }
  }
  const timedOut = Boolean(r.error && /ETIMEDOUT|timed out/i.test(String(r.error.message)))
  return { status: r.status === null ? 1 : r.status, stdout: out, stderr: r.stderr || '', json, timedOut, error: r.error }
}

/** A gate that could not run. Never silent, never counted as a pass. */
export function unavailable(gate, r, why) {
  const reason = why
    || (r.timedOut ? `timed out after ${CHILD_TIMEOUT / 1000}s` : '')
    || (r.stderr || '').split('\n').map((s) => s.trim()).filter(Boolean)[0]
    || (r.status === 127 ? 'the tool is not installed' : `exit ${r.status} with nothing readable on stdout`)
  return {
    gate,
    level: 'skip',
    line: `could not run — ${reason.slice(0, 140)}`,
    next: r.status === 2 ? 'cgc install --only=mcp   (playwright-core ships no browsers of its own)' : '',
  }
}

/** Build a gate row from a child's JSON, or say plainly that there is no result to read. */
export function fromJson(gate, r, build) {
  if (!r.json) return unavailable(gate, r)
  let row
  try { row = build(r.json) } catch (e) { return unavailable(gate, r, `its result could not be read — ${e.message}`) }
  // A child that reports nothing wrong and still exits non-zero has not finished its job.
  if (row.level === 'ok' && r.status !== 0) {
    return unavailable(gate, r, `it reported nothing wrong and then exited ${r.status}, so its result cannot be trusted`)
  }
  return row
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
      if (e === 'node_modules' || e === '.git' || e.startsWith('.')) continue
      walk(join(p, e), out, seen)
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
  motion       a page that animates   the animation stepped and photographed frame by frame
  print-lint   physical units         what the press would reject
  icons        a folder of 3+ SVGs    the set judged as a set: grid, weight, colour, small size

--strict exits 1 if any gate fails OR could not run — a gate that produced nothing has not
passed. --skip takes gate names and may be repeated. --size is passed to print-lint. A directory
is walked, and each folder of three or more SVGs is judged as its own set.
`

export async function main(argv = process.argv.slice(2)) {
  // A boolean flag must not eat the next path: `check --no-mobile page.html` used to check
  // nothing and report that everything was clean.
  const BOOLEAN = new Set(['strict', 'json', 'help', 'no-mobile'])
  const args = { _: [], skip: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      if (BOOLEAN.has(k)) { args[k] = true; continue }
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) { console.error(`check: --${k} wants a value`); return 1 }
      const v = argv[++i]
      if (k === 'skip') args.skip.push(...v.split(',').map((s) => s.trim()).filter(Boolean))
      else args[k] = v
    } else args._.push(a)
  }
  if (args.help || !args._.length) { console.log(HELP); return args.help ? 0 : 1 }
  const skip = new Set(args.skip)

  const files = []
  for (const p of args._) {
    const abs = resolve(p)
    if (!existsSync(abs)) { console.error(`check: no such file — ${p}`); return 1 }
    walk(abs, files)
  }
  const unique = [...new Set(files.map((f) => resolve(f)))]
  if (!unique.length) { console.error('check: nothing to check — no design files at those paths'); return 1 }

  const results = []
  for (const file of unique) {
    const ext = extname(file).toLowerCase()
    const gates = []
    let text
    try { text = readFileSync(file, 'utf8') } catch (e) {
      // A file that cannot be read has not been checked, and must not vanish from the report.
      results.push({ file, gates: [{ gate: 'read', level: 'skip', line: `could not read this file — ${e.message.slice(0, 120)}`, next: '' }] })
      continue
    }
    const physical = PAGE_SIZE.test(withoutQuotedCode(text))
    const sprite = ext === '.svg' && /<symbol\b/i.test(text)
    const moves = MOVES.test(withoutQuotedCode(text))

    if (!skip.has('techniques') && text.length >= SUBSTANTIAL && !sprite) {
      const r = run('techniques.mjs', [file, '--json'])
      const applies = r.json && (WEB.has(ext) || r.json.detected)
      if (applies || !r.json) {
        gates.push(fromJson('techniques', r, (t) => ({
          gate: 'techniques',
          level: t.verdict === 'assembled' ? 'fail' : t.verdict === 'conventional' ? 'warn' : 'ok',
          line: `${t.verdict} · ${t.count} of ${t.pool} · ${(t.media || []).map((m) => m.label).join(' + ') || 'unknown medium'}`,
          next: (t.untouched || []).length
            ? `never entered: ${t.untouched.map((u) => u.dim || u).join(', ')} — decide whether that was a choice (cgc techniques "${file}" --all)`
            : '',
        })))
      }
    }

    if (WEB.has(ext) && !physical && !skip.has('lint')) {
      const r = run('slop-lint.mjs', [file, '--json'])
      gates.push(fromJson('lint', r, (j) => {
        const f = j.files && j.files[0]
        if (!f) throw new Error('no file in the result')
        return {
          gate: 'lint',
          level: f.verdict === 'centroid' ? 'fail' : f.score >= 2 ? 'warn' : 'ok',
          line: `${f.verdict} · score ${f.score} of ${f.max}`,
          next: (f.findings || []).length ? f.findings.slice(0, 3).map((x) => x.id).join(', ') : '',
        }
      }))
    }

    if (physical && !skip.has('print-lint')) {
      const r = run('print-lint.mjs', [file, ...(args.size ? ['--size', String(args.size)] : [])])
      gates.push(r.status === 0
        ? { gate: 'print-lint', level: 'ok', line: 'press-ready', next: '' }
        : r.status === 1
          ? { gate: 'print-lint', level: 'fail', line: 'the press would reject this', next: `cgc print-lint "${file}"${args.size ? ` --size ${args.size}` : ''}` }
          : unavailable('print-lint', r))
    }

    if (PAGE.has(ext) && !physical && !skip.has('audit')) {
      const r = run('page-audit.mjs', [file, '--json', ...(args['no-mobile'] ? [] : ['--mobile'])])
      gates.push(fromJson('audit', r, (j) => {
        const views = j.results || []
        if (!views.length) throw new Error('no viewport was measured')
        const count = (level) => views.reduce((n, v) => n + (v.findings || []).filter((f) => f.level === level).length, 0)
        const fails = count('fail'), warns = count('warn')
        return {
          gate: 'audit',
          level: fails ? 'fail' : warns ? 'warn' : 'ok',
          line: fails ? `${fails} failure${fails === 1 ? '' : 's'}` : warns ? `${warns} warning${warns === 1 ? '' : 's'}` : 'no failures',
          next: fails || warns ? `cgc audit "${file}" --mobile` : '',
        }
      }))
    }

    if (PAGE.has(ext) && !physical && moves && !skip.has('motion')) {
      const r = run('motion-render.mjs', [file, '--json'])
      gates.push(fromJson('motion', r, (j) => {
        const findings = j.findings || []
        const fails = findings.filter((f) => f.level === 'fail')
        return {
          gate: 'motion',
          level: fails.length ? 'fail' : findings.length ? 'warn' : 'ok',
          line: j.easing === 'none' ? 'NOTHING MOVED' : `${j.easing} · settles at ${j.settleMs} ms`,
          next: findings.length
            ? findings.map((f) => f.id).join(', ') + (j.sheet ? ` — look at ${basename(j.sheet)}` : '')
            : (j.sheet ? `look at ${basename(j.sheet)}` : ''),
        }
      }))
    }

    results.push({ file, gates })
  }

  // An icon set is judged as a SET — and a set is a FOLDER. Judging every SVG under a tree as
  // one set failed a logo for disagreeing with icons it has nothing to do with.
  if (!skip.has('icons')) {
    const byFolder = new Map()
    for (const f of unique) {
      if (extname(f).toLowerCase() !== '.svg') continue
      const d = dirname(f)
      byFolder.set(d, (byFolder.get(d) || 0) + 1)
    }
    for (const [folder, count] of [...byFolder.entries()].sort()) {
      if (count < 3) continue
      const r = run('icon-lint.mjs', [folder, '--json'])
      results.push({
        file: `${folder} (as a set)`,
        gates: [fromJson('icons', r, (j) => {
          const findings = j.findings || []
          const fails = findings.filter((f) => f.level === 'fail')
          const warns = findings.filter((f) => f.level === 'warn')
          return {
            gate: 'icons',
            level: fails.length ? 'fail' : warns.length ? 'warn' : 'ok',
            line: `${j.count} icons · grid ${j.grid || '?'} · stroke ${j.stroke ?? 'n/a'} · at ${j.size}px`,
            next: findings.length ? [...new Set(findings.map((f) => f.id))].join(', ') + ` — cgc icons "${folder}"` : '',
          }
        })],
      })
    }
  }

  const all = results.flatMap((r) => r.gates)
  const failed = all.filter((g) => g.level === 'fail')
  const warned = all.filter((g) => g.level === 'warn')
  const skipped = all.filter((g) => g.level === 'skip')
  // A gate that could not run has not passed. `ok` and --strict both say so.
  const ok = failed.length === 0 && skipped.length === 0

  if (args.json) {
    console.log(JSON.stringify({ ok, files: results.length, failed: failed.length, warned: warned.length, skipped: skipped.length, results }, null, 2))
    return ok || !args.strict ? 0 : 1
  }

  for (const r of results) {
    console.log(`\n  ${C.bold}${r.file}${C.off}`)
    if (!r.gates.length) { console.log(`    ${C.dim}no gate applies to this file${C.off}`); continue }
    for (const g of r.gates) {
      const mark = g.level === 'fail' ? `${C.red}✖${C.off}` : g.level === 'warn' ? `${C.yellow}!${C.off}` : g.level === 'skip' ? `${C.yellow}·${C.off}` : `${C.green}✔${C.off}`
      console.log(`    ${mark} ${g.gate.padEnd(11)}${g.line}`)
      if (g.next) console.log(`      ${C.dim}${g.next}${C.off}`)
    }
  }

  console.log('')
  const couldNot = skipped.length ? ` · ${C.yellow}${skipped.length} could not run${C.off}` : ''
  if (failed.length) {
    console.log(`  ${C.red}${failed.length} gate${failed.length === 1 ? '' : 's'} failed${C.off}${warned.length ? ` · ${warned.length} warning${warned.length === 1 ? '' : 's'}` : ''}${couldNot}`)
    console.log(`  ${C.dim}Fix the worst one, then run this again. The first render is never the one shown.${C.off}\n`)
  } else if (skipped.length) {
    console.log(`  ${C.yellow}nothing failed, but ${skipped.length} gate${skipped.length === 1 ? '' : 's'} could not run${C.off}${warned.length ? ` · ${warned.length} warning${warned.length === 1 ? '' : 's'}` : ''}`)
    console.log(`  ${C.dim}That is not a pass. Make them runnable and check again — an unrun gate is the one thing a verdict must never round up.${C.off}\n`)
  } else if (warned.length) {
    console.log(`  ${C.yellow}no failures${C.off} · ${warned.length} warning${warned.length === 1 ? '' : 's'}`)
    console.log(`  ${C.dim}Nothing here is broken. Now look at the render and name the weakest thing yourself — no gate can do that part.${C.off}\n`)
  } else {
    console.log(`  ${C.green}every gate clean${C.off}`)
    console.log(`  ${C.dim}Which is the floor, not the finish. Look at it, name the weakest thing, fix it, run this again — until a professional watching would have nothing left to say.${C.off}\n`)
  }
  return ok || !args.strict ? 0 : 1
}

const isEntry = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false } })()
if (isEntry) main().then((code) => process.exit(code), (e) => { console.error(`check: ${e.message}`); process.exit(1) })
