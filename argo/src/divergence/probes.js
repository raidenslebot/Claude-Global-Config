/**
 * probes.js — the questions, and the graph's own answer to each of them.
 *
 * a divergence run is only as good as its probe set. questions whose answer is
 * a judgement call ("how many workers should we use") produce huge divergence
 * that means nothing, so every generated probe is a fact the reference graph
 * already knows: a path, a count, a name. the graph answer is kept alongside
 * each probe as a reference point and as the seed for offline dry runs — it is
 * the graph's reading, not ground truth, and is never used to gate.
 */

/** Filenames that conventionally mark an entrypoint, when fan-out ties. */
const ENTRY_NAMES = /(^|\/)(cli|main|index|app|server|__main__|mod)\.[^/]+$/

/**
 * Files nothing else in the repo names, ranked by how much they reach out.
 * A root of the reference graph is what a user actually runs.
 *
 * @param {Array<{file: string, fanIn: number, fanOut: number}>} ranked from rankFiles()
 */
export function entrypointCandidates(ranked) {
  return ranked
    .filter((r) => r.fanIn === 0 && r.fanOut > 0)
    .map((r) => ({ ...r, entryScore: r.fanOut + (ENTRY_NAMES.test(r.file) ? 5 : 0) }))
    .sort((a, b) => b.entryScore - a.entryScore || a.file.localeCompare(b.file))
}

