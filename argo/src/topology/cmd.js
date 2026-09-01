/** `argo topology` — declare the agent graph, lint it, render it. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { analyse } from '../graph/index.js'
import { lint, normalise, parseDeclaration, TopologyError } from './lint.js'
import { renderDot, renderMermaid } from './render.js'
import { buildDeclaration } from './init.js'

const HELP = `
argo topology — make the agent graph an explicit, lintable artifact

  Every edge between two agents is a channel a mistake can travel down. Most
  fleets have never written their graph down, so nobody can say which edges
  exist — and the edges that do the damage are the accidental ones.

usage:
  argo topology lint   [FILE] [--json]
  argo topology render [FILE] [--format mermaid|dot] [--out FILE]
  argo topology init   [PATH] [--workers N] [--out FILE] [--force] [--json]

  FILE defaults to .argo/topology.json (also .argo/topology.yaml — a flat YAML
  subset; anything fancier should be JSON).

rules:
  R1  exactly one supervisor over every worker  (opt out: allowMultipleSupervisors)
  R2  no peer edges unless the edge carries a "justification"
  R3  no cycles among dispatch edges
  R4  every worker has exactly one report path to a supervisor
  R5  shared state with more than one writer is flagged
  R6  no orphan agents
  R7  fan-out no wider than the repo's shared surface supports
  R8  no two agents claiming overlapping writes
  R9  no agent claiming an agentType nothing ships

  lint exits 1 when any finding is error-severity.

options:
  --json             machine-readable output
  --format FORMAT    render as mermaid (default) or dot
  --out FILE         write output to FILE instead of stdout
  --workers N        force the worker count for init (default: measured sweep)
  --max-workers N    upper bound for the init sweep                        [12]
  --force            let init overwrite an existing declaration

examples:
  argo graph . --json --out .argo/graph.json   # gives R7 a real width to check
  argo topology init .
  argo topology lint
  argo topology render --format dot --out .argo/topology.dot
`.trim()

const SUBCOMMANDS = new Set(['lint', 'render', 'init'])
const DECL_NAMES = ['topology.json', 'topology.yaml', 'topology.yml']

export async function run(args) {
  if (args.help) {
    console.log(HELP)
    return 0
  }

  const first = args._[0]
  const sub = SUBCOMMANDS.has(first) ? first : 'lint'
  const rest = SUBCOMMANDS.has(first) ? args._.slice(1) : args._

  if (sub === 'init') return runInit(args, rest)
  if (sub === 'render') return runRender(args, rest)
  return runLint(args, rest)
}

/* ------------------------------------------------------------------ *
 * Locating things on disk
 * ------------------------------------------------------------------ */

function findDeclaration(explicit) {
  if (typeof explicit === 'string' && explicit) {
    const target = resolve(explicit)
    return existsSync(target) ? target : null
  }
  for (const dir of [join(process.cwd(), '.argo'), process.cwd()]) {
    for (const name of DECL_NAMES) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/**
 * R7 is only worth much when it has a measured width to check against, which is
 * what `argo graph --json --out .argo/graph.json` leaves behind. Absent, the rule
 * falls back to a soft warning and says so.
 */
function loadPlan(declPath) {
  const candidates = [
    join(dirname(declPath), 'graph.json'),
    join(process.cwd(), '.argo', 'graph.json'),
  ]
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      const plan = JSON.parse(readFileSync(candidate, 'utf8'))
      if (Number.isFinite(plan?.recommendedWorkers)) return { plan, path: candidate }
    } catch {
      // A corrupt cache is not a reason to refuse to lint the declaration.
    }
  }
  return { plan: null, path: null }
}

function readDeclaration(file) {
  return parseDeclaration(readFileSync(file, 'utf8'), { file })
}

function missing(file) {
  if (file) console.error(`argo topology: no such file — ${resolve(file)}`)
  else console.error('argo topology: no declaration found (looked for .argo/topology.json|.yaml|.yml).')
  console.error('  run `argo topology init .` to generate one from the repo.')
  return 2
}

function writeOut(target, text, label) {
  const out = resolve(target)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, text.endsWith('\n') ? text : text + '\n', 'utf8')
  console.log(`${label}: wrote ${out}`)
}

/* ------------------------------------------------------------------ *
 * lint
 * ------------------------------------------------------------------ */

function runLint(args, rest) {
  const file = findDeclaration(rest[0])
  if (!file) return missing(rest[0])

  let raw
  try {
    raw = readDeclaration(file)
  } catch (err) {
    if (err instanceof TopologyError) {
      console.error(`argo topology lint: ${file}\n  ${err.message}`)
      return 2
    }
    throw err
  }

  const { plan, path: planPath } = loadPlan(file)
  const result = lint(raw, { plan })

  if (args.json) {
    console.log(JSON.stringify({
      file,
      graphSource: planPath,
      name: result.name,
      stats: result.stats,
      findings: result.findings,
      errors: result.errors,
      warnings: result.warnings,
      ok: result.ok,
    }, null, 2))
  } else {
    console.log(renderLintText(result, file, planPath))
  }

  return result.errors > 0 ? 1 : 0
}

