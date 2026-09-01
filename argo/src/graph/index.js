/** Public API for the graph engine. */

export { scanRepo, walk, extractRefs, resolveRef, buildIndex } from './scan.js'
export {
  buildGraph, rankFiles, findHubs, findCycles, blastRadius, summarise, hubScore, scopeGraph,
} from './build.js'
export {
  toUndirected, louvain, balanceToK, sharedSurface, sweepWorkers, partitionAt,
  predictedSpeedup,
} from './partition.js'
export {
  buildPlan, renderText, renderBrief, renderMermaid, COUPLING, VERIFICATION_LINE, couplingLine,
} from './report.js'

import { scanRepo } from './scan.js'
import { buildGraph, scopeGraph } from './build.js'
import { buildPlan } from './report.js'

/**
 * One call: path in, fan-out plan out.
 * `opts.touch` (paths or globs) scopes the plan to a task's write-set plus one hop.
 */
export function analyse(root, opts = {}) {
  const scan = scanRepo(root, opts)
  let graph = buildGraph(scan)
  if (opts.touch?.length) graph = scopeGraph(graph, opts.touch)
  return { graph, plan: buildPlan(graph, opts) }
}
