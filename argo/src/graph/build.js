/**
 * build.js — turn raw scan edges into the metrics that decide fan-out.
 *
 * The number that matters is fan-in: how many other files name this path.
 * It tracks nothing about file size. A 61-line file named by 144 others is a
 * harder constraint on parallel work than a 4,000-line file nobody imports.
 */

import { existsSync } from 'node:fs'
import { isAbsolute, join, relative, posix } from 'node:path'

/**
 * @typedef {object} Graph
 * @property {string[]}                 files
 * @property {Map<string, Set<string>>} out    file -> files it names
 * @property {Map<string, Set<string>>} in     file -> files that name it
 * @property {Map<string, object>}      meta   file -> { lines, lang, external }
 */

/** Build the bidirectional graph from a scan result. */
export function buildGraph(scan) {
  const inEdges = new Map()
  for (const f of scan.files) inEdges.set(f, new Set())
  for (const [from, targets] of scan.edges) {
    for (const to of targets) {
      if (inEdges.has(to)) inEdges.get(to).add(from)
    }
  }
  return {
    root: scan.root,
    files: scan.files,
    out: scan.edges,
    in: inEdges,
    meta: scan.meta,
    coverage: scan.coverage,
  }
}

/**
 * Restrict a graph to a task's write-set plus one reference hop each way.
 *
 * A whole-repo plan describes the repo. A task that only creates three new
 * files has no shared surface at all, and the plan should say so instead of
 * recommending six workers for coupling the task never goes near. One hop is
 * kept so a hub the task touches still shows its blast radius.
 *
 * `specs` are repo-relative paths, directories, or globs (`*`, `?`, `**`).
 * A plain path that matches nothing is legal — a file that does not exist yet
 * has no inbound edges — and is kept as an isolated node so the brief can list
 * it and say so, rather than dropping it silently.
 */
export function scopeGraph(graph, specs) {
  const known = new Set(graph.files)
  const byLower = new Map(graph.files.map((f) => [f.toLowerCase(), f]))
  const ignoreCase = caseInsensitiveFs(graph)
  const touched = new Set()
  const newFiles = []
  const unindexed = []
  const unmatched = []
  const invalid = []

  for (const raw of specs) {
    const { spec, error } = normaliseSpec(raw, graph.root)
    if (error) {
      invalid.push({ spec: String(raw), error })
      continue
    }
    if (/[*?]/.test(spec)) {
      const re = globToRegExp(spec, { ignoreCase })
      const hits = graph.files.filter((f) => re.test(f))
      if (hits.length === 0) unmatched.push(spec)
      for (const f of hits) touched.add(f)
    } else if (known.has(spec)) {
      touched.add(spec)
    } else {
      const under = graph.files.filter((f) => f.startsWith(spec + '/'))
      const onDisk = existsSync(join(graph.root, spec))
      // On a case-insensitive filesystem `SRC/a.ts` exists and IS `src/a.ts`; only
      // the index is strict about spelling. Ask the filesystem first, so a
      // case-sensitive one still treats the other spelling as a genuinely new path.
      const alias = under.length === 0 && onDisk ? byLower.get(spec.toLowerCase()) : undefined
      const aliased = under.length === 0 && onDisk && !alias
        ? graph.files.filter((f) => f.toLowerCase().startsWith(spec.toLowerCase() + '/'))
        : []
      if (under.length > 0) {
        for (const f of under) touched.add(f)
      } else if (alias) {
        touched.add(alias)
      } else if (aliased.length > 0) {
        for (const f of aliased) touched.add(f)
      } else {
        touched.add(spec)
        // Two different truths: not on disk yet, or on disk but not a source
        // file the scan indexes. Both carry zero edges, but only one is "new".
        if (onDisk) unindexed.push(spec)
        else newFiles.push(spec)
      }
    }
  }

  const inScope = new Set(touched)
  for (const f of touched) {
    for (const d of graph.in.get(f) ?? []) inScope.add(d)
    for (const t of graph.out.get(f) ?? []) inScope.add(t)
  }

  const files = [...inScope].sort()
  const out = new Map()
  const inn = new Map()
  const meta = new Map()
  for (const f of files) {
    out.set(f, new Set([...(graph.out.get(f) ?? [])].filter((t) => inScope.has(t))))
    inn.set(f, new Set([...(graph.in.get(f) ?? [])].filter((d) => inScope.has(d))))
    meta.set(f, graph.meta.get(f) ?? { lines: 0, lang: 'unknown', external: 0, missed: 0, rawRefs: 0 })
  }

  return {
    ...graph,
    files,
    out,
    in: inn,
    meta,
    // The unscoped fan-in, so a file's real coupling stays visible after the
    // edges outside the scope were cut.
    fullIn: graph.fullIn ?? graph.in,
    scope: {
      specs: specs.map(String),
      touched: [...touched].sort(),
      hops: files.filter((f) => !touched.has(f)),
      newFiles: newFiles.sort(),
      unindexed: unindexed.sort(),
      unmatched,
      invalid,
    },
  }
}

