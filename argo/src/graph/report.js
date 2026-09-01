/**
 * report.js — turn a partition into a fan-out plan a fleet can actually execute.
 *
 * The output is not a picture of the repo. It is an assignment: who owns what,
 * what nobody may edit, and what has to happen serially before the fan-out starts.
 */

import { rankFiles, findHubs, findCycles, summarise, blastRadius } from './build.js'
import { sweepWorkers, partitionAt } from './partition.js'

/**
 * Build the complete plan.
 *
 * @param {object} graph     from buildGraph()
 * @param {object} [opts]
 * @param {number} [opts.workers]   force a worker count instead of using the sweep
 * @param {number} [opts.maxWorkers]
 * @param {number} [opts.resolution] Louvain resolution; higher = finer communities
 */
export function buildPlan(graph, opts = {}) {
  const ranked = rankFiles(graph)
  const stats = summarise(graph, ranked)
  const hubs = findHubs(ranked)
  const cycles = findCycles(graph)

  const sweep = sweepWorkers(graph, {
    min: 2,
    max: opts.maxWorkers ?? 12,
    resolution: opts.resolution ?? 1.0,
  })

  const workers = opts.workers ?? sweep.recommended?.workers ?? 2
  const { bins, binOf, surface } = partitionAt(graph, workers, {
    adj: sweep.adj,
    communities: sweep.communities,
  })

  const surfaceSet = new Set(surface.map((s) => s.file))

  // Cycles that straddle a partition boundary are worse than a shared file:
  // no ordering of the workers makes them safe.
  const straddlingCycles = cycles
    .filter((comp) => new Set(comp.map((f) => binOf.get(f))).size > 1)
    .map((comp) => ({
      files: comp,
      partitions: [...new Set(comp.map((f) => binOf.get(f)))].sort((a, b) => a - b),
    }))

  const partitions = bins.map((bin, i) => {
    const owned = bin.files.filter((f) => !surfaceSet.has(f))
    const sharedHere = bin.files.filter((f) => surfaceSet.has(f))
    return {
      id: i,
      worker: `worker-${i + 1}`,
      fileCount: bin.files.length,
      ownedExclusively: owned,
      ownsSharedFiles: sharedHere,
      lines: bin.files.reduce((n, f) => n + (graph.meta.get(f)?.lines ?? 0), 0),
      topLevelDirs: topDirs(bin.files),
    }
  })

  const s = stats.files > 0 ? surface.length / stats.files : 1

  return {
    root: graph.root,
    stats,
    hubs: hubs.map((h) => ({
      ...h,
      blastRadius: blastRadius(graph, h.file),
    })),
    cycles: cycles.slice(0, 20).map((c) => ({ size: c.length, files: c.slice(0, 30) })),
    straddlingCycles,
    sweep: sweep.rows,
    recommendedWorkers: sweep.recommended?.workers ?? workers,
    chosenWorkers: workers,
    sharedSurface: surface,
    sharedFraction: Number(s.toFixed(4)),
    partitions,
    verdict: verdict(s, surface.length, stats.files, straddlingCycles.length),
  }
}

