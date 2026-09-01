/**
 * tests for `argo baseline`.
 *
 * pure functions only — no model calls, no network, no CLI spawning. the point
 * of the seeded simulator is that the whole arithmetic path can be asserted on
 * without any of that.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  scoreRun, errorAmplification, verdict, requiredMargin, aggregateRepeats,
  compareRows, costSummary, buildComparison, SOLO_INFLECTION, PRIOR_NOTE, RERUN_NOTE,
} from '../src/baseline/verdict.js'
import { parseTasks, validateTasks, checkError, matchText, CHECK_TYPES } from '../src/baseline/tasks.js'
import { hash32, unitFrom, simulateOutcome, estimateSpend } from '../src/baseline/simulate.js'
import {
  claudeCandidates, resolveClaudeBin, cliArgs, parseCliJson, isMissingBinary, isAuthFailure,
  mapPool, probesFor, buildPrompt, crewFrame, SOLO_FRAME, armFailure,
} from '../src/baseline/runner.js'
import { renderText, nextRunLabel } from '../src/baseline/report.js'

/* ------------------------------------------------------------------ *
 * scoring
 * ------------------------------------------------------------------ */

test('scoreRun counts booleans, records and nothing at all', () => {
  assert.deepEqual(scoreRun([]), { passed: 0, total: 0, rate: 0 })
  assert.deepEqual(scoreRun(undefined), { passed: 0, total: 0, rate: 0 })
  assert.deepEqual(scoreRun([true, false, true, true]), { passed: 3, total: 4, rate: 0.75 })
  assert.deepEqual(
    scoreRun([{ id: 'a', pass: true }, { id: 'b', pass: false }]),
    { passed: 1, total: 2, rate: 0.5 }
  )
})

test('scoreRun does not credit truthy non-passes', () => {
  assert.equal(scoreRun([{ pass: 'yes' }, { pass: 1 }]).passed, 0)
})

/* ------------------------------------------------------------------ *
 * error amplification — the number that decides
 * ------------------------------------------------------------------ */

test('errorAmplification separates regressions from fixes', () => {
  const solo = [
    { id: 'a', pass: true }, { id: 'b', pass: true }, { id: 'c', pass: true },
    { id: 'd', pass: false }, { id: 'e', pass: false },
  ]
  const crew = [
    { id: 'a', pass: true }, { id: 'b', pass: false }, { id: 'c', pass: false },
    { id: 'd', pass: true }, { id: 'e', pass: false },
  ]
  assert.deepEqual(errorAmplification(solo, crew), {
    regressions: 2, fixes: 1, amplification: 2, netDelta: -1,
  })
})

test('a crew that fixes two and breaks five is not progress', () => {
  const solo = []
  const crew = []
  for (let i = 0; i < 5; i++) { solo.push({ id: `p${i}`, pass: true }); crew.push({ id: `p${i}`, pass: false }) }
  for (let i = 0; i < 2; i++) { solo.push({ id: `f${i}`, pass: false }); crew.push({ id: `f${i}`, pass: true }) }
  const amp = errorAmplification(solo, crew)
  assert.equal(amp.regressions, 5)
  assert.equal(amp.fixes, 2)
  assert.equal(amp.amplification, 2.5)
  assert.equal(amp.netDelta, -3)
  assert.equal(verdict({ soloRate: 5 / 7, crewRate: 2 / 7, amplification: amp.amplification, costRatio: 4 }).level, 'crew-subtracts')
})

test('errorAmplification never divides by zero and ignores unmatched ids', () => {
  const amp = errorAmplification(
    [{ id: 'a', pass: true }, { id: 'b', pass: true }, { id: 'ghost', pass: true }],
    [{ id: 'a', pass: false }, { id: 'b', pass: false }, { id: 'extra', pass: false }]
  )
  assert.equal(amp.fixes, 0)
  assert.equal(amp.regressions, 2)
  assert.equal(amp.amplification, 2)
})

test('errorAmplification matches ids across string and number forms', () => {
  const amp = errorAmplification([{ id: 1, pass: true }], [{ id: '1', pass: false }])
  assert.equal(amp.regressions, 1)
})

/* ------------------------------------------------------------------ *
 * verdict
 * ------------------------------------------------------------------ */