/**
 * A spec is repo-relative, forward-slashed and normalised — or it is refused
 * with a reason. Every miss used to become "a new file", silently: `.`,
 * `../etc/passwd`, a brace pattern, `src/./a.ts`. A new file carries zero
 * edges, so each of those produced a confident one-worker, zero-surface plan
 * for a task that was nothing of the kind.
 */
function normaliseSpec(raw, root) {
  let s = String(raw).trim().replace(/\\/g, '/')
  if (isAbsolute(s) || /^[A-Za-z]:\//.test(s)) s = relative(root, s).replace(/\\/g, '/')
  // normalize() would fold `src/*/../a.ts` into `src/a.ts` — a different pattern.
  if (/[*?]/.test(s) && /(^|\/)\.\.(\/|$)/.test(s)) return { error: 'is a glob containing "..", which is not supported' }
  s = posix.normalize(s).replace(/^\.\//, '').replace(/\/+$/, '')
  if (s === '' || s === '.') return { error: 'names the whole repo — drop --touch for the whole-repo plan' }
  if (s === '..' || s.startsWith('../') || isAbsolute(s) || /^[A-Za-z]:/.test(s)) return { error: 'is outside the repo' }
  if (/[{}]/.test(s)) return { error: 'is a brace pattern, which is not supported — list the paths, or separate them with commas' }
  return { spec: s }
}

/**
 * Does the filesystem under this root ignore case? Asked of the disk, not of
 * the platform: a case-sensitive volume on macOS or Windows exists, and so
 * does a case-insensitive mount on Linux. Flip one letter of one indexed file
 * and see whether the path still exists.
 */
function caseInsensitiveFs(graph) {
  const probe = graph.files.find((f) => /[a-z]/i.test(f))
  if (!probe) return false
  const flipped = probe.replace(/[a-z]/i, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()))
  return flipped !== probe && existsSync(join(graph.root, flipped))
}

/** `**` spans directories, `*` and `?` stay within one path segment. */
function globToRegExp(glob, { ignoreCase = false } = {}) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?' } else re += '.*'
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/, '\\$&')
    }
  }
  return new RegExp(`^${re}$`, ignoreCase ? 'i' : '')
}

/** fan-in / fan-out / lines per file, sorted by fan-in descending. */
export function rankFiles(graph) {
  return graph.files
    .map((f) => {
      const m = graph.meta.get(f) ?? {}
      return {
        file: f,
        fanIn: graph.in.get(f)?.size ?? 0,
        fanOut: graph.out.get(f)?.size ?? 0,
        lines: m.lines ?? 0,
        lang: m.lang ?? 'unknown',
        external: m.external ?? 0,
      }
    })
    .sort((a, b) => b.fanIn - a.fanIn || b.fanOut - a.fanOut || a.file.localeCompare(b.file))
}

/**
 * Hub score. A hub is a file that many others name but which is itself small
 * and stable — the classic shape that serialises a fan-out. We reward fan-in
 * and penalise size, because a big file at least warns you.
 */
export function hubScore(entry) {
  if (entry.fanIn === 0) return 0
  return entry.fanIn / Math.log2(Math.max(entry.lines, 2) + 2)
}

/**
 * Files whose fan-in sits in the top `pct` of the distribution AND which are
 * named by at least `minFanIn` others. These are the candidates for the
 * read-only / serial-edit list.
 */
