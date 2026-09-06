// The gate on workflow scripts, calibrated against the run that made it necessary.
//
// On 2026-09-06 a workflow called factorx-spec-review ran 1,000 agents and spent 8.67M tokens to
// produce a result whose verified subset was empty. Three things in its script caused that, and
// every one of them was visible in the text before a single agent started:
//
//   1. `pipeline(unique, …)` where `const unique = [...seen.values()]` — a fan-out as wide as the
//      data, against a runtime that stops at 1,000 agents. It wanted 1,193.
//   2. `const refuted = vs.length > 0 && vs.every(v => v.refuted)` over `votes.filter(Boolean)` —
//      with no survivors that is false, so `confirmed: !refuted` is TRUE. 931 agents then died on
//      the account's session limit and 421 findings nobody checked were reported as confirmed.
//   3. Not one `agent()` call named a model or read the `__modelPolicy` the hook puts in args, so
//      all 1,000 inherited the session model.
//
// The fixtures below are those exact shapes, plus the shapes that must NOT be refused — a
// pessimistic empty-case is correct, a literal array is bounded, and a prompt is allowed to
// contain the word "agent(" without becoming a call site. The two workflows this package ships
// are checked as they really are: a gate that refuses its own repository is worse than no gate.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { REPO } from '../paths.mjs'

const { auditWorkflow, stripLiterals } = createRequire(import.meta.url)(
  join(REPO, 'config', 'hooks', 'pre-tool-workflow-policy.js'))

const codes = (src, opts = { routable: true }) => auditWorkflow(src, opts).map((f) => f.code).sort()

test('the three defects of the run that cost 8.67M tokens are all refused', () => {
  const asItWas = [
    'const seen = new Map()',
    'const unique = [...seen.values()]',
    'const verified = await pipeline(unique,',
    '  f => parallel([0, 1].map(v => () =>',
    '    agent(`verify ${f.summary}`, { label: "verify", phase: "Verify", schema: VERDICT })',
    '  )).then(votes => {',
    '    const vs = votes.filter(Boolean)',
    '    const refuted = vs.length > 0 && vs.every(v => v.refuted)',
    '    return { ...f, confirmed: !refuted }',
    '  })',
    ')',
  ].join('\n')
  assert.deepEqual(codes(asItWas), ['unbounded-fanout', 'unrouted-fanout', 'verdict-fails-open'])
})

test('a spread is not a bound, and the declaration is read to its own end', () => {
  // `[...x]` looks like a literal and is however long the data was. Reading the declaration by
  // keyword-terminator ran past a one-line statement into the next; capping the read at 400
  // characters missed a multi-line one entirely. Both were wrong in opposite directions.
  assert.deepEqual(codes('const u = [...seen.values()]\nawait pipeline(u, f => agent("x", { model: "opus" }))\nconst v = z.filter(Boolean)\nif (v.length === 0) return 1'),
    ['unbounded-fanout'])
  assert.deepEqual(codes('const u = [0, 1]\nawait pipeline(u, f => agent("x", { model: "opus" }))\nconst v = z.filter(Boolean)\nif (v.length === 0) return 1'),
    [], 'a literal with nothing spread into it is bounded')
  assert.deepEqual(codes('const u = all.slice(0, 40)\nawait pipeline(u, f => agent("x", { model: "opus" }))\nconst v = z.filter(Boolean)\nif (v.length === 0) return 1'),
    [], 'a slice is a bound')
  // A multi-line ternary whose cap is on the third line.
  assert.deepEqual(codes('const OPS = (input.ops && input.ops.length)\n  ? ALL.filter((o) => true)\n  : ALL.slice(0, 5)\nawait parallel(OPS.map(o => () => agent("x", { model: "haiku" })))\nconst v = z.filter(Boolean)\nif (v.length === 0) return 1'),
    [], 'the bound is on the continuation line, and the statement does not end at the first newline')
})

test('an empty vote list must not collapse to the affirmative — but a pessimistic default is right', () => {
  const open = 'const A = [1, 2]\nawait parallel(A.map(x => () => agent("x", { model: "opus" })))\nconst vs = v.filter(Boolean)\nconst refuted = vs.length > 0 && vs.every(q => q.refuted)'
  assert.deepEqual(codes(open), ['verdict-fails-open'])
  const closed = 'const A = [1, 2]\nawait parallel(A.map(x => () => agent("x", { model: "opus" })))\nconst vs = v.filter(Boolean)\nconst worst = vs.length ? Math.max(...vs) : 10'
  assert.deepEqual(codes(closed), [], 'a ternary that answers the empty case with the worst score has decided it')
})

test('a pinned session is not asked to name a model, because it cannot', () => {
  const src = 'const A = [1, 2]\nawait parallel(A.map(x => () => agent("x")))\nconst v = z.filter(Boolean)\nif (v.length === 0) return 1'
  assert.deepEqual(codes(src, { routable: false }), [], 'inheritance IS the rule when the aliases cannot express the version')
  assert.deepEqual(codes(src, { routable: true }), ['unrouted-fanout'])
})

test('prose is not code: a prompt may contain agent( and pipeline( without becoming either', () => {
  const src = 'const A = [1, 2]\nawait parallel(A.map(x => () => agent(`discuss agent( and pipeline(xs, f) at length`, { model: "haiku" })))\nconst v = z.filter(Boolean)\nif (v.length === 0) return 1'
  assert.deepEqual(codes(src), [])
  // But an interpolation is code again, and a call inside one is a call.
  assert.match(stripLiterals('const q = `text ${agent(1)} more`').trim(), /\$\{agent\(1\)\}/)
  assert.doesNotMatch(stripLiterals('const q = "agent(1)"'), /agent\(1\)/)
  assert.doesNotMatch(stripLiterals('// agent(1)\n'), /agent\(1\)/)
  assert.doesNotMatch(stripLiterals('/* agent(1) */'), /agent\(1\)/)
})

test('a deliberate exception is recorded, not silently allowed', () => {
  const src = 'const u = [...seen.values()]\n// cgc-audit-ack: unbounded-fanout\nawait pipeline(u, f => agent("x", { model: "opus" }))\nconst v = z.filter(Boolean)\nif (v.length === 0) return 1'
  assert.deepEqual(codes(src), [], 'the acknowledgement is in the script, so the decision has an author')
  assert.deepEqual(codes(src.replace('unbounded-fanout', 'something-else')), ['unbounded-fanout'],
    'and it only excuses the fault it names')
})

test('every workflow this package ships passes its own gate', () => {
  // A gate that refuses the repository it lives in gets switched off within a day.
  for (const name of ['design-divergence.js', 'probe-model-policy.js']) {
    const src = readFileSync(join(REPO, 'workflows', name), 'utf8')
    assert.deepEqual(codes(src), [], `${name} must pass`)
  }
})
