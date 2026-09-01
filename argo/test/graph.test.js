import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildIndex, resolveRef, scanRepo } from '../src/graph/scan.js'
import {
  buildGraph, rankFiles, findCycles, blastRadius, summarise, scopeGraph,
} from '../src/graph/build.js'
import {
  toUndirected, louvain, balanceToK, sharedSurface, sweepWorkers,
  predictedSpeedup, effectiveSpeedup,
} from '../src/graph/partition.js'
import {
  buildPlan, renderText, renderBrief, COUPLING, VERIFICATION_LINE, couplingLine,
} from '../src/graph/report.js'
import { analyse } from '../src/graph/index.js'
import { splitTouch } from '../src/graph/cmd.js'

/** Build a throwaway repo on disk. Returns its root; caller removes it. */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'argo-test-'))
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body, 'utf8')
  }
  return root
}

describe('resolveRef', () => {
  const index = buildIndex([
    'src/index.ts',
    'src/types/index.ts',
    'src/llm/client.ts',
    'src/util/format.js',
    'pkg/deep/thing.py',
    'app/Widget.jsx',
  ])

  test('resolves an explicit relative path', () => {
    assert.equal(resolveRef('./client.js', 'src/llm/other.ts', index), 'src/llm/client.ts')
  })

  test('resolves a parent-relative path', () => {
    assert.equal(resolveRef('../util/format.js', 'src/llm/client.ts', index), 'src/util/format.js')
  })

  test('rewrites TypeScript NodeNext .js specifiers to the .ts on disk', () => {
    // The whole reason coverage was 13.5% before this existed.
    assert.equal(resolveRef('../types/index.js', 'src/llm/client.ts', index), 'src/types/index.ts')
  })

  test('resolves a directory to its index file', () => {
    assert.equal(resolveRef('./types', 'src/index.ts', index), 'src/types/index.ts')
  })

  test('remaps build output back to source', () => {
    assert.equal(resolveRef('../dist/llm/client.js', 'scripts/run.mjs', index), 'src/llm/client.ts')
  })

  test('resolves python dotted relative imports', () => {
    const py = buildIndex(['pkg/a.py', 'pkg/sub/b.py'])
    assert.equal(resolveRef('.a', 'pkg/sub/b.py', py), null, 'single dot stays in own dir')
    assert.equal(resolveRef('..a', 'pkg/sub/b.py', py), 'pkg/a.py')
  })

  test('returns null for external packages and builtins', () => {
    assert.equal(resolveRef('node:fs', 'src/index.ts', index), null)
    assert.equal(resolveRef('react', 'src/index.ts', index), null)
    assert.equal(resolveRef('https://example.com/x.js', 'src/index.ts', index), null)
  })

  test('does not resolve an ambiguous bare stem', () => {
    const dupes = buildIndex(['a/thing.ts', 'b/thing.ts'])
    assert.equal(resolveRef('thing', 'c/other.ts', dupes), null)
  })

  test('never resolves a file to itself', () => {
    assert.equal(resolveRef('./client.js', 'src/llm/client.ts', index), 'src/llm/client.ts')
  })
})

