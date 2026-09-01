import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

import {
  AGENT_TYPES, EDGE_KINDS, SOFT_FANOUT_LIMIT, TopologyError,
  globsOverlap, lint, normalise, normaliseGlob, parseDeclaration,
} from '../src/topology/lint.js'
import { parseYaml } from '../src/topology/yaml.js'
import { renderDot, renderMermaid } from '../src/topology/render.js'
import { buildDeclaration, ownedGlobs } from '../src/topology/init.js'

/* ------------------------------------------------------------------ *
 * fixtures
 * ------------------------------------------------------------------ */

/** A fleet that breaks no rule: one supervisor, two workers, disjoint writes. */
function cleanFleet(overrides = {}) {
  return {
    name: 'test fleet',
    agents: [
      { id: 'supervisor', role: 'supervisor', writes: [] },
      { id: 'w1', role: 'worker', writes: ['src/a/**'] },
      { id: 'w2', role: 'worker', writes: ['src/b/**'] },
    ],
    edges: [
      { from: 'supervisor', to: 'w1', kind: 'dispatch' },
      { from: 'supervisor', to: 'w2', kind: 'dispatch' },
      { from: 'w1', to: 'supervisor', kind: 'report' },
      { from: 'w2', to: 'supervisor', kind: 'report' },
    ],
    sharedState: [],
    ...overrides,
  }
}

const rules = (result) => result.findings.map((f) => f.rule)
const of = (result, rule) => result.findings.filter((f) => f.rule === rule)

/* ------------------------------------------------------------------ *
 * baseline
 * ------------------------------------------------------------------ */

test('a well-formed fleet produces no findings', () => {
  const result = lint(cleanFleet())
  assert.deepEqual(result.findings, [])
  assert.equal(result.ok, true)
  assert.equal(result.errors, 0)
  assert.equal(result.stats.agents, 3)
  assert.equal(result.stats.supervisors, 1)
  assert.equal(result.stats.byKind.dispatch, 2)
})

test('lint is deterministic', () => {
  const decl = cleanFleet({
    agents: [
      { id: 'supervisor', role: 'supervisor', writes: [] },
      { id: 'w1', role: 'worker', writes: ['src/**'] },
      { id: 'w2', role: 'worker', writes: ['src/a/*.js'] },
    ],
  })
  const a = JSON.stringify(lint(decl).findings)
  const b = JSON.stringify(lint(decl).findings)
  assert.equal(a, b)
})

/* ------------------------------------------------------------------ *
 * schema
 * ------------------------------------------------------------------ */

test('schema errors stop the rules from running', () => {
  const result = lint({ agents: [{ id: 'a', role: 'worker' }], edges: [{ from: 'a', to: 'ghost' }] })
  assert.equal(result.rulesRan, false)
  assert.equal(result.errors > 0, true)
  assert.deepEqual([...new Set(rules(result))], ['SCHEMA'])
  assert.match(result.findings[0].message, /unknown agent "ghost"/)
})

test('schema catches duplicate ids, bad kinds and self-edges', () => {
  const dup = lint({ agents: [{ id: 'a', role: 'worker' }, { id: 'a', role: 'worker' }] })
  assert.match(dup.findings.map((f) => f.message).join(' '), /duplicate agent id "a"/)

  const kind = lint({
    agents: [{ id: 'a', role: 'supervisor' }, { id: 'b', role: 'worker' }],
    edges: [{ from: 'a', to: 'b', kind: 'gossip' }],
  })
  assert.match(kind.findings.map((f) => f.message).join(' '), /unknown kind "gossip"/)

  const self = lint({
    agents: [{ id: 'a', role: 'supervisor' }],
    edges: [{ from: 'a', to: 'a', kind: 'dispatch' }],
  })
  assert.match(self.findings.map((f) => f.message).join(' '), /self-edge/)
})

test('a missing role is assumed to be worker, with a warning', () => {
  const { decl, findings } = normalise({ agents: [{ id: 'a' }] })
  assert.equal(decl.agents[0].role, 'worker')
  assert.equal(findings.filter((f) => f.severity === 'error').length, 0)
  assert.match(findings[0].message, /declares no role/)
})

/* ------------------------------------------------------------------ *
 * R1 — supervision
 * ------------------------------------------------------------------ */

