import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CHECK_ORDER, NEVER_MEASURED, SEVERITY_ORDER,
  checkBaseline, checkDiverge, checkDrift, checkGraph, checkTopology,
  diagnose, fixPlan, installedVersion, verdict,
} from '../src/doctor/checks.js'

/* ------------------------------------------------------------------ *
 * fixtures
 * ------------------------------------------------------------------ */

/** A repo the graph engine is happy with. */
function goodGraph(overrides = {}) {
  return {
    files: 44,
    coverage: 1,
    missedRefs: 0,
    sharedFiles: 2,
    sharedFraction: 0.045,
    recommendedWorkers: 6,
    verdict: { level: 'clean', message: 'This tree fans out cleanly.' },
    ...overrides,
  }
}

function goodTopology(overrides = {}) {
  return { path: '.argo/topology.json', rulesRan: true, errors: 0, warnings: 0, agents: 3, edges: 4, ...overrides }
}

function snapshot(id, capturedAt, packageVersion, fingerprint) {
  return { id, capturedAt, packageVersion, fingerprint }
}

/** Two snapshots of the same build, newest first. */
function stableDrift(overrides = {}) {
  return {
    snapshots: [
      snapshot('2.1.232-bbbb', '2026-08-17T23:15:41.531Z', '2.1.232', 'ffff'),
      snapshot('2.1.232-aaaa', '2026-08-10T10:00:00.000Z', '2.1.232', 'ffff'),
    ],
    selfreports: [
      { capturedAt: '2026-08-17T23:20:37.084Z', model: 'claude-opus-5', gateCount: 0, declaredNone: true, confidence: 'weak' },
    ],
    ...overrides,
  }
}

function goodBaseline(overrides = {}) {
  return {
    path: '.argo/baseline-0002.json',
    label: '0002',
    at: '2026-08-18T09:00:00.000Z',
    dryRun: false,
    verdict: { level: 'crew-pays', message: 'The fan-out is earning its calls.' },
    ...overrides,
  }
}

function goodDivergence(overrides = {}) {
  return {
    path: '.argo/divergence.json',
    at: '2026-08-19T13:53:00.000Z',
    mode: 'live',
    gate: 'max',
    threshold: 0.35,
    breaches: 0,
    worstPair: { a: 'agent-a', b: 'agent-b', meanDivergence: 0.05, maxDivergence: 0.11 },
    ...overrides,
  }
}

/** Everything measured, everything fine. */
function healthy(overrides = {}) {
  return {
    graph: goodGraph(),
    topology: goodTopology(),
    drift: stableDrift(),
    baseline: goodBaseline(),
    divergence: goodDivergence(),
    dryRunDivergence: false,
    ...overrides,
  }
}

const ids = (list) => list.map((f) => f.id)
const byId = (list, id) => list.find((f) => f.id === id)

/* ------------------------------------------------------------------ *
 * 1. graph
 * ------------------------------------------------------------------ */

test('a fully resolved clean graph produces one ok finding', () => {
  const out = checkGraph(goodGraph())
  assert.deepEqual(ids(out), ['graph.ok'])
  assert.equal(out[0].severity, 'ok')
  assert.match(out[0].detail, /coverage 100\.0%/)
})

test('coverage below 0.9 is a finding, because the plan is built on a partial graph', () => {
  const out = checkGraph(goodGraph({ coverage: 0.82, missedRefs: 31 }))
  const f = byId(out, 'graph.coverage')
  assert.equal(f.severity, 'warn')
  assert.match(f.title, /82\.0%/)
  assert.match(f.detail, /31 intra-repo reference/)
})

test('coverage exactly 0.9 is not a finding', () => {
  assert.deepEqual(ids(checkGraph(goodGraph({ coverage: 0.9 }))), ['graph.ok'])
})

test('a cycle across a partition boundary is an error, a hub-bound tree is a warning', () => {
  const cyc = checkGraph(goodGraph({ verdict: { level: 'serialise', message: '2 cycles cross.' } }))
  assert.equal(byId(cyc, 'graph.serialise').severity, 'error')

  const hub = checkGraph(goodGraph({ verdict: { level: 'hub-bound', message: 'hub-bound.' } }))
  assert.equal(byId(hub, 'graph.hub-bound').severity, 'warn')
})

test('an unbuildable graph is an error, not an absence', () => {
  const out = checkGraph(null)
  assert.deepEqual(ids(out), ['graph.unavailable'])
  assert.equal(out[0].severity, 'error')
})

/* ------------------------------------------------------------------ *
 * 2. topology
 * ------------------------------------------------------------------ */

