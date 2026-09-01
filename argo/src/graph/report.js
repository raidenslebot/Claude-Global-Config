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

  // A task-scoped plan partitions the WRITE-SET. Hop files are context a worker
  // reads, not work it owns: they never add a worker and are never listed as owned.
  const touched = graph.scope ? new Set(graph.scope.touched) : null

  // A task-scoped graph may be one worker's worth of work; the whole-repo sweep
  // never asks that question because a repo is never one worker's job. And no
  // scoped sweep may propose more workers than there are files to write.
  const maxWorkers = opts.maxWorkers ?? 12
  const sweep = sweepWorkers(graph, {
    min: touched ? 1 : 2,
    max: touched ? Math.max(1, Math.min(maxWorkers, touched.size)) : maxWorkers,
    resolution: opts.resolution ?? 1.0,
  })

  const requested = opts.workers ?? sweep.recommended?.workers ?? 2
  const cut = partitionAt(graph, requested, { adj: sweep.adj, communities: sweep.communities })

  // Unscoped: every bin is a worker. Scoped: a bin is reduced to what it writes,
  // and a bin holding only hop files is not a worker — nothing in it is written —
  // so it is dropped and the survivors renumbered.
  let bins = cut.bins.map((b, i) => ({ id: i, files: touched ? b.files.filter((f) => touched.has(f)) : b.files }))
  if (touched) {
    bins = bins.filter((b) => b.files.length > 0).map((b, i) => ({ ...b, id: i }))
    // A bin whose every file is frozen is not a worker either: it would be spawned
    // to edit nothing, while the worker that froze those files is the one that
    // needs them. Hand its files to that reader and try again, until every worker
    // owns something outright or one worker is left.
    for (let guard = 0; guard <= bins.length && bins.length > 1; guard++) {
      const wo = new Map()
      for (const b of bins) for (const f of b.files) wo.set(f, b.id)
      const frozen = new Set(scopedSurface(graph, wo).map((s) => s.file))
      const victim = bins.find((b) => b.files.every((f) => frozen.has(f)))
      if (!victim) break
      const votes = new Map()
      for (const f of victim.files) {
        for (const d of graph.in.get(f) ?? []) {
          const w = wo.get(d)
          if (w !== undefined && w !== victim.id) votes.set(w, (votes.get(w) ?? 0) + 1)
        }
      }
      const target = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0]
      if (target === undefined) break
      bins.find((b) => b.id === target).files.push(...victim.files)
      bins = bins.filter((b) => b !== victim).map((b, i) => ({ ...b, id: i }))
    }
    bins = bins.map((b) => ({ ...b, files: [...b.files].sort() }))
  }
  const workerOf = new Map()
  for (const b of bins) for (const f of b.files) workerOf.set(f, b.id)
  const workers = bins.length

  const surface = touched ? scopedSurface(graph, workerOf) : cut.surface
  const surfaceSet = new Set(surface.map((s) => s.file))

  // Cycles that straddle a partition boundary are worse than a shared file:
  // no ordering of the workers makes them safe. A cycle living entirely in hop
  // files that nobody writes is not a worker's problem.
  const straddlingCycles = cycles
    .map((comp) => ({
      files: comp,
      partitions: [...new Set(comp.map((f) => workerOf.get(f)).filter((p) => p !== undefined))].sort((a, b) => a - b),
    }))
    .filter((c) => c.partitions.length > 1)

  const hubSet = new Set(hubs.map((h) => h.file))
  const straddled = new Set(straddlingCycles.flatMap((c) => c.files))
  const newFiles = new Set(graph.scope?.newFiles ?? [])

  const partitions = bins.map((bin) => {
    const owned = bin.files.filter((f) => !surfaceSet.has(f))
    const sharedHere = bin.files.filter((f) => surfaceSet.has(f))
    return {
      id: bin.id,
      worker: `worker-${bin.id + 1}`,
      fileCount: bin.files.length,
      ownedExclusively: owned,
      ownsSharedFiles: sharedHere,
      // One hop from this worker's files and outside the write-set: read-only
      // context, listed so the worker knows its read-set. A hop reached from two
      // workers is in the shared surface instead, listed once under FROZEN.
      reads: touched ? readsOf(graph, bin.files, touched, surfaceSet) : [],
      lines: bin.files.reduce((n, f) => n + (graph.meta.get(f)?.lines ?? 0), 0),
      topLevelDirs: topDirs(bin.files),
      coupling: couplingOf(bin.files, { graph, surfaceSet, hubSet, straddled, newFiles }),
    }
  })

  const s = stats.files > 0 ? surface.length / stats.files : 1

  return {
    root: graph.root,
    scope: graph.scope ?? null,
    stats,
    hubs: hubs.map((h) => ({
      ...h,
      blastRadius: blastRadius(graph, h.file),
    })),
    cycles: cycles.slice(0, 20).map((c) => ({ size: c.length, files: c.slice(0, 30) })),
    straddlingCycles,
    sweep: sweep.rows,
    recommendedWorkers: touched ? workers : (sweep.recommended?.workers ?? workers),
    chosenWorkers: workers,
    sharedSurface: surface,
    sharedFraction: Number(s.toFixed(4)),
    partitions,
    verdict: verdict(s, surface.length, stats.files, straddlingCycles.length),
  }
}