test('R1 fails when nothing supervises the fan-out', () => {
  const decl = cleanFleet()
  decl.agents[0].role = 'worker'
  const result = lint(decl)
  assert.equal(of(result, 'R1').length, 1)
  assert.equal(of(result, 'R1')[0].severity, 'error')
  assert.match(of(result, 'R1')[0].message, /no agent declares role "supervisor"/)
})

test('R1 fails on two supervisors over one worker, and passes with the opt-in', () => {
  const decl = {
    agents: [
      { id: 's1', role: 'supervisor', writes: [] },
      { id: 's2', role: 'supervisor', writes: [] },
      { id: 'w1', role: 'worker', writes: ['src/a/**'] },
    ],
    edges: [
      { from: 's1', to: 'w1', kind: 'dispatch' },
      { from: 's2', to: 'w1', kind: 'dispatch' },
      { from: 'w1', to: 's1', kind: 'report' },
    ],
  }
  const strict = lint(decl)
  assert.equal(of(strict, 'R1').length, 2)
  assert.equal(strict.ok, false)

  const opted = lint({ ...decl, allowMultipleSupervisors: true })
  assert.deepEqual(of(opted, 'R1'), [])
  assert.equal(opted.ok, true)
})

/* ------------------------------------------------------------------ *
 * R2 — peer edges
 * ------------------------------------------------------------------ */

test('R2 rejects an unjustified peer edge and allowlists a justified one', () => {
  const bare = cleanFleet()
  bare.edges.push({ from: 'w1', to: 'w2', kind: 'peer' })
  const strict = lint(bare)
  assert.equal(of(strict, 'R2').length, 1)
  assert.equal(of(strict, 'R2')[0].severity, 'error')
  assert.equal(strict.ok, false)

  const justified = cleanFleet()
  justified.edges.push({
    from: 'w1', to: 'w2', kind: 'peer',
    justification: 'w2 consumes the generated schema w1 owns; supervisor round-trip costs a whole pass',
  })
  const allowed = lint(justified)
  assert.equal(of(allowed, 'R2').length, 1)
  assert.equal(of(allowed, 'R2')[0].severity, 'warn')
  assert.equal(allowed.ok, true)
})

/* ------------------------------------------------------------------ *
 * R3 — dispatch cycles
 * ------------------------------------------------------------------ */

test('R3 catches a dispatch cycle and reports the path', () => {
  const decl = cleanFleet()
  decl.edges.push({ from: 'w1', to: 'w2', kind: 'dispatch' })
  decl.edges.push({ from: 'w2', to: 'w1', kind: 'dispatch' })
  const result = lint(decl)
  assert.equal(of(result, 'R3').length, 1)
  assert.match(of(result, 'R3')[0].message, /w1 -> w2 -> w1/)
})

test('R3 reports one finding per cycle, not one per traversal', () => {
  const decl = {
    agents: [
      { id: 's', role: 'supervisor' },
      { id: 'a', role: 'worker' }, { id: 'b', role: 'worker' }, { id: 'c', role: 'worker' },
    ],
    edges: [
      { from: 's', to: 'a', kind: 'dispatch' },
      { from: 'a', to: 'b', kind: 'dispatch' },
      { from: 'b', to: 'c', kind: 'dispatch' },
      { from: 'c', to: 'a', kind: 'dispatch' },
      { from: 'a', to: 's', kind: 'report' },
      { from: 'b', to: 's', kind: 'report' },
      { from: 'c', to: 's', kind: 'report' },
    ],
  }
  assert.equal(of(lint(decl), 'R3').length, 1)
})

test('R3 ignores cycles made of report edges', () => {
  const decl = cleanFleet()
  decl.edges.push({ from: 'supervisor', to: 'w1', kind: 'report' })
  assert.deepEqual(of(lint(decl), 'R3'), [])
})

/* ------------------------------------------------------------------ *
 * R4 — report paths
 * ------------------------------------------------------------------ */

test('R4 fails on a worker with no report edge', () => {
  const decl = cleanFleet()
  decl.edges = decl.edges.filter((e) => !(e.from === 'w2' && e.kind === 'report'))
  const result = lint(decl)
  assert.equal(of(result, 'R4').length, 1)
  assert.match(of(result, 'R4')[0].message, /"w2" has no report edge/)
})

