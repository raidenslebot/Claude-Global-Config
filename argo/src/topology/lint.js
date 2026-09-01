/**
 * lint.js — the rules that decide whether an agent graph is safe to run.
 *
 * every edge between two agents is a channel a mistake can travel down. most
 * fleets have never written their graph down, so nobody can say which edges
 * exist, and the edges that do the damage are the accidental ones: the worker
 * that quietly reads another worker's draft, the second supervisor nobody meant
 * to create, the two agents that both own the same file.
 *
 * so this file is pure on purpose. parse, normalise, lint — no filesystem, no
 * clock, no model. the declaration goes in, an ordered list of findings comes
 * out, and the same input gives the same output on every machine, which is the
 * only way a lint result is worth failing a build over.
 */

import { parseYaml, TopologyError } from './yaml.js'

export { TopologyError }

/** The four ways one agent can be wired to another. */
export const EDGE_KINDS = new Set(['dispatch', 'report', 'peer', 'broadcast'])

/**
 * Agent definitions this plugin actually ships, under plugin/agents/.
 *
 * `agentType` is optional, but when it is set it is a promise that something
 * will resolve the name at dispatch time. A typo there produces a declaration
 * that lints clean and a fleet that does not exist, which is worse than no
 * declaration at all — so an unknown name is named and listed against the set.
 */
export const AGENT_TYPES = new Set(['graph-supervisor', 'graph-worker', 'hub-splitter'])

/**
 * Fan-out width we grumble about when there is no measured repo to check
 * against. Not a law — a prompt to go measure. `argo graph --json` replaces it
 * with a number derived from the actual shared surface.
 */
export const SOFT_FANOUT_LIMIT = 6

/**
 * The only model values the dispatch option can express. Anything else on an
 * agent is a full model id, and a full id is a pin: it overrides inheritance,
 * which is the one mechanism that reproduces a session pinned to an exact
 * version. "inherit" and an absent field both mean "whatever the session runs".
 */
export const MODEL_ALIASES = new Set(['sonnet', 'opus', 'haiku', 'fable'])

const RULE_ORDER = ['SCHEMA', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'MODEL']

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

/**
 * Read a declaration from text. JSON when it looks like JSON or the filename
 * says so, otherwise the yaml subset.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {string} [opts.file]  filename, used only to pick the format
 */
export function parseDeclaration(text, { file = '' } = {}) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) throw new TopologyError('the declaration file is empty.')
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || /\.json$/i.test(file)) {
    try {
      return JSON.parse(trimmed)
    } catch (err) {
      throw new TopologyError(`invalid JSON: ${err.message}`)
    }
  }
  return parseYaml(text)
}

/* ------------------------------------------------------------------ *
 * Glob overlap
 * ------------------------------------------------------------------ */

/**
 * Normalise a write/read pattern into comparable posix segments.
 * A trailing slash means "this directory", which is `dir/**`.
 */
