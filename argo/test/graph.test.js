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
  buildPlan, renderText, renderBrief, DIFFICULTY, difficultyLine,
} from '../src/graph/report.js'
import { analyse } from '../src/graph/index.js'

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

/** renderText of mixedRepo() before --touch and Difficulty existed. Root is machine-specific, hence the placeholder. */
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

/** renderBrief of mixedRepo() before --touch and Difficulty existed. */
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

  test('three new files: zero surface, one worker each, all judgment', () => {
    const root = mixedRepo()
    try {
      const { plan } = analyse(root, { touch: ['src/n1.ts', 'src/n2.ts', 'src/n3.ts'] })
      assert.equal(plan.stats.files, 3, 'scope is the write-set, not the repo')
      assert.equal(plan.sharedSurface.length, 0)
      assert.equal(plan.recommendedWorkers, 3)
      assert.equal(plan.verdict.level, 'clean')
      for (const p of plan.partitions) {
        assert.equal(p.difficulty.tier, 'judgment', `${p.worker}: writing a file from nothing is never mechanical`)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('touching a real hub pulls in its dependents and yields a non-zero surface', () => {
    const root = mixedRepo()
    try {
      const graph = scopeGraph(buildGraph(scanRepo(root)), ['src/bridge.ts'])
      assert.equal(graph.files.length, 13, 'the hub plus its 12 dependents')
      assert.deepEqual(graph.scope.touched, ['src/bridge.ts'])
      assert.equal(graph.scope.hops.length, 12)
      assert.equal(graph.in.get('src/bridge.ts').size, 12, 'in-scope fan-in is the real fan-in')

      const plan = buildPlan(graph, { workers: 2 })
      assert.ok(plan.sharedSurface.some((s) => s.file === 'src/bridge.ts'), 'the touched hub is frozen')
      assert.ok(plan.sharedSurface.length > 0)
      assert.match(renderBrief(plan), /- `src\/x0\.ts` \(hop\)/, 'one-hop files are marked')
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

  test('the default (no --touch) is byte-identical to before, plus the Difficulty line', () => {
    const root = mixedRepo()
    try {
      const { plan } = analyse(root)
      assert.equal(plan.scope, null)
      const strip = (s) => s.split(plan.root).join('<ROOT>')

      assert.equal(strip(renderText(plan)), TEXT_BEFORE)

      const brief = strip(renderBrief(plan))
      const withoutDifficulty = brief.replace(/^Difficulty: [^\n]*\n\n/gm, '')
      assert.equal(withoutDifficulty, BRIEF_BEFORE)
      assert.equal((brief.match(/^Difficulty: /gm) ?? []).length, plan.partitions.length, 'one line per worker')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

/* ------------------------------------------------------------------ *
 * Difficulty tier per worker
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

describe('difficulty', () => {
  test('existing leaves that nothing names are mechanical; hubs, shared files and coupled files are judgment', () => {
    const root = mixedRepo()
    try {
      const graph = buildGraph(scanRepo(root))
      const scripts = buildPlan(scopeGraph(graph, ['scripts/*.sh']), { workers: 2 })
      for (const p of scripts.partitions) {
        assert.equal(p.difficulty.tier, 'mechanical', `${p.worker}: ${p.difficulty.reason}`)
      }

      const whole = buildPlan(graph)
      const byFile = (f) => whole.partitions.find((p) => p.ownedExclusively.includes(f) || p.ownsSharedFiles.includes(f))
      assert.equal(byFile('src/bridge.ts').difficulty.tier, 'judgment', 'homes a FROZEN file')
      assert.match(byFile('src/bridge.ts').difficulty.reason, /homes 1 FROZEN file/)
      assert.equal(byFile('src/y0.ts').difficulty.tier, 'judgment', 'files name each other')
      assert.equal(byFile('src/hub.ts').difficulty.tier, 'judgment', 'contains a hub-let with fan-in')
      assert.match(byFile('src/hub.ts').difficulty.reason, /named by other files/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('every worker section in the brief carries one Difficulty line, right under its heading', () => {
    const root = mixedRepo()
    try {
      const plan = buildPlan(buildGraph(scanRepo(root)))
      const brief = renderBrief(plan)
      for (const p of plan.partitions) {
        const re = new RegExp(`^## ${p.worker} — \\d+ owned files\\n\\nDifficulty: ${p.difficulty.tier} — `, 'm')
        assert.match(brief, re)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the hook classifies each tier line the way the tier says', (t) => {
    const router = loadRouter()
    if (!router) return t.skip('model-routing hook not co-located; nothing to classify against')
    const decide = (prompt) => router.decide({ prompt })

    assert.equal(decide(difficultyLine({ tier: 'mechanical', reason: DIFFICULTY.mechanical })), 'haiku')
    assert.equal(decide(difficultyLine({ tier: 'judgment', reason: DIFFICULTY.judgment })), router.INHERIT)
    assert.equal(decide(difficultyLine({ tier: 'verification', reason: DIFFICULTY.verification })), 'opus')
  })

  test('the hook reads whole worker sections the same way, and the preamble pushes nothing', (t) => {
    const router = loadRouter()
    if (!router) return t.skip('model-routing hook not co-located; nothing to classify against')
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
      assert.equal(router.decide({ prompt: whole.preamble }), router.INHERIT, 'rules + FROZEN carry no signal of their own')
      for (const w of whole.workers) assert.equal(router.decide({ prompt: w }), router.INHERIT)

      const scoped = sections(buildPlan(scopeGraph(graph, ['scripts/*.sh']), { workers: 2 }))
      assert.equal(router.decide({ prompt: scoped.preamble }), router.INHERIT, 'the scope header carries no signal either')
      for (const w of scoped.workers) assert.equal(router.decide({ prompt: w }), 'haiku')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