test('R4 fails on two report destinations', () => {
  const decl = cleanFleet()
  decl.edges.push({ from: 'w1', to: 'w2', kind: 'report' })
  const result = lint(decl)
  assert.equal(of(result, 'R4').length, 1)
  assert.match(of(result, 'R4')[0].message, /reports to 2 places/)
})

test('R4 accepts a chain that ends at a supervisor', () => {
  const decl = {
    agents: [
      { id: 's', role: 'supervisor' },
      { id: 'lead', role: 'worker' },
      { id: 'w', role: 'worker' },
    ],
    edges: [
      { from: 's', to: 'lead', kind: 'dispatch' },
      { from: 'lead', to: 'w', kind: 'dispatch' },
      { from: 'w', to: 'lead', kind: 'report' },
      { from: 'lead', to: 's', kind: 'report' },
    ],
  }
  assert.deepEqual(of(lint(decl), 'R4'), [])
})

test('R4 fails when the report chain never reaches a supervisor', () => {
  const decl = {
    agents: [
      { id: 's', role: 'supervisor' },
      { id: 'a', role: 'worker' },
      { id: 'b', role: 'worker' },
    ],
    edges: [
      { from: 's', to: 'a', kind: 'dispatch' },
      { from: 's', to: 'b', kind: 'dispatch' },
      { from: 'a', to: 'b', kind: 'report' },
      { from: 'b', to: 's', kind: 'report' },
    ],
  }
  const result = lint(decl)
  assert.deepEqual(of(result, 'R4'), [])

  const broken = structuredClone(decl)
  broken.edges = broken.edges.filter((e) => !(e.from === 'b' && e.kind === 'report'))
  const bad = lint(broken)
  assert.equal(of(bad, 'R4').length, 2)
  assert.match(of(bad, 'R4').map((f) => f.message).join(' '), /never reaches a supervisor/)
})

/* ------------------------------------------------------------------ *
 * R5 — shared state writers
 * ------------------------------------------------------------------ */

test('R5 flags shared state with more than one writer', () => {
  const one = cleanFleet({
    sharedState: [{ id: 'notes', readers: ['w1', 'w2'], writers: ['w1'] }],
  })
  assert.deepEqual(of(lint(one), 'R5'), [])

  const many = cleanFleet({
    sharedState: [{ id: 'notes', readers: ['w1', 'w2'], writers: ['w1', 'w2'] }],
  })
  const result = lint(many)
  assert.equal(of(result, 'R5').length, 1)
  assert.equal(of(result, 'R5')[0].severity, 'warn')
  assert.equal(result.ok, true, 'a shared-state warning does not fail the build')
})

/* ------------------------------------------------------------------ *
 * R6 — orphans
 * ------------------------------------------------------------------ */

test('R6 catches an agent nobody dispatches to', () => {
  const decl = cleanFleet()
  decl.agents.push({ id: 'stray', role: 'worker', writes: ['src/c/**'] })
  decl.edges.push({ from: 'stray', to: 'supervisor', kind: 'report' })
  const result = lint(decl)
  assert.equal(of(result, 'R6').length, 1)
  assert.match(of(result, 'R6')[0].message, /never dispatched to/)
  assert.deepEqual(of(result, 'R6')[0].agents, ['stray'])
})

test('R6 names a fully disconnected agent as an orphan', () => {
  const decl = cleanFleet()
  decl.agents.push({ id: 'stray', role: 'worker', writes: [] })
  assert.match(of(lint(decl), 'R6')[0].message, /is an orphan/)
})

test('R6 accepts an agent reached through another worker', () => {
  const decl = cleanFleet()
  decl.agents.push({ id: 'w3', role: 'worker', writes: ['src/c/**'] })
  decl.edges.push({ from: 'w1', to: 'w3', kind: 'dispatch' })
  decl.edges.push({ from: 'w3', to: 'supervisor', kind: 'report' })
  assert.deepEqual(of(lint(decl), 'R6'), [])
})

/* ------------------------------------------------------------------ *
 * R7 — fan-out width
 * ------------------------------------------------------------------ */

