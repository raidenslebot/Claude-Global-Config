/**
 * `argo baseline` — solo vs crew on a real task list.
 *
 * the control is a single agent doing the same work. it is the only thing that
 * can tell you whether a fan-out is buying capability or just spending more to
 * do worse, and it is the first thing every fleet stops running.
 */

import { writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { loadTasks } from './tasks.js'
import { buildComparison } from './verdict.js'
import { renderText, nextRunLabel } from './report.js'
import { runArm, resolveClaudeBin, describeInvocation, buildPrompt, armFailure } from './runner.js'

const HELP = `
argo baseline --tasks FILE — is the crew earning its calls on this task list

  Runs every task twice: once SOLO (one agent, no delegation) and once CREWED
  (supervisor + N workers), then reports the raw delta AND the error
  amplification — of the tasks solo already had right, how many did the crew
  break. A crew that fixes 2 and breaks 5 looks like progress on a raw score.

options:
  --tasks FILE       JSON array of { id, prompt, check }             (required)
  --workers N        crew width                                            [3]
  --model ID         pin a model (claude-opus-5, claude-sonnet-5, ...)
  --repeats N        runs per task per arm; a strict majority decides       [1]
  --concurrency N    probes in flight per arm                               [4]
  --timeout MS       per-probe timeout                                 [180000]
  --cwd DIR          working dir for checks and for .argo artifacts      [cwd]
  --seed N           seed for --dry-run simulation                      [1337]
  --label NAME       artifact label (default: next counter under .argo)
  --dry-run          simulate deterministically; spawns nothing, spends nothing
  --strict           exit 1 when the verdict is crew-subtracts
  --json             machine-readable comparison
  --out FILE         write the chosen output to FILE instead of stdout

check types:
  { "type": "contains",    "value": "...", "ignoreCase": false }
  { "type": "regex",       "pattern": "...", "flags": "i" }
  { "type": "file_exists", "path": "relative/to/--cwd" }
  { "type": "command",     "run": "npm test", "expectExit": 0 }

examples:
  argo baseline --tasks tasks.json --dry-run
  argo baseline --tasks tasks.json --workers 5 --repeats 3 --model claude-sonnet-5
  argo baseline --tasks tasks.json --json --out .argo/baseline.json --strict

env:
  ARGO_CLAUDE_BIN    full path to the claude executable, if it is not on PATH
`.trim()

export async function run(args) {
  if (args.help) {
    console.log(HELP)
    return 0
  }

  const tasksFile = args.tasks ?? args._[0]
  if (!tasksFile || tasksFile === true) {
    console.error('argo baseline: --tasks FILE is required (JSON array of { id, prompt, check })\n')
    console.log(HELP)
    return 2
  }

  let loaded
  try {
    loaded = loadTasks(String(tasksFile))
  } catch (err) {
    console.error(`argo baseline: ${err.message}`)
    return 2
  }
  if (loaded.tasks.length === 0) {
    console.error(`argo baseline: no usable tasks in ${loaded.path}`)
    for (const e of loaded.errors) console.error(`  ${e}`)
    return 2
  }

  const dryRun = args['dry-run'] === true
  // `--cwd` with no value parses as `true`; resolve() would throw on it. Every
  // other string flag here is guarded the same way.
  const cwd = resolve(args.cwd && args.cwd !== true ? String(args.cwd) : process.cwd())
  const workers = Math.max(2, Number(args.workers) || 3)
  const repeats = Math.max(1, Number(args.repeats) || 1)
  const opts = {
    workers,
    repeats,
    concurrency: Math.max(1, Number(args.concurrency) || 4),
    model: typeof args.model === 'string' ? args.model : null,
    timeout: Math.max(1000, Number(args.timeout) || 180_000),
    cwd,
    dryRun,
    seed: Number.isFinite(Number(args.seed)) && args.seed !== true ? Number(args.seed) : 1337,
    bin: dryRun ? null : resolveClaudeBin(),
  }

  // What a real run would do, stated before it does it (and instead of it, under --dry-run).
  const sample = loaded.tasks[0]
  const preview = ['solo', 'crew'].map((arm) => ({
    arm,
    command: describeInvocation({
      bin: opts.bin ?? resolveClaudeBin(),
      model: opts.model,
      promptLength: buildPrompt(sample, arm, workers).length,
    }),
  }))
  const probeCount = loaded.tasks.length * repeats * 2

  if (!args.json) {
    console.log(dryRun ? 'DRY RUN   would invoke, once per task per arm:' : 'RUNNING   invoking, once per task per arm:')
    for (const p of preview) console.log(`          ${p.arm}  ${p.command}`)
    console.log(
      `          ${loaded.tasks.length} tasks x ${repeats} repeat(s) x 2 arms = ${probeCount} probes` +
        `${dryRun ? ' (none of them real)' : `, up to ${opts.concurrency} in flight`}`
    )
    console.log('')
  }

  // Arms run one after the other so the second arm never competes with the first
  // for rate limit; probes inside an arm are pooled.
  // No arm, no verdict. Scoring an arm that never reached a model as "all tasks
  // failed" would produce a confident comparison out of an empty column — and it
  // is the CREW arm that is most likely to hit this, because it runs second and
  // inherits any outage that started during the control.
  const soloRuns = await runArm({ arm: 'solo', tasks: loaded.tasks, opts })
  const soloDead = armFailure(soloRuns, 'solo')
  if (soloDead) return reportArmFailure(soloDead)

  const crewRuns = await runArm({ arm: 'crew', tasks: loaded.tasks, opts })
  const crewDead = armFailure(crewRuns, 'crew')
  if (crewDead) return reportArmFailure(crewDead)

  const label = args.label && args.label !== true
    ? String(args.label)
    : nextRunLabel(listArgoFiles(cwd))

  const probeErrors = [...soloRuns, ...crewRuns]
    .filter((r) => r.error)
    .map((r) => `${r.arm}/${r.id}#${r.repeat}: ${r.error}`)

  const cmp = buildComparison({
    soloRuns,
    crewRuns,
    workers,
    label,
    meta: {
      tasksFile: loaded.path,
      repeats,
      model: opts.model,
      dryRun,
      seed: opts.seed,
      stamp: args.stamp && args.stamp !== true ? String(args.stamp) : null,
      taskErrors: loaded.errors,
      probeErrors,
    },
  })

  const artifact = persist(cwd, label, { comparison: cmp, preview, runs: { solo: soloRuns, crew: crewRuns } })

  const output = args.json
    ? JSON.stringify({ ...cmp, artifact, wouldInvoke: preview }, null, 2)
    : renderText(cmp, { top: Number(args.top) || 30 })

  if (args.out && args.out !== true) {
    const target = resolve(String(args.out))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, `${output}\n`, 'utf8')
    console.log(`argo baseline: wrote ${target}`)
  } else {
    console.log(output)
  }

  if (!args.json) console.log(`\nRAW       ${artifact}`)

  return args.strict === true && cmp.verdict.level === 'crew-subtracts' ? 1 : 0
}

/** An unusable arm is an operational failure, not a result. Say so and stop. */
function reportArmFailure(failure) {
  console.error(failure.message)
  for (const line of failure.details ?? []) console.error(line)
  return 1
}

/** Existing artifacts, so the counter continues instead of overwriting. */
function listArgoFiles(cwd) {
  try {
    return readdirSync(join(cwd, '.argo'))
  } catch {
    return []
  }
}

/** Raw runs are the evidence; the report is only a reading of them. */
function persist(cwd, label, payload) {
  const dir = join(cwd, '.argo')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `baseline-${label}.json`)
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return file
}