/**
 * The shared surface of a task-scoped plan. `sharedSurface()` asks which bin a
 * file's dependents sit in; here hop files sit in no worker at all, so the
 * question becomes which WORKERS reach a file — by owning it, or by naming it
 * from an owned file. Reached from more than one, it is frozen. A hop that only
 * one worker names is that worker's read-set, not a frozen file. Same entry
 * shape as `sharedSurface()`, so every renderer is indifferent to which built it.
 */
function scopedSurface(graph, workerOf) {
  const fanIn = graph.fullIn ?? graph.in
  const out = []
  for (const file of graph.files) {
    const owner = workerOf.get(file)
    const readers = new Set()
    let foreignRefs = 0
    for (const d of graph.in.get(file) ?? []) {
      const w = workerOf.get(d)
      if (w === undefined) continue
      readers.add(w)
      if (w !== owner) foreignRefs++
    }
    const foreign = [...readers].filter((w) => w !== owner).sort((a, b) => a - b)
    if (foreign.length === 0) continue
    if (owner === undefined && readers.size < 2) continue
    out.push({
      file,
      homePartition: owner ?? null,
      reachedByPartitions: foreign,
      foreignPartitionCount: foreign.length,
      foreignRefs,
      totalFanIn: fanIn.get(file)?.size ?? 0,
      lines: graph.meta.get(file)?.lines ?? 0,
    })
  }
  return out.sort((a, b) =>
    b.foreignPartitionCount - a.foreignPartitionCount ||
    b.foreignRefs - a.foreignRefs ||
    a.file.localeCompare(b.file))
}

/** Files one hop from a worker's write-set that it does not own and that are not frozen. */
function readsOf(graph, files, touched, surfaceSet) {
  const near = new Set()
  for (const f of files) {
    for (const t of graph.out.get(f) ?? []) near.add(t)
    for (const d of graph.in.get(f) ?? []) near.add(d)
  }
  return [...near].filter((f) => !touched.has(f) && !surfaceSet.has(f)).sort()
}

/**
 * The wording of each coupling tier, fixed so the model-routing hook's
 * classifier reads the line the way a human does.
 *
 * `coupled` carries a JUDGMENT signal — the hook lets JUDGMENT veto every
 * downgrade, so a coupled line anywhere in a worker prompt is the strongest
 * thing this brief can say. `isolated` carries NO signal at all, on purpose:
 * the graph can certify that nothing outside a partition depends on anything
 * inside it, and it cannot certify that the edit itself is easy. An earlier
 * version made the isolated line a MECHANICAL signal, and a hard task on a leaf
 * file ("implement OAuth2 token refresh with retry and backoff in run.sh") plus
 * that line routed to the smallest model. So the isolated line stays neutral
 * and the task text alone decides. A wrong downgrade is a correctness failure
 * that nobody notices; a wrong upgrade costs money and is visible.
 *
 * `VERIFICATION_LINE` is exported for whoever spawns a verifier over the
 * reports; the brief itself never does, because in this protocol the supervisor
 * is the correction step.
 */
export const COUPLING = {
  isolated:
    'nothing outside this partition names anything inside it — no hub, nothing FROZEN, no cycle. ' +
    'The graph certifies containment only; the task text sets the model.',
  coupled: 'the worker must reason about how an edit propagates.',
}

export const VERIFICATION_LINE =
  "Verification: review the workers' reports against this plan; verify each claim before it counts."

/** One line, machine-readable: `Coupling: <tier> — <reason>`. */
export function couplingLine({ tier, reason }) {
  return `Coupling: ${tier} — ${reason}`
}