/** Terminal report. Same shape as `argo graph`: header, body, one verdict line. */
function renderLintText(result, file, planPath) {
  const L = []
  const s = result.stats
  const kinds = Object.entries(s.byKind)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`)
    .join(', ')

  L.push(`TOPOLOGY ${result.name || '(unnamed)'}`)
  L.push(`         ${file}`)
  L.push(
    `         ${s.agents} agents (${s.supervisors} supervisor, ${s.workers} worker) · ` +
      `${s.edges} edges${kinds ? ` (${kinds})` : ''} · ${s.sharedState} shared state`
  )
  L.push(
    planPath
      ? `         fan-out width checked against ${planPath}`
      : `         no .argo/graph.json — R7 falls back to a soft limit; run \`argo graph . --json --out .argo/graph.json\``
  )
  L.push('')

  L.push('RULES    R1 supervision · R2 peer edges · R3 dispatch cycles · R4 report paths')
  L.push('         R5 shared writers · R6 orphans · R7 fan-out width · R8 write collisions')
  L.push('         R9 unknown agentType')
  L.push('')

  if (result.findings.length === 0) {
    L.push('FINDINGS none — every declared edge is one somebody chose.')
  } else {
    L.push('FINDINGS')
    for (const f of result.findings) {
      L.push(`  ${`[${f.severity}]`.padEnd(8)} ${f.rule}  ${f.message}`)
      L.push(`           ${' '.repeat(f.rule.length)}  fix: ${f.fix}`)
    }
  }
  L.push('')

  if (!result.rulesRan) {
    L.push('VERDICT [malformed] the declaration does not parse into a graph; rules R1-R9 did not run.')
  } else if (result.errors > 0) {
    L.push(
      `VERDICT [fail] ${result.errors} error(s), ${result.warnings} warning(s). ` +
        'Each error is a channel that will carry a mistake further than you meant it to go.'
    )
  } else if (result.warnings > 0) {
    L.push(
      `VERDICT [pass] 0 errors, ${result.warnings} warning(s). ` +
        'The graph is safe to run; the warnings are the edges worth re-reading at the next review.'
    )
  } else {
    L.push('VERDICT [clean] no findings. Every edge in this fleet is one somebody chose on purpose.')
  }

  return L.join('\n')
}

/* ------------------------------------------------------------------ *
 * render
 * ------------------------------------------------------------------ */

function runRender(args, rest) {
  const file = findDeclaration(rest[0])
  if (!file) return missing(rest[0])

  const format = typeof args.format === 'string' ? args.format.toLowerCase() : 'mermaid'
  if (format !== 'mermaid' && format !== 'dot') {
    console.error(`argo topology render: unknown format "${format}" (use mermaid or dot).`)
    return 2
  }

  let raw
  try {
    raw = readDeclaration(file)
  } catch (err) {
    if (err instanceof TopologyError) {
      console.error(`argo topology render: ${file}\n  ${err.message}`)
      return 2
    }
    throw err
  }

  // Render the normalised graph, so a diagram of a broken file still draws the
  // parts that are readable instead of throwing.
  const { decl } = normalise(raw)
  const output = format === 'dot' ? renderDot(decl) : renderMermaid(decl)

  if (typeof args.out === 'string' && args.out) writeOut(args.out, output, 'argo topology render')
  else console.log(output)

  return 0
}

/* ------------------------------------------------------------------ *
 * init
 * ------------------------------------------------------------------ */

function runInit(args, rest) {
  const root = resolve(rest[0] ?? process.cwd())
  if (!existsSync(root)) {
    console.error(`argo topology init: no such path — ${root}`)
    return 2
  }

  const { plan } = analyse(root, {
    workers: typeof args.workers === 'number' ? args.workers : undefined,
    maxWorkers: typeof args['max-workers'] === 'number' ? args['max-workers'] : 12,
  })

  if (plan.stats.files === 0) {
    console.error(`argo topology init: no recognised source files under ${root}`)
    return 1
  }

  const decl = buildDeclaration(plan, { name: `${basename(root)} fleet` })
  const text = JSON.stringify(decl, null, 2)
  const check = lint(decl, { plan })

  if (args.json) {
    console.log(text)
    return check.errors > 0 ? 1 : 0
  }

  const target = typeof args.out === 'string' && args.out
    ? resolve(args.out)
    : join(root, '.argo', 'topology.json')

  if (existsSync(target) && args.force !== true) {
    console.error(`argo topology init: ${target} already exists. Pass --force to overwrite.`)
    return 1
  }

  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, text + '\n', 'utf8')

  const workers = decl.agents.length - 1
  console.log(
    `argo topology init: ${workers} workers under 1 supervisor, from ${plan.stats.files} files ` +
      `(${plan.sharedSurface.length} in the shared surface, declared read-only)`
  )
  console.log(`argo topology init: wrote ${target}`)
  console.log(
    check.errors > 0
      ? `argo topology init: WARNING the generated file has ${check.errors} lint error(s) — run \`argo topology lint\``
      : `argo topology init: lints clean (${check.warnings} warning(s))`
  )
  return check.errors > 0 ? 1 : 0
}
