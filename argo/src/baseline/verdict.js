/**
 * verdict.js — the arithmetic that decides whether a crew earned its calls.
 *
 * a crew is a bet on your own diagram, and the only thing that settles the bet is
 * a control: one agent doing the same task list. almost nobody keeps that control
 * alive, so almost nobody can say whether their fan-out bought capability or just
 * spent more to do worse.
 *
 * the deciding number is not the raw delta. a crew that fixes two tasks and
 * breaks five still moves a pass count around slowly enough to read as progress,
 * so regressions are counted against fixes explicitly and that ratio is allowed
 * to override the score.
 *
 * re-run all of this after every model upgrade. solo success rate is the decisive
 * variable, a better model raises it, and a higher solo baseline is exactly what
 * makes a crew stop paying — this verdict has a shelf life measured in model
 * releases, not months.
 */

/**
 * The published inflection point: below roughly this solo success rate a crew
 * tends to add capability, above it a crew tends to add cost and error instead.
 *
 * It is a heuristic from one study on one model family, not a law. It is a PRIOR,
 * and the user's own measured numbers override it. PRIOR_NOTE exists so that
 * caveat travels in the output rather than staying buried here.
 */
export const SOLO_INFLECTION = 0.45

export const PRIOR_NOTE =
  `The ${(SOLO_INFLECTION * 100).toFixed(0)}% solo-success inflection point is a prior, not a law — it comes from ` +
  'one study on one model family. Your own measured rates override it; if this list is ' +
  'unrepresentative of your real work, the verdict is too.'

export const RERUN_NOTE =
  'Re-run after every model upgrade. A better model raises the solo baseline, and a higher ' +
  'solo baseline is what makes a crew stop paying — this verdict expires on model releases, not dates.'

/** Smallest crew gain worth calling a gain at all, before cost is considered. */
const BASE_MARGIN = 0.05

/** Above this, extra cost can no longer be bought back with pass rate alone. */
const MAX_MARGIN = 0.30

function isPass(r) {
  return r === true || (r != null && typeof r === 'object' && r.pass === true)
}

function round(n, places) {
  const f = 10 ** places
  return Math.round(n * f) / f
}

function sum(rows, key) {
  let total = 0
  for (const r of rows ?? []) {
    const v = r?.[key]
    if (typeof v === 'number' && Number.isFinite(v)) total += v
  }
  return total
}

/**
 * Pass rate for one arm.
 * Accepts booleans or `{ pass }` records so callers can hand over raw runs.
 *
 * @param {Array<boolean|{pass:boolean}>} results
 * @returns {{passed:number,total:number,rate:number}}
 */
export function scoreRun(results) {
  const list = Array.isArray(results) ? results : []
  let passed = 0
  for (const r of list) if (isPass(r)) passed++
  return { passed, total: list.length, rate: list.length > 0 ? passed / list.length : 0 }
}

/**
 * The number that matters. Of the tasks the solo agent got RIGHT, how many did
 * the crew get wrong — measured against how many the crew rescued.
 *
 * Tasks are matched by id; anything present in one arm and not the other is
 * ignored rather than scored, because an unrun task is not a regression.
 *
 * @param {Array<{id:string,pass:boolean}>} soloResults
 * @param {Array<{id:string,pass:boolean}>} crewResults
 * @returns {{regressions:number,fixes:number,amplification:number,netDelta:number}}
 */
export function errorAmplification(soloResults, crewResults) {
  const crewById = new Map()
  for (const r of crewResults ?? []) {
    if (r && r.id != null) crewById.set(String(r.id), r)
  }

  let regressions = 0
  let fixes = 0
  for (const s of soloResults ?? []) {
    if (!s || s.id == null) continue
    const c = crewById.get(String(s.id))
    if (c === undefined) continue
    if (isPass(s) && !isPass(c)) regressions++
    else if (!isPass(s) && isPass(c)) fixes++
  }

  return {
    regressions,
    fixes,
    // max(1, fixes) so a crew that fixes nothing and breaks three reads as 3, not Infinity.
    amplification: round(regressions / Math.max(1, fixes), 3),
    netDelta: fixes - regressions,
  }
}

