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
                     or globs plus one reference hop each way. A path that
                     does not exist yet is legal (a new file shares nothing).
                     Put the repo path BEFORE --touch; every positional after
                     it is another touch path, and commas separate too.
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

/** `--touch a b,c` -> ['a', 'b', 'c']; the parser only binds one value to the flag. */
function touchPaths(args) {
  if (args.touch === undefined) return []
  const raw = args.touch === true ? [] : [args.touch]
  return [...raw, ...args._.slice(1)]
    .flatMap((s) => String(s).split(','))
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function run(args) {
  if (args.help) {
    console.log(HELP)
    return 0
  }

  const root = resolve(args._[0] ?? process.cwd())
  const touch = touchPaths(args)
  if (args.touch !== undefined && touch.length === 0) {
    console.error('argo graph: --touch needs at least one path or glob')
    return 1
  }

  const scan = scanRepo(root, { includeDocs: args['include-docs'] === true })

  if (scan.files.length === 0) {
    console.error(`argo graph: no recognised source files under ${root}`)
    return 1
  }

  let graph = buildGraph(scan)
  if (touch.length > 0) {
    graph = scopeGraph(graph, touch)
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