function wideFleet(n) {
  const agents = [{ id: 'supervisor', role: 'supervisor', writes: [] }]
  const edges = []
  for (let i = 1; i <= n; i++) {
    agents.push({ id: `w${i}`, role: 'worker', writes: [`src/w${i}/**`] })
    edges.push({ from: 'supervisor', to: `w${i}`, kind: 'dispatch' })
    edges.push({ from: `w${i}`, to: 'supervisor', kind: 'report' })
  }
  return { name: 'wide', agents, edges, sharedState: [] }
}

test('R7 warns softly when no measured width is available', () => {
  assert.deepEqual(of(lint(wideFleet(SOFT_FANOUT_LIMIT)), 'R7'), [])
  const result = lint(wideFleet(SOFT_FANOUT_LIMIT + 1))
  assert.equal(of(result, 'R7').length, 1)
  assert.equal(of(result, 'R7')[0].severity, 'warn')
  assert.match(of(result, 'R7')[0].fix, /argo graph/)
  assert.equal(result.ok, true)
})

test('R7 checks against the measured repo when a plan is present', () => {
  const plan = { recommendedWorkers: 3, sharedFraction: 0.12, sharedSurface: [{ file: 'a' }] }
  const wide = lint(wideFleet(5), { plan })
  assert.equal(of(wide, 'R7').length, 1)
  assert.match(of(wide, 'R7')[0].message, /supports 3/)
  assert.equal(wide.checkedAgainstGraph, true)

  const narrow = lint(wideFleet(3), { plan })
  assert.deepEqual(of(narrow, 'R7'), [])
})

test('R7 fires at exactly one worker past the measured cap', () => {
  const plan = { recommendedWorkers: 3, sharedFraction: 0.12, sharedSurface: [{ file: 'a' }] }
  // The boundary is the whole rule: at the cap it is silent, one past it it speaks.
  assert.deepEqual(of(lint(wideFleet(3), { plan }), 'R7'), [])
  const over = of(lint(wideFleet(4), { plan }), 'R7')
  assert.equal(over.length, 1)
  assert.equal(over[0].severity, 'warn')
  assert.match(over[0].message, /dispatches to 4 workers/)
  assert.match(over[0].message, /supports 3/)
})

/* ------------------------------------------------------------------ *
 * R8 — write collisions
 * ------------------------------------------------------------------ */

test('R8 catches two agents claiming the same path', () => {
  const decl = cleanFleet()
  decl.agents[1].writes = ['src/**']
  decl.agents[2].writes = ['src/b/*.js']
  const result = lint(decl)
  assert.equal(of(result, 'R8').length, 1)
  assert.equal(of(result, 'R8')[0].severity, 'error')
  assert.deepEqual(of(result, 'R8')[0].agents, ['w1', 'w2'])
})

test('R8 leaves disjoint globs alone', () => {
  assert.deepEqual(of(lint(cleanFleet()), 'R8'), [])
})

test('globsOverlap answers the question a filesystem would', () => {
  const yes = [
    ['src/**', 'src/graph/*.js'],
    ['**', 'anything/at/all.ts'],
    ['*.js', 'a.js'],
    ['src/a/**', 'src/a/**'],
    ['src/*/cmd.js', 'src/topology/cmd.js'],
    ['docs/', 'docs/intro.md'],
  ]
  for (const [a, b] of yes) assert.equal(globsOverlap(a, b), true, `${a} ~ ${b}`)

  const no = [
    ['src/a/**', 'src/b/**'],
    ['src/*', 'src/graph/scan.js'],
    ['*.js', 'a.ts'],
    ['src/**/*.ts', 'test/**/*.ts'],
    ['README.md', 'CHANGELOG.md'],
  ]
  for (const [a, b] of no) assert.equal(globsOverlap(a, b), false, `${a} !~ ${b}`)
})

test('globsOverlap is symmetric and normalises separators', () => {
  assert.equal(globsOverlap('src\\a\\**', 'src/a/one.js'), true)
  assert.equal(globsOverlap('src/a/one.js', 'src\\a\\**'), true)
  assert.equal(normaliseGlob('./src/a/'), 'src/a/**')
})

/* ------------------------------------------------------------------ *
 * R9 — agentType
 * ------------------------------------------------------------------ */

