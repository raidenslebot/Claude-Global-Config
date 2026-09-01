/**
 * simulate.js — the offline arm.
 *
 * a control that can only be exercised by spending tokens stops being exercised,
 * and then the control is dead again. --dry-run therefore has to drive the whole
 * pipeline: both arms, the amplification, the verdict, the artifact.
 *
 * every draw here is a seeded hash of (seed, task id, stream, repeat) — no
 * Math.random, no clock, no accumulator. the same seed and the same task list
 * produce byte-identical output forever, which is what makes the arithmetic
 * testable and the report diffable.
 *
 * the shape of the simulation encodes the claim under test rather than a happy
 * path: the crew rescues some of what solo missed AND breaks some of what solo
 * already had, with breakage rising as the fan-out widens.
 */

/** FNV-1a. Small, deterministic, and does not need a dependency. */
export function hash32(str) {
  let h = 0x811c9dc5
  const s = String(str)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * A stable draw in [0,1) from any set of parts.
 *
 * Parts are length-prefixed before joining, so ('ab','c') and ('a','bc') cannot
 * collide whatever separator is used — a collision here would silently couple
 * two independent draws and quietly bias the whole simulation.
 */
export function unitFrom(...parts) {
  const key = parts.map((p) => `${String(p).length}:${p}`).join('|')
  // one extra mixing round so short, similar keys ('t1' vs 't2') separate.
  const h = hash32(key)
  const mixed = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0
  return mixed / 0x100000000
}

/** Baseline competence of the simulated single agent, on a 0..1 difficulty scale. */
const DEFAULT_SOLO_SKILL = 0.6

/** Share of solo failures a crew rescues. */
const FIX_RATE = 0.35

/** Share of solo successes a crew breaks at two workers, before the width penalty. */
const BREAK_RATE = 0.18

/** Extra breakage per worker beyond two — more edges, more places to lose context. */
const BREAK_PER_WORKER = 0.045

/**
 * One simulated run.
 *
 * The crew outcome is defined RELATIVE to the solo outcome for the same task and
 * repeat, which is the only way a simulated error amplification means anything:
 * a regression has to be a task solo actually got right.
 *
 * @param {object} o
 * @param {number} o.seed
 * @param {string} o.taskId
 * @param {'solo'|'crew'} o.arm
 * @param {number} [o.repeat]
 * @param {number} [o.workers]
 * @param {number} [o.soloSkill]
 * @returns {{pass:boolean, ms:number, costUsd:number, tokens:number, output:string, difficulty:number}}
 */
export function simulateOutcome({ seed = 1337, taskId, arm = 'solo', repeat = 0, workers = 3, soloSkill = DEFAULT_SOLO_SKILL } = {}) {
  const difficulty = unitFrom(seed, taskId, 'difficulty')
  const jitter = (unitFrom(seed, taskId, 'jitter', repeat) - 0.5) * 0.16
  const soloPass = difficulty + jitter < soloSkill

  let pass = soloPass
  if (arm === 'crew') {
    const roll = unitFrom(seed, taskId, 'crew', repeat)
    const breakChance = BREAK_RATE + BREAK_PER_WORKER * Math.max(0, workers - 2)
    pass = soloPass ? roll >= breakChance : roll < FIX_RATE
  }

  const soloMs = 4000 + Math.round(difficulty * 8000)
  const soloUsd = 0.012 + difficulty * 0.03
  const soloTokens = 3000 + Math.round(difficulty * 9000)
  const fan = Math.max(1, workers)
  const crewed = arm === 'crew'

  return {
    pass,
    difficulty: Math.round(difficulty * 1000) / 1000,
    // a crew is not k times slower — the workers overlap — but the supervisor adds turns.
    ms: crewed ? Math.round(soloMs * (1.3 + 0.22 * fan)) : soloMs,
    costUsd: Math.round(soloUsd * (crewed ? 0.7 + 0.9 * fan : 1) * 1e6) / 1e6,
    tokens: crewed ? Math.round(soloTokens * (0.8 + 0.95 * fan)) : soloTokens,
    output: `[dry-run] simulated ${arm} response for ${taskId} (${pass ? 'check would pass' : 'check would fail'})`,
  }
}

/**
 * What a real run of this command would have cost, stated up front. The point of
 * a dry run is to decide whether to pay, so the estimate belongs in the dry run.
 */
export function estimateSpend(runs) {
  let usd = 0
  let tokens = 0
  for (const r of runs ?? []) {
    if (Number.isFinite(r?.costUsd)) usd += r.costUsd
    if (Number.isFinite(r?.tokens)) tokens += r.tokens
  }
  return { usd: Math.round(usd * 1e4) / 1e4, tokens }
}
