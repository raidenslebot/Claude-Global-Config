/**
 * `argo doctor` — run the whole chain and return one prioritised verdict.
 *
 * the other six commands each measure one thing. nobody runs six commands
 * before a fan-out, so in practice nobody measures anything, and the tools stay
 * six good tools that share a repo but not a workflow.
 *
 * this file is only the gathering half: it imports the existing modules (never
 * shells out to itself, never reimplements a rule) and turns the .argo
 * directory into plain facts. every judgement lives in checks.js, which is
 * pure, so the verdict can be tested without a filesystem or a model call.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { analyse } from '../graph/index.js'
import { lint, parseDeclaration } from '../topology/lint.js'
import { listSnapshots, readJson, storeDir } from '../drift/snapshot.js'
import { diagnose, fixPlan, CHECK_ORDER } from './checks.js'

const HELP = `
argo doctor [path] — one command that runs the chain and gives one verdict

  Joins all five measurements into a single prioritised list: the repo graph,
  the declared agent graph, the drift store, the last baseline, and the last
  divergence run.

  Every check reports in one of two states — measured, with the timestamp, or
  never measured. Never measured is an error, not silence: a doctor that prints
  "no problems" because nothing was ever measured is the false-green failure
  this toolkit exists to delete.

options:
  --fix              print the ordered command sequence that closes every
                     open finding (prints only — executes nothing)
  --json             full report as JSON
  --help

exit codes:
  0  no error-severity finding
  1  at least one error-severity finding
  2  bad input (no such path)

examples:
  argo doctor
  argo doctor . --fix
  argo doctor . --json
`.trim()

/** Artifacts doctor reads. Deliberately the real ones — never the .dry-run twins. */
const DECL_NAMES = ['topology.json', 'topology.yaml', 'topology.yml']

export async function run(args) {
  if (args.help) {
    console.log(HELP)
    return 0
  }

  const root = resolve(args._[0] ?? process.cwd())
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`argo doctor: no such directory — ${root}`)
    return 2
  }

  const obs = observe(root)
  const result = diagnose(obs)
  const fixes = fixPlan(result.findings)

  if (args.json) {
    console.log(JSON.stringify({
      root,
      checks: CHECK_ORDER,
      observed: obs,
      counts: result.counts,
      findings: result.findings,
      fix: fixes,
      verdict: result.verdict,
    }, null, 2))
    return result.counts.error > 0 ? 1 : 0
  }

  console.log(renderText(root, obs, result))
  if (args.fix === true) console.log('\n' + renderFix(fixes))

  return result.counts.error > 0 ? 1 : 0
}

/* ------------------------------------------------------------------ *
 * Gathering — facts only, no judgement
 * ------------------------------------------------------------------ */

/**
 * Read every artifact the chain leaves behind, plus one live graph analysis.
 *
 * A missing artifact returns null rather than throwing. That is the whole point:
 * absence is a finding downstream, so it has to survive the read.
 */
export function observe(root) {
  // The live plan is passed to the topology linter so R7 checks the declared
  // fan-out against a width measured today, not against a cached graph.json
  // that may predate both.
  const { plan } = analyse(root)
  return {
    graph: {
      files: plan.stats.files,
      coverage: plan.stats.coverage ?? 1,
      missedRefs: plan.stats.missedRefs ?? 0,
      sharedFiles: plan.sharedSurface.length,
      sharedFraction: plan.sharedFraction,
      recommendedWorkers: plan.recommendedWorkers,
      verdict: plan.verdict,
    },
    topology: observeTopology(root, plan),
    drift: observeDrift(root),
    baseline: observeBaseline(root),
    divergence: observeDivergence(root, 'divergence.json'),
    dryRunDivergence: existsSync(join(root, '.argo', 'divergence.dry-run.json')),
  }
}

function observeTopology(root, plan) {
  let file = null
  for (const dir of [join(root, '.argo'), root]) {
    for (const name of DECL_NAMES) {
      const candidate = join(dir, name)
      if (!file && existsSync(candidate)) file = candidate
    }
  }
  if (!file) return null

  let result
  try {
    result = lint(parseDeclaration(readFileSync(file, 'utf8'), { file }), { plan })
  } catch {
    // A declaration that does not parse is not an absent one, and the two want
    // different fixes — so it reports as present-and-malformed.
    return { path: file, rulesRan: false, errors: 1, warnings: 0, agents: 0, edges: 0 }
  }

  return {
    path: file,
    rulesRan: result.rulesRan,
    errors: result.errors,
    warnings: result.warnings,
    agents: result.stats.agents,
    edges: result.stats.edges,
  }
}

function observeDrift(root) {
  const snapshots = listSnapshots(root).map((s) => ({
    id: s.id,
    capturedAt: s.capturedAt,
    packageVersion: s.packageVersion ?? s.cliVersion ?? null,
    fingerprint: s.fingerprint,
  }))

  const dir = join(storeDir(root), 'selfreports')
  const selfreports = readJsonDir(dir)
    .map(({ data }) => ({
      capturedAt: data.capturedAt ?? null,
      model: data.model ?? null,
      gateCount: (data.gates ?? []).length,
      declaredNone: data.declaredNone === true,
      confidence: data.confidence?.level ?? null,
    }))
    .sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)))

  return { snapshots, selfreports }
}