test('the known agent types are the ones the plugin ships', () => {
  // Read what is on disk. Restating the constant here would let a renamed or
  // deleted plugin/agents/*.md leave R9 blessing a type nothing resolves —
  // which is the exact failure R9 claims to catch.
  const dir = new URL('../plugin/agents/', import.meta.url)
  const shipped = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const front = readFileSync(new URL(f, dir), 'utf8').split(/^---\s*$/m)[1] || ''
      const name = /^name:\s*(\S+)/m.exec(front)
      assert.ok(name, `${f} has no "name:" in its frontmatter — nothing can dispatch it`)
      return name[1]
    })
  assert.deepEqual([...AGENT_TYPES].sort(), shipped.sort())
})

test('normalise carries agentType through, and defaults it to empty', () => {
  const { decl } = normalise({
    agents: [
      { id: 's', role: 'supervisor', agentType: '  graph-supervisor  ' },
      { id: 'w', role: 'worker' },
      { id: 'x', role: 'worker', agentType: 42 },
    ],
  })
  assert.equal(decl.agents[0].agentType, 'graph-supervisor')
  assert.equal(decl.agents[1].agentType, '')
  assert.equal(decl.agents[2].agentType, '')
})

test('R9 is silent on a known agentType and on no agentType at all', () => {
  const typed = cleanFleet()
  typed.agents[0].agentType = 'graph-supervisor'
  typed.agents[1].agentType = 'graph-worker'
  typed.agents[2].agentType = 'hub-splitter'
  assert.deepEqual(of(lint(typed), 'R9'), [])
  assert.deepEqual(of(lint(cleanFleet()), 'R9'), [])
})

test('R9 warns on an agentType nothing ships, and names the known set', () => {
  const decl = cleanFleet()
  decl.agents[1].agentType = 'graph-wroker'
  const result = lint(decl)
  assert.equal(of(result, 'R9').length, 1)
  const [f] = of(result, 'R9')
  assert.equal(f.severity, 'warn')
  assert.deepEqual(f.agents, ['w1'])
  assert.match(f.message, /agentType "graph-wroker"/)
  for (const known of AGENT_TYPES) assert.match(f.message, new RegExp(known))
  // A typo here is a fleet that will not dispatch, but it is not a bad graph:
  // the shape still lints, so it warns rather than failing the build.
  assert.equal(result.ok, true)
})

test('R9 reports one finding per mistyped agent', () => {
  const decl = cleanFleet()
  decl.agents[1].agentType = 'nope'
  decl.agents[2].agentType = 'also-nope'
  assert.equal(of(lint(decl), 'R9').length, 2)
})

test('R9 does not run while the declaration is malformed', () => {
  const result = lint({
    agents: [{ id: 'a', role: 'worker', agentType: 'nope' }],
    edges: [{ from: 'a', to: 'ghost' }],
  })
  assert.equal(result.rulesRan, false)
  assert.deepEqual(of(result, 'R9'), [])
})

/* ------------------------------------------------------------------ *
 * declaration parsing
 * ------------------------------------------------------------------ */

const YAML_FLEET = `
# a fleet declared by hand
name: test fleet
allowMultipleSupervisors: false
agents:
  - id: supervisor
    role: supervisor
    writes: []
  - id: w1
    role: worker
    writes: [src/a/**]
  - id: w2
    role: worker
    writes:
      - src/b/**
edges:
  - from: supervisor
    to: w1
    kind: dispatch
  - from: supervisor
    to: w2
    kind: dispatch
  - from: w1
    to: supervisor
    kind: report
  - from: w2
    to: supervisor
    kind: report
sharedState: []
`

test('the yaml subset parses to the same graph as the json', () => {
  const fromYaml = parseDeclaration(YAML_FLEET, { file: 'topology.yaml' })
  assert.deepEqual(normalise(fromYaml).decl, normalise(cleanFleet()).decl)
  assert.deepEqual(lint(fromYaml).findings, [])
})

test('the yaml reader handles comments, quotes, nesting and inline lists', () => {
  const parsed = parseYaml([
    'name: "a # not a comment"   # this one is',
    'count: 3',
    'on: true',
    'tools: [read, grep, "edit files"]',
    'nested:',
    '  deep:',
    '    - one',
    '    - two',
  ].join('\n'))
  assert.deepEqual(parsed, {
    name: 'a # not a comment',
    count: 3,
    on: true,
    tools: ['read', 'grep', 'edit files'],
    nested: { deep: ['one', 'two'] },
  })
})