export function normaliseGlob(glob) {
  let g = String(glob ?? '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  g = g.replace(/^\.\//, '')
  if (g.endsWith('/')) g += '**'
  return g
}

/** Do two single-segment patterns (with * and ?) share any concrete string? */
function segIntersect(a, b) {
  const seen = new Set()
  const go = (i, j) => {
    const key = i * (b.length + 1) + j
    if (seen.has(key)) return false
    seen.add(key)
    if (i === a.length && j === b.length) return true
    if (i === a.length) return [...b.slice(j)].every((c) => c === '*')
    if (j === b.length) return [...a.slice(i)].every((c) => c === '*')
    if (a[i] === '*') return go(i + 1, j) || go(i, j + 1)
    if (b[j] === '*') return go(i, j + 1) || go(i + 1, j)
    if (a[i] === '?' || b[j] === '?' || a[i] === b[j]) return go(i + 1, j + 1)
    return false
  }
  return go(0, 0)
}

/** Same question one level up, over path segments, where `**` spans any number. */
function segsIntersect(A, B) {
  const seen = new Set()
  const go = (i, j) => {
    const key = i * (B.length + 1) + j
    if (seen.has(key)) return false
    seen.add(key)
    if (i === A.length && j === B.length) return true
    if (i === A.length) return B.slice(j).every((s) => s === '**')
    if (j === B.length) return A.slice(i).every((s) => s === '**')
    if (A[i] === '**') return go(i + 1, j) || go(i, j + 1)
    if (B[j] === '**') return go(i, j + 1) || go(i + 1, j)
    return segIntersect(A[i], B[j]) && go(i + 1, j + 1)
  }
  return go(0, 0)
}

/**
 * Could a single path match both patterns? This is the question R8 asks, and it
 * has to be answered without a filesystem: the collision matters at declaration
 * time, before either agent has written anything.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function globsOverlap(a, b) {
  const ga = normaliseGlob(a)
  const gb = normaliseGlob(b)
  if (!ga || !gb) return false
  if (ga === gb) return true
  return segsIntersect(ga.split('/'), gb.split('/'))
}

/* ------------------------------------------------------------------ *
 * Normalisation + schema
 * ------------------------------------------------------------------ */

function finding(rule, severity, message, fix, extra = {}) {
  return { rule, severity, agents: [], edges: [], ...extra, message, fix }
}

function asList(value) {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * Coerce a parsed declaration into the shape the rules assume, collecting the
 * structural problems as SCHEMA findings. Rules do not run while any of those
 * are errors: linting a graph you cannot read produces confident nonsense.
 *
 * @param {object} raw
 * @returns {{ decl: object, findings: object[] }}
 */
export function normalise(raw) {
  const findings = []
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    findings.push(finding('SCHEMA', 'error',
      'the declaration must be an object with an "agents" list.',
      'see `argo topology init` for a generated starting point.'))
    return { decl: { name: '', agents: [], edges: [], sharedState: [] }, findings }
  }

  const decl = {
    name: typeof raw.name === 'string' ? raw.name : '',
    allowMultipleSupervisors: raw.allowMultipleSupervisors === true,
    agents: [],
    edges: [],
    sharedState: [],
  }

  const rawAgents = asList(raw.agents)
  if (rawAgents.length === 0) {
    findings.push(finding('SCHEMA', 'error',
      'no agents declared.',
      'add at least one agent: { "id": "supervisor", "role": "supervisor" }.'))
  }

  const seen = new Set()
  for (const [i, a] of rawAgents.entries()) {
    if (a === null || typeof a !== 'object' || Array.isArray(a)) {
      findings.push(finding('SCHEMA', 'error',
        `agents[${i}] is not an object.`,
        'each agent is { "id": ..., "role": ..., "reads": [...], "writes": [...] }.'))
      continue
    }
    const id = typeof a.id === 'string' ? a.id.trim() : ''
    if (!id) {
      findings.push(finding('SCHEMA', 'error',
        `agents[${i}] has no "id".`,
        'give every agent a stable id — findings and edges are addressed by it.'))
      continue
    }
    if (seen.has(id)) {
      findings.push(finding('SCHEMA', 'error',
        `duplicate agent id "${id}".`,
        'ids address edges; two agents with one id makes the graph unreadable.',
        { agents: [id] }))
      continue
    }
    seen.add(id)
    const role = typeof a.role === 'string' && a.role.trim() ? a.role.trim() : 'worker'
    if (typeof a.role !== 'string' || !a.role.trim()) {
      findings.push(finding('SCHEMA', 'warn',
        `agent "${id}" declares no role — assuming "worker".`,
        'set "role": "supervisor" or "role": "worker" explicitly.',
        { agents: [id] }))
    }
    decl.agents.push({
      id,
      role,
      agentType: typeof a.agentType === 'string' ? a.agentType.trim() : '',
      model: typeof a.model === 'string' ? a.model : '',
      reads: asList(a.reads).map(String),
      writes: asList(a.writes).map(String),
      tools: asList(a.tools).map(String),
    })
  }

  for (const [i, e] of asList(raw.edges).entries()) {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) {
      findings.push(finding('SCHEMA', 'error',
        `edges[${i}] is not an object.`,
        'each edge is { "from": ..., "to": ..., "kind": "dispatch" }.'))
      continue
    }
    const from = typeof e.from === 'string' ? e.from.trim() : ''
    const to = typeof e.to === 'string' ? e.to.trim() : ''
    const kind = typeof e.kind === 'string' && e.kind.trim() ? e.kind.trim() : 'dispatch'
    if (!from || !to) {
      findings.push(finding('SCHEMA', 'error',
        `edges[${i}] needs both "from" and "to".`,
        'an edge with one end is not a channel.'))
      continue
    }
    for (const end of [from, to]) {
      if (!seen.has(end)) {
        findings.push(finding('SCHEMA', 'error',
          `edge ${from} -> ${to} names unknown agent "${end}".`,
          `declare "${end}" under "agents", or fix the typo.`,
          { edges: [{ from, to, kind }] }))
      }
    }
    if (!EDGE_KINDS.has(kind)) {
      findings.push(finding('SCHEMA', 'error',
        `edge ${from} -> ${to} has unknown kind "${kind}".`,
        `use one of: ${[...EDGE_KINDS].join(', ')}.`,
        { edges: [{ from, to, kind }] }))
      continue
    }
    if (from === to) {
      findings.push(finding('SCHEMA', 'error',
        `edge ${from} -> ${to} is a self-edge.`,
        'an agent talking to itself is a prompt, not a topology edge.',
        { agents: [from], edges: [{ from, to, kind }] }))
      continue
    }
    decl.edges.push({
      from,
      to,
      kind,
      justification: typeof e.justification === 'string' ? e.justification.trim() : '',
    })
  }

  const stateIds = new Set()
  for (const [i, s] of asList(raw.sharedState).entries()) {
    if (s === null || typeof s !== 'object' || Array.isArray(s)) {
      findings.push(finding('SCHEMA', 'error',
        `sharedState[${i}] is not an object.`,
        'each entry is { "id": ..., "readers": [...], "writers": [...] }.'))
      continue
    }
    const id = typeof s.id === 'string' ? s.id.trim() : ''
    if (!id) {
      findings.push(finding('SCHEMA', 'error',
        `sharedState[${i}] has no "id".`,
        'name the state so findings can point at it.'))
      continue
    }
    if (stateIds.has(id)) {
      findings.push(finding('SCHEMA', 'error',
        `duplicate sharedState id "${id}".`,
        'one name, one piece of state.'))
      continue
    }
    stateIds.add(id)
    const readers = asList(s.readers).map(String)
    const writers = asList(s.writers).map(String)
    for (const who of [...readers, ...writers]) {
      if (!seen.has(who)) {
        findings.push(finding('SCHEMA', 'error',
          `sharedState "${id}" names unknown agent "${who}".`,
          `declare "${who}" under "agents", or fix the typo.`))
      }
    }
    decl.sharedState.push({
      id,
      description: typeof s.description === 'string' ? s.description : '',
      files: asList(s.files).map(String),
      readers,
      writers,
    })
  }

  return { decl, findings }
}

