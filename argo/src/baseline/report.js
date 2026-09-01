/**
 * report.js — render the comparison so the uncomfortable number is unavoidable.
 *
 * the raw delta is the number people quote and the amplification is the number
 * that decides, so amplification gets its own block and its own sentence rather
 * than a column somewhere on the right. the per-task table is here for the same
 * reason: an average cannot show you WHICH task the crew broke, and that is the
 * thing you have to go look at.
 *
 * the prior and the re-run caveat are rendered every time. a threshold from one
 * study on one model family, quoted without its provenance, becomes folklore in
 * about two repetitions.
 */

import { PRIOR_NOTE, RERUN_NOTE, SOLO_INFLECTION } from './verdict.js'

const pct = (n) => `${(n * 100).toFixed(1)}%`

function duration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '-'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  return `${m}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`
}

function money(usd) {
  if (!Number.isFinite(usd) || usd === 0) return '-'
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}

/**
 * Next artifact label from what is already in .argo. A counter rather than a
 * clock: two runs of the same task list should differ by their inputs, not by
 * when they happened, and a test that asserts on a filename should not have to
 * freeze time.
 */
export function nextRunLabel(existing = []) {
  let max = 0
  for (const name of existing) {
    const m = /^baseline-(\d+)\.json$/.exec(String(name))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return String(max + 1).padStart(4, '0')
}

const MARK = {
  regression: '  <-- crew broke it',
  fix: '  <-- crew fixed it',
  unrun: '  <-- not run by the crew',
  'both-pass': '',
  'both-fail': '',
}

/** Human-readable terminal report. */
export function renderText(cmp, { top = 30 } = {}) {
  const L = []
  const m = cmp.meta ?? {}
  const mode = m.dryRun ? `dry-run (seed ${m.seed})` : `live${m.model ? ` · ${m.model}` : ''}`

  L.push(`BASELINE  ${m.tasksFile ?? '(task list)'}`)
  L.push(
    `          ${cmp.tasks} tasks · ${m.repeats ?? 1} run(s) each · ` +
      `crew = supervisor + ${cmp.workers} workers · ${mode}`
  )
  L.push('')

  L.push(`ARMS      arm     passed          rate     wall      spend`)
  L.push(
    `          solo    ${String(`${cmp.solo.passed}/${cmp.solo.total}`).padEnd(12)}  ` +
      `${pct(cmp.solo.rate).padStart(6)}   ${duration(cmp.cost.soloMs).padStart(7)}   ${money(cmp.cost.soloUsd).padStart(8)}`
  )
  L.push(
    `          crew    ${String(`${cmp.crew.passed}/${cmp.crew.total}`).padEnd(12)}  ` +
      `${pct(cmp.crew.rate).padStart(6)}   ${duration(cmp.cost.crewMs).padStart(7)}   ${money(cmp.cost.crewUsd).padStart(8)}`
  )
  L.push('')

  L.push(`TASKS     id                                   solo   crew`)
  for (const row of cmp.rows.slice(0, top)) {
    const id = row.id.length > 34 ? `${row.id.slice(0, 31)}...` : row.id
    L.push(
      `          ${id.padEnd(34)}   ${(row.solo ? 'PASS' : 'FAIL').padEnd(4)}   ` +
        `${(row.crew ? 'PASS' : 'FAIL').padEnd(4)}${MARK[row.outcome] ?? ''}`
    )
  }
  if (cmp.rows.length > top) L.push(`          ... and ${cmp.rows.length - top} more`)
  L.push('')

  const d = cmp.rawDelta
  L.push(
    `DELTA     raw ${d.tasks >= 0 ? '+' : ''}${d.tasks} task(s), ` +
      `${d.rate >= 0 ? '+' : ''}${pct(d.rate)} — this is the number that flatters a crew`
  )

  const amp = cmp.amplification
  L.push(
    `AMPLIF    ${amp.regressions} regression(s) / ${amp.fixes} fix(es) = ` +
      `${amp.amplification.toFixed(2)} broken per fixed · net ${amp.netDelta >= 0 ? '+' : ''}${amp.netDelta}`
  )
  L.push(
    `          Of the ${cmp.solo.passed} task(s) solo already had right, the crew lost ${amp.regressions}. ` +
      `Regressions are specific; the rate is an average.`
  )

  L.push(
    `COST      crew is ${cmp.cost.ratio.toFixed(1)}x solo (${cmp.cost.basis}) — ` +
      `needs +${pct(cmp.requiredMargin)} pass rate to justify that`
  )
  L.push('')

  L.push(`VERDICT   [${cmp.verdict.level}] ${cmp.verdict.message}`)
  L.push(`PRIOR     ${PRIOR_NOTE}`)
  L.push(`          Solo here is ${pct(cmp.solo.rate)} against a ${pct(SOLO_INFLECTION)} prior.`)
  L.push(`RERUN     ${RERUN_NOTE}`)

  if (m.dryRun) {
    L.push('')
    L.push(
      `NOTE      Simulated outcomes; no model was called and no check was executed. ` +
        `A real run would spend about ${money(cmp.cost.soloUsd + cmp.cost.crewUsd)}.`
    )
  }
  if (m.taskErrors?.length) {
    L.push('')
    L.push(`SKIPPED   ${m.taskErrors.length} entr(ies) in the task list were unusable:`)
    for (const e of m.taskErrors.slice(0, 10)) L.push(`          ${e}`)
  }
  if (m.probeErrors?.length) {
    L.push('')
    L.push(`ERRORS    ${m.probeErrors.length} probe(s) failed outright and were scored as failures:`)
    for (const e of m.probeErrors.slice(0, 5)) L.push(`          ${e}`)
  }

  return L.join('\n')
}