/**
 * How much pass rate the crew has to add before its extra spend is defensible.
 * A crew costing 5x solo has to buy 20 points; one costing 1.5x has to buy 5.
 */
export function requiredMargin(costRatio) {
  const r = Number.isFinite(costRatio) && costRatio > 0 ? costRatio : 1
  const raw = BASE_MARGIN * Math.max(1, r - 1)
  return round(Math.min(MAX_MARGIN, Math.max(BASE_MARGIN, raw)), 4)
}

const pct = (n) => `${(n * 100).toFixed(1)}%`

/**
 * Does the crew earn its calls on THIS task list.
 *
 * Order matters. Amplification is checked first and overrides everything: a crew
 * that breaks more than it fixes has failed regardless of what the raw score did,
 * because the raw score is an average and the breakages are specific.
 *
 * @param {{soloRate:number,crewRate:number,amplification:number,costRatio:number}} input
 * @returns {{level:'crew-pays'|'crew-neutral'|'crew-subtracts', message:string}}
 */
export function verdict({ soloRate = 0, crewRate = 0, amplification = 0, costRatio = 1 } = {}) {
  const gain = crewRate - soloRate
  const need = requiredMargin(costRatio)
  const cost = Number.isFinite(costRatio) && costRatio > 0 ? costRatio : 1

  if (amplification > 1) {
    return {
      level: 'crew-subtracts',
      message:
        `The crew broke ${amplification.toFixed(2)} tasks for every one it fixed. Raw rate moved ` +
        `${gain >= 0 ? '+' : ''}${pct(gain)}, but that average is hiding work the solo agent already ` +
        `had right. Cut the fan-out or shrink what the workers may touch.`,
    }
  }

  if (gain < 0) {
    return {
      level: 'crew-subtracts',
      message:
        `The crew scored ${pct(crewRate)} against solo ${pct(soloRate)} — ${pct(-gain)} worse, at ` +
        `${cost.toFixed(1)}x the cost. You are paying more to do less.`,
    }
  }

  if (soloRate >= SOLO_INFLECTION && gain < need) {
    return {
      level: 'crew-subtracts',
      message:
        `Solo already clears ${pct(soloRate)} of this list, above the ${pct(SOLO_INFLECTION)} inflection ` +
        `point, and the crew adds only ${pct(gain)} for ${cost.toFixed(1)}x the cost (needs ${pct(need)}). ` +
        `A single agent is the cheaper and safer topology here.`,
    }
  }

  if (gain >= need) {
    return {
      level: 'crew-pays',
      message:
        `Crew ${pct(crewRate)} vs solo ${pct(soloRate)}: +${pct(gain)} for ${cost.toFixed(1)}x the cost, ` +
        `clearing the ${pct(need)} bar, and it broke ${amplification.toFixed(2)} tasks per fix. ` +
        `The fan-out is earning its calls on this list.`,
    }
  }

  return {
    level: 'crew-neutral',
    message:
      `Crew ${pct(crewRate)} vs solo ${pct(soloRate)}: +${pct(gain)}, short of the ${pct(need)} needed to ` +
      `justify ${cost.toFixed(1)}x the cost. Solo is weak enough (${pct(soloRate)}) that the crew is not ` +
      `obviously wrong — widen the task list before deciding.`,
  }
}

/**
 * Collapse repeats into one record per task.
 *
 * A task counts as passed when a strict majority of its attempts passed, so a
 * task that flakes 1-of-2 is not credited to either arm. Wall time and cost are
 * summed, because the bill is the sum of the attempts you actually paid for.
 */