test('no declared graph is an error whose fix is topology init', () => {
  const out = checkTopology(null)
  assert.deepEqual(ids(out), ['topology.missing'])
  assert.equal(out[0].severity, 'error')
  assert.equal(out[0].fix, 'argo topology init .')
})

test('a declaration that does not parse reports as malformed, not as missing', () => {
  const out = checkTopology(goodTopology({ rulesRan: false, errors: 1 }))
  assert.deepEqual(ids(out), ['topology.malformed'])
  assert.equal(out[0].severity, 'error')
})

test('lint errors and warnings fold in at their own severities', () => {
  const out = checkTopology(goodTopology({ errors: 2, warnings: 3 }))
  assert.deepEqual(ids(out), ['topology.errors', 'topology.warnings'])
  assert.equal(byId(out, 'topology.errors').severity, 'error')
  assert.equal(byId(out, 'topology.warnings').severity, 'warn')
})

/* ------------------------------------------------------------------ *
 * 3. drift
 * ------------------------------------------------------------------ */

test('zero snapshots is an error: there is no before', () => {
  const out = checkDrift({ snapshots: [], selfreports: [] })
  assert.equal(byId(out, 'drift.no-snapshots').severity, 'error')
  assert.equal(byId(out, 'drift.no-snapshots').fix, 'argo drift snapshot --label "first"')
})

test('one snapshot is a before with no after', () => {
  const out = checkDrift({ snapshots: [snapshot('a', '2026-08-01T00:00:00.000Z', '2.1.1', 'ff')], selfreports: [] })
  const f = byId(out, 'drift.one-snapshot')
  assert.equal(f.severity, 'warn')
  assert.match(f.title, /2\.1\.1/)
  assert.match(f.title, /2026-08-01T00:00:00\.000Z/)
})

test('an unchanged build is info and says which day it is a statement about', () => {
  const out = checkDrift(stableDrift())
  const f = byId(out, 'drift.stable')
  assert.equal(f.severity, 'info')
  assert.match(f.detail, /2026-08-17T23:15:41\.531Z/)
  assert.match(f.detail, /not about the build right now/)
})

test('a changed fingerprint between the last two snapshots is a finding', () => {
  const drift = stableDrift({
    snapshots: [
      snapshot('2.1.240-cccc', '2026-08-18T00:00:00.000Z', '2.1.240', 'aaaa'),
      snapshot('2.1.232-bbbb', '2026-08-17T00:00:00.000Z', '2.1.232', 'ffff'),
    ],
  })
  const f = byId(checkDrift(drift), 'drift.build-changed')
  assert.equal(f.severity, 'warn')
  assert.match(f.title, /2\.1\.232 -> 2\.1\.240/)
})

test('no stored selfreport is an error; a recorded gate is a warning; declared-none is info', () => {
  assert.equal(byId(checkDrift({ snapshots: [], selfreports: [] }), 'drift.no-selfreport').severity, 'error')

  const gated = stableDrift({
    selfreports: [{ capturedAt: '2026-08-17T23:20:37.084Z', model: 'claude-opus-5', gateCount: 2, declaredNone: false, confidence: 'strong' }],
  })
  const f = byId(checkDrift(gated), 'drift.gate-recorded')
  assert.equal(f.severity, 'warn')
  assert.match(f.title, /2 delegation gate/)

  assert.equal(byId(checkDrift(stableDrift()), 'drift.no-gate').severity, 'info')
})

test('a self-report with no gate and no declaration of none is inconclusive, not clean', () => {
  const drift = stableDrift({
    selfreports: [{ capturedAt: '2026-08-19T19:04:17.197Z', model: 'claude-opus-5', gateCount: 0, declaredNone: false, confidence: 'inconclusive' }],
  })
  const f = byId(checkDrift(drift), 'drift.selfreport-inconclusive')
  assert.equal(f.severity, 'warn')
  assert.match(f.detail, /not a\s+clean one/)
  assert.equal(byId(checkDrift(drift), 'drift.no-gate'), undefined)
})

/* ------------------------------------------------------------------ *
 * 4. baseline
 * ------------------------------------------------------------------ */

test('installedVersion takes the newest build and the first day it was seen', () => {
  const snaps = [
    snapshot('c', '2026-08-18T00:00:00.000Z', '2.1.240', 'a'),
    snapshot('b', '2026-08-16T00:00:00.000Z', '2.1.240', 'b'),
    snapshot('a', '2026-08-01T00:00:00.000Z', '2.1.232', 'c'),
  ]
  assert.deepEqual(installedVersion(snaps), { version: '2.1.240', firstSeen: '2026-08-16T00:00:00.000Z' })
  assert.deepEqual(installedVersion([]), { version: null, firstSeen: null })
})