test('the yaml reader refuses what it cannot read honestly', () => {
  const cases = [
    'agents:\n\t- id: a',
    'note: |\n  a block scalar',
    'base: &anchor\nother: *anchor',
    'agent: { id: a }',
    'a: 1\nb: [1, 2',
  ]
  for (const text of cases) {
    assert.throws(() => parseYaml(text), TopologyError, `should reject: ${text}`)
  }
  assert.throws(() => parseYaml('a: 1\nb: |\n  x'), /JSON/)
})

test('globs survive the yaml reader instead of being read as aliases', () => {
  assert.deepEqual(parseYaml('writes: [**, *.js, src/**]').writes, ['**', '*.js', 'src/**'])
})

test('a # only starts a comment when whitespace precedes it', () => {
  // Unquoted values carry # all the time — fragment ids, issue numbers, C# —
  // and truncating them silently would corrupt a declaration rather than reject it.
  assert.deepEqual(parseYaml('a: b#c'), { a: 'b#c' })
  assert.deepEqual(parseYaml('url: http://x/y#frag'), { url: 'http://x/y#frag' })
  assert.deepEqual(parseYaml('a: b # c'), { a: 'b' })
  assert.deepEqual(parseYaml('a: b\t# c'), { a: 'b' })
  assert.deepEqual(parseYaml('# whole line\na: b'), { a: 'b' })
})

test('the yaml reader rejects a duplicate key instead of picking a winner', () => {
  // Two values for one key is exactly the "two people read this file differently"
  // failure the module exists to catch, so it is an error, not a last-one-wins.
  assert.throws(() => parseYaml('a: 1\na: 2'), TopologyError)
  assert.throws(() => parseYaml('a: 1\na: 2'), /duplicate key "a"/)
  assert.throws(() => parseYaml('agents:\n  - id: x\n    id: y'), /duplicate key "id"/)
  // ...but the same key under two different parents is fine.
  assert.deepEqual(parseYaml('one:\n  id: a\ntwo:\n  id: b'), { one: { id: 'a' }, two: { id: 'b' } })
})

test('parseDeclaration reports bad json as a topology error', () => {
  assert.throws(() => parseDeclaration('{ "agents": [', { file: 'topology.json' }), TopologyError)
  assert.throws(() => parseDeclaration('   '), /empty/)
})

/* ------------------------------------------------------------------ *
 * init
 * ------------------------------------------------------------------ */

const PARTITIONS = [
  { id: 0, worker: 'worker-1', ownedExclusively: ['src/a/one.js', 'src/a/two.js'] },
  { id: 1, worker: 'worker-2', ownedExclusively: ['src/b/one.js', 'root.js'] },
]

test('ownedGlobs widens to a directory only when the whole subtree is owned', () => {
  const globs = ownedGlobs(PARTITIONS, ['src/shared.js'])
  assert.deepEqual(globs, [['src/a/**'], ['root.js', 'src/b/**']])
})

test('ownedGlobs never widens over a frozen file', () => {
  const globs = ownedGlobs(
    [{ id: 0, worker: 'worker-1', ownedExclusively: ['src/a/one.js'] }],
    ['src/a/frozen.js']
  )
  assert.deepEqual(globs, [['src/a/one.js']])
})

test('a generated declaration lints clean', () => {
  const plan = {
    partitions: PARTITIONS,
    sharedSurface: [{ file: 'src/shared.js' }],
    stats: { files: 5 },
    recommendedWorkers: 2,
  }
  const decl = buildDeclaration(plan, { name: 'demo fleet' })
  assert.equal(decl.agents.length, 3)
  assert.equal(decl.agents[0].role, 'supervisor')
  // The generated file names the definitions under plugin/agents/, so lint is
  // checking the fleet that will really be dispatched.
  assert.deepEqual(decl.agents.map((a) => a.agentType),
    ['graph-supervisor', 'graph-worker', 'graph-worker'])
  for (const a of decl.agents) assert.equal(AGENT_TYPES.has(a.agentType), true)
  assert.deepEqual(decl.agents[0].writes, [])
  assert.equal(decl.edges.filter((e) => e.kind === 'peer').length, 0)
  assert.deepEqual(decl.sharedState[0].writers, [])

  const result = lint(decl, { plan })
  assert.deepEqual(result.findings, [])
  assert.equal(result.ok, true)
})