/**
 * The coupling tier a partition's SHAPE supports. Fan-in is read from the
 * unscoped graph, so a file whose dependents fell outside a task scope is
 * still coupled. A file that does not exist yet has no edges and is honestly
 * isolated; the line says so and, being neutral, leaves the model to the task.
 */
function couplingOf(files, { graph, surfaceSet, hubSet, straddled, newFiles }) {
  const fanIn = graph.fullIn ?? graph.in
  const reasons = []
  const shared = files.filter((f) => surfaceSet.has(f)).length
  if (shared > 0) reasons.push(`homes ${shared} FROZEN file(s)`)
  const hubs = files.filter((f) => hubSet.has(f))
  if (hubs.length > 0) reasons.push(`contains hub ${hubs.map((h) => `\`${h}\``).join(', ')}`)
  const named = files.filter((f) => (fanIn.get(f)?.size ?? 0) > 0 && !surfaceSet.has(f)).length
  if (named > 0) reasons.push(`${named} file(s) are named by other files`)
  if (files.some((f) => straddled.has(f))) reasons.push('sits on a cycle that crosses partitions')
  if (files.length === 0) reasons.push('empty partition')
  if (reasons.length > 0) return { tier: 'coupled', reason: `${reasons.join('; ')}; ${COUPLING.coupled}` }

  const created = files.filter((f) => newFiles.has(f)).length
  const note = created > 0 ? `${created} file(s) do not exist yet and carry no edges; ` : ''
  return { tier: 'isolated', reason: note + COUPLING.isolated }
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
  if (plan.scope) {
    const sc = plan.scope
    L.push(
      `       scope  --touch: ${sc.touched.length} touched path(s) -> ${plan.stats.files} files in scope ` +
        `(touched + one reference hop each way)`
    )
    if (sc.newFiles.length > 0) {
      L.push(`              ${sc.newFiles.length} do not exist yet (no inbound edges, zero shared surface): ${sc.newFiles.join(', ')}`)
    }
    if (sc.unindexed.length > 0) {
      L.push(`              ${sc.unindexed.length} on disk but not indexed by the scan (no edges): ${sc.unindexed.join(', ')}`)
    }
    if (sc.unmatched.length > 0) {
      L.push(`              matched nothing: ${sc.unmatched.join(', ')}`)
    }
  }
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
    const reads = p.reads?.length ? ` · reads ${p.reads.length}` : ''
    L.push(
      `       ${p.worker}: ${p.fileCount} files, ${p.lines.toLocaleString()} lines  ` +
        `[${p.topLevelDirs.join(', ')}]${reads}`
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
  if (plan.scope) {
    const sc = plan.scope
    L.push(
      `Scope: task write-set (\`--touch\`), not the whole repo — ${sc.touched.length} touched path(s) ` +
        `-> ${plan.stats.files} files in scope (touched + one reference hop each way). ` +
        `The worker count and shared surface below are task-scoped.`
    )
    if (sc.hops.length > 0) {
      L.push(
        `Each worker section lists under "Reads" the files one hop from its write-set. ` +
          `They are outside the write-set and read-only. A hop that two workers' files name is frozen ` +
          `instead and appears once, under FROZEN; a hop that merely depends on their files may appear under both.`
      )
    }
    if (sc.newFiles.length > 0) {
      L.push(
        `New files, do not exist yet (no inbound edges, zero shared-surface contribution): ` +
          sc.newFiles.map((f) => `\`${f}\``).join(', ')
      )
    }
    if (sc.unindexed.length > 0) {
      L.push(
        `On disk but not indexed by the scan (no edges): ` + sc.unindexed.map((f) => `\`${f}\``).join(', ')
      )
    }
    if (sc.unmatched.length > 0) {
      L.push(`Matched no files: ` + sc.unmatched.map((f) => `\`${f}\``).join(', '))
    }
  }
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
    if (p.coupling) {
      L.push(couplingLine(p.coupling))
      L.push('')
    }
    if (p.ownsSharedFiles.length > 0) {
      L.push(`Nominal home of ${p.ownsSharedFiles.length} FROZEN file(s); still read-only during fan-out.`)
      L.push('')
    }
    for (const f of p.ownedExclusively) L.push(`- \`${f}\``)
    L.push('')
    if (p.reads?.length) {
      L.push(`Reads — one hop from the write-set, outside it, read-only:`)
      L.push('')
      for (const f of p.reads) L.push(`- \`${f}\``)
      L.push('')
    }
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