test('no baseline at all is an error', () => {
  const out = checkBaseline(null, [])
  assert.deepEqual(ids(out), ['baseline.missing'])
  assert.equal(out[0].severity, 'error')
})

test('a dry-run baseline counts as never measured, not as a result', () => {
  const out = checkBaseline(goodBaseline({ dryRun: true, verdict: { level: 'crew-pays', message: 'x' } }), [])
  assert.deepEqual(ids(out), ['baseline.dry-run-only'])
  assert.equal(out[0].severity, 'error')
  assert.ok(NEVER_MEASURED.has('baseline.dry-run-only'))
})

test('crew-subtracts is an error and crew-neutral is a warning', () => {
  const sub = checkBaseline(goodBaseline({ verdict: { level: 'crew-subtracts', message: 'broke more than it fixed.' } }), stableDrift().snapshots)
  assert.equal(byId(sub, 'baseline.crew-subtracts').severity, 'error')

  const neu = checkBaseline(goodBaseline({ verdict: { level: 'crew-neutral', message: 'short of the bar.' } }), stableDrift().snapshots)
  assert.equal(byId(neu, 'baseline.crew-neutral').severity, 'warn')
})

test('a baseline older than the installed build is stale', () => {
  const snaps = [
    snapshot('new', '2026-08-18T00:00:00.000Z', '2.1.240', 'a'),
    snapshot('old', '2026-08-01T00:00:00.000Z', '2.1.232', 'c'),
  ]
  const stale = byId(checkBaseline(goodBaseline({ at: '2026-08-05T00:00:00.000Z' }), snaps), 'baseline.stale')
  assert.equal(stale.severity, 'warn')
  assert.match(stale.title, /2\.1\.240/)

  const fresh = checkBaseline(goodBaseline({ at: '2026-08-19T00:00:00.000Z' }), snaps)
  assert.equal(byId(fresh, 'baseline.stale'), undefined)
  assert.deepEqual(ids(fresh), ['baseline.ok'])
})

test('a baseline artifact with no readable verdict is an error, never a crew win', () => {
  for (const verdict of [null, undefined, {}, { level: 'something-else' }]) {
    const out = checkBaseline(goodBaseline({ verdict }), [])
    assert.deepEqual(ids(out), ['baseline.unreadable'], `verdict ${JSON.stringify(verdict)}`)
    assert.equal(out[0].severity, 'error')
    assert.ok(NEVER_MEASURED.has(out[0].id))
  }
})

test('with no snapshots, staleness is unanswerable rather than absent', () => {
  const out = checkBaseline(goodBaseline(), [])
  const f = byId(out, 'baseline.age-unknown')
  assert.equal(f.severity, 'warn')
  assert.match(f.detail, /unanswerable, not absent/)
})

/* ------------------------------------------------------------------ *
 * 5. diverge
 * ------------------------------------------------------------------ */

test('never measured and dry-run-only are different findings', () => {
  assert.deepEqual(ids(checkDiverge(null, false)), ['diverge.missing'])
  assert.deepEqual(ids(checkDiverge(null, true)), ['diverge.dry-run-only'])
  assert.equal(checkDiverge(null, true)[0].severity, 'error')
})

test('a stored report in dry-run mode is not evidence about the agents', () => {
  const out = checkDiverge(goodDivergence({ mode: 'dry-run' }), false)
  assert.deepEqual(ids(out), ['diverge.dry-run-only'])
})

test('a breached pair is an error naming the worst pair', () => {
  const out = checkDiverge(goodDivergence({
    breaches: 1,
    worstPair: { a: 'agent-a', b: 'agent-b', meanDivergence: 0.25, maxDivergence: 1 },
  }))
  const f = byId(out, 'diverge.breach')
  assert.equal(f.severity, 'error')
  assert.match(f.detail, /agent-a <-> agent-b/)
  assert.match(f.detail, /fleet mean/)
})

test('a clean divergence run still reports the worst pair and the gate it cleared', () => {
  const f = checkDiverge(goodDivergence())[0]
  assert.equal(f.id, 'diverge.ok')
  assert.match(f.detail, /gate max @ 0\.35/)
  assert.match(f.detail, /2026-08-19T13:53:00\.000Z/)
})

test('a run where no pair scored is an error, not zero breaches', () => {
  const out = checkDiverge(goodDivergence({ breaches: 0, worstPair: null }))
  assert.deepEqual(ids(out), ['diverge.no-data'])
  assert.equal(out[0].severity, 'error')
  assert.ok(NEVER_MEASURED.has(out[0].id))
})