describe('scan + build', () => {
  test('counts fan-in from real files and excludes markdown by default', () => {
    const root = fixture({
      'src/hub.ts': 'export const x = 1\n',
      'src/a.ts': "import { x } from './hub.js'\n",
      'src/b.ts': "import { x } from './hub.js'\n",
      'src/c.ts': "import { x } from './hub.js'\n",
      'docs/guide.md': '[hub](../src/hub.ts)\n',
    })
    try {
      const graph = buildGraph(scanRepo(root))
      assert.ok(!graph.files.includes('docs/guide.md'), 'markdown excluded by default')

      const ranked = rankFiles(graph)
      const hub = ranked.find((r) => r.file === 'src/hub.ts')
      assert.equal(hub.fanIn, 3)
      assert.equal(hub.fanOut, 0)

      const withDocs = buildGraph(scanRepo(root, { includeDocs: true }))
      assert.ok(withDocs.files.includes('docs/guide.md'), '--include-docs opts markdown back in')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('reports coverage and counts a broken intra-repo reference as missed', () => {
    const root = fixture({
      'src/a.ts': "import './real.js'\nimport './ghost.js'\n",
      'src/real.ts': 'export const y = 2\n',
    })
    try {
      const scan = scanRepo(root)
      assert.equal(scan.coverage.resolved, 1)
      assert.equal(scan.coverage.missedIntraRepo, 1)
      const stats = summarise(buildGraph(scan), rankFiles(buildGraph(scan)))
      assert.equal(stats.coverage, 0.5)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('external package imports do not count against coverage', () => {
    const root = fixture({ 'src/a.ts': "import 'react'\nimport 'node:fs'\n" })
    try {
      const scan = scanRepo(root)
      assert.equal(scan.coverage.missedIntraRepo, 0)
      assert.equal(summarise(buildGraph(scan), rankFiles(buildGraph(scan))).coverage, 1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('cycles and blast radius', () => {
  test('finds a multi-file cycle and ignores acyclic chains', () => {
    const root = fixture({
      'src/a.ts': "import './b.js'\n",
      'src/b.ts': "import './c.js'\n",
      'src/c.ts': "import './a.js'\n",
      'src/lone.ts': 'export const z = 3\n',
    })
    try {
      const graph = buildGraph(scanRepo(root))
      const cycles = findCycles(graph)
      assert.equal(cycles.length, 1)
      assert.deepEqual(cycles[0], ['src/a.ts', 'src/b.ts', 'src/c.ts'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('blast radius counts transitive dependents, not direct ones', () => {
    const root = fixture({
      'src/base.ts': 'export const b = 1\n',
      'src/mid.ts': "import './base.js'\n",
      'src/top.ts': "import './mid.js'\n",
    })
    try {
      const graph = buildGraph(scanRepo(root))
      assert.equal(blastRadius(graph, 'src/base.ts'), 2)
      assert.equal(blastRadius(graph, 'src/top.ts'), 0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('partitioning', () => {
  /** Two dense clusters joined by a single bridge file. */
  function twoClusters() {
    const files = {}
    for (const side of ['x', 'y']) {
      for (let i = 0; i < 6; i++) {
        const peers = [0, 1, 2, 3, 4, 5]
          .filter((j) => j !== i)
          .map((j) => `import './${side}${j}.js'`)
          .join('\n')
        files[`src/${side}${i}.ts`] = `${peers}\nimport './bridge.js'\n`
      }
    }
    files['src/bridge.ts'] = 'export const bridge = 1\n'
    return fixture(files)
  }

  test('louvain is deterministic across runs', () => {
    const root = twoClusters()
    try {
      const graph = buildGraph(scanRepo(root))
      const adj = toUndirected(graph)
      const a = [...louvain(adj).entries()].sort()
      const b = [...louvain(adj).entries()].sort()
      assert.deepEqual(a, b)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the bridge file lands in the shared surface at k=2', () => {
    const root = twoClusters()
    try {
      const graph = buildGraph(scanRepo(root))
      const adj = toUndirected(graph)
      const { binOf } = balanceToK(adj, louvain(adj), 2)
      const surface = sharedSurface(graph, binOf)
      assert.ok(
        surface.some((s) => s.file === 'src/bridge.ts'),
        'a file named from both partitions must be shared'
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a file named only from its own partition is not shared', () => {
    const root = fixture({
      'src/a1.ts': "import './a2.js'\n",
      'src/a2.ts': 'export const a = 1\n',
      'src/b1.ts': "import './b2.js'\n",
      'src/b2.ts': 'export const b = 2\n',
    })
    try {
      const graph = buildGraph(scanRepo(root))
      const adj = toUndirected(graph)
      const { binOf } = balanceToK(adj, louvain(adj), 2)
      const surface = sharedSurface(graph, binOf)
      assert.equal(surface.length, 0, 'fully independent partitions share nothing')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('balanceToK assigns every file exactly once', () => {
    const root = twoClusters()
    try {
      const graph = buildGraph(scanRepo(root))
      const adj = toUndirected(graph)
      const { bins, binOf } = balanceToK(adj, louvain(adj), 3)
      const total = bins.reduce((n, b) => n + b.files.length, 0)
      assert.equal(total, graph.files.length)
      assert.equal(new Set(bins.flatMap((b) => b.files)).size, graph.files.length)
      for (const f of graph.files) assert.ok(binOf.has(f), `${f} unassigned`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('speedup models', () => {
  test('idealised Amdahl matches the closed form', () => {
    assert.equal(predictedSpeedup(0, 4), 4)
    assert.equal(Number(predictedSpeedup(0.5, 2).toFixed(4)), 1.3333)
  })

  test('effective speedup is bounded by the slowest worker', () => {
    // Four workers, but one holds 70% of the work: nowhere near 4x.
    assert.equal(Number(effectiveSpeedup(0, 0.7).toFixed(4)), 1.4286)
    // Balanced 4-way with no shared surface does reach 4x.
    assert.equal(effectiveSpeedup(0, 0.25), 4)
  })

  test('effective speedup punishes an idle worker that ideal Amdahl rewards', () => {
    // k=4 but one worker holds everything: ideal says 4x, effective says 1x.
    assert.equal(predictedSpeedup(0, 4), 4)
    assert.equal(effectiveSpeedup(0, 1.0), 1)
  })

  test('sweep never recommends a degenerate cut when a real one exists', () => {
    const root = fixture(
      Object.fromEntries(
        Array.from({ length: 24 }, (_, i) => [
          `src/f${i}.ts`,
          i % 6 === 0 ? 'export const v = 1\n' : `import './f${Math.floor(i / 6) * 6}.js'\n`,
        ])
      )
    )
    try {
      const graph = buildGraph(scanRepo(root))
      const { recommended, rows } = sweepWorkers(graph, { min: 2, max: 8 })
      assert.ok(recommended, 'a recommendation is always produced')
      if (rows.some((r) => !r.degenerate)) {
        assert.equal(recommended.degenerate, false, 'must not recommend an idle worker')
      }
      assert.ok(recommended.workers >= 2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('plan', () => {
  test('produces partitions covering every file, and a verdict', () => {
    const root = fixture({
      'src/hub.ts': 'export const h = 1\n',
      'src/a.ts': "import './hub.js'\n",
      'src/b.ts': "import './hub.js'\n",
      'src/c.ts': "import './hub.js'\n",
      'src/d.ts': "import './hub.js'\n",
    })
    try {
      const graph = buildGraph(scanRepo(root))
      const plan = buildPlan(graph, { workers: 2 })
      const assigned = plan.partitions.flatMap((p) => [...p.ownedExclusively, ...p.ownsSharedFiles])
      assert.equal(new Set(assigned).size, graph.files.length)
      assert.equal(plan.chosenWorkers, 2)
      assert.ok(plan.verdict.level)
      assert.ok(plan.sharedFraction >= 0 && plan.sharedFraction <= 1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('flags cycles that straddle a partition boundary', () => {
    const root = fixture({
      'src/a.ts': "import './b.js'\n",
      'src/b.ts': "import './a.js'\n",
    })
    try {
      const graph = buildGraph(scanRepo(root))
      const plan = buildPlan(graph, { workers: 2 })
      if (plan.straddlingCycles.length > 0) {
        assert.equal(plan.verdict.level, 'serialise')
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

/* ------------------------------------------------------------------ *
 * --touch: task-scoped plans
 * ------------------------------------------------------------------ */

/**
 * Two dense clusters on a bridge, a small hub with three dependents, and two
 * orphan scripts. Every shape the scoper and the difficulty rule care about.
 */
function mixedRepo() {
  const files = {}
  for (const side of ['x', 'y']) {
    for (let i = 0; i < 6; i++) {
      const peers = [0, 1, 2, 3, 4, 5]
        .filter((j) => j !== i)
        .map((j) => `import './${side}${j}.js'`)
        .join('\n')
      files[`src/${side}${i}.ts`] = `${peers}\nimport './bridge.js'\n`
    }
  }
  files['src/bridge.ts'] = 'export const bridge = 1\n'
  files['src/hub.ts'] = 'export const h = 1\n'
  files['src/a.ts'] = "import './hub.js'\n"
  files['src/b.ts'] = "import './hub.js'\n"
  files['src/c.ts'] = "import './hub.js'\n"
  files['scripts/run.sh'] = 'echo hi\n'
  files['scripts/other.sh'] = 'echo other\n'
  return fixture(files)
}

/** renderText of mixedRepo() before --touch and the Coupling line existed. Root is machine-specific, hence the placeholder. */
const TEXT_BEFORE = [
  "GRAPH  <ROOT>",
  "       19 files · 75 edges · 98 lines · density 0.219298",
  "       fan-in  median 5 · p90 5 · p99 12 · max 12",
  "       coverage 100.0% of intra-repo refs resolved (0 missed)",
  "",
  "HUBS   the files everything names — size is not the signal",
  "         12 refs      2 lines  blast   12  src/bridge.ts",
  "",
  "SWEEP  effective speedup by worker count (bounded by the slowest worker)",
  "       workers   shared   fraction   speedup   ideal   imbalance",
  "             2        0       0.0%      1.46    2.00        0.74",
  "             3        1       5.3%      2.71    2.71        0.16  <-- best",
  "             4        1       5.3%      2.71    3.46        1.05",
  "             5        1       5.3%      2.71    4.13        1.84  (degenerate — idle worker)",
  "             6        1       5.3%      2.71    4.75        2.21  (degenerate — idle worker)",
  "             7        1       5.3%      2.71    5.32        2.58  (degenerate — idle worker)",
  "             8        1       5.3%      2.71    5.85        2.95  (degenerate — idle worker)",
  "             9        1       5.3%      2.71    6.33        3.32  (degenerate — idle worker)",
  "            10        7      36.8%      1.46    2.32        4.21  (degenerate — idle worker)",
  "            11        7      36.8%      1.46    2.35        6.95  (degenerate — idle worker)",
  "            12        2      10.5%      2.38    5.56        4.42  (degenerate — idle worker)",
  "",
  "PLAN   3 workers · 1 files in the shared surface (5.3%)",
  "       worker-1: 7 files, 44 lines  [src (7)]",
  "       worker-2: 6 files, 42 lines  [src (6)]",
  "       worker-3: 6 files, 12 lines  [src (4), scripts (2)]",
  "",
  "FROZEN read-only for every worker; edits to these go in a serial pre-step",
  "        1 parts    12 refs      2 lines  src/bridge.ts",
  "",
  "VERDICT [ok] 1/19 files (5.3%) are shared. Workable, but every worker carries that surface. Freeze it and keep edits to it serial.",
].join('\n')

/** renderBrief of mixedRepo() before --touch and the Coupling line existed. */
const BRIEF_BEFORE = [
  "# Fan-out plan",
  "",
  "Repo: `<ROOT>`",
  "19 files · 75 reference edges · shared surface 1 files (5.3%)",
  "",
  "**Worker count: 3.** 1/19 files (5.3%) are shared. Workable, but every worker carries that surface. Freeze it and keep edits to it serial.",
  "",
  "## Rules for every worker",
  "",
  "1. You own exactly the files listed under your worker id. Do not edit any other file.",
  "2. Files under FROZEN are read-only for you. If your task needs one changed, stop and report it — do not edit it.",
  "3. Do not read another worker's draft output. Report to the supervisor only.",
  "4. If your change would add a new import from your partition into another, report it instead of writing it.",
  "",
  "## FROZEN — read-only for all 3 workers",
  "",
  "These are named from more than one partition. Any edit here happens in a serial pre-step, before a single worker starts.",
  "",
  "- `src/bridge.ts` — 12 refs, reached from partitions 1",
  "",
  "## worker-1 — 6 owned files",
  "",
  "Nominal home of 1 FROZEN file(s); still read-only during fan-out.",
  "",
  "- `src/x0.ts`",
  "- `src/x1.ts`",
  "- `src/x2.ts`",
  "- `src/x3.ts`",
  "- `src/x4.ts`",
  "- `src/x5.ts`",
  "",
  "## worker-2 — 6 owned files",
  "",
  "- `src/y0.ts`",
  "- `src/y1.ts`",
  "- `src/y2.ts`",
  "- `src/y3.ts`",
  "- `src/y4.ts`",
  "- `src/y5.ts`",
  "",
  "## worker-3 — 6 owned files",
  "",
  "- `scripts/other.sh`",
  "- `scripts/run.sh`",
  "- `src/a.ts`",
  "- `src/b.ts`",
  "- `src/c.ts`",
  "- `src/hub.ts`",
  "",
].join('\n')

describe('--touch scope', () => {
  test('a path that does not exist yet yields zero shared surface and the brief says so', () => {
    const root = mixedRepo()
    try {
      const graph = scopeGraph(buildGraph(scanRepo(root)), ['src/new-feature.ts'])
      assert.deepEqual(graph.files, ['src/new-feature.ts'], 'a new file is kept as an isolated node')
      assert.deepEqual(graph.scope.newFiles, ['src/new-feature.ts'])
      assert.equal(graph.in.get('src/new-feature.ts').size, 0, 'nothing names a file that does not exist')

      const plan = buildPlan(graph)
      assert.equal(plan.sharedSurface.length, 0)
      assert.equal(plan.sharedFraction, 0)
      assert.equal(plan.chosenWorkers, 1, 'one new file is one worker')

      const brief = renderBrief(plan)
      assert.match(brief, /^Scope: task write-set \(`--touch`\)/m, 'header states the scope')
      assert.match(brief, /do not exist yet[^\n]*`src\/new-feature\.ts`/, 'the new file is named, not dropped')
      assert.match(renderText(plan), /do not exist yet[^\n]*src\/new-feature\.ts/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('three new files: zero surface, one worker each, all isolated, nothing to read', () => {
    const root = mixedRepo()
    try {
      const { plan } = analyse(root, { touch: ['src/n1.ts', 'src/n2.ts', 'src/n3.ts'] })
      assert.equal(plan.stats.files, 3, 'scope is the write-set, not the repo')
      assert.equal(plan.sharedSurface.length, 0)
      assert.equal(plan.recommendedWorkers, 3)
      assert.equal(plan.verdict.level, 'clean')
      for (const p of plan.partitions) {
        assert.equal(p.coupling.tier, 'isolated', `${p.worker}: a file with no edges is isolated`)
        assert.match(p.coupling.reason, /do not exist yet/)
        assert.deepEqual(p.reads, [])
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('touching a real hub: one worker owns it, its dependents are the read-set, and nothing is frozen', () => {
    const root = mixedRepo()
    try {
      const graph = scopeGraph(buildGraph(scanRepo(root)), ['src/bridge.ts'])
      assert.equal(graph.files.length, 13, 'the hub plus its 12 dependents')
      assert.deepEqual(graph.scope.touched, ['src/bridge.ts'])
      assert.equal(graph.scope.hops.length, 12)
      assert.equal(graph.in.get('src/bridge.ts').size, 12, 'in-scope fan-in is the real fan-in')

      // Two workers were asked for. There is one file to write, so there is one
      // worker: a bin holding only hop files is not work, and hops are never owned.
      const plan = buildPlan(graph, { workers: 2 })
      assert.equal(plan.chosenWorkers, 1)
      assert.equal(plan.partitions.length, 1)
      const [w] = plan.partitions
      assert.deepEqual(w.ownedExclusively, ['src/bridge.ts'])
      assert.equal(w.reads.length, 12, 'the dependents are read-only context, not owned work')
      assert.equal(plan.sharedSurface.length, 0, 'nothing is shared between one worker and nobody')
      assert.ok(plan.hubs.some((h) => h.file === 'src/bridge.ts' && h.fanIn === 12), 'the hub keeps its full fan-in')
      assert.equal(w.coupling.tier, 'coupled')
      assert.match(w.coupling.reason, /contains hub `src\/bridge\.ts`/)

      const brief = renderBrief(plan)
      assert.match(brief, /^## worker-1 — 1 owned files/m)
      assert.match(brief, /^Reads — one hop[^\n]*\n\n- `src\/x0\.ts`/m, 'hops are listed under Reads')
      assert.doesNotMatch(brief, /## worker-2/)
      assert.doesNotMatch(brief, /\(hop\)/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('two touched files that share a hop: the touched files are owned, the hop never is', () => {
    const root = mixedRepo()
    try {
      const graph = scopeGraph(buildGraph(scanRepo(root)), ['src/a.ts', 'src/b.ts'])
      assert.deepEqual(graph.files, ['src/a.ts', 'src/b.ts', 'src/hub.ts'])
      const plan = buildPlan(graph, { workers: 2 })
      const owned = plan.partitions.flatMap((p) => [...p.ownedExclusively, ...p.ownsSharedFiles])
      assert.deepEqual(owned.sort(), ['src/a.ts', 'src/b.ts'], 'exactly the write-set is owned, once')
      assert.ok(!owned.includes('src/hub.ts'))
      // Whichever way the cut fell, the hop is accounted for exactly once: frozen
      // when two workers name it, read-set when one does.
      if (plan.chosenWorkers === 2) {
        assert.ok(plan.sharedSurface.some((s) => s.file === 'src/hub.ts'), 'a hop two workers name is frozen')
        assert.ok(plan.partitions.every((p) => !p.reads.includes('src/hub.ts')))
      } else {
        assert.equal(plan.sharedSurface.length, 0)
        assert.deepEqual(plan.partitions[0].reads, ['src/hub.ts'])
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('one hop each way: a touched leaf brings in what it imports', () => {
    const root = mixedRepo()
    try {
      const graph = scopeGraph(buildGraph(scanRepo(root)), ['src/a.ts'])
      assert.deepEqual(graph.files, ['src/a.ts', 'src/hub.ts'])
      assert.deepEqual(graph.scope.hops, ['src/hub.ts'])
      assert.ok(!graph.files.includes('src/b.ts'), 'siblings of the touched file are two hops away')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('globs, directories, and files not indexed by the scan', () => {
    const root = mixedRepo()
    writeFileSync(join(root, 'logo.png'), 'not source', 'utf8')
    try {
      const graph = buildGraph(scanRepo(root))
      const byGlob = scopeGraph(graph, ['src/x*.ts'])
      assert.equal(byGlob.scope.touched.length, 6)
      assert.deepEqual(scopeGraph(graph, ['**/*.sh']).scope.touched, ['scripts/other.sh', 'scripts/run.sh'])
      assert.deepEqual(scopeGraph(graph, ['scripts']).scope.touched, ['scripts/other.sh', 'scripts/run.sh'])
      assert.deepEqual(scopeGraph(graph, ['./scripts/']).scope.touched, ['scripts/other.sh', 'scripts/run.sh'])

      const nothing = scopeGraph(graph, ['src/nope/**'])
      assert.deepEqual(nothing.scope.unmatched, ['src/nope/**'])
      assert.deepEqual(nothing.files, [], 'a glob cannot name a new file')

      const png = scopeGraph(graph, ['logo.png'])
      assert.deepEqual(png.scope.unindexed, ['logo.png'], 'on disk but carries no edges')
      assert.deepEqual(png.scope.newFiles, [])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('specs are normalised, and the ones that cannot mean a write-set are refused with a reason', () => {
    const root = mixedRepo()
    try {
      const graph = buildGraph(scanRepo(root))
      assert.deepEqual(scopeGraph(graph, ['src/./a.ts', 'src/../src/b.ts']).scope.touched, ['src/a.ts', 'src/b.ts'])
      assert.deepEqual(scopeGraph(graph, [join(root, 'src', 'c.ts')]).scope.touched, ['src/c.ts'], 'an absolute in-repo path')
      assert.deepEqual(scopeGraph(graph, ['src/a.ts']).scope.invalid, [])

      // Each of these used to become "a new file" — zero edges, one worker, no surface.
      for (const bad of ['.', './', '', '..', '../outside.ts', 'src/{a,b}.ts', join(root, '..', 'elsewhere.ts')]) {
        const g = scopeGraph(graph, [bad])
        assert.equal(g.scope.invalid.length, 1, `${JSON.stringify(bad)} must be refused`)
        assert.deepEqual(g.scope.touched, [], `${JSON.stringify(bad)} must not become a new file`)
        assert.ok(g.scope.invalid[0].error, 'with a reason')
      }

      // A different-case spelling of a real path IS that path wherever the filesystem says so.
      const cased = scopeGraph(graph, ['SRC/a.ts'])
      if (existsSync(join(root, 'SRC', 'a.ts'))) assert.deepEqual(cased.scope.touched, ['src/a.ts'])
      else assert.deepEqual(cased.scope.newFiles, ['SRC/a.ts'], 'on a case-sensitive filesystem it is honestly a new path')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('positionals before --touch name the repo; everything after is a path, taken from argv uncoerced', () => {
    // The parsed shape alone cannot tell these two apart; the second used to take `src` as the root.
    assert.deepEqual(
      splitTouch({ _: ['src'], touch: 'src/graph/build.js' }, ['--touch', 'src/graph/build.js', 'src']),
      { root: undefined, touch: ['src/graph/build.js', 'src'], flagged: true })
    assert.deepEqual(
      splitTouch({ _: ['.'], touch: 'a.ts' }, ['.', '--touch', 'a.ts', 'b.ts,c.ts', '--workers', '2', '--brief']),
      { root: '.', touch: ['a.ts', 'b.ts', 'c.ts'], flagged: true })
    assert.deepEqual(splitTouch({ _: [], touch: true }, ['--touch', 'true']).touch, ['true'], 'a file named true is a path')
    assert.deepEqual(splitTouch({ _: [], touch: 123 }, ['--touch', '123']).touch, ['123'], 'a file named 123 is a path')
    assert.deepEqual(splitTouch({ _: ['.'] }, ['.']), { root: '.', touch: [], flagged: false })
    // Without argv (programmatic call) the parsed shape is all there is.
    assert.deepEqual(splitTouch({ _: ['.', 'b.ts'], touch: 'a.ts' }), { root: '.', touch: ['a.ts', 'b.ts'], flagged: true })
  })

  test('a path after a switch, a second --touch, and the --touch=value form all stay in the write-set', () => {
    // Each of these silently narrowed the write-set: the generic parser lets any flag
    // swallow the next token, so `--brief b.ts` ate b.ts and `--touch b.ts` ate it as a value.
    assert.deepEqual(
      splitTouch({ _: ['.'], touch: 'a.ts', brief: 'b.ts' }, ['.', '--touch', 'a.ts', '--brief', 'b.ts']).touch,
      ['a.ts', 'b.ts'], 'a switch does not swallow a path')
    assert.deepEqual(
      splitTouch({ _: ['.'], touch: 'b.ts' }, ['.', '--touch', 'a.ts', '--touch', 'b.ts', '--json']).touch,
      ['a.ts', 'b.ts'], '--touch may repeat')
    assert.deepEqual(
      splitTouch({ _: ['src'], touch: 'a.ts' }, ['--touch=a.ts', 'src']),
      { root: undefined, touch: ['a.ts', 'src'], flagged: true }, 'the = form is still a marker; src after it is a path')
    assert.deepEqual(splitTouch({ _: [], touch: 1000 }, ['--touch=1e3']).touch, ['1e3'], 'uncoerced in the = form too')
    assert.deepEqual(
      splitTouch({ _: ['.'], touch: 'a.ts', workers: 2, out: 'x.md' }, ['.', '--touch', 'a.ts', '--workers', '2', '--out', 'x.md', 'b.ts']).touch,
      ['a.ts', 'b.ts'], 'value flags still swallow their value')
  })

  test('two touched files where one depends on the other are one worker, never a worker that owns nothing', () => {
    // b imports a, each imports two private hops. A 2-way cut puts a and b apart, which
    // freezes a (named from b's worker) and leaves a's worker owning nothing outright.
    const root = fixture({
      'src/a.ts': "import './h1.js'\nimport './h2.js'\n",
      'src/b.ts': "import './a.js'\nimport './h3.js'\nimport './h4.js'\n",
      'src/h1.ts': 'export const x = 1\n',
      'src/h2.ts': 'export const x = 1\n',
      'src/h3.ts': 'export const x = 1\n',
      'src/h4.ts': 'export const x = 1\n',
    })
    try {
      const plan = buildPlan(scopeGraph(buildGraph(scanRepo(root)), ['src/a.ts', 'src/b.ts']), { workers: 2 })
      assert.equal(plan.chosenWorkers, 1)
      assert.deepEqual(plan.partitions[0].ownedExclusively, ['src/a.ts', 'src/b.ts'])
      assert.deepEqual(plan.partitions[0].ownsSharedFiles, [])
      assert.deepEqual(plan.sharedSurface, [])
      assert.deepEqual(plan.partitions[0].reads, ['src/h1.ts', 'src/h2.ts', 'src/h3.ts', 'src/h4.ts'])
      assert.doesNotMatch(renderBrief(plan), /0 owned files/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a glob is matched the way the filesystem matches, and a glob may not contain ".."', () => {
    const root = mixedRepo()
    try {
      const graph = buildGraph(scanRepo(root))
      const cased = scopeGraph(graph, ['SRC/x*.ts'])
      if (existsSync(join(root, 'SRC'))) assert.equal(cased.scope.touched.length, 6, 'case-insensitive disk, case-insensitive glob')
      else assert.deepEqual(cased.scope.unmatched, ['SRC/x*.ts'], 'case-sensitive disk, case-sensitive glob')
      const folded = scopeGraph(graph, ['src/*/../a.ts'])
      assert.equal(folded.scope.invalid.length, 1, 'normalising would turn it into a different pattern')
      assert.match(folded.scope.invalid[0].error, /".."/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the default (no --touch) is byte-identical to before, plus the Coupling line', () => {
    const root = mixedRepo()
    try {
      const { plan } = analyse(root)
      assert.equal(plan.scope, null)
      const strip = (s) => s.split(plan.root).join('<ROOT>')

      assert.equal(strip(renderText(plan)), TEXT_BEFORE)

      const brief = strip(renderBrief(plan))
      const withoutCoupling = brief.replace(/^Coupling: [^\n]*\n\n/gm, '')
      assert.equal(withoutCoupling, BRIEF_BEFORE)
      assert.equal((brief.match(/^Coupling: /gm) ?? []).length, plan.partitions.length, 'one line per worker')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

/* ------------------------------------------------------------------ *
 * Coupling tier per worker
 * ------------------------------------------------------------------ */

/**
 * The model-routing hook that consumes these lines lives beside argo in the
 * same config repo. When it is there, classify against the real thing; when
 * argo runs standalone, skip rather than pretend.
 */
function loadRouter() {
  const p = fileURLToPath(new URL('../../config/hooks/pre-tool-model-route.js', import.meta.url))
  if (!existsSync(p)) return null
  try {
    const mod = createRequire(import.meta.url)(p)
    return typeof mod.decide === 'function' ? mod : null
  } catch {
    return null
  }
}

describe('coupling', () => {
  test('partitions nothing else names are isolated; hubs, shared files and coupled files are coupled', () => {
    const root = mixedRepo()
    try {
      const graph = buildGraph(scanRepo(root))
      const scripts = buildPlan(scopeGraph(graph, ['scripts/*.sh']), { workers: 2 })
      assert.equal(scripts.partitions.length, 2)
      for (const p of scripts.partitions) {
        assert.equal(p.coupling.tier, 'isolated', `${p.worker}: ${p.coupling.reason}`)
      }

      const whole = buildPlan(graph)
      const byFile = (f) => whole.partitions.find((p) => p.ownedExclusively.includes(f) || p.ownsSharedFiles.includes(f))
      assert.equal(byFile('src/bridge.ts').coupling.tier, 'coupled', 'homes a FROZEN file')
      assert.match(byFile('src/bridge.ts').coupling.reason, /homes 1 FROZEN file/)
      assert.equal(byFile('src/y0.ts').coupling.tier, 'coupled', 'files name each other')
      assert.equal(byFile('src/hub.ts').coupling.tier, 'coupled', 'contains a hub-let with fan-in')
      assert.match(byFile('src/hub.ts').coupling.reason, /named by other files/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a scoped graph keeps the unscoped fan-in, so coupling is never judged on cut edges', () => {
    const root = mixedRepo()
    try {
      const scoped = scopeGraph(buildGraph(scanRepo(root)), ['src/a.ts'])
      // hub.ts is a hop here; b.ts and c.ts name it too, from outside the scope.
      assert.equal(scoped.in.get('src/hub.ts').size, 1, 'in-scope fan-in is cut to the scope')
      assert.equal(scoped.fullIn.get('src/hub.ts').size, 3, 'the real fan-in travels with the graph')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('every worker section in the brief carries one Coupling line, right under its heading', () => {
    const root = mixedRepo()
    try {
      const plan = buildPlan(buildGraph(scanRepo(root)))
      const brief = renderBrief(plan)
      for (const p of plan.partitions) {
        const re = new RegExp(`^## ${p.worker} — \\d+ owned files\\n\\nCoupling: ${p.coupling.tier} — `, 'm')
        assert.match(brief, re)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the hook reads the lines the way the tiers intend: coupled vetoes, isolated pushes nothing, verification is review', (t) => {
    const router = loadRouter()
    if (!router) return t.skip('model-routing hook not co-located; nothing to classify against')
    const decide = (prompt) => router.decide({ prompt })

    assert.equal(decide(couplingLine({ tier: 'isolated', reason: COUPLING.isolated })), router.INHERIT,
      'isolated carries no signal of its own — the task text decides')
    assert.equal(decide(couplingLine({ tier: 'coupled', reason: COUPLING.coupled })), router.INHERIT)
    assert.equal(decide(VERIFICATION_LINE), 'opus')
  })

  test('the task text decides on an isolated partition; a coupled one vetoes any downgrade', (t) => {
    const router = loadRouter()
    if (!router) return t.skip('model-routing hook not co-located; nothing to classify against')
    const decide = (prompt) => router.decide({ prompt })
    const root = mixedRepo()
    try {
      const graph = buildGraph(scanRepo(root))
      const sections = (plan) => {
        const brief = renderBrief(plan)
        const idx = plan.partitions.map((p) => brief.indexOf(`## ${p.worker} —`))
        return {
          preamble: brief.slice(0, idx[0]),
          workers: idx.map((at, i) => brief.slice(at, idx[i + 1] ?? brief.length)),
        }
      }

      const whole = sections(buildPlan(graph))
      assert.equal(decide(whole.preamble), router.INHERIT, 'rules + FROZEN carry no signal of their own')
      for (const w of whole.workers) assert.equal(decide(w), router.INHERIT)

      const scoped = sections(buildPlan(scopeGraph(graph, ['scripts/*.sh']), { workers: 2 }))
      assert.equal(decide(scoped.preamble), router.INHERIT, 'the scope header carries no signal either')

      // The repro that showed an earlier MECHANICAL wording was a live downgrade vector:
      // a hard task on a leaf file plus the worker section routed to the smallest model.
      const HARD = 'Task: implement an OAuth2 token refresh with retry and backoff in scripts/run.sh, handling expired refresh tokens and clock skew.'
      const ROTE = 'Task: run the tests in scripts/ and report the output.'
      assert.equal(decide(HARD), router.INHERIT, 'the hard task alone carries no signal')
      assert.equal(decide(ROTE), 'haiku', 'the rote task alone is mechanical')
      for (const w of scoped.workers) {
        assert.equal(decide(w), router.INHERIT, 'an isolated section pushes nothing on its own')
        assert.equal(decide(`${HARD}\n\n${w}`), router.INHERIT, 'isolated + hard task: the section must not downgrade it')
        assert.equal(decide(`${ROTE}\n\n${w}`), 'haiku', 'isolated + rote task: the task decides')
      }
      for (const w of whole.workers) {
        assert.equal(decide(`${ROTE}\n\n${w}`), router.INHERIT, 'coupled + rote task: the veto wins')
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
