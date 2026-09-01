/**
 * score.js — how far apart two answers to the same question landed.
 *
 * the failure this file exists to catch is not "an agent was wrong". it is
 * "two of your agents were each individually plausible and contradicted each
 * other". that only ever shows up per pair. a fleet average dilutes one
 * contradicting pair against every pair that happened to agree, which is why
 * pairMatrix reports fleetMean but does not gate on it.
 *
 * the scorer is layered, cheapest signal first: most pairs are settled by
 * string equality and never need the rest.
 */

/** Extensions that make a bare token look like a source file rather than a word. */
const SOURCE_EXT =
  /\.(js|mjs|cjs|jsx|ts|tsx|mts|cts|py|pyi|go|rs|java|kt|kts|scala|cs|c|h|cc|cpp|hpp|rb|php|swift|ex|exs|dart|lua|sh|bash|sql|md|mdx|json|ya?ml|toml|ini|cfg|lock)$/

/**
 * Strip everything that two agents can differ on without disagreeing:
 * casing, markdown furniture, sentence punctuation, whitespace, thousands
 * separators, and a leading `./` on a path. What survives is the claim.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalise(text) {
  if (typeof text !== 'string') return ''
  return text
    .replace(/```[^\n]*/g, ' ')
    .replace(/`/g, ' ')
    .toLowerCase()
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[*~#>|"'()[\]{}]/g, ' ')
    .replace(/[,;:!?]/g, ' ')
    .replace(/(^|\s)[-+]+(?=\s)/g, '$1')
    .replace(/(^|\s)\.\//g, '$1')
    .replace(/\.(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Normalised whitespace tokens. */
export function tokens(text) {
  const n = normalise(text)
  return n === '' ? [] : n.split(' ')
}

/** Identical after normalisation. The cheapest layer, and the one that fires most. */
export function exactMatch(a, b) {
  return normalise(a) === normalise(b)
}

/** Set overlap on token sets: |A∩B| / |A∪B|. Two empties agree. */
export function jaccard(a, b) {
  const A = new Set(tokens(a))
  const B = new Set(tokens(b))
  if (A.size === 0 && B.size === 0) return 1
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  const union = A.size + B.size - inter
  return union === 0 ? 1 : inter / union
}

/**
 * Cosine on token-frequency vectors. Unlike jaccard this notices repetition,
 * so an answer that hammers one path is not treated as the same claim as one
 * that mentions it once among ten others.
 */
export function cosine(a, b) {
  const A = freq(tokens(a))
  const B = freq(tokens(b))
  if (A.size === 0 && B.size === 0) return 1
  if (A.size === 0 || B.size === 0) return 0
  let dot = 0
  for (const [t, n] of A) dot += n * (B.get(t) ?? 0)
  const magA = Math.sqrt([...A.values()].reduce((s, n) => s + n * n, 0))
  const magB = Math.sqrt([...B.values()].reduce((s, n) => s + n * n, 0))
  return magA === 0 || magB === 0 ? 0 : dot / (magA * magB)
}

function freq(list) {
  const m = new Map()
  for (const t of list) m.set(t, (m.get(t) ?? 0) + 1)
  return m
}

/**
 * Tokens that look like files: anything containing a slash, or ending in a
 * known source extension. Leading `./` and `/` are dropped so `./src/a.js`
 * and `src/a.js` are the same claim.
 */
export function extractPaths(text) {
  const out = new Set()
  for (const tok of tokens(text)) {
    const t = tok.replace(/^[./]+/, '').replace(/[./]+$/, '')
    if (!t) continue
    if (t.includes('/') || SOURCE_EXT.test(t)) out.add(t)
  }
  return [...out].sort()
}

/**
 * Compare the file-path tokens separately from the prose around them.
 * For a code question the paths ARE the answer; whether one agent wrapped it
 * in a sentence is noise.
 *
 * @returns {{similarity: number, present: boolean, a: string[], b: string[]}}
 *          `present` is false when neither side named a path, in which case
 *          the caller must not weight this layer at all.
 */
export function pathOverlap(a, b) {
  const pa = extractPaths(a)
  const pb = extractPaths(b)
  const present = pa.length > 0 || pb.length > 0
  if (!present) return { similarity: 1, present: false, a: pa, b: pb }
  const B = new Set(pb)
  let inter = 0
  for (const p of new Set(pa)) if (B.has(p)) inter++
  const union = new Set([...pa, ...pb]).size
  return { similarity: union === 0 ? 1 : inter / union, present: true, a: pa, b: pb }
}

/**
 * Standalone quantities. Numbers glued to a word (`p90`) or sitting inside a
 * path (`v2/api.js`) are identifiers, not measurements, so they are skipped.
 * Dotted versions (`1.2.3`) are left to the lexical layer on purpose — they
 * are names too.
 */
export function extractNumbers(text) {
  const out = []
  for (const tok of tokens(text)) {
    if (tok.includes('/') || SOURCE_EXT.test(tok)) continue
    for (const m of tok.matchAll(/(?<![\w.])[-+]?\d+(?:\.\d+)?(?![\w.])/g)) {
      const v = Number(m[0])
      if (Number.isFinite(v)) out.push(v)
    }
  }
  return out
}

/**
 * Do the two answers claim the same quantities?
 *
 * Disagreeing numbers are the strongest divergence signal there is: "5 workers"
 * and "3 workers" cannot both be right, whereas two different phrasings can.
 *
 * @returns {{agreement: number, present: boolean, a: number[], b: number[]}}
 */
export function numericAgreement(a, b) {
  const na = extractNumbers(a)
  const nb = extractNumbers(b)
  const present = na.length > 0 || nb.length > 0
  if (!present) return { agreement: 1, present: false, a: na, b: nb }
  const key = (v) => String(Number(v.toFixed(6)))
  const A = new Set(na.map(key))
  const B = new Set(nb.map(key))
  let inter = 0
  for (const k of A) if (B.has(k)) inter++
  const union = A.size + B.size - inter
  return { agreement: union === 0 ? 1 : inter / union, present: true, a: na, b: nb }
}

/**
 * Is one answer's token set entirely inside the other's?
 *
 * That is the signature of padding, not disagreement: the shorter answer makes
 * no claim the longer one contradicts, it just did not wrap itself in a
 * sentence. It matters because the probe set deliberately asks for bare answers
 * ("Answer with one word", "the directory name only"), so "javascript" and
 * "The primary language is javascript" are the SAME answer — and a bag-of-words
 * score punishes the length gap hard enough to call it a contradiction.
 *
 * Only a strict subset counts. A partial overlap is not padding: "yes there is
 * a circular dependency" and "no there is no circular dependency" share most of
 * their words while contradicting outright, and neither contains the other, so
 * they are left to cosine and jaccard where they belong.
 */
export function containment(a, b) {
  const A = new Set(tokens(a))
  const B = new Set(tokens(b))
  if (A.size === 0 || B.size === 0) return false
  const [small, large] = A.size <= B.size ? [A, B] : [B, A]
  for (const t of small) if (!large.has(t)) return false
  return true
}

/**
 * Similarity floor applied when one answer contains the other. 0.75 puts a
 * padded answer at 0.25 divergence — inside the same 0.21–0.27 wording band the
 * path and number layers already produce, and clear of the 0.35 gate.
 */
const CONTAINED_FLOOR = 0.75

/**
 * Layer weights.
 *
 * Rationale, in the order the weights were argued:
 *   - a numeric contradiction is unambiguous, so numbers take the largest share
 *     whenever any number is on the table.
 *   - paths come next: for a code question they carry the answer, but two
 *     answers can each name a partially correct subset of a file list, so a
 *     path mismatch is slightly weaker evidence than a number mismatch.
 *   - lexical similarity never goes to zero weight. It is the only layer that
 *     survives when an agent answers in prose, and it keeps a floor under the
 *     score so an answer that goes somewhere else entirely still registers.
 *
 * The single-layer weights are high (0.65 / 0.70) for a measured reason. At
 * 0.55 / 0.60 a pair that agreed perfectly on the path and differed only in how
 * much prose it wrapped around it scored 0.27–0.35 — touching the default 0.35
 * gate on wording alone, while a real contradiction scored ~0.69. Pushing the
 * strong layer up drops the wording band to ~0.21 and leaves the contradiction
 * band untouched, which is the separation the gate depends on.
 *
 * Known cost, stated plainly: weighting paths this hard means "src/cli.js is
 * the entrypoint" and "src/cli.js is not the entrypoint" score as near
 * agreement. Lexical similarity is blind to negation, and the containment floor
 * above widens that same blind spot slightly — a negated answer usually
 * contains the affirmative one word for word. Probes that invite a yes/no
 * answer must be read from the answers, not from the score.
 */
const WEIGHTS = {
  both:    { num: 0.40, path: 0.35, lex: 0.25 },
  num:     { num: 0.70, path: 0.00, lex: 0.30 },
  path:    { num: 0.00, path: 0.65, lex: 0.35 },
  neither: { num: 0.00, path: 0.00, lex: 1.00 },
}

/** Lexical blend. Cosine leads because frequency carries emphasis; jaccard
 *  keeps a long answer from drowning a short correct one. Containment then puts
 *  a floor under the pair, because neither of those two can tell a padded
 *  restatement from a different answer once no path or number is on the table. */
function lexical(a, b) {
  const blend = 0.6 * cosine(a, b) + 0.4 * jaccard(a, b)
  return containment(a, b) ? Math.max(blend, CONTAINED_FLOOR) : blend
}

/**
 * How far apart two answers are: 0 = identical, 1 = unrelated.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function divergence(a, b) {
  if (exactMatch(a, b)) return 0
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.length === 0 && tb.length === 0) return 0
  if (ta.length === 0 || tb.length === 0) return 1

  const p = pathOverlap(a, b)
  const n = numericAgreement(a, b)
  const w = n.present && p.present ? WEIGHTS.both
    : n.present ? WEIGHTS.num
      : p.present ? WEIGHTS.path
        : WEIGHTS.neither

  const similarity = w.lex * lexical(a, b) + w.path * p.similarity + w.num * n.agreement
  return round4(Math.min(1, Math.max(0, 1 - similarity)))
}

/**
 * The sample an agent would most defensibly stand behind: the medoid of its
 * own repeats. Picking the medoid rather than the first sample keeps one
 * unlucky roll from being mistaken for a stable position.
 */
export function representative(samples) {
  const list = (samples ?? []).filter((s) => typeof s === 'string')
  if (list.length === 0) return null
  if (list.length === 1) return list[0]
  let best = 0
  let bestCost = Infinity
  for (let i = 0; i < list.length; i++) {
    let cost = 0
    for (let j = 0; j < list.length; j++) if (i !== j) cost += divergence(list[i], list[j])
    if (cost < bestCost - 1e-12) {
      bestCost = cost
      best = i
    }
  }
  return list[best]
}

/**
 * How far an agent lands from ITSELF across repeats. Without this you cannot
 * tell "these two agents disagree" from "this model is just noisy", and the
 * two want completely different fixes.
 *
 * @returns {number|null} null when there are fewer than two samples
 */
export function selfDivergence(samples) {
  const list = (samples ?? []).filter((s) => typeof s === 'string')
  if (list.length < 2) return null
  let sum = 0
  let n = 0
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      sum += divergence(list[i], list[j])
      n++
    }
  }
  return round4(sum / n)
}

/**
 * Score every (agent_i, agent_j) pair over every question.
 *
 * @param {object|Map} answersByAgent  agent -> array indexed by question, each
 *        entry a string, an array of repeat samples, or null when the call failed
 * @returns {object} { agents, questionCount, answers, pairs, worstPair,
 *                     worstQuestion, fleetMean, selfDivergence }
 */
export function pairMatrix(answersByAgent) {
  const entries = toEntries(answersByAgent)
  const agents = entries.map(([name]) => name)
  const questionCount = entries.reduce((n, [, rows]) => Math.max(n, (rows ?? []).length), 0)

  const answers = {}
  const self = {}
  for (const [name, rows] of entries) {
    const collapsed = []
    const spread = []
    for (let q = 0; q < questionCount; q++) {
      const cell = (rows ?? [])[q]
      if (Array.isArray(cell)) {
        collapsed.push(representative(cell))
        spread.push(selfDivergence(cell))
      } else if (typeof cell === 'string') {
        collapsed.push(cell)
        spread.push(null)
      } else {
        collapsed.push(null)
        spread.push(null)
      }
    }
    answers[name] = collapsed
    const scored = spread.filter((v) => v !== null)
    self[name] = scored.length > 0 ? round4(mean(scored)) : null
  }

  const pairs = []
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i]
      const b = agents[j]
      const perQuestion = []
      for (let q = 0; q < questionCount; q++) {
        const ta = answers[a][q]
        const tb = answers[b][q]
        // A failed call is not a disagreement. Scoring it as one would let an
        // outage masquerade as divergence, which is the opposite of useful.
        const d = ta === null || tb === null ? null : divergence(ta, tb)
        perQuestion.push({ index: q, divergence: d })
      }
      const scored = perQuestion.map((p) => p.divergence).filter((v) => v !== null)
      pairs.push({
        a,
        b,
        meanDivergence: scored.length > 0 ? round4(mean(scored)) : null,
        maxDivergence: scored.length > 0 ? round4(Math.max(...scored)) : null,
        scoredQuestions: scored.length,
        perQuestion,
      })
    }
  }

  const ranked = pairs.filter((p) => p.meanDivergence !== null)
  const worstPair = ranked.length > 0
    ? ranked.reduce((w, p) => (p.meanDivergence > w.meanDivergence ? p : w))
    : null

  // fleetMean is the number that HIDES the problem. It is reported so the user
  // can see how mild a fleet looks in aggregate while one pair is contradicting
  // itself — never as a gate.
  const fleetMean = ranked.length > 0 ? round4(mean(ranked.map((p) => p.meanDivergence))) : null

  let worstQuestion = null
  for (let q = 0; q < questionCount; q++) {
    const vals = pairs.map((p) => p.perQuestion[q]?.divergence).filter((v) => v !== null && v !== undefined)
    if (vals.length === 0) continue
    const m = round4(mean(vals))
    if (!worstQuestion || m > worstQuestion.meanDivergence) {
      worstQuestion = { index: q, meanDivergence: m, maxDivergence: round4(Math.max(...vals)) }
    }
  }

  return { agents, questionCount, answers, pairs, worstPair, worstQuestion, fleetMean, selfDivergence: self }
}

/**
 * Unanimity is not proof of correctness — it is also exactly what a copied
 * error looks like when every agent inherited the same context or the same
 * base model. So agreement is reported as its own signal rather than being
 * folded into "low divergence", and a lone dissenter is called out instead of
 * being averaged away.
 *
 * @param {object|Map|Array} answers  agent -> answer for ONE question
 * @returns {{level: 'none'|'dissent'|'unanimous', trapped: boolean,
 *            majority: string[], dissenters: string[], majorityAnswer: string|null,
 *            size: number, note: string}}
 */
export function consensusTrap(answers) {
  const entries = toEntries(answers).filter(([, text]) => typeof text === 'string')
  const groups = new Map()
  for (const [agent, text] of entries) {
    const key = normalise(text)
    if (!groups.has(key)) groups.set(key, { agents: [], sample: text })
    groups.get(key).agents.push(agent)
  }

  const clusters = [...groups.entries()]
    .map(([key, g]) => ({ key, agents: g.agents, sample: g.sample }))
    .sort((x, y) => y.agents.length - x.agents.length || x.key.localeCompare(y.key))

  const top = clusters[0]
  const size = top ? top.agents.length : 0
  const majority = top ? [...top.agents] : []
  const dissenters = entries.map(([a]) => a).filter((a) => !majority.includes(a))

  if (size < 3) {
    return {
      level: 'none',
      trapped: false,
      majority,
      dissenters,
      majorityAnswer: top?.sample ?? null,
      size,
      note: 'no cluster of three or more identical answers',
    }
  }

  if (dissenters.length === 0) {
    return {
      level: 'unanimous',
      trapped: true,
      majority,
      dissenters,
      majorityAnswer: top.sample,
      size,
      note:
        `all ${size} agents returned the identical answer. that is what a correct ` +
        'fleet looks like and also what a shared prior or a copied error looks like — ' +
        'this is not evidence of correctness, only of common cause.',
    }
  }

  return {
    level: 'dissent',
    trapped: true,
    majority,
    dissenters,
    majorityAnswer: top.sample,
    size,
    note:
      `${size} agents agree exactly and ${dissenters.length} dissent. the majority is ` +
      'not a vote — check the dissenter before you assume it is the one that is wrong.',
  }
}

function mean(list) {
  return list.reduce((s, n) => s + n, 0) / list.length
}

function round4(n) {
  return Number(n.toFixed(4))
}

/** Accept object maps, Maps, [key, value] pairs, or [{ agent, text }] alike. */
function toEntries(input) {
  if (input instanceof Map) return [...input.entries()]
  if (Array.isArray(input)) {
    return input.map((item, i) => {
      if (Array.isArray(item)) return [String(item[0]), item[1]]
      if (item && typeof item === 'object') {
        return [String(item.agent ?? item.name ?? i), item.text ?? item.answer ?? null]
      }
      return [String(i), item]
    })
  }
  if (input && typeof input === 'object') return Object.entries(input)
  return []
}

export { SOURCE_EXT, WEIGHTS }