/* ------------------------------------------------------------------ *
 * Graph helpers
 * ------------------------------------------------------------------ */

function adjacency(edges, kind) {
  const adj = new Map()
  for (const e of edges) {
    if (e.kind !== kind) continue
    if (!adj.has(e.from)) adj.set(e.from, [])
    if (!adj.get(e.from).includes(e.to)) adj.get(e.from).push(e.to)
  }
  return adj
}

function reachableFrom(starts, adj) {
  const out = new Set()
  const queue = [...starts]
  while (queue.length > 0) {
    const node = queue.shift()
    for (const next of adj.get(node) ?? []) {
      if (out.has(next)) continue
      out.add(next)
      queue.push(next)
    }
  }
  return out
}

/** Rotate a cycle so the alphabetically-first member leads — same cycle, one name. */
function canonicalCycle(cycle) {
  let at = 0
  for (let i = 1; i < cycle.length; i++) if (cycle[i] < cycle[at]) at = i
  return [...cycle.slice(at), ...cycle.slice(0, at)]
}

/**
 * Every cycle reachable by a back edge. Fleets are tens of agents, so a plain
 * recursive DFS is the right size of hammer, and reporting the actual path
 * (a -> b -> a) is far more actionable than reporting the component it lives in.
 */
function findCyclesIn(ids, adj) {
  const state = new Map()
  const stack = []
  const seen = new Set()
  const cycles = []

  const visit = (id) => {
    state.set(id, 1)
    stack.push(id)
    for (const next of adj.get(id) ?? []) {
      const s = state.get(next) ?? 0
      if (s === 1) {
        const cycle = canonicalCycle(stack.slice(stack.indexOf(next)))
        const key = cycle.join('>')
        if (!seen.has(key)) {
          seen.add(key)
          cycles.push(cycle)
        }
      } else if (s === 0) {
        visit(next)
      }
    }
    stack.pop()
    state.set(id, 2)
  }

  for (const id of ids) if ((state.get(id) ?? 0) === 0) visit(id)
  return cycles
}