test('requiredMargin scales with cost and stays inside its clamps', () => {
  assert.equal(requiredMargin(1), 0.05)
  assert.equal(requiredMargin(0), 0.05)
  assert.equal(requiredMargin(NaN), 0.05)
  assert.equal(requiredMargin(3), 0.1)
  assert.equal(requiredMargin(5), 0.2)
  assert.equal(requiredMargin(50), 0.3)
})

test('amplification above 1 subtracts regardless of the raw rate', () => {
  const v = verdict({ soloRate: 0.2, crewRate: 0.9, amplification: 1.5, costRatio: 2 })
  assert.equal(v.level, 'crew-subtracts')
  assert.match(v.message, /every one it fixed/)
})

test('a strong solo baseline with no meaningful gain subtracts', () => {
  const v = verdict({ soloRate: 0.8, crewRate: 0.83, amplification: 0.5, costRatio: 4 })
  assert.equal(v.level, 'crew-subtracts')
  assert.match(v.message, /inflection point/)
})

test('a crew that beats the cost bar pays', () => {
  const v = verdict({ soloRate: 0.3, crewRate: 0.7, amplification: 0.25, costRatio: 4 })
  assert.equal(v.level, 'crew-pays')
})

test('a gain too small for its cost is neutral while solo is weak', () => {
  const v = verdict({ soloRate: 0.3, crewRate: 0.36, amplification: 0.5, costRatio: 5 })
  assert.equal(v.level, 'crew-neutral')
})

test('scoring worse than solo always subtracts', () => {
  assert.equal(verdict({ soloRate: 0.6, crewRate: 0.4, amplification: 0, costRatio: 1 }).level, 'crew-subtracts')
})

test('the same gain flips verdict when the solo baseline crosses the prior', () => {
  const weak = verdict({ soloRate: 0.30, crewRate: 0.36, amplification: 0, costRatio: 3 })
  const strong = verdict({ soloRate: SOLO_INFLECTION + 0.05, crewRate: SOLO_INFLECTION + 0.11, amplification: 0, costRatio: 3 })
  assert.equal(weak.level, 'crew-neutral')
  assert.equal(strong.level, 'crew-subtracts')
})

test('verdict survives being called with nothing', () => {
  assert.ok(['crew-pays', 'crew-neutral', 'crew-subtracts'].includes(verdict().level))
})

/* ------------------------------------------------------------------ *
 * repeats, rows, cost
 * ------------------------------------------------------------------ */

test('aggregateRepeats needs a strict majority and sums the bill', () => {
  const runs = [
    { id: 'a', pass: true, ms: 100, costUsd: 0.01 },
    { id: 'a', pass: true, ms: 100, costUsd: 0.01 },
    { id: 'a', pass: false, ms: 100, costUsd: 0.01 },
    { id: 'b', pass: true, ms: 50, costUsd: 0.02 },
    { id: 'b', pass: false, ms: 50, costUsd: 0.02 },
  ]
  const agg = aggregateRepeats(runs)
  const a = agg.find((r) => r.id === 'a')
  const b = agg.find((r) => r.id === 'b')
  assert.equal(a.pass, true)
  assert.equal(a.attempts, 3)
  assert.equal(a.ms, 300)
  assert.equal(a.costUsd, 0.03)
  // 1 of 2 is a flake, not a pass
  assert.equal(b.pass, false)
  assert.equal(b.rate, 0.5)
})

test('compareRows labels every per-task outcome', () => {
  const rows = compareRows(
    [{ id: 'w', pass: true }, { id: 'x', pass: true }, { id: 'y', pass: false }, { id: 'z', pass: false }, { id: 'q', pass: true }],
    [{ id: 'w', pass: true }, { id: 'x', pass: false }, { id: 'y', pass: true }, { id: 'z', pass: false }]
  )
  assert.deepEqual(rows.map((r) => r.outcome), ['both-pass', 'regression', 'fix', 'both-fail', 'unrun'])
})

test('costSummary reports measured dollars, and says so when it cannot', () => {
  const measured = costSummary([{ costUsd: 1 }], [{ costUsd: 4 }], 3)
  assert.equal(measured.ratio, 4)
  assert.equal(measured.basis, 'measured')

  const nominal = costSummary([{ costUsd: 0 }], [{ costUsd: 0 }], 4)
  assert.equal(nominal.basis, 'nominal')
  assert.equal(nominal.ratio, 5)
})

/* ------------------------------------------------------------------ *
 * task list
 * ------------------------------------------------------------------ */