test('a generated declaration still lints clean with no shared surface', () => {
  const plan = { partitions: PARTITIONS, sharedSurface: [], stats: { files: 4 }, recommendedWorkers: 2 }
  const decl = buildDeclaration(plan)
  assert.deepEqual(decl.sharedState, [])
  assert.deepEqual(lint(decl, { plan }).findings, [])
})

/* ------------------------------------------------------------------ *
 * rendering
 * ------------------------------------------------------------------ */

function peerFleet() {
  const decl = cleanFleet({ sharedState: [{ id: 'notes', readers: ['w1', 'w2'], writers: ['w1'] }] })
  decl.agents[0].model = 'claude-opus-5'
  decl.edges.push({ from: 'w1', to: 'w2', kind: 'peer', justification: 'reviewed weekly' })
  return normalise(decl).decl
}

test('mermaid draws peer edges red and shared state as its own node', () => {
  const out = renderMermaid(peerFleet())
  assert.match(out, /^flowchart TD/)
  assert.match(out, /a0\[\["supervisor/)
  assert.match(out, /s0\[\("notes<br\/>1 writer\(s\) · 2 reader\(s\)"\)\]/)
  assert.match(out, /==>\|peer\|/)
  const peerIndex = out.split('\n').filter((l) => /-->|==>|-\.->/.test(l) && !l.includes('linkStyle'))
    .findIndex((l) => l.includes('|peer|'))
  assert.match(out, new RegExp(`linkStyle ${peerIndex} stroke:#e5484d`))
})

test('dot marks the peer edge and the shared state too', () => {
  const out = renderDot(peerFleet())
  assert.match(out, /^digraph topology \{/)
  assert.match(out, /"supervisor" \[shape=doubleoctagon/)
  // graphviz wants a single backslash-n inside the label, not an escaped one
  assert.match(out, /label="supervisor\\nsupervisor · claude-opus-5"/)
  assert.match(out, /label="peer", color="#e5484d"/)
  assert.match(out, /"state:notes" \[shape=cylinder/)
  assert.match(out, /"w1" -> "state:notes" \[label="writes"/)
})

test('both renderers surface agentType next to the role', () => {
  const decl = normalise(cleanFleet({
    agents: [
      { id: 'supervisor', role: 'supervisor', agentType: 'graph-supervisor', writes: [] },
      { id: 'w1', role: 'worker', agentType: 'graph-worker', writes: ['src/a/**'] },
      { id: 'w2', role: 'worker', writes: ['src/b/**'] },
    ],
  })).decl
  const mermaid = renderMermaid(decl)
  assert.match(mermaid, /<i>supervisor · graph-supervisor<\/i>/)
  assert.match(mermaid, /<i>worker · graph-worker<\/i>/)
  // No agentType declared: draw the role alone rather than a dangling separator.
  assert.match(mermaid, /w2<br\/><i>worker<\/i>/)

  const dot = renderDot(decl)
  assert.match(dot, /label="supervisor\\nsupervisor · graph-supervisor"/)
  assert.match(dot, /label="w1\\nworker · graph-worker"/)
  assert.match(dot, /label="w2\\nworker"/)
})

test('renderers are stable across calls', () => {
  const decl = peerFleet()
  assert.equal(renderMermaid(decl), renderMermaid(decl))
  assert.equal(renderDot(decl), renderDot(decl))
})

test('every edge kind is renderable', () => {
  assert.deepEqual([...EDGE_KINDS], ['dispatch', 'report', 'peer', 'broadcast'])
  const decl = normalise(cleanFleet({
    edges: [
      { from: 'supervisor', to: 'w1', kind: 'dispatch' },
      { from: 'w1', to: 'supervisor', kind: 'report' },
      { from: 'w1', to: 'w2', kind: 'peer', justification: 'x' },
      { from: 'w2', to: 'w1', kind: 'broadcast' },
    ],
  })).decl
  const mermaid = renderMermaid(decl)
  for (const kind of EDGE_KINDS) assert.match(mermaid, new RegExp(`\\|${kind}\\|`))
})