/* ------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------ */

/**
 * Apply R1–R9 to a normalised declaration.
 *
 * @param {object} raw            declaration as parsed (not yet normalised)
 * @param {object} [opts]
 * @param {object} [opts.plan]    a plan from `argo graph --json` for R7
 * @returns {{ decl, findings, errors, warnings, ok, stats }}
 */
export function lint(raw, { plan = null } = {}) {
  const { decl, findings: schema } = normalise(raw)
  const findings = [...schema]

  const stats = {
    agents: decl.agents.length,
    supervisors: decl.agents.filter((a) => a.role === 'supervisor').length,
    workers: decl.agents.filter((a) => a.role !== 'supervisor').length,
    edges: decl.edges.length,
    sharedState: decl.sharedState.length,
    byKind: Object.fromEntries(
      [...EDGE_KINDS].map((k) => [k, decl.edges.filter((e) => e.kind === k).length])
    ),
  }

  // A graph that does not parse cannot be reasoned about. Report the structure
  // and stop, rather than emitting eight consequential findings from one typo.
  if (schema.some((f) => f.severity === 'error')) {
    return finish(decl, findings, stats, { rulesRan: false, plan })
  }

  const ids = decl.agents.map((a) => a.id)
  const supervisors = decl.agents.filter((a) => a.role === 'supervisor').map((a) => a.id)
  const workers = decl.agents.filter((a) => a.role !== 'supervisor').map((a) => a.id)
  const dispatch = adjacency(decl.edges, 'dispatch')
  const report = adjacency(decl.edges, 'report')
  const multiOk = decl.allowMultipleSupervisors

  /* R1 — exactly one supervisor over every worker. */
  if (supervisors.length === 0) {
    findings.push(finding('R1', 'error',
      'no agent declares role "supervisor": nothing in this fleet checks the work.',
      'add a supervisor and dispatch from it — a fan-out with no correction step ships whatever the first worker guessed.'))
  } else {
    if (supervisors.length > 1 && !multiOk) {
      findings.push(finding('R1', 'error',
        `${supervisors.length} supervisors declared (${supervisors.join(', ')}).`,
        'collapse them into one, or set "allowMultipleSupervisors": true if two chains of command is deliberate.',
        { agents: [...supervisors] }))
    }
    for (const worker of workers) {
      const over = supervisors.filter((s) => reachableFrom([s], dispatch).has(worker))
      if (over.length > 1 && !multiOk) {
        findings.push(finding('R1', 'error',
          `worker "${worker}" is dispatched to by ${over.length} supervisors (${over.join(', ')}).`,
          'give this worker one owner, or set "allowMultipleSupervisors": true — two supervisors correcting one worker will undo each other.',
          { agents: [worker, ...over] }))
      }
    }
  }

  /* R2 — peer edges are off by default. */
  for (const e of decl.edges) {
    if (e.kind !== 'peer') continue
    if (!e.justification) {
      findings.push(finding('R2', 'error',
        `peer edge ${e.from} -> ${e.to} has no justification.`,
        'delete the edge and route through the supervisor, or add "justification": "<why this cannot go through the supervisor>". A worker reading another worker\'s draft turns one wrong step into four.',
        { agents: [e.from, e.to], edges: [{ from: e.from, to: e.to, kind: e.kind }] }))
    } else {
      findings.push(finding('R2', 'warn',
        `peer edge ${e.from} -> ${e.to} is allowlisted: ${e.justification}`,
        'revisit at the next review — every peer edge is a path an unreviewed mistake can take sideways.',
        { agents: [e.from, e.to], edges: [{ from: e.from, to: e.to, kind: e.kind }] }))
    }
  }

  /* R3 — no cycles among dispatch edges. */
  for (const cycle of findCyclesIn(ids, dispatch)) {
    findings.push(finding('R3', 'error',
      `dispatch cycle: ${[...cycle, cycle[0]].join(' -> ')}.`,
      'break one edge. Work that dispatches back into its own chain has no termination condition and no owner.',
      { agents: [...cycle] }))
  }

  /* R4 — exactly one report path from every worker to a supervisor. */
  if (supervisors.length > 0) {
    for (const worker of workers) {
      const direct = report.get(worker) ?? []
      if (direct.length === 0) {
        findings.push(finding('R4', 'error',
          `worker "${worker}" has no report edge: its result is never returned to anyone.`,
          `add { "from": "${worker}", "to": "<supervisor>", "kind": "report" }.`,
          { agents: [worker] }))
        continue
      }
      if (direct.length > 1) {
        findings.push(finding('R4', 'error',
          `worker "${worker}" reports to ${direct.length} places (${direct.join(', ')}).`,
          'keep one report edge. Two readers of one result means each assumes the other checked it.',
          { agents: [worker, ...direct] }))
        continue
      }
      const reached = reachableFrom([worker], report)
      const hit = supervisors.filter((s) => reached.has(s))
      if (hit.length === 0) {
        findings.push(finding('R4', 'error',
          `worker "${worker}" reports to "${direct[0]}", but that chain never reaches a supervisor.`,
          'follow the report chain up to a supervisor, or make the last hop report directly.',
          { agents: [worker, direct[0]] }))
      } else if (hit.length > 1 && !multiOk) {
        findings.push(finding('R4', 'error',
          `worker "${worker}" reports up to ${hit.length} supervisors (${hit.join(', ')}).`,
          'one destination for one result, or set "allowMultipleSupervisors": true.',
          { agents: [worker, ...hit] }))
      }
    }
  }

  /* R5 — shared state with more than one writer. */
  for (const s of decl.sharedState) {
    const writers = [...new Set(s.writers)]
    if (writers.length > 1) {
      findings.push(finding('R5', 'warn',
        `shared state "${s.id}" has ${writers.length} writers (${writers.join(', ')}).`,
        'route writes through one owner, or split the state per writer. Unreviewed state propagating is how a whole fleet copies one mistake.',
        { agents: writers }))
    }
  }

  /* R6 — orphans. Skipped with no supervisor: R1 already named the cause. */
  if (supervisors.length > 0) {
    const dispatched = reachableFrom(supervisors, dispatch)
    for (const a of decl.agents) {
      if (a.role === 'supervisor') continue
      if (dispatched.has(a.id)) continue
      const touched = decl.edges.some((e) => e.from === a.id || e.to === a.id)
      findings.push(finding('R6', 'error',
        touched
          ? `agent "${a.id}" has edges but is never dispatched to from a supervisor.`
          : `agent "${a.id}" is an orphan: no edge reaches it at all.`,
        `dispatch to it from a supervisor, or delete it. An agent nobody dispatches is either dead config or a channel opened outside the graph.`,
        { agents: [a.id] }))
    }
  }

  /* R7 — fan-out width against what the repo can actually support. */
  const cap = Number.isFinite(plan?.recommendedWorkers) ? plan.recommendedWorkers : null
  for (const sup of supervisors) {
    const targets = dispatch.get(sup) ?? []
    if (cap !== null) {
      if (targets.length > cap) {
        const shared = plan.sharedSurface?.length ?? 0
        const pct = plan.sharedFraction !== undefined
          ? ` (${(plan.sharedFraction * 100).toFixed(1)}% of files are shared)`
          : ''
        findings.push(finding('R7', 'warn',
          `"${sup}" dispatches to ${targets.length} workers, but the measured repo supports ${cap}${pct}.`,
          `narrow the fan-out to ${cap}, or shrink the ${shared}-file shared surface first. Past the width the surface supports, extra workers add contention, not throughput.`,
          { agents: [sup, ...targets] }))
      }
    } else if (targets.length > SOFT_FANOUT_LIMIT) {
      findings.push(finding('R7', 'warn',
        `"${sup}" dispatches to ${targets.length} workers, and no measured width was available to check it against.`,
        'run `argo graph . --json --out .argo/graph.json` and lint again — the honest width comes from the shared surface, not from a round number.',
        { agents: [sup, ...targets] }))
    }
  }

  /* R8 — two agents claiming the same file. */
  for (let i = 0; i < decl.agents.length; i++) {
    for (let j = i + 1; j < decl.agents.length; j++) {
      const a = decl.agents[i]
      const b = decl.agents[j]
      const clashes = []
      for (const ga of a.writes) {
        for (const gb of b.writes) {
          if (globsOverlap(ga, gb)) clashes.push(`${ga} ~ ${gb}`)
        }
      }
      if (clashes.length === 0) continue
      findings.push(finding('R8', 'error',
        `"${a.id}" and "${b.id}" both claim writes matching ${clashes.slice(0, 3).join(', ')}` +
          `${clashes.length > 3 ? ` (+${clashes.length - 3} more)` : ''}.`,
        'give each file exactly one writer. Two agents editing one path is a merge conflict at best and a silently reverted fix at worst.',
        { agents: [a.id, b.id] }))
    }
  }

  /* R9 — an agentType no shipped definition answers to. */
  for (const a of decl.agents) {
    if (a.agentType === '' || AGENT_TYPES.has(a.agentType)) continue
    findings.push(finding('R9', 'warn',
      `agent "${a.id}" declares agentType "${a.agentType}", which is not one of: ${[...AGENT_TYPES].join(', ')}.`,
      'point it at a shipped agent definition or drop the field. A type nothing resolves means the graph you linted is not the graph that runs.',
      { agents: [a.id] }))
  }

  /* MODEL — a version-specific model id pinned on an agent. A warning, not an
   * error: a user may pin on purpose, but must be told what the pin costs. */
  for (const a of decl.agents) {
    const model = a.model.trim().toLowerCase()
    if (model === '' || model === 'inherit' || MODEL_ALIASES.has(model)) continue
    findings.push(finding('MODEL', 'warn',
      `agent "${a.id}" pins model "${a.model}".`,
      'omit "model" or set it to "inherit". A spawned agent inherits the session model by default, ' +
        `and the dispatch option accepts only the coarse aliases ${[...MODEL_ALIASES].join(', ')} — ` +
        'so when the session is pinned to an exact version, inheritance is the only thing that reproduces it, ' +
        'and this id silently runs something else. Keep the pin only if you mean it.',
      { agents: [a.id] }))
  }

  return finish(decl, findings, stats, { rulesRan: true, plan })
}

function finish(decl, findings, stats, { rulesRan, plan }) {
  findings.sort((a, b) =>
    RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule) ||
    a.severity.localeCompare(b.severity) ||
    a.message.localeCompare(b.message))

  const errors = findings.filter((f) => f.severity === 'error').length
  const warnings = findings.filter((f) => f.severity === 'warn').length
  return {
    name: decl.name,
    decl,
    stats,
    findings,
    errors,
    warnings,
    rulesRan,
    checkedAgainstGraph: plan !== null && plan !== undefined,
    ok: errors === 0,
  }
}