test('parseTasks rejects non-arrays and bad JSON with a readable message', () => {
  assert.throws(() => parseTasks('{', 'tasks.json'), /not valid JSON/)
  assert.throws(() => parseTasks('{"a":1}', 'tasks.json'), /expected a JSON array/)
  assert.deepEqual(parseTasks('[]'), [])
})

test('validateTasks keeps the usable and explains the rest', () => {
  const { tasks, errors } = validateTasks([
    { id: 'ok', prompt: 'do a thing', check: { type: 'contains', value: 'x' } },
    { id: 'ok', prompt: 'dupe', check: { type: 'contains', value: 'x' } },
    { prompt: 'no id', check: { type: 'contains', value: 'x' } },
    { id: 'no-prompt', check: { type: 'contains', value: 'x' } },
    { id: 'bad-check', prompt: 'p', check: { type: 'vibes' } },
    { id: 'bad-regex', prompt: 'p', check: { type: 'regex', pattern: '([' } },
    'not an object',
  ])
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].id, 'ok')
  assert.equal(errors.length, 6)
  assert.match(errors.join('\n'), /duplicate id/)
  assert.match(errors.join('\n'), /uncompilable/)
})

test('checkError accepts each documented shape', () => {
  assert.equal(checkError({ type: 'contains', value: 'a' }), null)
  assert.equal(checkError({ type: 'regex', pattern: '^a$' }), null)
  assert.equal(checkError({ type: 'file_exists', path: 'a.txt' }), null)
  assert.equal(checkError({ type: 'command', run: 'npm test', expectExit: 0 }), null)
  assert.equal(CHECK_TYPES.length, 4)
  assert.match(checkError(null), /missing check/)
})

test('matchText settles the text checks and abstains on the rest', () => {
  assert.equal(matchText({ type: 'contains', value: 'Frozen' }, 'the Frozen list'), true)
  assert.equal(matchText({ type: 'contains', value: 'frozen' }, 'the Frozen list'), false)
  assert.equal(matchText({ type: 'contains', value: 'frozen', ignoreCase: true }, 'the Frozen list'), true)
  assert.equal(matchText({ type: 'regex', pattern: '^\\d+ files$' }, '12 files'), true)
  assert.equal(matchText({ type: 'regex', pattern: 'FILES', flags: 'i' }, '12 files'), true)
  assert.equal(matchText({ type: 'file_exists', path: 'x' }, 'anything'), null)
  assert.equal(matchText({ type: 'command', run: 'x' }, 'anything'), null)
})

/* ------------------------------------------------------------------ *
 * seeded simulation
 * ------------------------------------------------------------------ */

test('hash32 and unitFrom are stable and bounded', () => {
  assert.equal(hash32('argo'), hash32('argo'))
  assert.notEqual(hash32('argo'), hash32('argonaut'))
  for (const key of ['a', 'b', 'task-17', '']) {
    const u = unitFrom(1337, key, 'difficulty')
    assert.ok(u >= 0 && u < 1, `${key} -> ${u}`)
    assert.equal(u, unitFrom(1337, key, 'difficulty'))
  }
})

test('simulateOutcome is a pure function of its inputs', () => {
  const a = simulateOutcome({ seed: 7, taskId: 't1', arm: 'solo', repeat: 0, workers: 3 })
  const b = simulateOutcome({ seed: 7, taskId: 't1', arm: 'solo', repeat: 0, workers: 3 })
  assert.deepEqual(a, b)
  assert.notDeepEqual(a, simulateOutcome({ seed: 8, taskId: 't1', arm: 'solo', repeat: 0, workers: 3 }))
})

test('the simulated crew both rescues and breaks, and costs more', () => {
  const ids = Array.from({ length: 60 }, (_, i) => `task-${i}`)
  const solo = ids.map((id) => ({ id, ...simulateOutcome({ seed: 1337, taskId: id, arm: 'solo', workers: 3 }) }))
  const crew = ids.map((id) => ({ id, ...simulateOutcome({ seed: 1337, taskId: id, arm: 'crew', workers: 3 }) }))
  const amp = errorAmplification(solo, crew)
  assert.ok(amp.regressions > 0, 'expected the simulator to break something solo had right')
  assert.ok(amp.fixes > 0, 'expected the simulator to rescue something solo missed')
  assert.ok(estimateSpend(crew).usd > estimateSpend(solo).usd)
  assert.ok(estimateSpend(crew).tokens > estimateSpend(solo).tokens)
})

