/**
 * partition.js — cut a repo graph into k pieces and measure what the pieces share.
 *
 * The shared surface is the whole point. A file belongs to it when something in
 * ANOTHER partition names it: that worker has to read it, so it cannot be edited
 * freely by the worker who owns it. The size of that surface, not the size of the
 * repo, is what caps how wide a fan-out can usefully go.
 *
 * Pipeline:  Louvain communities -> balance into exactly k bins -> shared surface
 *            -> sweep k and pick the width with the best predicted speedup.
 */

/* ------------------------------------------------------------------ *
 * Undirected weighted projection
 * ------------------------------------------------------------------ */

/**
 * Louvain needs an undirected graph. We project the directed reference graph by
 * summing weights in both directions: a mutual reference is a stronger coupling
 * than a one-way one, and lands as weight 2.
 */
export function toUndirected(graph) {
  const adj = new Map()
  const ensure = (n) => {
    if (!adj.has(n)) adj.set(n, new Map())
    return adj.get(n)
  }
  for (const f of graph.files) ensure(f)

  for (const [from, targets] of graph.out) {
    for (const to of targets) {
      if (!adj.has(to)) continue
      const a = ensure(from)
      const b = ensure(to)
      a.set(to, (a.get(to) ?? 0) + 1)
      b.set(from, (b.get(from) ?? 0) + 1)
    }
  }
  return adj
}

/* ------------------------------------------------------------------ *
 * Louvain modularity maximisation
 * ------------------------------------------------------------------ */

/**
 * Louvain community detection on a weighted undirected adjacency map.
 * `resolution` > 1 yields more, smaller communities.
 * Returns Map<node, communityId>.
 */
export function louvain(adj, { resolution = 1.0, maxPasses = 12, seed = 42 } = {}) {
  // Level 0 works on the real nodes; later levels work on aggregated super-nodes.
  let nodes = [...adj.keys()]
  let graph = adj
  // membership[level] maps that level's node -> community at that level
  const levels = []

  for (let pass = 0; pass < maxPasses; pass++) {
    const { communities, improved } = onePass(graph, nodes, resolution, seed + pass)
    levels.push(communities)
    if (!improved) break

    const agg = aggregate(graph, communities)
    if (agg.nodes.length === graph.size) break
    graph = agg.adj
    nodes = agg.nodes
    if (nodes.length <= 1) break
  }

  // Collapse the level hierarchy back down to the original nodes.
  const final = new Map()
  for (const node of adj.keys()) {
    let cur = node
    for (const level of levels) {
      cur = level.get(cur) ?? cur
    }
    final.set(node, cur)
  }
  return relabel(final)
}

function onePass(adj, nodes, resolution, seed) {
  const community = new Map()
  const degree = new Map()
  let totalWeight = 0

  for (const n of nodes) {
    community.set(n, n)
    let d = 0
    for (const w of (adj.get(n) ?? new Map()).values()) d += w
    degree.set(n, d)
    totalWeight += d
  }
  const m2 = totalWeight // == 2m for an undirected graph stored both ways
  if (m2 === 0) return { communities: community, improved: false }

  // Σ_tot per community.
  const commDegree = new Map()
  for (const n of nodes) commDegree.set(n, degree.get(n))

  const order = shuffled(nodes, seed)
  let improved = false
  let moved = true
  let rounds = 0

  while (moved && rounds < 30) {
    moved = false
    rounds++
    for (const node of order) {
      const own = community.get(node)
      const kI = degree.get(node)
      const neighbours = adj.get(node) ?? new Map()

      // Weight from `node` into each candidate community.
      const linksTo = new Map()
      for (const [nb, w] of neighbours) {
        if (nb === node) continue
        const c = community.get(nb)
        linksTo.set(c, (linksTo.get(c) ?? 0) + w)
      }

      // Remove node from its community before scoring.
      commDegree.set(own, commDegree.get(own) - kI)

      let bestComm = own
      let bestGain = (linksTo.get(own) ?? 0) - (resolution * commDegree.get(own) * kI) / m2

      for (const [c, wIn] of linksTo) {
        if (c === own) continue
        const gain = wIn - (resolution * commDegree.get(c) * kI) / m2
        if (gain > bestGain + 1e-12) {
          bestGain = gain
          bestComm = c
        }
      }

      commDegree.set(bestComm, commDegree.get(bestComm) + kI)
      if (bestComm !== own) {
        community.set(node, bestComm)
        moved = true
        improved = true
      }
    }
  }

  return { communities: community, improved }
}

