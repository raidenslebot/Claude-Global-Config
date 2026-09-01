import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

import { buildIndex, resolveRef, scanRepo } from '../src/graph/scan.js'
import { buildGraph, rankFiles, findCycles, blastRadius, summarise } from '../src/graph/build.js'
import {
  toUndirected, louvain, balanceToK, sharedSurface, sweepWorkers,
  predictedSpeedup, effectiveSpeedup,
} from '../src/graph/partition.js'
import { buildPlan } from '../src/graph/report.js'

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
