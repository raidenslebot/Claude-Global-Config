/**
 * Pins the gate semantics of `argo diverge`.
 *
 * These exist because the default was changed from mean to max and the whole
 * suite stayed green — the gate had never been pinned, so the number that
 * decides a CI exit code was free to drift. The scenario below is the real one
 * observed on this repo: a pair whose mean (0.332) passes while a single probe
 * they flatly contradict on (0.877) is the actual finding.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { buildReport } from '../src/divergence/report.js'

const AGENTS = [{ name: 'agent-a' }, { name: 'agent-b' }]

const PROBES = [
  { id: 'top-hub', question: 'Which file is imported by the most others?', kind: 'path' },
  { id: 'entrypoint', question: 'What is the CLI entrypoint?', kind: 'path' },
  { id: 'lang', question: 'What is the primary language?', kind: 'word' },
  { id: 'deps', question: 'How many runtime dependencies?', kind: 'num' },
]

/**
 * Agree on three probes, flatly contradict on the first.
 * Mean lands under a 0.35 gate; the worst probe is far above it.
 */
function contradictOnOneProbe() {
  return {
    'agent-a': [['src/graph/build.js'], ['src/cli.js'], ['JavaScript'], ['0']],
    'agent-b': [['src/baseline/tasks.js'], ['src/cli.js'], ['JavaScript'], ['0']],
  }
}

function report(samples, extra = {}) {
  return buildReport({
    root: '/repo', agents: AGENTS, probes: PROBES, samples,
    threshold: 0.35, repeats: 1, mode: 'live', ...extra,
  })
}

describe('gate metric', () => {
  test('the scenario is real: mean passes, one probe is a flat contradiction', () => {
    const pair = report(contradictOnOneProbe()).matrix.pairs[0]
    assert.ok(pair.meanDivergence < 0.35, `mean ${pair.meanDivergence} should sit under the gate`)
    assert.ok(pair.maxDivergence > 0.35, `max ${pair.maxDivergence} should sit above it`)
  })

  test('defaults to max — one contradicted probe fails the run', () => {
    const r = report(contradictOnOneProbe())
    assert.equal(r.gate, 'max')
    assert.equal(r.breaches.length, 1, 'the pair must breach on its worst probe')
    assert.equal(r.verdict.level, 'breach')
  })

  test('--gate mean is the lenient reading, and it hides that contradiction', () => {
    const r = report(contradictOnOneProbe(), { gate: 'mean' })
    assert.equal(r.gate, 'mean')
    assert.equal(r.breaches.length, 0)
    assert.notEqual(r.verdict.level, 'breach')
  })

  test('a genuinely consistent pair passes under either gate', () => {
    const samples = {
      'agent-a': [['src/graph/build.js'], ['src/cli.js'], ['JavaScript'], ['0']],
      'agent-b': [['src/graph/build.js'], ['src/cli.js'], ['JavaScript'], ['0']],
    }
    for (const gate of ['max', 'mean']) {
      const r = report(samples, { gate })
      assert.equal(r.breaches.length, 0, `${gate} gate should pass an agreeing pair`)
    }
  })

  test('breaches record which metric gated them', () => {
    const r = report(contradictOnOneProbe())
    assert.equal(r.breaches[0].gatedOn, 'max')
    assert.equal(r.breaches[0].gatedValue, r.breaches[0].maxDivergence)
  })
})

describe('breach verdict', () => {
  test('quotes the gated value, not a different one', () => {
    const r = report(contradictOnOneProbe())
    const worst = r.breaches[0].maxDivergence.toFixed(3)
    assert.ok(
      r.verdict.message.includes(worst),
      `verdict should quote the gated value ${worst}: ${r.verdict.message}`
    )
  })

  test('names the probe the pair split hardest on', () => {
    const r = report(contradictOnOneProbe())
    assert.match(r.verdict.message, /imported by the most others/i)
  })

  test('says which reading produced the failure', () => {
    assert.match(report(contradictOnOneProbe()).verdict.message, /worst-probe/i)
    const meanR = report(
      { 'agent-a': [['x'], ['y'], ['z'], ['1']], 'agent-b': [['p'], ['q'], ['r'], ['9']] },
      { gate: 'mean' }
    )
    assert.match(meanR.verdict.message, /mean/i)
  })
})

describe('failed calls are not disagreements', () => {
  test('a null answer is skipped rather than scored as maximal divergence', () => {
    const samples = {
      'agent-a': [[null], ['src/cli.js'], ['JavaScript'], ['0']],
      'agent-b': [['src/graph/build.js'], ['src/cli.js'], ['JavaScript'], ['0']],
    }
    const r = report(samples)
    assert.equal(r.matrix.pairs[0].scoredQuestions, 3, 'the failed probe must not be scored')
    assert.equal(r.breaches.length, 0, 'an outage is not a contradiction')
  })

  test('every call failing is no-data, never a clean pass', () => {
    const samples = {
      'agent-a': [[null], [null], [null], [null]],
      'agent-b': [[null], [null], [null], [null]],
    }
    const r = report(samples, { errors: [{ agent: 'agent-a', error: 'timeout' }] })
    assert.equal(r.verdict.level, 'no-data')
    assert.equal(r.breaches.length, 0)
  })
})