/** Top-level directory by file count, ties broken by name so runs repeat. */
export function topDirs(ranked) {
  const counts = new Map()
  for (const r of ranked) {
    const dir = r.file.includes('/') ? r.file.slice(0, r.file.indexOf('/')) : '.'
    counts.set(dir, (counts.get(dir) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([dir, count]) => ({ dir, count }))
}

/** Language by file count, same tie-breaking. */
export function topLangs(ranked) {
  const counts = new Map()
  for (const r of ranked) counts.set(r.lang, (counts.get(r.lang) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([lang, count]) => ({ lang, count }))
}

/**
 * Build the default probe set straight from the repo graph, so the tool is
 * useful with zero config.
 *
 * @param {object} ctx
 * @param {object} ctx.plan    from buildPlan() / analyse()
 * @param {Array}  ctx.ranked  from rankFiles()
 * @param {object} [opts]
 * @param {number} [opts.limit] how many probes to keep       [8]
 * @returns {Array<{id: string, kind: string, question: string,
 *                  graphAnswer: string, alternatives: string[]}>}
 */
export function defaultProbes({ plan, ranked }, { limit = 8 } = {}) {
  const rows = ranked ?? []
  if (rows.length === 0) return []

  const byFanIn = [...rows].sort((a, b) => b.fanIn - a.fanIn || a.file.localeCompare(b.file))
  const byFanOut = [...rows].sort((a, b) => b.fanOut - a.fanOut || a.file.localeCompare(b.file))
  const byLines = [...rows].sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file))
  const entries = entrypointCandidates(rows)
  const dirs = topDirs(rows)
  const langs = topLangs(rows)
  const frozen = (plan?.sharedSurface ?? []).map((s) => s.file)
  const fileCount = plan?.stats?.files ?? rows.length

  const others = (list, from, n) => list.slice(from, from + n).map((r) => r.file)

  const candidates = [
    {
      id: 'top-hub',
      kind: 'path',
      question:
        'Which single file in this repository is imported or required by the most ' +
        'other files in the same repository? Answer with the repo-relative path only.',
      graphAnswer: byFanIn[0].file,
      alternatives: others(byFanIn, 1, 2),
    },
    entries.length > 0 && {
      id: 'entrypoint',
      kind: 'path',
      question:
        'What is the entrypoint of this repository — the file that runs first when a ' +
        'user invokes it? Answer with the repo-relative path only.',
      graphAnswer: entries[0].file,
      alternatives: entries.slice(1, 3).map((r) => r.file),
    },
    {
      id: 'file-count',
      kind: 'number',
      question:
        'How many source files does this repository contain, excluding dependencies, ' +
        'build output and dot-directories? Answer with a single number.',
      graphAnswer: String(fileCount),
      alternatives: [String(fileCount + 2), String(Math.max(0, fileCount - 3))],
    },
    {
      id: 'top-importer',
      kind: 'path',
      question:
        'Which file in this repository imports or requires the most other files from ' +
        'this same repository? Answer with the repo-relative path only.',
      graphAnswer: byFanOut[0].file,
      alternatives: others(byFanOut, 1, 2),
    },
    {
      id: 'largest-file',
      kind: 'path',
      question:
        'Which single source file in this repository has the most lines? ' +
        'Answer with the repo-relative path only.',
      graphAnswer: byLines[0].file,
      alternatives: others(byLines, 1, 2),
    },
    byFanIn[0].fanIn > 0 && {
      id: 'hub-fan-in',
      kind: 'number',
      question:
        `How many other files in this repository import or require \`${byFanIn[0].file}\`? ` +
        'Answer with a single number.',
      graphAnswer: String(byFanIn[0].fanIn),
      alternatives: [String(byFanIn[0].fanIn + 1), String(Math.max(0, byFanIn[0].fanIn - 2))],
    },
    dirs.length > 0 && {
      id: 'top-dir',
      kind: 'path',
      question:
        'Which top-level directory of this repository contains the most source files? ' +
        'Answer with the directory name only.',
      graphAnswer: dirs[0].dir,
      alternatives: dirs.slice(1, 3).map((d) => d.dir),
    },
    frozen.length > 0 && {
      id: 'frozen-surface',
      kind: 'path',
      question:
        'If this repository were split between several agents working in parallel, which ' +
        'files would every one of them need to read but none could safely edit? ' +
        'List the repo-relative paths, most important first.',
      graphAnswer: frozen.slice(0, 3).join(', '),
      alternatives: [frozen.slice(0, 1).join(', '), frozen.slice(1, 4).join(', ')].filter(Boolean),
    },
    langs.length > 0 && {
      id: 'primary-language',
      kind: 'prose',
      question:
        'What is the primary programming language of this repository? Answer with one word.',
      graphAnswer: langs[0].lang,
      alternatives: langs.slice(1, 3).map((l) => l.lang),
    },
  ]

  return candidates.filter(Boolean).slice(0, limit)
}

/**
 * The prompt an agent actually receives. Kept deliberately terse: every word of
 * framing is a variable, and a probe set is only comparable across agents if
 * the only thing that differs between them is the agent config.
 */
export function buildPrompt(probe, { root = '.' } = {}) {
  return [
    `You are inspecting the repository at ${root}.`,
    'Read whatever files you need, then answer the question below.',
    'Reply with the shortest complete answer. No preamble, no explanation, no markdown.',
    '',
    `Question: ${probe.question}`,
  ].join('\n')
}

/**
 * Offline stand-in for a real answer, so `--dry-run` exercises the whole
 * pipeline without spending tokens. Seeded off the agent name, probe id and
 * repeat index, so a dry run is byte-identical every time — and it deliberately
 * makes agents disagree, because a dry run that always scores 0.0 would teach
 * the user nothing about what the report looks like when it fires.
 *
 * These are synthetic. The numbers they produce are illustrative, not measured.
 */
export function syntheticAnswer(agent, probe, repeat = 0) {
  const pool = [probe.graphAnswer ?? '', ...(probe.alternatives ?? [])]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
  if (pool.length === 0) return `(no offline answer available for ${probe.id})`

  // An agent holds a position and phrases it the same way; roughly one repeat
  // in four wanders off it. That is what a real fleet looks like, and it keeps
  // self-divergence and pair divergence as two distinguishable signals rather
  // than one wall of noise.
  const stance = hash32(`${agent}|${probe.id}`)
  const wobble = hash32(`${agent}|${probe.id}|${repeat}`)
  const idx = wobble % 4 === 0
    ? (stance + 1 + (wobble >>> 4)) % pool.length
    : stance % pool.length

  const pick = pool[idx]
  const style = (stance >>> 8) % 3
  if (style === 0) return pick
  if (style === 1) return `The answer is ${pick}.`
  return `Based on the repository structure, ${pick} is the one.`
}

/** FNV-1a. Any stable hash would do; this one is short and dependency-free. */
export function hash32(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Normalise a user-supplied probe file into the internal shape.
 * Accepts `expected` as an alias for `graphAnswer` because that is what a
 * hand-written probe set naturally calls it.
 */
export function normaliseProbes(raw) {
  if (!Array.isArray(raw)) throw new Error('probe file must be a JSON array')
  return raw.map((p, i) => {
    const question = typeof p === 'string' ? p : p?.question
    if (typeof question !== 'string' || question.trim() === '') {
      throw new Error(`probe ${i} has no question`)
    }
    const obj = typeof p === 'string' ? {} : p
    return {
      id: String(obj.id ?? `probe-${i + 1}`),
      kind: String(obj.kind ?? 'prose'),
      question: question.trim(),
      graphAnswer: String(obj.graphAnswer ?? obj.expected ?? ''),
      alternatives: Array.isArray(obj.alternatives) ? obj.alternatives.map(String) : [],
    }
  })
}

export { ENTRY_NAMES }