export function aggregateRepeats(runs) {
  const byId = new Map()
  for (const r of runs ?? []) {
    if (!r || r.id == null) continue
    const id = String(r.id)
    if (!byId.has(id)) byId.set(id, { id, attempts: 0, passes: 0, ms: 0, costUsd: 0, tokens: 0, errors: 0 })
    const acc = byId.get(id)
    acc.attempts++
    if (isPass(r)) acc.passes++
    if (Number.isFinite(r.ms)) acc.ms += r.ms
    if (Number.isFinite(r.costUsd)) acc.costUsd += r.costUsd
    if (Number.isFinite(r.tokens)) acc.tokens += r.tokens
    if (r.error) acc.errors++
  }

  return [...byId.values()].map((a) => ({
    ...a,
    costUsd: round(a.costUsd, 6),
    pass: a.passes * 2 > a.attempts,
    rate: a.attempts > 0 ? round(a.passes / a.attempts, 4) : 0,
  }))
}

/** Per-task outcome, which is where a raw delta hides its regressions. */
export function compareRows(solo, crew) {
  const crewById = new Map()
  for (const c of crew ?? []) if (c && c.id != null) crewById.set(String(c.id), c)

  return (solo ?? []).map((s) => {
    const c = crewById.get(String(s.id))
    const sp = isPass(s)
    const cp = isPass(c)
    let outcome
    if (c === undefined) outcome = 'unrun'
    else if (sp && cp) outcome = 'both-pass'
    else if (sp && !cp) outcome = 'regression'
    else if (!sp && cp) outcome = 'fix'
    else outcome = 'both-fail'
    return {
      id: String(s.id),
      solo: sp,
      crew: cp,
      outcome,
      soloRate: s.rate ?? (sp ? 1 : 0),
      crewRate: c?.rate ?? (cp ? 1 : 0),
    }
  })
}

/**
 * Cost side of the comparison. Measured dollars when the CLI reported them,
 * otherwise the nominal supervisor+workers call count — labelled either way, so
 * nobody mistakes an assumption for a measurement.
 */
export function costSummary(solo, crew, workers = 1) {
  const soloUsd = sum(solo, 'costUsd')
  const crewUsd = sum(crew, 'costUsd')
  const measured = soloUsd > 0 && crewUsd > 0
  const nominal = Math.max(1, (Number(workers) || 1) + 1)
  return {
    soloUsd: round(soloUsd, 4),
    crewUsd: round(crewUsd, 4),
    soloMs: sum(solo, 'ms'),
    crewMs: sum(crew, 'ms'),
    soloTokens: sum(solo, 'tokens'),
    crewTokens: sum(crew, 'tokens'),
    ratio: measured ? round(crewUsd / soloUsd, 3) : nominal,
    basis: measured ? 'measured' : 'nominal',
  }
}

/**
 * Assemble the whole comparison from two arms of raw runs. Pure: everything that
 * touches a model, a clock or a disk happens before this is called.
 */
export function buildComparison({ soloRuns, crewRuns, workers = 1, label = null, meta = {} } = {}) {
  const solo = aggregateRepeats(soloRuns)
  const crew = aggregateRepeats(crewRuns)
  const soloScore = scoreRun(solo)
  const crewScore = scoreRun(crew)
  const amp = errorAmplification(solo, crew)
  const cost = costSummary(solo, crew, workers)
  const v = verdict({
    soloRate: soloScore.rate,
    crewRate: crewScore.rate,
    amplification: amp.amplification,
    costRatio: cost.ratio,
  })

  return {
    label,
    workers,
    meta,
    tasks: solo.length,
    solo: { ...soloScore, rate: round(soloScore.rate, 4), perTask: solo },
    crew: { ...crewScore, rate: round(crewScore.rate, 4), perTask: crew },
    rawDelta: {
      tasks: crewScore.passed - soloScore.passed,
      rate: round(crewScore.rate - soloScore.rate, 4),
    },
    amplification: amp,
    cost,
    requiredMargin: requiredMargin(cost.ratio),
    rows: compareRows(solo, crew),
    verdict: v,
    priorNote: PRIOR_NOTE,
    rerunNote: RERUN_NOTE,
  }
}