function aggregate(adj, community) {
  const superAdj = new Map()
  const ensure = (c) => {
    if (!superAdj.has(c)) superAdj.set(c, new Map())
    return superAdj.get(c)
  }
  for (const c of new Set(community.values())) ensure(c)

  for (const [node, nbrs] of adj) {
    const cu = community.get(node)
    const bucket = ensure(cu)
    for (const [nb, w] of nbrs) {
      const cv = community.get(nb)
      bucket.set(cv, (bucket.get(cv) ?? 0) + w)
    }
  }
  return { adj: superAdj, nodes: [...superAdj.keys()] }
}

function relabel(membership) {
  const map = new Map()
  const out = new Map()
  let next = 0
  for (const [node, comm] of membership) {
    if (!map.has(comm)) map.set(comm, next++)
    out.set(node, map.get(comm))
  }
  return out
}

/** Deterministic shuffle — reports must be reproducible run to run. */
function shuffled(arr, seed) {
  const a = [...arr]
  let s = seed >>> 0
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/* ------------------------------------------------------------------ *
 * Balance communities into exactly k partitions
 * ------------------------------------------------------------------ */

/**
 * Pack Louvain communities into exactly `k` bins, trading connectivity against
 * balance. Communities are placed largest-first; each goes to the bin that
 * maximises (edges already linking it to that bin) minus a load penalty, so
 * coupled code stays together without one worker inheriting the whole repo.
 */
export function balanceToK(adj, communities, k, { balancePenalty = 1.0 } = {}) {
  const groups = new Map()
  for (const [node, c] of communities) {
    if (!groups.has(c)) groups.set(c, [])
    groups.get(c).push(node)
  }

  let blocks = [...groups.values()]

  // Too few blocks to fill k bins — split the biggest ones until we can.
  while (blocks.length < k) {
    blocks.sort((a, b) => b.length - a.length)
    const biggest = blocks.shift()
    if (!biggest || biggest.length < 2) {
      blocks.push(biggest ?? [])
      break
    }
    const mid = Math.ceil(biggest.length / 2)
    blocks.push(biggest.slice(0, mid), biggest.slice(mid))
  }

  blocks.sort((a, b) => b.length - a.length)

  const bins = Array.from({ length: k }, () => ({ files: [], load: 0 }))
  const binOf = new Map()
  const target = blocks.reduce((n, b) => n + b.length, 0) / k

  for (const block of blocks) {
    const blockSet = new Set(block)
    let bestBin = 0
    let bestScore = -Infinity

    for (let i = 0; i < k; i++) {
      // Connectivity from this block into whatever already sits in bin i.
      let connectivity = 0
      for (const node of block) {
        for (const [nb, w] of adj.get(node) ?? new Map()) {
          if (blockSet.has(nb)) continue
          if (binOf.get(nb) === i) connectivity += w
        }
      }
      const overflow = Math.max(0, bins[i].load + block.length - target)
      const score = connectivity - balancePenalty * overflow
      if (score > bestScore) {
        bestScore = score
        bestBin = i
      }
    }

    for (const node of block) binOf.set(node, bestBin)
    bins[bestBin].files.push(...block)
    bins[bestBin].load += block.length
  }

  for (const bin of bins) bin.files.sort()
  return { bins, binOf }
}

/* ------------------------------------------------------------------ *
 * Shared surface
 * ------------------------------------------------------------------ */

/**
 * A file is in the shared surface when a file in a DIFFERENT partition names it.
 * That is exactly the set every worker has to be able to read, and therefore the
 * set no worker may freely edit.
 *
 * Returns entries sorted by how many foreign partitions reach in.
 */
export function sharedSurface(graph, binOf) {
  const surface = []
  for (const file of graph.files) {
    const home = binOf.get(file)
    if (home === undefined) continue
    const foreign = new Set()
    let foreignRefs = 0
    for (const dependent of graph.in.get(file) ?? []) {
      const b = binOf.get(dependent)
      if (b !== undefined && b !== home) {
        foreign.add(b)
        foreignRefs++
      }
    }
    if (foreign.size > 0) {
      surface.push({
        file,
        homePartition: home,
        reachedByPartitions: [...foreign].sort((a, b) => a - b),
        foreignPartitionCount: foreign.size,
        foreignRefs,
        totalFanIn: graph.in.get(file)?.size ?? 0,
        lines: graph.meta.get(file)?.lines ?? 0,
      })
    }
  }
  return surface.sort(
    (a, b) =>
      b.foreignPartitionCount - a.foreignPartitionCount ||
      b.foreignRefs - a.foreignRefs ||
      a.file.localeCompare(b.file)
  )
}

/* ------------------------------------------------------------------ *
 * Worker-count sweep
 * ------------------------------------------------------------------ */

/**
 * Idealised Amdahl speedup: serial fraction `s` is the shared surface, the rest
 * splits perfectly k ways. Kept for reference — it is too generous, because it
 * assumes the partitions come out equal. They never do.
 */
export function predictedSpeedup(sharedFraction, k) {
  const s = Math.min(1, Math.max(0, sharedFraction))
  return 1 / (s + (1 - s) / k)
}

/**
 * Effective speedup — what you actually get.
 *
 * The fan-out finishes when the SLOWEST worker finishes, so the parallel phase
 * costs the largest partition's share of the work, not 1/k of it. The shared
 * surface is handled serially on top.
 *
 *      speedup = 1 / ( s + maxPartitionFraction )
 *
 * This is the honest number. It punishes an empty worker (which inflates some
 * other worker's share) and an unbalanced cut, both of which the idealised
 * formula silently rewards.
 *
 * @param {number} sharedFraction        shared-surface files / total files
 * @param {number} maxPartitionFraction  largest partition's exclusively-owned files / total files
 */
export function effectiveSpeedup(sharedFraction, maxPartitionFraction) {
  const denom = Math.max(0, sharedFraction) + Math.max(0, maxPartitionFraction)
  return denom > 0 ? 1 / denom : 1
}

/**
 * Sweep worker counts and report the width where predicted speedup peaks.
 * This replaces "pick 5 because the tutorial said 5".
 */
export function sweepWorkers(graph, { min = 2, max = 12, resolution = 1.0 } = {}) {
  const adj = toUndirected(graph)
  const communities = louvain(adj, { resolution })
  const total = graph.files.length
  const rows = []

  const upper = Math.min(max, Math.max(min, total))
  for (let k = min; k <= upper; k++) {
    const { bins, binOf } = balanceToK(adj, communities, k)
    const surface = sharedSurface(graph, binOf)
    const surfaceSet = new Set(surface.map((e) => e.file))
    const s = total > 0 ? surface.length / total : 1

    const loads = bins.map((b) => b.files.length)
    // Exclusively-owned files per bin — the work that actually parallelises.
    const ownedLoads = bins.map((b) => b.files.filter((f) => !surfaceSet.has(f)).length)
    const maxOwnedFraction = total > 0 ? Math.max(...ownedLoads) / total : 1
    const emptyWorkers = loads.filter((n) => n === 0).length

    const imbalance = loads.length
      ? (Math.max(...loads) - Math.min(...loads)) / Math.max(1, total / k)
      : 0

    rows.push({
      workers: k,
      sharedFiles: surface.length,
      sharedFraction: Number(s.toFixed(4)),
      // The honest number: bounded by the slowest worker, not by 1/k.
      predictedSpeedup: Number(effectiveSpeedup(s, maxOwnedFraction).toFixed(3)),
      idealSpeedup: Number(predictedSpeedup(s, k).toFixed(3)),
      maxOwnedFraction: Number(maxOwnedFraction.toFixed(4)),
      imbalance: Number(imbalance.toFixed(3)),
      emptyWorkers,
      // A cut that leaves a worker with nothing is not a k-way cut.
      degenerate: emptyWorkers > 0,
      partitionSizes: loads,
    })
  }

  // Only real cuts are eligible; fall back to the full set if every k is degenerate.
  const eligible = rows.filter((r) => !r.degenerate)
  const pool = eligible.length > 0 ? eligible : rows

  // Score discounts lopsided cuts. A width that parks one worker on four files
  // is not worth the extra process, the extra context, or the extra bill.
  for (const row of pool) {
    row.score = Number((row.predictedSpeedup / (1 + 0.15 * row.imbalance)).toFixed(4))
  }

  let best = pool[0]
  for (const row of pool) {
    if (!best) { best = row; continue }
    // Adding workers has to EARN it: 5% better, not 0.5% better. Ties go to the
    // narrower fan-out, which is cheaper to run and easier to reason about.
    if (row.score > best.score * 1.05) best = row
  }

  return { rows, recommended: best, communities, adj }
}

/** Convenience: full partition at a chosen k, reusing a computed community map. */
export function partitionAt(graph, k, { adj, communities, resolution = 1.0 } = {}) {
  const a = adj ?? toUndirected(graph)
  const c = communities ?? louvain(a, { resolution })
  const { bins, binOf } = balanceToK(a, c, k)
  const surface = sharedSurface(graph, binOf)
  return { bins, binOf, surface, adj: a, communities: c }
}
