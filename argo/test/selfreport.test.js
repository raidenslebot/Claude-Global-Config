import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  classifySentence, parseSelfReport, confidence, buildRecord, diffSelfReports,
} from '../src/drift/selfreport.js'

/** The real gate observed in a live Claude Code 2.1.232 / Opus 5 session. */
const REAL_A = 'Do not call the AgentTool unless the user requested it'
const REAL_B = 'Do not use workflows or deep-research unless the user requested it'

describe('classifySentence', () => {
  test('a named mechanism under a user-conditional is a gate', () => {
    const c = classifySentence(REAL_A)
    assert.ok(c)
    assert.equal(c.isGate, true)
    assert.ok(c.mechanisms.includes('agent-tool'))
    assert.ok(c.restrictions.includes('user-gated'))
    assert.ok(c.score >= 8, `expected a strong score, got ${c.score}`)
  })

  test('workflows and deep-research are both recognised mechanisms', () => {
    const c = classifySentence(REAL_B)
    assert.ok(c.mechanisms.includes('workflow'))
    assert.ok(c.mechanisms.includes('deep-research'))
    assert.equal(c.isGate, true)
  })

  test('naming a mechanism without restricting it is not a gate', () => {
    const c = classifySentence('The AgentTool launches a subagent to handle a task.')
    assert.ok(c, 'still classified — it names a mechanism')
    assert.equal(c.isGate, false, 'documentation is not a gate')
  })

  test('a restriction that names no mechanism is not classified at all', () => {
    assert.equal(classifySentence('Do not delete files without asking.'), null)
  })

  test('empty input returns null rather than throwing', () => {
    assert.equal(classifySentence(''), null)
    assert.equal(classifySentence(null), null)
    assert.equal(classifySentence(undefined), null)
  })
})

describe('parseSelfReport', () => {
  test('parses the real two-line report', () => {
    const p = parseSelfReport(`GATE: ${REAL_A}\nGATE: ${REAL_B}\n`)
    assert.equal(p.declaredNone, false)
    assert.equal(p.gates.length, 2)
    assert.equal(p.mentions.length, 0)
  })

  test('NONE is an explicit absence, not an empty parse', () => {
    const p = parseSelfReport('NONE')
    assert.equal(p.declaredNone, true)
    assert.equal(p.gates.length, 0)
  })

  test('tolerates a preamble the model added anyway', () => {
    const p = parseSelfReport(
      `Here is what I found in my context:\n\nGATE: ${REAL_A}\n\nThat is the only one.`
    )
    assert.equal(p.gates.length, 1)
    assert.equal(p.gates[0].text, REAL_A)
  })

  test('strips surrounding quotes the model may add', () => {
    const p = parseSelfReport(`GATE: "${REAL_A}"`)
    assert.equal(p.gates[0].text, REAL_A)
  })

  test('a stray NONE alongside real gates does not suppress them', () => {
    const p = parseSelfReport(`GATE: ${REAL_A}\nNONE`)
    assert.equal(p.declaredNone, false)
    assert.equal(p.gates.length, 1)
  })

  test('separates gates from bare mentions', () => {
    const p = parseSelfReport(
      `GATE: ${REAL_A}\nGATE: Subagents are available via the Agent tool.`
    )
    assert.equal(p.gates.length, 1)
    assert.equal(p.mentions.length, 1)
  })
})

describe('confidence', () => {
  test('the real gate scores strong', () => {
    assert.equal(confidence(parseSelfReport(`GATE: ${REAL_A}`)).level, 'strong')
  })

  test('reported absence is labelled as a report, not as proof', () => {
    const c = confidence(parseSelfReport('NONE'))
    assert.equal(c.level, 'reported-absent')
    assert.match(c.note, /confirm behaviourally/i)
  })

  test('mechanisms without restrictions are inconclusive', () => {
    const c = confidence(parseSelfReport('GATE: The Agent tool spawns a subagent.'))
    assert.equal(c.level, 'inconclusive')
  })
})

describe('buildRecord', () => {
  test('records the caveat that this is a report, not a capture', () => {
    const r = buildRecord({ text: `GATE: ${REAL_A}`, capturedAt: '2026-08-17T00:00:00.000Z' })
    assert.match(r.caveat, /not captured off the wire/i)
    assert.equal(r.kind, 'self-report')
    assert.equal(r.gates.length, 1)
  })

  test('is deterministic for the same input', () => {
    const at = '2026-08-17T00:00:00.000Z'
    const a = buildRecord({ text: `GATE: ${REAL_A}`, capturedAt: at })
    const b = buildRecord({ text: `GATE: ${REAL_A}`, capturedAt: at })
    assert.equal(a.hash, b.hash)
  })

  test('different gate sets hash differently', () => {
    const at = '2026-08-17T00:00:00.000Z'
    const a = buildRecord({ text: `GATE: ${REAL_A}`, capturedAt: at })
    const b = buildRecord({ text: `GATE: ${REAL_A}\nGATE: ${REAL_B}`, capturedAt: at })
    assert.notEqual(a.hash, b.hash)
  })
})

describe('diffSelfReports', () => {
  test('a newly appearing restriction shows as added', () => {
    const before = buildRecord({ text: `GATE: ${REAL_A}`, capturedAt: '2026-08-01T00:00:00.000Z' })
    const after = buildRecord({ text: `GATE: ${REAL_A}\nGATE: ${REAL_B}`, capturedAt: '2026-08-17T00:00:00.000Z' })
    const d = diffSelfReports(before, after)
    assert.deepEqual(d.added, [REAL_B])
    assert.equal(d.removed.length, 0)
    assert.deepEqual(d.unchanged, [REAL_A])
  })

  test('a lifted restriction shows as removed', () => {
    const before = buildRecord({ text: `GATE: ${REAL_A}`, capturedAt: '2026-08-01T00:00:00.000Z' })
    const after = buildRecord({ text: 'NONE', capturedAt: '2026-08-17T00:00:00.000Z' })
    const d = diffSelfReports(before, after)
    assert.deepEqual(d.removed, [REAL_A])
    assert.equal(d.added.length, 0)
  })

  test('identical reports diff to nothing', () => {
    const a = buildRecord({ text: `GATE: ${REAL_A}`, capturedAt: '2026-08-01T00:00:00.000Z' })
    const b = buildRecord({ text: `GATE: ${REAL_A}`, capturedAt: '2026-08-17T00:00:00.000Z' })
    const d = diffSelfReports(a, b)
    assert.equal(d.added.length, 0)
    assert.equal(d.removed.length, 0)
    assert.equal(d.unchanged.length, 1)
  })
})