export function findHubs(ranked, { pct = 0.02, minFanIn = 3 } = {}) {
  const withFanIn = ranked.filter((r) => r.fanIn >= minFanIn)
  if (withFanIn.length === 0) return []
  const cut = Math.max(1, Math.ceil(ranked.length * pct))
  return withFanIn
    .map((r) => ({ ...r, hubScore: Number(hubScore(r).toFixed(3)) }))
    .sort((a, b) => b.hubScore - a.hubScore)
    .slice(0, cut)
}

/**
 * Tarjan strongly-connected components. Any SCC with >1 member is a cycle:
 * those files cannot be split across workers without one of them seeing a
 * half-finished peer, so they must travel together.
 */
export function findCycles(graph) {
  const index = new Map()
  const low = new Map()
  const onStack = new Set()
  const stack = []
  const comps = []
  let counter = 0

  // Iterative Tarjan — repos get deep enough to blow the call stack.
  for (const root of graph.files) {
    if (index.has(root)) continue
    const work = [{ node: root, iter: null }]

    while (work.length > 0) {
      const frame = work[work.length - 1]
      const { node } = frame

      if (frame.iter === null) {
        index.set(node, counter)
        low.set(node, counter)
        counter++
        stack.push(node)
        onStack.add(node)
        frame.iter = [...(graph.out.get(node) ?? [])]
        frame.pos = 0
      }

      let descended = false
      while (frame.pos < frame.iter.length) {
        const next = frame.iter[frame.pos++]
        if (!index.has(next)) {
          work.push({ node: next, iter: null })
          descended = true
          break
        } else if (onStack.has(next)) {
          low.set(node, Math.min(low.get(node), index.get(next)))
        }
      }
      if (descended) continue

      if (low.get(node) === index.get(node)) {
        const comp = []
        let w
        do {
          w = stack.pop()
          onStack.delete(w)
          comp.push(w)
        } while (w !== node)
        if (comp.length > 1) comps.push(comp.sort())
      }

      work.pop()
      if (work.length > 0) {
        const parent = work[work.length - 1].node
        low.set(parent, Math.min(low.get(parent), low.get(node)))
      }
    }
  }

  return comps.sort((a, b) => b.length - a.length)
}

/**
 * Blast radius: how many files transitively depend on `file`. Editing it can
 * break any of them. Computed by reverse BFS, capped so a hub in a huge repo
 * does not stall the report.
 */
export function blastRadius(graph, file, cap = 5000) {
  const seen = new Set([file])
  const queue = [file]
  while (queue.length > 0 && seen.size < cap) {
    const cur = queue.shift()
    for (const dep of graph.in.get(cur) ?? []) {
      if (!seen.has(dep)) {
        seen.add(dep)
        queue.push(dep)
      }
    }
  }
  return seen.size - 1
}

/** Aggregate stats for the header of a report. */
export function summarise(graph, ranked) {
  const edgeCount = [...graph.out.values()].reduce((n, s) => n + s.size, 0)
  const orphans = ranked.filter((r) => r.fanIn === 0 && r.fanOut === 0).length
  const leaves = ranked.filter((r) => r.fanIn === 0).length
  const fanIns = ranked.map((r) => r.fanIn).sort((a, b) => a - b)
  const totalLines = ranked.reduce((n, r) => n + r.lines, 0)

  const cov = graph.coverage ?? { total: 0, resolved: 0, missedIntraRepo: 0 }
  const claimed = cov.resolved + cov.missedIntraRepo

  return {
    files: graph.files.length,
    edges: edgeCount,
    totalLines,
    // Of the references that CLAIM to point inside the tree, how many did we
    // resolve? Below ~0.9 the plan is built on an incomplete graph — say so.
    coverage: claimed > 0 ? Number((cov.resolved / claimed).toFixed(3)) : 1,
    missedRefs: cov.missedIntraRepo,
    density: graph.files.length > 1
      ? Number((edgeCount / (graph.files.length * (graph.files.length - 1))).toFixed(6))
      : 0,
    orphans,
    leaves,
    medianFanIn: percentile(fanIns, 0.5),
    p90FanIn: percentile(fanIns, 0.9),
    p99FanIn: percentile(fanIns, 0.99),
    maxFanIn: fanIns.length ? fanIns[fanIns.length - 1] : 0,
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[i]
}
