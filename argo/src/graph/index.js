/** Public API for the graph engine. */

export { scanRepo, walk, extractRefs, resolveRef, buildIndex } from './scan.js'
export {
  buildGraph, rankFiles, findHubs, findCycles, blastRadius, summarise, hubScore,
} from './build.js'
export {
  toUndirected, louvain, balanceToK, sharedSurface, sweepWorkers, partitionAt,
  predictedSpeedup,
} from './partition.js'
export { buildPlan, renderText, renderBrief, renderMermaid } from './report.js'

import { scanRepo } from './scan.js'
import { buildGraph } from './build.js'
import { buildPlan } from './report.js'

/** One call: path in, fan-out plan out. */
export function analyse(root, opts = {}) {
  const scan = scanRepo(root, opts)
  const graph = buildGraph(scan)
  return { graph, plan: buildPlan(graph, opts) }
}