test('a repo whose only measurements are empty artifacts cannot read as clean', () => {
  const result = diagnose(healthy({
    baseline: goodBaseline({ verdict: null }),
    divergence: goodDivergence({ worstPair: null }),
  }))
  assert.equal(result.verdict.level, 'blocked')
  assert.equal(result.counts.error, 2)
  assert.equal(result.counts.neverMeasured, 2)
})

/* ------------------------------------------------------------------ *
 * join, verdict, fix plan
 * ------------------------------------------------------------------ */

test('an empty repo can never read as clean — every check reports never measured', () => {
  const result = diagnose({ graph: goodGraph(), topology: null, drift: { snapshots: [], selfreports: [] }, baseline: null, divergence: null })
  assert.equal(result.verdict.level, 'blocked')
  assert.equal(result.counts.error, 5)
  assert.equal(result.counts.neverMeasured, 5)
  assert.match(result.verdict.message, /an unmeasured check is not a passing one/)
})

test('a fully measured healthy repo reads clean, and says what clean means', () => {
  const result = diagnose(healthy())
  assert.equal(result.counts.error, 0)
  assert.equal(result.counts.warn, 0)
  assert.equal(result.counts.neverMeasured, 0)
  assert.equal(result.verdict.level, 'clean')
  assert.match(result.verdict.message, /only ever as current as the day each was taken/)
})

test('warnings alone give watch, not clean and not blocked', () => {
  const result = diagnose(healthy({ topology: goodTopology({ warnings: 1 }) }))
  assert.equal(result.verdict.level, 'watch')
  assert.equal(result.counts.error, 0)
  assert.equal(result.counts.warn, 1)
})

test('findings sort by severity first and by check order inside a severity', () => {
  const result = diagnose({
    graph: goodGraph({ coverage: 0.5, missedRefs: 9 }),
    topology: null,
    drift: stableDrift(),
    baseline: goodBaseline({ verdict: { level: 'crew-subtracts', message: 'x' } }),
    divergence: goodDivergence({ breaches: 1 }),
  })
  const order = ids(result.findings)
  assert.deepEqual(order.slice(0, 3), ['topology.missing', 'baseline.crew-subtracts', 'diverge.breach'])
  // severity never goes backwards
  const rank = (f) => SEVERITY_ORDER.indexOf(f.severity)
  for (let i = 1; i < result.findings.length; i++) {
    assert.ok(rank(result.findings[i]) >= rank(result.findings[i - 1]))
  }
})

test('every finding carries the full shape, and only open ones carry a fix', () => {
  const result = diagnose({ graph: goodGraph(), topology: null, drift: { snapshots: [], selfreports: [] }, baseline: null, divergence: null })
  for (const f of result.findings) {
    assert.equal(typeof f.id, 'string')
    assert.ok(SEVERITY_ORDER.includes(f.severity))
    assert.equal(typeof f.title, 'string')
    assert.equal(typeof f.detail, 'string')
    if (f.severity === 'error' || f.severity === 'warn') assert.equal(typeof f.fix, 'string')
  }
})

test('the fix plan is ordered, deduplicated, and skips anything not open', () => {
  const result = diagnose({
    graph: goodGraph(),
    topology: null,
    drift: { snapshots: [], selfreports: [] },
    baseline: goodBaseline({ verdict: { level: 'crew-subtracts', message: 'x' } }),
    divergence: null,
  })
  const plan = fixPlan(result.findings)
  const commands = plan.map((p) => p.command)

  assert.equal(new Set(commands).size, commands.length)
  assert.ok(commands.includes('argo topology init .'))
  assert.ok(!plan.some((p) => p.severity === 'ok' || p.severity === 'info'))
  // baseline.crew-subtracts and baseline.stale share a command; it appears once
  assert.equal(commands.filter((c) => c === 'argo baseline --tasks examples/tasks.json').length, 1)
  assert.deepEqual(fixPlan([]), [])
})

test('diagnose is deterministic and names every check it ran', () => {
  const obs = healthy({ graph: goodGraph({ coverage: 0.4, missedRefs: 12 }) })
  assert.deepEqual(diagnose(obs), diagnose(obs))
  assert.deepEqual(CHECK_ORDER, ['graph', 'topology', 'drift', 'baseline', 'diverge'])
  assert.equal(diagnose(obs).counts.checks, CHECK_ORDER.length)
})

test('verdict counts unmeasured checks separately from failed ones', () => {
  const v = verdict({ error: 3, warn: 1, info: 0, ok: 1, neverMeasured: 0, checks: 5 })
  assert.equal(v.level, 'blocked')
  assert.doesNotMatch(v.message, /never measured/)
  assert.match(verdict({ error: 3, warn: 1, info: 0, ok: 1, neverMeasured: 2, checks: 5 }).message, /2 of them are things nobody has ever measured/)
})
