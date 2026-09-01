// A labelled corpus that measures whether the model-routing classifier is SAFE, not whether it
// is clever. The two failure modes are not symmetric and are not treated symmetrically:
//
//   UNDER-assignment (weaker than the label) is a CORRECTNESS failure. The agent runs anyway,
//   returns something plausible, and nobody finds out without redoing the work. One instance
//   fails this file. Zero tolerance is the whole point of the corpus.
//
//   OVER-assignment (stronger than the label) is a COST failure. It is visible on the bill and
//   recoverable, so it is measured and capped rather than gated. The cap sits just above the
//   measured rate: widening a downgrade rule ratchets it down, and a regression that spends more
//   money cannot slip in unnoticed.
//
// Labels are the record of intent and are NOT tuned to whatever the classifier currently does.
// A corpus bent to fit the classifier measures nothing. When a case fails, the classifier is the
// thing to change.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { REPO } from '../paths.mjs'

// The hook is CommonJS on purpose (hooks are loaded by basename outside any package scope), so
// an ESM test reaches its exports through createRequire rather than import.
const require = createRequire(import.meta.url)
const { decide } = require(join(REPO, 'config', 'hooks', 'pre-tool-model-route.js'))

const CORPUS_PATH = join(REPO, 'tools', 'test', 'fixtures', 'model-corpus.json')
const CORPUS = JSON.parse(readFileSync(CORPUS_PATH, 'utf8'))

// haiku < sonnet < opus <= INHERIT. INHERIT ranks top because it is the only outcome guaranteed
// to be at least as strong as the session model — naming 'opus' on a session running something
// stronger is itself a downgrade.
const STRENGTH = { haiku: 0, sonnet: 1, opus: 2, inherit: 3 }
const TIERS = Object.keys(STRENGTH)

const MIN_CASES = 60
const MIN_ADVERSARIAL = 15

// Measured 2026-09-01: 13 over-assignments in 82 cases = 15.9%. Only ever move this DOWN.
// Raising it to make a change pass is the one edit that turns this gate back into decoration.
// Raised 0.17 -> 0.21, deliberately and once, with the reason recorded.
//
// The first corpus run measured 9 UNDER-assignments, all adversarial — prompts whose surface
// wording reads mechanical while the real work is judgment ("list every test that fails and why",
// "where is the bug", "search for why it is slow"). Fixing them meant broadening the judgment and
// verification vetoes, which necessarily pushes borderline cases UP. Unders went 9 -> 0; overs
// went 13 -> 17.
//
// That is the trade the invariant demands: under-assignment is a correctness failure that hides,
// over-assignment is a cost failure that shows. This ceiling exists to stop SILENT regression,
// not to block a documented trade — so it moves up only with a reason written here, and every
// later change must move it DOWN. Getting it back below 0.17 means adding high-confidence
// downgrade rules, never loosening a veto.
const OVER_CEILING = 0.21

const results = CORPUS.map((c) => {
  const actual = decide(c.input) ?? 'inherit'
  const delta = STRENGTH[actual] - STRENGTH[c.expect]
  return { ...c, actual, verdict: delta < 0 ? 'under' : delta > 0 ? 'over' : 'exact' }
})

const under = results.filter((r) => r.verdict === 'under')
const over = results.filter((r) => r.verdict === 'over')
const exact = results.filter((r) => r.verdict === 'exact')
const overRate = over.length / results.length

function row(label, set) {
  const n = set.length
  const pct = (k) => (n ? `${((k / n) * 100).toFixed(1)}%` : '-')
  const e = set.filter((r) => r.verdict === 'exact').length
  const u = set.filter((r) => r.verdict === 'under').length
  const o = set.filter((r) => r.verdict === 'over').length
  return `  ${label.padEnd(22)} ${String(n).padStart(4)} ${String(e).padStart(6)} ${pct(e).padStart(8)} ${String(u).padStart(6)} ${String(o).padStart(5)}`
}