function topDirs(files) {
  const counts = new Map()
  for (const f of files) {
    const dir = f.includes('/') ? f.slice(0, f.indexOf('/')) : '.'
    counts.set(dir, (counts.get(dir) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([dir, n]) => `${dir} (${n})`)
}

function verdict(sharedFraction, sharedCount, total, straddling) {
  if (total === 0) return { level: 'empty', message: 'No source files found.' }
  if (straddling > 0) {
    return {
      level: 'serialise',
      message:
        `${straddling} dependency cycle(s) cross a partition boundary. Those files cannot be ` +
        `split — merge their partitions or break the cycle before fanning out.`,
    }
  }
  if (sharedFraction < 0.02) {
    return {
      level: 'clean',
      message:
        `Only ${sharedCount}/${total} files (${(sharedFraction * 100).toFixed(1)}%) are shared. ` +
        `This tree fans out cleanly — freeze the shared list and go.`,
    }
  }
  if (sharedFraction < 0.10) {
    return {
      level: 'ok',
      message:
        `${sharedCount}/${total} files (${(sharedFraction * 100).toFixed(1)}%) are shared. ` +
        `Workable, but every worker carries that surface. Freeze it and keep edits to it serial.`,
    }
  }
  return {
    level: 'hub-bound',
    message:
      `${sharedCount}/${total} files (${(sharedFraction * 100).toFixed(1)}%) are shared. ` +
      `This tree is hub-bound: splitting the top hubs will buy you more parallelism than ` +
      `adding workers will.`,
  }
}

/* ------------------------------------------------------------------ *
 * Renderers
 * ------------------------------------------------------------------ */

/** Human-readable terminal report. */
export function renderText(plan, { top = 15 } = {}) {
  const L = []
  const pct = (n) => `${(n * 100).toFixed(1)}%`

  L.push(`GRAPH  ${plan.root}`)
  L.push(
    `       ${plan.stats.files} files · ${plan.stats.edges} edges · ` +
      `${plan.stats.totalLines.toLocaleString()} lines · density ${plan.stats.density}`
  )
  L.push(
    `       fan-in  median ${plan.stats.medianFanIn} · p90 ${plan.stats.p90FanIn} · ` +
      `p99 ${plan.stats.p99FanIn} · max ${plan.stats.maxFanIn}`
  )
  const cov = plan.stats.coverage ?? 1
  const covWarn = cov < 0.9 ? '  <-- graph is incomplete, treat the plan as optimistic' : ''
  L.push(
    `       coverage ${(cov * 100).toFixed(1)}% of intra-repo refs resolved ` +
      `(${plan.stats.missedRefs ?? 0} missed)${covWarn}`
  )
  L.push('')

  L.push(`HUBS   the files everything names — size is not the signal`)
  if (plan.hubs.length === 0) {
    L.push('       (none — no file is named by 3+ others)')
  }
  for (const h of plan.hubs.slice(0, top)) {
    L.push(
      `       ${String(h.fanIn).padStart(4)} refs  ${String(h.lines).padStart(5)} lines  ` +
        `blast ${String(h.blastRadius).padStart(4)}  ${h.file}`
    )
  }
  L.push('')

  L.push(`SWEEP  effective speedup by worker count (bounded by the slowest worker)`)
  L.push(`       workers   shared   fraction   speedup   ideal   imbalance`)
  for (const r of plan.sweep) {
    const mark = r.degenerate
      ? '  (degenerate — idle worker)'
      : r.workers === plan.recommendedWorkers
        ? '  <-- best'
        : ''
    L.push(
      `       ${String(r.workers).padStart(7)}   ${String(r.sharedFiles).padStart(6)}   ` +
        `${pct(r.sharedFraction).padStart(8)}   ${r.predictedSpeedup.toFixed(2).padStart(7)}   ` +
        `${r.idealSpeedup.toFixed(2).padStart(5)}   ` +
        `${r.imbalance.toFixed(2).padStart(9)}${mark}`
    )
  }
  L.push('')

  L.push(`PLAN   ${plan.chosenWorkers} workers · ${plan.sharedSurface.length} files in the shared surface (${pct(plan.sharedFraction)})`)
  for (const p of plan.partitions) {
    L.push(
      `       ${p.worker}: ${p.fileCount} files, ${p.lines.toLocaleString()} lines  ` +
        `[${p.topLevelDirs.join(', ')}]`
    )
  }
  L.push('')

  L.push(`FROZEN read-only for every worker; edits to these go in a serial pre-step`)
  if (plan.sharedSurface.length === 0) {
    L.push('       (none — the partitions are fully independent)')
  }
  for (const s of plan.sharedSurface.slice(0, top)) {
    L.push(
      `       ${String(s.foreignPartitionCount).padStart(2)} parts  ` +
        `${String(s.totalFanIn).padStart(4)} refs  ${String(s.lines).padStart(5)} lines  ${s.file}`
    )
  }
  if (plan.sharedSurface.length > top) {
    L.push(`       ... and ${plan.sharedSurface.length - top} more`)
  }
  L.push('')

  if (plan.straddlingCycles.length > 0) {
    L.push(`CYCLES ${plan.straddlingCycles.length} cycle(s) cross a partition boundary`)
    for (const c of plan.straddlingCycles.slice(0, 5)) {
      L.push(`       partitions ${c.partitions.join(',')}: ${c.files.slice(0, 4).join(' -> ')}${c.files.length > 4 ? ' -> ...' : ''}`)
    }
    L.push('')
  }

  L.push(`VERDICT [${plan.verdict.level}] ${plan.verdict.message}`)
  return L.join('\n')
}

/**
 * The brief handed to the fleet. This is the artifact that actually changes
 * behaviour: paste it into the supervisor's context, or let the skill read it.
 */
export function renderBrief(plan) {
  const L = []
  L.push(`# Fan-out plan`)
  L.push('')
  L.push(`Repo: \`${plan.root}\``)
  L.push(
    `${plan.stats.files} files · ${plan.stats.edges} reference edges · ` +
      `shared surface ${plan.sharedSurface.length} files (${(plan.sharedFraction * 100).toFixed(1)}%)`
  )
  L.push('')
  L.push(`**Worker count: ${plan.chosenWorkers}.** ${plan.verdict.message}`)
  L.push('')

  L.push(`## Rules for every worker`)
  L.push('')
  L.push(`1. You own exactly the files listed under your worker id. Do not edit any other file.`)
  L.push(`2. Files under FROZEN are read-only for you. If your task needs one changed, stop and report it — do not edit it.`)
  L.push(`3. Do not read another worker's draft output. Report to the supervisor only.`)
  L.push(`4. If your change would add a new import from your partition into another, report it instead of writing it.`)
  L.push('')

  if (plan.sharedSurface.length > 0) {
    L.push(`## FROZEN — read-only for all ${plan.chosenWorkers} workers`)
    L.push('')
    L.push(`These are named from more than one partition. Any edit here happens in a serial pre-step, before a single worker starts.`)
    L.push('')
    for (const s of plan.sharedSurface) {
      L.push(`- \`${s.file}\` — ${s.totalFanIn} refs, reached from partitions ${s.reachedByPartitions.join(', ')}`)
    }
    L.push('')
  }

  for (const p of plan.partitions) {
    L.push(`## ${p.worker} — ${p.ownedExclusively.length} owned files`)
    L.push('')
    if (p.ownsSharedFiles.length > 0) {
      L.push(`Nominal home of ${p.ownsSharedFiles.length} FROZEN file(s); still read-only during fan-out.`)
      L.push('')
    }
    for (const f of p.ownedExclusively) L.push(`- \`${f}\``)
    L.push('')
  }

  if (plan.straddlingCycles.length > 0) {
    L.push(`## Blocking cycles`)
    L.push('')
    L.push(`These dependency cycles cross partition boundaries. Break them or merge the partitions before fanning out.`)
    L.push('')
    for (const c of plan.straddlingCycles) {
      L.push(`- partitions ${c.partitions.join(', ')}: ${c.files.map((f) => `\`${f}\``).join(' → ')}`)
    }
    L.push('')
  }

  return L.join('\n')
}

/** Mermaid graph of the partitions and the shared surface between them. */
export function renderMermaid(plan, { maxSharedNodes = 12 } = {}) {
  const L = ['graph TD']
  for (const p of plan.partitions) {
    L.push(`  subgraph P${p.id}["${p.worker} · ${p.fileCount} files"]`)
    L.push(`    P${p.id}n["${p.topLevelDirs.slice(0, 3).join('<br/>') || 'files'}"]`)
    L.push('  end')
  }
  const shown = plan.sharedSurface.slice(0, maxSharedNodes)
  if (shown.length > 0) {
    L.push(`  subgraph SHARED["FROZEN · ${plan.sharedSurface.length} files"]`)
    shown.forEach((s, i) => {
      const label = s.file.length > 34 ? '...' + s.file.slice(-31) : s.file
      L.push(`    S${i}["${label}<br/>${s.totalFanIn} refs"]`)
    })
    L.push('  end')
    shown.forEach((s, i) => {
      for (const part of s.reachedByPartitions) L.push(`  P${part}n -.reads.-> S${i}`)
    })
  }
  L.push('  classDef frozen fill:#3b1f1f,stroke:#b45252,color:#f5d5d5;')
  if (shown.length > 0) {
    L.push(`  class ${shown.map((_, i) => `S${i}`).join(',')} frozen;`)
  }
  return L.join('\n')
}
