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
  assert.deepEqual(codes('const P = args.__modelPolicy\nconst u = [...seen.values()]\nawait pipeline(u, f => agent("x", { model: "opus" }))\nconst v = z.filter(Boolean)\nif (v.length === 0) return 1'),
    ['unbounded-fanout'])
  assert.deepEqual(codes('const P = args.__modelPolicy\nconst u = [0, 1]\nawait pipeline(u, f => agent("x", { model: "opus" }))\nconst v = z.filter(Boolean)\nif (v.length === 0) return 1'),
    [], 'a literal with nothing spread into it is bounded')
  assert.deepEqual(codes('const P = args.__modelPolicy\nconst u = all.slice(0, 40)\nawait pipeline(u, f => agent("x", { model: "opus" }))\nconst v = z.filter(Boolean)\nif (v.length === 0) return 1'),
    [], 'a slice is a bound')
  // A multi-line ternary whose cap is on the third line.
  assert.deepEqual(codes('const P = args.__modelPolicy\nconst OPS = (input.ops && input.ops.length)\n  ? ALL.filter((o) => true)\n  : ALL.slice(0, 5)\nawait parallel(OPS.map(o => () => agent("x", { model: "haiku" })))\nconst v = z.filter(Boolean)\nif (v.length === 0) return 1'),
    [], 'the bound is on the continuation line, and the statement does not end at the first newline')
})

test('an empty vote list must not collapse to the affirmative — but a pessimistic default is right', () => {
  const open = 'const P = args.__modelPolicy\nconst A = [1, 2]\nawait parallel(A.map(x => () => agent("x", { model: "opus" })))\nconst vs = v.filter(Boolean)\nconst refuted = vs.length > 0 && vs.every(q => q.refuted)'
  assert.deepEqual(codes(open), ['verdict-fails-open'])
  const closed = 'const P = args.__modelPolicy\nconst A = [1, 2]\nawait parallel(A.map(x => () => agent("x", { model: "opus" })))\nconst vs = v.filter(Boolean)\nconst worst = vs.length ? Math.max(...vs) : 10'
  assert.deepEqual(codes(closed), [], 'a ternary that answers the empty case with the worst score has decided it')
})

test('a pinned session is not asked to name a model, because it cannot', () => {
  const src = 'const A = [1, 2]\nawait parallel(A.map(x => () => agent("x")))\nconst v = z.filter(Boolean)\nif (v.length === 0) return 1'
  assert.deepEqual(codes(src, { routable: false }), [], 'inheritance IS the rule when the aliases cannot express the version')
  assert.deepEqual(codes(src, { routable: true }), ['unrouted-fanout'])
})

test('prose is not code: a prompt may contain agent( and pipeline( without becoming either', () => {
  const src = 'const P = args.__modelPolicy\nconst A = [1, 2]\nawait parallel(A.map(x => () => agent(`discuss agent( and pipeline(xs, f) at length`, { model: "haiku" })))\nconst v = z.filter(Boolean)\nif (v.length === 0) return 1'
  assert.deepEqual(codes(src), [])
  // But an interpolation is code again, and a call inside one is a call.
  assert.match(stripLiterals('const q = `text ${agent(1)} more`').trim(), /\$\{agent\(1\)\}/)
  assert.doesNotMatch(stripLiterals('const q = "agent(1)"'), /agent\(1\)/)
  assert.doesNotMatch(stripLiterals('// agent(1)\n'), /agent\(1\)/)
  assert.doesNotMatch(stripLiterals('/* agent(1) */'), /agent\(1\)/)
})