console.log('\nmodel-routing corpus')
console.log(`  ${'group'.padEnd(22)} ${'n'.padStart(4)} ${'exact'.padStart(6)} ${'acc'.padStart(8)} ${'under'.padStart(6)} ${'over'.padStart(5)}`)
for (const tier of TIERS) {
  const set = results.filter((r) => r.expect === tier)
  if (set.length) console.log(row(`expect ${tier}`, set))
}
console.log(row('adversarial', results.filter((r) => r.adversarial)))
console.log(row('TOTAL', results))
console.log(`\n  accuracy            ${((exact.length / results.length) * 100).toFixed(1)}%`)
console.log(`  under-assignments   ${under.length}   (gate: 0)`)
console.log(`  over-assignments    ${over.length}   ${(overRate * 100).toFixed(1)}%  (ceiling: ${(OVER_CEILING * 100).toFixed(1)}%)\n`)

test('the corpus is well-formed', () => {
  assert.ok(Array.isArray(CORPUS) && CORPUS.length >= MIN_CASES,
    `the corpus needs at least ${MIN_CASES} cases to say anything about a rate; found ${CORPUS.length}`)

  const ids = new Set()
  for (const c of CORPUS) {
    assert.ok(c.id && typeof c.id === 'string', `every case needs an id: ${JSON.stringify(c).slice(0, 80)}`)
    assert.equal(ids.has(c.id), false, `duplicate id "${c.id}" — a failure report has to name one case`)
    ids.add(c.id)
    assert.ok(TIERS.includes(c.expect), `case "${c.id}" has expect "${c.expect}", not one of ${TIERS.join('/')}`)
    assert.ok(c.input && typeof c.input === 'object' && !Array.isArray(c.input),
      `case "${c.id}" needs an input object`)
    assert.ok(c.input.subagent_type || c.input.description || c.input.prompt,
      `case "${c.id}" has an empty input — the classifier would see nothing`)
    // "why" is the record of intent. Without it a later reader cannot tell a deliberate label
    // from a typo, and the corpus stops being evidence.
    assert.ok(typeof c.why === 'string' && c.why.length > 20,
      `case "${c.id}" needs a real one-sentence justification in "why"`)
  }

  const adversarial = CORPUS.filter((c) => c.adversarial === true)
  assert.ok(adversarial.length >= MIN_ADVERSARIAL,
    `the corpus needs at least ${MIN_ADVERSARIAL} adversarial cases — prompts whose surface wording ` +
    `points at a different tier than the real difficulty — because those are the ones a keyword ` +
    `classifier gets wrong; found ${adversarial.length}`)
})

test('ZERO under-assignments: no case is routed weaker than its label', () => {
  // The opus/inherit pair is the one boundary worth spelling out: opus only under-runs the label
  // on a session whose model is stronger than opus, which is exactly the case inheritance exists
  // to protect. Naming it keeps the reader from dismissing that row as a rounding artefact.
  const note = (r) => (r.expect === 'inherit' && r.actual === 'opus'
    ? 'WEAKER — a named tier cannot track a session model stronger than itself'
    : 'WEAKER — this agent would run under-powered')

  const report = under.map((r) =>
    `\n  ${r.id}\n` +
    `    expected : ${r.expect}\n` +
    `    actual   : ${r.actual}   (${note(r)})\n` +
    (r.input.subagent_type ? `    type     : ${r.input.subagent_type}\n` : '') +
    `    prompt   : ${JSON.stringify(r.input.prompt || r.input.description || '')}\n` +
    `    why      : ${r.why}`
  ).join('\n')

  assert.equal(under.length, 0,
    `${under.length} under-assignment(s). Each one is an agent that runs too weak on work where a ` +
    `wrong answer looks right. Fix the classifier in config/hooks/pre-tool-model-route.js — do not ` +
    `relabel the case unless it was genuinely mislabelled.\n${report}\n`)
})

test('over-assignment rate stays under its ceiling', () => {
  const listed = over.map((r) => `  ${r.id}: ${r.expect} -> ${r.actual}`).join('\n')
  assert.ok(overRate <= OVER_CEILING,
    `over-assignment rate ${(overRate * 100).toFixed(1)}% exceeds the ${(OVER_CEILING * 100).toFixed(1)}% ceiling ` +
    `(${over.length}/${results.length}). This costs money rather than correctness, so the fix is a wider ` +
    `high-confidence downgrade rule — never a weaker safety rule.\n${listed}\n`)
})
