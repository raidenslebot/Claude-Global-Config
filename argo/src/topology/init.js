/**
 * init.js — derive a starter topology from what the repo actually looks like.
 *
 * the usual first declaration is a guess: one supervisor, five workers, because
 * five is what the tutorial said. this builds one from the measured graph
 * instead — the worker count the sweep recommends, the shared surface marked
 * read-only, and write globs that are provably disjoint, so the file it emits
 * passes its own lint on the first run.
 *
 * pure: a plan object goes in, a declaration object comes out. the cmd layer
 * does the io.
 */

const ROOT = '.'

function dirOf(file) {
  const at = file.lastIndexOf('/')
  return at === -1 ? ROOT : file.slice(0, at)
}

/** Every directory containing `file`, nearest first, root ('.') last. */
function ancestors(file) {
  const parts = file.split('/')
  const out = []
  for (let i = parts.length - 1; i > 0; i--) out.push(parts.slice(0, i).join('/'))
  out.push(ROOT)
  return out
}

/**
 * Turn each partition's owned files into write globs that cannot collide.
 *
 * A `dir/**` glob is only emitted when the whole subtree under `dir` belongs to
 * one partition and holds no frozen file. Anywhere ownership is mixed, the files
 * are listed individually. That is more verbose and completely unambiguous,
 * which is the trade this module exists to make.
 *
 * @param {object[]} partitions  plan.partitions
 * @param {string[]} frozen      shared-surface files — nobody may write these
 * @returns {string[][]}         globs per partition, in partition order
 */
export function ownedGlobs(partitions, frozen = []) {
  const owners = new Map()
  const claim = (file, owner) => {
    for (const dir of ancestors(file)) {
      if (!owners.has(dir)) owners.set(dir, new Set())
      owners.get(dir).add(owner)
    }
  }
  for (const f of frozen) claim(f, 'frozen')
  for (const p of partitions) for (const f of p.ownedExclusively ?? []) claim(f, `p${p.id}`)

  return partitions.map((p) => {
    const owner = `p${p.id}`
    const globs = new Set()
    for (const file of p.ownedExclusively ?? []) {
      // Walk down from the root and take the broadest directory this partition
      // owns outright; ownership is inherited, so the first exclusive hit wins.
      const chain = ancestors(file)
      let best = null
      for (let i = chain.length - 1; i >= 0; i--) {
        const dir = chain[i]
        const set = owners.get(dir)
        if (set && set.size === 1 && set.has(owner)) {
          best = dir
          break
        }
      }
      if (best === null) globs.add(file)
      else globs.add(best === ROOT ? '**' : `${best}/**`)
    }
    return [...globs].sort()
  })
}

/**
 * Build a starter declaration: one supervisor, one worker per partition, the
 * shared surface declared read-only, and no peer edges. Every agent carries the
 * `agentType` of the definition that will really run it, so lint is checking the
 * fleet the user dispatches rather than a sketch of one. The shape is the one
 * `argo topology lint` expects, and it lints clean.
 *
 * hub-splitter is deliberately absent: it runs before a fan-out exists, in the
 * serial pre-step that shrinks the shared surface, so it is not a node in the
 * graph the workers run inside.
 *
 * No agent carries a `model`. A spawned agent inherits the session model, and
 * inheritance is the only mechanism that reproduces a session pinned to an
 * exact version — a model id written here would override it silently, which is
 * what the MODEL lint rule exists to catch.
 *
 * @param {object} plan  from analyse().plan
 * @param {object} [opts]
 * @param {string} [opts.name]
 */
export function buildDeclaration(plan, { name = 'fleet' } = {}) {
  const partitions = plan.partitions ?? []
  const frozen = [...new Set((plan.sharedSurface ?? []).map((s) => s.file))].sort()
  const globs = ownedGlobs(partitions, frozen)

  const agents = [{
    id: 'supervisor',
    role: 'supervisor',
    // Name the shipped definition, not a generic role: the point of linting a
    // topology is that it is the topology you will actually dispatch.
    agentType: 'graph-supervisor',
    // The supervisor reads everything and writes nothing: it is the correction
    // step, and a correction step that edits files is just another worker.
    reads: ['**'],
    writes: [],
    tools: ['read', 'grep', 'dispatch'],
  }]

  partitions.forEach((p, i) => {
    agents.push({
      id: p.worker ?? `worker-${i + 1}`,
      role: 'worker',
      agentType: 'graph-worker',
      reads: [...globs[i], ...frozen],
      writes: globs[i],
      tools: ['read', 'grep', 'edit'],
    })
  })

  const workerIds = agents.filter((a) => a.role !== 'supervisor').map((a) => a.id)
  const edges = []
  for (const id of workerIds) edges.push({ from: 'supervisor', to: id, kind: 'dispatch' })
  for (const id of workerIds) edges.push({ from: id, to: 'supervisor', kind: 'report' })

  const sharedState = frozen.length > 0
    ? [{
      id: 'frozen-surface',
      description:
        'files named from more than one partition. Read-only during fan-out; ' +
        'edits happen in a serial pre-step before a single worker starts.',
      files: frozen,
      readers: [...workerIds, 'supervisor'],
      writers: [],
    }]
    : []

  return {
    name,
    generatedBy: 'argo topology init',
    allowMultipleSupervisors: false,
    agents,
    edges,
    sharedState,
  }
}