test('a wider fan-out breaks more of what solo already had right', () => {
  const ids = Array.from({ length: 120 }, (_, i) => `t${i}`)
  const solo = ids.map((id) => ({ id, ...simulateOutcome({ seed: 99, taskId: id, arm: 'solo', workers: 2 }) }))
  const narrow = ids.map((id) => ({ id, ...simulateOutcome({ seed: 99, taskId: id, arm: 'crew', workers: 2 }) }))
  const wide = ids.map((id) => ({ id, ...simulateOutcome({ seed: 99, taskId: id, arm: 'crew', workers: 8 }) }))
  assert.ok(errorAmplification(solo, wide).regressions > errorAmplification(solo, narrow).regressions)
})

/* ------------------------------------------------------------------ *
 * runner — the parts that do not spawn anything
 * ------------------------------------------------------------------ */

test('claudeCandidates puts the env override first and PATH last', () => {
  const list = claudeCandidates({ ARGO_CLAUDE_BIN: 'D:\\bin\\claude.cmd' })
  assert.equal(list[0], 'D:\\bin\\claude.cmd')
  assert.equal(list.at(-1), 'claude')
  // Install-method agnostic: the native installer ships `claude`/`claude.exe`, the older
  // npm global ships `claude.cmd`. Asserting one of them encoded the same assumption that
  // made the default hardcode a single machine's layout.
  assert.match(claudeCandidates({})[0], /claude(\.cmd|\.exe)?$/)
  assert.ok(claudeCandidates({}).some((c) => c.endsWith('claude.cmd')),
    'the npm-global shim must stay a candidate for machines that installed that way')
})

test('resolveClaudeBin honours the env override, then falls back to PATH', () => {
  const exists = (p) => p === 'D:\\bin\\claude.cmd'
  assert.equal(resolveClaudeBin({ ARGO_CLAUDE_BIN: 'D:\\bin\\claude.cmd' }, exists), 'D:\\bin\\claude.cmd')
  // an override that does not exist is still the override — falling back would
  // silently run a different binary than the one the user named.
  assert.equal(resolveClaudeBin({ ARGO_CLAUDE_BIN: 'D:\\gone\\claude.cmd' }, () => false), 'D:\\gone\\claude.cmd')
  assert.equal(resolveClaudeBin({}, (p) => p.endsWith('claude.cmd')).endsWith('claude.cmd'), true)
  assert.equal(resolveClaudeBin({}, () => false), 'claude')
})

test('cliArgs asks for the JSON envelope and quotes the model', () => {
  assert.deepEqual(cliArgs(), ['-p', '--output-format', 'json'])
  assert.deepEqual(cliArgs({ model: 'claude-opus-5' }), ['-p', '--output-format', 'json', '--model', 'claude-opus-5'])
})

test('parseCliJson pulls text and cost out of the envelope', () => {
  const stdout = JSON.stringify({
    type: 'result',
    result: 'the answer is 42',
    total_cost_usd: 0.0731,
    duration_ms: 4210,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5 },
  })
  const p = parseCliJson(stdout)
  assert.equal(p.text, 'the answer is 42')
  assert.equal(p.costUsd, 0.0731)
  assert.equal(p.tokens, 125)
  assert.equal(p.durationMs, 4210)
})

test('parseCliJson survives noise, a renamed result field, and garbage', () => {
  assert.equal(parseCliJson('warn: something\n{"result":"ok"}\n').text, 'ok')
  assert.equal(parseCliJson('{"output":"fallback text"}').text, 'fallback text')
  const junk = parseCliJson('not json at all')
  assert.equal(junk.text, 'not json at all')
  assert.equal(junk.costUsd, null)
})

test('isMissingBinary tells a missing shim apart from a model failure', () => {
  assert.equal(isMissingBinary({ code: 'ENOENT' }), true)
  assert.equal(isMissingBinary({ code: 1 }, "'claude' is not recognized as an internal or external command"), true)
  assert.equal(isMissingBinary({ code: 1 }, 'The system cannot find the path specified.'), true)
  assert.equal(isMissingBinary({ code: 1 }, 'Error: credit balance too low'), false)
})