/**
 * The newest baseline artifact. Newest by filename, because the counter in
 * `baseline-0002.json` is what the writer increments — mtime would reorder the
 * store the moment someone copies a file.
 */
function observeBaseline(root) {
  const rows = readJsonDir(join(root, '.argo'), /^baseline-.*\.json$/)
    .sort((a, b) => b.name.localeCompare(a.name))
  if (rows.length === 0) return null

  const { name, file, data } = rows[0]
  const cmp = data.comparison ?? {}
  return {
    path: file,
    label: cmp.label ?? name,
    at: mtime(file),
    dryRun: cmp.meta?.dryRun === true,
    verdict: cmp.verdict ?? null,
  }
}

function observeDivergence(root, name) {
  const file = join(root, '.argo', name)
  if (!existsSync(file)) return null
  let data
  try {
    data = readJson(file)
  } catch {
    return null
  }
  const w = data.matrix?.worstPair ?? null
  return {
    path: file,
    at: mtime(file),
    mode: data.mode ?? null,
    gate: data.gate ?? null,
    threshold: data.threshold ?? null,
    breaches: (data.breaches ?? []).length,
    worstPair: w
      ? { a: w.a, b: w.b, meanDivergence: w.meanDivergence, maxDivergence: w.maxDivergence }
      : null,
  }
}

/** Every parseable .json in a directory. A corrupt file is skipped, not fatal. */
function readJsonDir(dir, match = /\.json$/) {
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir).sort()) {
    if (!match.test(name)) continue
    const file = join(dir, name)
    try {
      out.push({ name, file, data: readJson(file) })
    } catch {
      // a half-written artifact should not stop the whole checkup
    }
  }
  return out
}

/**
 * When an artifact was written. These files carry no timestamp of their own, so
 * mtime is the only "when" available — and a wrong-looking date is still better
 * than the report implying the number is current.
 */
function mtime(file) {
  try {
    return statSync(file).mtime.toISOString()
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

const BADGE = { error: '[error]', warn: '[warn] ', info: '[info] ', ok: '[ok]   ' }

/** Terminal report. Same shape as the other commands: header, body, one verdict. */
export function renderText(root, obs, result) {
  const L = []
  const c = result.counts

  L.push(`DOCTOR ${root}`)
  L.push(`       ${c.checks} checks · ${CHECK_ORDER.join(', ')}`)
  L.push(`       ${c.error} error · ${c.warn} warn · ${c.info} info · ${c.ok} ok`)
  L.push(`       ${c.neverMeasured} never measured`)
  L.push('')

  L.push('MEASURED what exists on disk, and when it was written')
  L.push(`       topology    ${obs.topology ? obs.topology.path : 'not measured'}`)
  L.push(`       snapshots   ${describeSnapshots(obs.drift.snapshots)}`)
  L.push(`       selfreport  ${obs.drift.selfreports[0]?.capturedAt ?? 'not measured'}`)
  L.push(`       baseline    ${obs.baseline ? `${obs.baseline.at}${obs.baseline.dryRun ? '  (dry-run only)' : ''}` : 'not measured'}`)
  L.push(`       divergence  ${obs.divergence ? obs.divergence.at : obs.dryRunDivergence ? 'dry-run only' : 'not measured'}`)
  L.push('')

  L.push('FINDINGS worst first')
  for (const f of result.findings) {
    L.push(`  ${BADGE[f.severity]} ${f.id}`)
    L.push(`          ${f.title}`)
    for (const line of wrap(f.detail, 76)) L.push(`          ${line}`)
    if (f.fix) L.push(`          fix: ${f.fix}`)
    L.push('')
  }

  L.push(`VERDICT [${result.verdict.level}] ${result.verdict.message}`)
  return L.join('\n')
}

function describeSnapshots(snaps) {
  if (snaps.length === 0) return 'not measured'
  return `${snaps.length} stored · newest ${snaps[0].packageVersion ?? 'unknown'} at ${snaps[0].capturedAt}`
}

/** The ordered close-out. Printed only; nothing here is executed. */
export function renderFix(fixes) {
  const L = []
  L.push('FIX    run these in order, then re-run `argo doctor`. Nothing was executed.')
  if (fixes.length === 0) {
    L.push('       (nothing open)')
    return L.join('\n')
  }
  fixes.forEach((f, i) => {
    L.push('')
    L.push(`  ${String(i + 1).padStart(2)}  ${f.command}`)
    L.push(`      closes ${f.id} [${f.severity}]`)
  })
  return L.join('\n')
}

/** Greedy wrap. The details are prose and a 300-char line is unreadable. */
function wrap(text, width) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines
}