test('a deliberate exception is recorded, not silently allowed', () => {
  const src = 'const P = args.__modelPolicy\nconst u = [...seen.values()]\n// cgc-audit-ack: unbounded-fanout\nawait pipeline(u, f => agent("x", { model: "opus" }))\nconst v = z.filter(Boolean)\nif (v.length === 0) return 1'
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

test('a cap is not a budget: the script must ask for a number an account can serve', () => {
  // The first version of this gate demanded `.slice(0, MAX)` and never said what MAX may be, so
  // `.slice(0, 500)` satisfied it and still asked for five hundred agents. The number that
  // matters is not the runtime's 1,000-agent backstop — that is a runaway guard. On the run this
  // ceiling comes from, 69 agents completed, spent 8,665,098 tokens between them, and that was a
  // session limit reached from nothing in thirty minutes; the other 931 existed only to fail.
  const capped = [
    'const P = args.__modelPolicy',    'const R = [1, 2, 3]',
    'const unique = all.slice(0, 300)',
    'await parallel(R.map(x => () => agent("a", { model: "haiku" })))',
    'await pipeline(unique, f => parallel([0, 1].map(v => () => agent("v", { model: "opus" }))))',
    'const vs = z.filter(Boolean)',
    'if (vs.length === 0) return 1',
  ].join('\n')
  assert.deepEqual(codes(capped), ['fanout-exceeds-budget'], '300 x 2 verifiers is 600 agents')

  const sane = capped.replace('all.slice(0, 300)', 'ranked.slice(0, 12)')
  assert.deepEqual(codes(sane), [], '12 x 2 = 24 fits')
})

test('nesting multiplies and sequence adds — the difference decides whether a script is sane', () => {
  // Two phases one after the other are 13 + 24; the same two nested are 13 x 24. Reading them
  // the same way either refuses honest workflows or waves through the one that broke.
  const sequential = [
    'const P = args.__modelPolicy',    'const A = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]',
    'const B = ranked.slice(0, 12)',
    'await parallel(A.map(x => () => agent("a", { model: "haiku" })))',
    'await parallel(B.map(x => () => agent("b", { model: "opus" })))',
    'const vs = z.filter(Boolean)',
    'if (vs.length === 0) return 1',
  ].join('\n')
  assert.deepEqual(codes(sequential), [], '13 + 12 = 25 is two phases, not a product')

  const nested = [
    'const P = args.__modelPolicy',    'const B = ranked.slice(0, 12)',
    'await pipeline(B, f => parallel(Array.from({ length: 8 }, () => () => agent("v", { model: "opus" }))))',
    'const vs = z.filter(Boolean)',
    'if (vs.length === 0) return 1',
  ].join('\n')
  assert.deepEqual(codes(nested), ['fanout-exceeds-budget'], '12 x 8 = 96 is nested')
})

test('the width of a fan-out over a previous fan-out is that fan-out, not unknown', () => {
  // design-divergence judges the DIRECTIONS it just produced. Losing that link reports the
  // shipped workflow as unbounded, which is how a gate gets switched off.
  const src = [
    'const P = args.__modelPolicy',    'const OPS = ALL.slice(0, 5)',
    'const JUDGES = input.judgesPerDirection || 3',
    'const directions = await parallel(OPS.map(o => () => agent("make one", { model: "sonnet" })))',
    'const judged = await parallel(directions.filter(Boolean).map(d => () =>',
    '  parallel(Array.from({ length: JUDGES }, () => () => agent("judge it", { model: "opus" })))))',
    'const vs = z.filter(Boolean)',
    'if (vs.length === 0) return 1',
  ].join('\n')
  assert.deepEqual(codes(src), [], '5 directions + 5 x 3 judges = 20')
})

test('every fault the gate can raise is documented where a reader would look for it', () => {
  // The gate shipped a fourth fault and the mandate still said "three defects" — the same stale
  // claim this package keeps rediscovering, one layer up. A doc that under-describes a gate is
  // worse than no doc: it tells the reader the refusal they just hit cannot happen.
  const hook = readFileSync(join(REPO, 'config', 'hooks', 'pre-tool-workflow-policy.js'), 'utf8')
  const faults = [...new Set([...hook.matchAll(/\badd\('([a-z-]+)'/g)].map((m) => m[1]))].sort()
  assert.ok(faults.length >= 4, `expected the gate to raise several faults, found ${faults.join(', ')}`)

  for (const doc of ['config/CLAUDE.md', 'skills/model-routing/SKILL.md']) {
    const text = readFileSync(join(REPO, doc), 'utf8')
    for (const fault of faults) {
      assert.ok(text.includes(fault), `${doc} never mentions \`${fault}\`, which the gate can refuse a workflow for`)
    }
    // And the count, written as a word, has to match — "three defects" outlived the third fault.
    const claimed = (text.match(/\b(one|two|three|four|five|six)\s+defects\b/i) || [])[1]
    if (claimed) {
      const n = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }[claimed.toLowerCase()]
      assert.equal(n, faults.length, `${doc} says "${claimed} defects" and the gate has ${faults.length}`)
    }
  }
})

test('models typed in by hand are not routing, and on a pinned session they are a correctness failure', () => {
  // `unrouted-fanout` asks only whether a model is NAMED, and a literal satisfies it. Measured on
  // a real seven-agent run whose models were written into the script by hand: the classifier,
  // never consulted, disagreed with every one of the five it could read — two sonnet that should
  // have been haiku, and three sonnet that should have INHERITED. Hand-picking is not reliably
  // the cheaper mistake; it is a different answer reached without the rule.
  const hand = [
    'const R = [1, 2, 3]',
    "await parallel(R.map(x => () => agent('read the file and report', { model: 'sonnet' })))",
    'const vs = z.filter(Boolean)',
    'if (vs.length === 0) return 1',
  ].join('\n')
  assert.deepEqual(codes(hand), ['hand-picked-models'])

  // AND on a pinned session, where inheritance is the only mechanism that reproduces the exact
  // version. Every other model fault is scoped to a routable session; this one must not be.
  assert.deepEqual(codes(hand, { routable: false }), ['hand-picked-models'],
    'a literal overrides the inheritance a pinned session depends on')

  // Deriving them is the fix, and it is accepted.
  const derived = hand.replace("{ model: 'sonnet' }", '{ ...M(args.__modelPolicy, "read the file") }')
  assert.deepEqual(codes(derived), [], 'a script that reads the policy is routing')
})

test('a prompt that discusses models is not a model assignment', () => {
  // The literal has to be found in code and read from source: matching the source directly would
  // flag any prompt that mentions a model by name, and matching the stripped text alone would
  // lose the value. Stripping blanks a literal character for character, so offsets line up.
  const talks = [
    'const A = [1, 2]',
    'await parallel(A.map(x => () => agent(`when does model: "sonnet" beat model: "haiku"?`, { model: undefined })))',
    'const v = z.filter(Boolean)',
    'if (v.length === 0) return 1',
  ].join('\n')
  assert.deepEqual(codes(talks), [], 'the words are inside a prompt, not an assignment')
  assert.match(stripLiterals("agent(p, { model: 'sonnet' })"), /model: '\s+'/,
    'stripping keeps the quotes and the length, which is what makes the offset trick work')
})