test('parseCliJson surfaces the envelope is_error flag', () => {
  // the real shape of a not-logged-in CLI: exit 1, is_error true, cost 0.
  const stdout = JSON.stringify({
    type: 'result', subtype: 'success', is_error: true,
    result: 'Not logged in · Please run /login', total_cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0 },
  })
  const p = parseCliJson(stdout)
  assert.equal(p.isError, true)
  assert.equal(isAuthFailure(p.text), true)
  assert.equal(parseCliJson('{"result":"fine"}').isError, false)
})

test('isAuthFailure separates a dead probe from a wrong answer', () => {
  assert.equal(isAuthFailure('Not logged in · Please run /login'), true)
  assert.equal(isAuthFailure('Invalid API key'), true)
  assert.equal(isAuthFailure('The answer is 42'), false)
})

test('mapPool preserves order and respects its width', async () => {
  const items = Array.from({ length: 12 }, (_, i) => i)
  let inFlight = 0
  let peak = 0
  const out = await mapPool(items, 4, async (n) => {
    inFlight++
    peak = Math.max(peak, inFlight)
    await Promise.resolve()
    inFlight--
    return n * 2
  })
  assert.deepEqual(out, items.map((n) => n * 2))
  assert.ok(peak <= 4, `peak concurrency ${peak}`)
  assert.deepEqual(await mapPool([], 4, async () => 1), [])
})

test('probesFor emits every task once per repeat, in a fixed order', () => {
  const probes = probesFor([{ id: 'a' }, { id: 'b' }], 2)
  assert.deepEqual(probes.map((p) => `${p.task.id}#${p.repeat}`), ['a#0', 'a#1', 'b#0', 'b#1'])
  assert.equal(probesFor([{ id: 'a' }], 0).length, 1)
})

test('the arms differ only in whether delegation is allowed', () => {
  const task = { id: 't', prompt: 'refactor the parser' }
  const solo = buildPrompt(task, 'solo', 5)
  const crew = buildPrompt(task, 'crew', 5)
  assert.ok(solo.includes(SOLO_FRAME))
  assert.ok(crew.includes(crewFrame(5)))
  assert.ok(solo.endsWith('TASK\nrefactor the parser'))
  assert.ok(crew.endsWith('TASK\nrefactor the parser'))
  assert.match(solo, /Do not delegate/)
  assert.match(crew, /crew of 5 workers/)
})

/* ------------------------------------------------------------------ *
 * report
 * ------------------------------------------------------------------ */

test('nextRunLabel continues the counter instead of reading a clock', () => {
  assert.equal(nextRunLabel([]), '0001')
  assert.equal(nextRunLabel(['baseline-0001.json', 'baseline-0009.json', 'fanout.md']), '0010')
  assert.equal(nextRunLabel(['baseline-0012.json', 'baseline-0003.json']), '0013')
})

/** A full offline comparison, built the same way the command builds it. */
function simulatedComparison({ seed = 1337, workers = 3, count = 20 } = {}) {
  const ids = Array.from({ length: count }, (_, i) => `task-${i}`)
  const armRuns = (arm) => ids.map((id) => {
    const s = simulateOutcome({ seed, taskId: id, arm, workers })
    return { id, arm, repeat: 0, pass: s.pass, ms: s.ms, costUsd: s.costUsd, tokens: s.tokens }
  })
  return buildComparison({
    soloRuns: armRuns('solo'),
    crewRuns: armRuns('crew'),
    workers,
    label: '0001',
    meta: { tasksFile: 'tasks.json', repeats: 1, dryRun: true, seed },
  })
}

test('buildComparison is reproducible run to run', () => {
  assert.deepEqual(simulatedComparison(), simulatedComparison())
})

test('buildComparison agrees with its own parts', () => {
  const cmp = simulatedComparison()
  assert.equal(cmp.tasks, 20)
  assert.equal(cmp.solo.total, 20)
  assert.equal(cmp.rawDelta.tasks, cmp.crew.passed - cmp.solo.passed)
  assert.equal(cmp.amplification.netDelta, cmp.amplification.fixes - cmp.amplification.regressions)
  assert.equal(cmp.rows.filter((r) => r.outcome === 'regression').length, cmp.amplification.regressions)
  assert.equal(cmp.rows.filter((r) => r.outcome === 'fix').length, cmp.amplification.fixes)
  assert.equal(cmp.requiredMargin, requiredMargin(cmp.cost.ratio))
  assert.ok(['crew-pays', 'crew-neutral', 'crew-subtracts'].includes(cmp.verdict.level))
})

