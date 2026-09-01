/** `argo graph` — repo dependency graph to fan-out plan. */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { scanRepo } from './scan.js'
import { buildGraph, scopeGraph } from './build.js'
import { buildPlan, renderText, renderBrief, renderMermaid } from './report.js'

const HELP = `
argo graph [path] — build the reference graph and produce a fan-out plan

  Counts how many other files NAME each path (not what a compiler resolves),
  partitions the tree, and reports the shared surface every worker carries.

options:
  --workers N        force a worker count (default: whatever the sweep picks)
  --max-workers N    upper bound for the sweep                    [12]
  --resolution F     Louvain resolution; higher = smaller communities [1.0]
  --top N            rows to show in hub/frozen tables             [15]
  --touch P [P...]   scope the plan to a task's write-set: these paths, dirs
                     or globs. Workers own only these files; files one hop
                     away are listed as read-only context. A path that does
                     not exist yet is legal (a new file shares nothing).
                     Put the repo path BEFORE --touch; every positional after
                     it is another touch path, and commas separate too. Paths
                     are repo-relative: ".", ".." and brace patterns are refused.
                     Each worker section carries a "Coupling:" line — coupled
                     tells the routing hook the work needs judgment; isolated
                     leaves the model to the task text.
  --include-docs     count markdown links as edges (off by default —
                     prose links are not coupling and drown the real graph)
  --json             full plan as JSON
  --brief            markdown fan-out brief for the fleet
  --mermaid          mermaid diagram of partitions + shared surface
  --out FILE         write the chosen output to FILE instead of stdout

examples:
  argo graph .
  argo graph . --workers 5 --brief --out .argo/fanout.md
  argo graph . --touch src/new-feature.js "src/api/**" --brief
  argo graph ./src --json --out .argo/graph.json
`.trim()

const split = (list) => list.flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean)

/** The flags of this command that take a value. Every other flag is a switch. */
const VALUE_FLAGS = new Set(['workers', 'max-workers', 'resolution', 'top', 'out'])

/**
 * `--touch a b,c` -> ['a', 'b', 'c'].
 *
 * The generic parser binds one value per flag and forgets argv order, so from
 * its output alone `argo graph src --touch a` and `argo graph --touch a src`
 * are the same call — and the second used to take `src` as the repo root and
 * report `a` as a file that does not exist yet. The raw argv settles it:
 * positionals before the first --touch name the repo, everything after it is a
 * path. `--touch` may appear any number of times and in either form
 * (`--touch a b` or `--touch=a`); only the flags that take a value swallow the
 * token after them, so a path after `--brief` stays a path. Values are read
 * from argv as strings: a file called `true`, `123` or `1e3` is a path, not a
 * coerced boolean or number.
 */
export function splitTouch(args, argv = []) {
  const at = argv.findIndex((a) => a === '--touch' || a.startsWith('--touch='))
  if (at === -1) {
    // No argv order available (called programmatically): the parsed shape is all there is.
    if (args.touch === undefined) return { root: args._[0], touch: [], flagged: false }
    const raw = args.touch === true ? [] : [String(args.touch)]
    return { root: args._[0], touch: split([...raw, ...args._.slice(1)]), flagged: true }
  }
  const before = []
  const after = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--touch') continue
    if (a.startsWith('--touch=')) { after.push(a.slice('--touch='.length)); continue }
    if (a.startsWith('--')) {
      const name = a.slice(2).split('=')[0]
      if (!a.includes('=') && VALUE_FLAGS.has(name) && i + 1 < argv.length && !argv[i + 1].startsWith('-')) i++
      continue
    }
    if (a.startsWith('-') && a.length > 1) continue
    ;(i < at ? before : after).push(a)
  }
  return { root: before[0], touch: split(after), flagged: true }
}

export async function run(args, argv = []) {
  if (args.help) {
    console.log(HELP)
    return 0
  }

  const { root: rootArg, touch, flagged } = splitTouch(args, argv)
  const root = resolve(rootArg ?? process.cwd())
  if (flagged && touch.length === 0) {
    console.error('argo graph: --touch needs at least one path or glob')
    return 1
  }

  // A switch that the generic parser handed a stray token (`--include-docs src/x.ts`)
  // is still on; only an explicit `=false` turns it off.
  const scan = scanRepo(root, { includeDocs: Boolean(args['include-docs']) })

  if (scan.files.length === 0) {
    console.error(`argo graph: no recognised source files under ${root}`)
    return 1
  }

  let graph = buildGraph(scan)
  if (touch.length > 0) {
    graph = scopeGraph(graph, touch)
    if (graph.scope.invalid.length > 0) {
      for (const { spec, error } of graph.scope.invalid) console.error(`argo graph: --touch ${JSON.stringify(spec)} ${error}`)
      return 1
    }
    if (graph.files.length === 0) {
      console.error(`argo graph: --touch matched no files under ${root}: ${touch.join(', ')}`)
      return 1
    }
  }

  const plan = buildPlan(graph, {
    workers: args.workers,
    maxWorkers: args['max-workers'] ?? 12,
    resolution: args.resolution ?? 1.0,
  })

  let output
  if (args.json) output = JSON.stringify(plan, null, 2)
  else if (args.brief) output = renderBrief(plan)
  else if (args.mermaid) output = renderMermaid(plan)
  else output = renderText(plan, { top: args.top ?? 15 })

  if (args.out) {
    const target = resolve(args.out)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, output + '\n', 'utf8')
    console.log(`argo graph: wrote ${target}`)
  } else {
    console.log(output)
  }

  return 0
}