test('the rendered report carries the caveat, not just the code', () => {
  const text = renderText(simulatedComparison())
  assert.ok(text.includes(PRIOR_NOTE), 'prior caveat must be visible in the output')
  assert.ok(text.includes(RERUN_NOTE), 'model-upgrade caveat must be visible in the output')
  assert.match(text, /AMPLIF/)
  assert.match(text, /broken per fixed/)
  assert.match(text, /VERDICT\s+\[crew-(pays|neutral|subtracts)\]/)
  assert.match(text, /no model was called/)
})

test('the report marks the tasks the crew broke', () => {
  const cmp = simulatedComparison()
  const text = renderText(cmp)
  if (cmp.amplification.regressions > 0) assert.match(text, /<-- crew broke it/)
  if (cmp.amplification.fixes > 0) assert.match(text, /<-- crew fixed it/)
  assert.match(text, /solo\s+\d+\/\d+/)
})

test('renderText truncates a long table instead of dumping it', () => {
  const text = renderText(simulatedComparison({ count: 40 }), { top: 5 })
  assert.match(text, /\.\.\. and 35 more/)
})

/* ------------------------------------------------------------------ *
 * armFailure — an arm that never reached a model is not an arm that
 * scored zero. The crew arm runs second, so it is the one that inherits
 * an outage starting mid-run; scoring it would print a confident
 * "crew-subtracts" out of an auth error.
 * ------------------------------------------------------------------ */

const deadProbe = (arm, id, error) => ({ arm, id, repeat: 0, pass: false, error })
const livedProbe = (arm, id) => ({ arm, id, repeat: 0, pass: true, error: null })

test('armFailure passes a healthy arm', () => {
  assert.equal(armFailure([livedProbe('crew', 'a'), livedProbe('crew', 'b')], 'crew'), null)
  assert.equal(armFailure([], 'crew'), null)
  assert.equal(armFailure(undefined, 'solo'), null)
})

test('armFailure does not fire when only some probes failed', () => {
  const runs = [deadProbe('crew', 'a', 'timed out'), livedProbe('crew', 'b')]
  assert.equal(armFailure(runs, 'crew'), null)
})

test('armFailure catches an auth outage on the CREW arm, not just the control', () => {
  const runs = ['a', 'b', 'c'].map((id) => ({
    ...deadProbe('crew', id, 'Not logged in · Please run /login'),
    authFailure: true,
  }))
  const f = armFailure(runs, 'crew')
  assert.ok(f, 'a crew arm that never reached a model must be refused, not scored')
  assert.equal(f.reason, 'auth')
  assert.equal(f.arm, 'crew')
  assert.match(f.message, /CREW arm/)
})

test('armFailure catches an auth outage on the solo arm', () => {
  const runs = [{ ...deadProbe('solo', 'a', 'Invalid API key'), authFailure: true }]
  const f = armFailure(runs, 'solo')
  assert.equal(f.reason, 'auth')
})

test('armFailure reports a missing binary ahead of anything else', () => {
  const runs = [{ ...deadProbe('solo', 'a', 'nope'), missingBinary: true, authFailure: true }]
  assert.equal(armFailure(runs, 'solo').reason, 'missing-binary')
})

test('armFailure refuses a wholly dead arm and names it', () => {
  const solo = armFailure([deadProbe('solo', 'a', 'timed out')], 'solo')
  assert.equal(solo.reason, 'dead-arm')
  assert.match(solo.message, /no control to compare against/)

  const crew = armFailure([deadProbe('crew', 'a', 'timed out')], 'crew')
  assert.equal(crew.reason, 'dead-arm')
  assert.match(crew.message, /no crew arm to compare the control against/)
  assert.match(crew.details[0], /crew\/a#0/)
})

test('a dead crew arm would otherwise have scored as a maximal regression', () => {
  // The exact shape armFailure exists to intercept: solo answered everything,
  // the crew arm never reached a model, and the arithmetic reads as damning.
  const solo = ['a', 'b', 'c'].map((id) => ({ id, pass: true, costUsd: 0.01 }))
  const crew = ['a', 'b', 'c'].map((id) => ({ id, pass: false, error: 'Not logged in' }))
  const cmp = buildComparison({ soloRuns: solo, crewRuns: crew, workers: 3 })
  assert.equal(cmp.verdict.level, 'crew-subtracts')
  assert.equal(cmp.amplification.regressions, 3)
})
