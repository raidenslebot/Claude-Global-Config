/**
 * report.js — assemble the divergence report, then render it.
 *
 * the layout is ordered by what should change behaviour: the matrix first (per
 * pair, because that is where the failure lives), then the breaches, then the
 * evidence for the worst one. the fleet mean is printed near the bottom and
 * labelled as the number that hides the problem, so nobody quotes it as a KPI.
 *
 * buildReport is pure — samples in, report out — so the whole shape of the
 * output can be tested without a model call.
 */

import { pairMatrix, consensusTrap, divergence } from './score.js'

/** Widest agent name we will print in a matrix column. */
const NAME_W = 9

/**
 * Assemble the full report.
 *
 * @param {object} input
 * @param {string}   input.root
 * @param {Array}    input.agents    [{ name, model, ... }]
 * @param {Array}    input.probes    [{ id, question, kind, graphAnswer }]
 * @param {object}   input.samples   agent -> array indexed by probe, each an array of repeat texts
 * @param {number}   input.threshold divergence above which a pair fails
 * @param {'max'|'mean'} [input.gate] which per-pair number the threshold reads
 * @param {number}   input.repeats
 * @param {string}   input.model
 * @param {string}   input.mode      'live' | 'dry-run'
 * @param {Array}    [input.errors]
 */
export function buildReport(input) {
  const {
    root, agents, probes, samples, threshold = 0.35, repeats = 1,
    gate = 'max', model = '(cli default)', mode = 'live', errors = [],
  } = input

  const matrix = pairMatrix(samples)

  const consensus = probes.map((_, i) => {
    const row = {}
    for (const name of matrix.agents) {
      const a = matrix.answers[name]?.[i]
      if (typeof a === 'string') row[name] = a
    }
    return { index: i, ...consensusTrap(row) }
  })

  // Distance from the graph's own reading of the repo. A secondary signal only:
  // the graph is a regex-based approximation, so a high number here means
  // "worth a look", never "the agent is wrong".
  const groundTruth = {}
  let anyTruth = false
  for (const name of matrix.agents) {
    const scores = []
    probes.forEach((probe, i) => {
      const a = matrix.answers[name]?.[i]
      if (typeof a === 'string' && probe.graphAnswer) scores.push(divergence(a, probe.graphAnswer))
    })
    if (scores.length > 0) anyTruth = true
    groundTruth[name] = scores.length > 0
      ? Number((scores.reduce((s, n) => s + n, 0) / scores.length).toFixed(4))
      : null
  }

  // Which per-pair number the gate reads.
  //
  // Default is max, and the reason is the tool's own thesis. This module
  // refuses to gate on the FLEET mean because it "dilutes one contradicting
  // pair against every pair that happened to agree". A pair's mean ACROSS
  // PROBES commits exactly that error one level down: it dilutes one probe the
  // pair flatly contradicted on against every probe they agreed on. Observed on
  // this repo — mean 0.332 (pass) hiding probe-level 0.877, 0.743 and 0.700.
  //
  // A single probe where two of your agents contradict each other is the
  // failure this tool exists to find, so it is the thing that fails the build.
  // --gate mean opts back into the lenient reading.
  const metric = gate === 'mean' ? 'meanDivergence' : 'maxDivergence'
  const breaches = matrix.pairs
    .filter((p) => p[metric] !== null && p[metric] > threshold)
    .map((p) => ({ ...p, gatedOn: gate, gatedValue: p[metric] }))

  return {
    root,
    mode,
    model,
    threshold,
    repeats,
    agents,
    probes,
    samples,
    gate,
    matrix,
    consensus,
    breaches,
    groundTruth: anyTruth ? groundTruth : null,
    errors,
    verdict: verdict({ matrix, breaches, consensus, threshold, gate, errors, mode, probes }),
  }
}

/**
 * The one line someone reads. Ordered by severity: a breach beats a trap, a
 * trap beats a clean run, and an all-failed run beats both because the number
 * it would otherwise print is meaningless.
 */
export function verdict({
  matrix, breaches, consensus, threshold, gate = 'max',
  errors = [], mode = 'live', probes = [],
}) {
  const scored = matrix.pairs.filter((p) => p.meanDivergence !== null)
  const prefix = mode === 'dry-run' ? 'Dry run (synthetic answers). ' : ''
  // A green verdict standing on a probe set that mostly never landed is the
  // same silent pass as an all-failed run, one notch quieter: the pairs that
  // scored are real, the confidence is not. So the count of calls that never
  // answered goes in the one line someone reads, not only in the body.
  const unmeasured = errors.length > 0 ? ` ${errors.length} call(s) failed and were never measured.` : ''

  if (matrix.agents.length < 2) {
    return { level: 'insufficient', message: `${prefix}Divergence needs at least two agents; got ${matrix.agents.length}.` }
  }
  if (scored.length === 0) {
    return {
      level: 'no-data',
      message: `${prefix}No pair scored a single probe — ${errors.length} call(s) failed. Nothing was measured.`,
    }
  }
  if (breaches.length > 0) {
    // Report the pair that actually failed the gate, measured the way the gate
    // measured it. Naming the worst pair by mean while gating on max would put
    // a different number in the verdict than in the exit code.
    const metric = gate === 'mean' ? 'meanDivergence' : 'maxDivergence'
    const w = breaches.reduce((worst, p) => (p[metric] > worst[metric] ? p : worst), breaches[0])

    // On a max gate the actionable detail is WHICH question they split on.
    let where = ''
    if (gate === 'max') {
      const q = w.perQuestion
        .filter((x) => x.divergence !== null)
        .reduce((a, b) => (b.divergence > a.divergence ? b : a), { divergence: -1 })
      const probe = probes[q.index]
      if (probe) {
        const text = String(probe.question ?? probe.id ?? '')
        where = ` They split hardest on: "${text.length > 90 ? text.slice(0, 87) + '...' : text}".`
      }
    }

    return {
      level: 'breach',
      message:
        `${prefix}${breaches.length} of ${scored.length} pair(s) exceed the ${threshold} gate ` +
        `on ${gate === 'mean' ? 'mean' : 'worst-probe'} divergence. ` +
        `Worst: ${w.a} <-> ${w.b} at ${w[metric].toFixed(3)} ` +
        `(mean ${w.meanDivergence.toFixed(3)}).${where} ` +
        'Two of your own agents answered the same question differently — averaging ' +
        'across probes is what would hide it.',
    }
  }

  const traps = consensus.filter((c) => c.trapped)
  const unanimous = traps.filter((c) => c.level === 'unanimous').length
  if (traps.length > 0) {
    return {
      level: 'agree',
      message:
        `${prefix}No pair exceeds the ${threshold} gate, but ${traps.length} probe(s) drew ` +
        `identical answers from three or more agents (${unanimous} unanimous). Agreement this ` +
        'tight is either a correct fleet or one shared mistake, and divergence cannot tell you which.' +
        unmeasured,
    }
  }

  return {
    level: 'consistent',
    message:
      `${prefix}All ${scored.length} pair(s) sit under the ${threshold} gate ` +
      `(worst ${matrix.worstPair.meanDivergence.toFixed(3)}). The fleet is self-consistent on this probe set.` +
      unmeasured,
  }
}

/**
 * Human-readable terminal report.
 *
 * @param {object} report from buildReport()
 * @param {object} [opts]
 * @param {number} [opts.top] how many probes to show in the evidence block [3]
 */
export function renderText(report, { top = 3 } = {}) {
  const L = []
  const m = report.matrix
  const num = (v) => (v === null || v === undefined ? '   ·' : v.toFixed(2))

  L.push(`DIVERGE  ${report.root}`)
  L.push(
    `         ${report.agents.length} agents · ${report.probes.length} probes · ` +
      `${report.repeats} repeat${report.repeats === 1 ? '' : 's'} · model ${report.model} · gate ${report.threshold}`
  )
  if (report.mode === 'dry-run') {
    L.push('         DRY RUN — answers are synthetic. These numbers are illustrative, not measured.')
  }
  if (report.errors.length > 0) {
    L.push(`         ${report.errors.length} probe call(s) failed and were excluded from scoring`)
  }
  L.push('')

  L.push('MATRIX   pairwise mean divergence · 0 = identical, 1 = unrelated')
  const names = m.agents
  const head = names.map((n) => clip(n).padStart(NAME_W)).join(' ')
  L.push(`         ${''.padEnd(NAME_W)} ${head}`)
  for (const row of names) {
    const cells = names.map((col) => {
      if (row === col) return '·'.padStart(NAME_W)
      const pair = findPair(m.pairs, row, col)
      return num(pair?.meanDivergence).padStart(NAME_W)
    })
    L.push(`         ${clip(row).padEnd(NAME_W)} ${cells.join(' ')}`)
  }
  L.push('')

  L.push(`PAIRS    every pair, worst first — a fleet is only as consistent as its worst pair`)
  const ordered = [...m.pairs].sort(
    (a, b) => (b.meanDivergence ?? -1) - (a.meanDivergence ?? -1) ||
      a.a.localeCompare(b.a) || a.b.localeCompare(b.b)
  )
  for (const p of ordered) {
    if (p.meanDivergence === null) {
      L.push(`         ${p.a} <-> ${p.b}   (no scored probes — every call failed)`)
      continue
    }
    // Flag on whatever the gate actually reads, so the row and the exit code
    // never disagree about the same pair.
    const gated = report.gate === 'mean' ? p.meanDivergence : p.maxDivergence
    const flag = gated > report.threshold ? `BREACH (> ${report.threshold})` : 'ok'
    L.push(
      `         ${(`${p.a} <-> ${p.b}`).padEnd(30)} mean ${p.meanDivergence.toFixed(3)}  ` +
        `max ${p.maxDivergence.toFixed(3)}  ${flag}`
    )
  }
  L.push('')

  const anySelf = Object.values(m.selfDivergence).some((v) => v !== null)
  L.push('SELF     each agent against its own repeats')
  if (!anySelf) {
    L.push('         (not measured — run with --repeats 2 or more)')
    L.push('         without this you cannot tell "these agents disagree" from "this model is noisy"')
  } else {
    for (const name of names) {
      const v = m.selfDivergence[name]
      const note = v !== null && v > report.threshold ? '  <-- unstable on its own' : ''
      L.push(`         ${clip(name, 20).padEnd(22)} ${v === null ? '   ·' : v.toFixed(3)}${note}`)
    }
  }
  L.push('')

  if (m.worstQuestion) {
    const probe = report.probes[m.worstQuestion.index]
    L.push(`WORST    probe ${m.worstQuestion.index + 1}/${report.probes.length} · mean ${m.worstQuestion.meanDivergence.toFixed(3)} · max ${m.worstQuestion.maxDivergence.toFixed(3)}`)
    L.push(`         ${probe?.question ?? ''}`)
    for (const name of names) {
      const answer = m.answers[name]?.[m.worstQuestion.index]
      L.push(`           ${clip(name, 14).padEnd(16)} ${answer === null ? '(no answer)' : oneLine(answer)}`)
    }
    L.push('')
  }

  const traps = report.consensus.filter((c) => c.trapped)
  L.push('TRAPS    unanimity is also what a copied error looks like')
  if (traps.length === 0) {
    L.push('         (none — no probe drew three or more identical answers)')
  }
  for (const c of traps.slice(0, top + 2)) {
    const where = `probe ${c.index + 1}`
    if (c.level === 'unanimous') {
      L.push(`         ${where}: all ${c.size} agents identical — common cause, not confirmation`)
    } else {
      L.push(
        `         ${where}: ${c.size} agree exactly, dissenting: ${c.dissenters.join(', ')} ` +
          '— check the dissenter before assuming it is the wrong one'
      )
    }
  }
  L.push('')

  L.push(`FLEET    mean divergence across all pairs ${m.fleetMean === null ? '·' : m.fleetMean.toFixed(3)}`)
  L.push('         this is the number that hides the problem — it averages a contradicting')
  L.push('         pair against every pair that happened to agree. do not gate on it.')
  if (report.groundTruth) {
    const gt = Object.entries(report.groundTruth)
      .map(([n, v]) => `${clip(n, 14)} ${v === null ? '·' : v.toFixed(2)}`)
      .join('   ')
    L.push(`         vs the graph's own answer: ${gt}`)
  }
  L.push('')

  L.push(`VERDICT  [${report.verdict.level}] ${report.verdict.message}`)
  return L.join('\n')
}

/** Markdown for the `.argo/` artifact — the thing you paste into a review. */
export function renderMarkdown(report) {
  const L = []
  const m = report.matrix
  L.push('# Divergence report')
  L.push('')
  L.push(`Repo: \`${report.root}\``)
  L.push(
    `${report.agents.length} agents · ${report.probes.length} probes · ${report.repeats} repeat(s) · ` +
      `model \`${report.model}\` · gate \`${report.threshold}\``
  )
  if (report.mode === 'dry-run') {
    L.push('')
    L.push('> **Dry run.** Answers are synthetic. These numbers are illustrative, not measured.')
  }
  L.push('')

  L.push('## Pairwise divergence')
  L.push('')
  L.push('| pair | mean | max | scored probes | gate |')
  L.push('| --- | --- | --- | --- | --- |')
  for (const p of [...m.pairs].sort((a, b) => (b.meanDivergence ?? -1) - (a.meanDivergence ?? -1))) {
    const mean = p.meanDivergence === null ? '–' : p.meanDivergence.toFixed(3)
    const max = p.maxDivergence === null ? '–' : p.maxDivergence.toFixed(3)
    const gatedValue = report.gate === 'mean' ? p.meanDivergence : p.maxDivergence
    const gate = p.meanDivergence === null ? '–'
      : gatedValue > report.threshold ? '**BREACH**' : 'ok'
    L.push(`| \`${p.a}\` ↔ \`${p.b}\` | ${mean} | ${max} | ${p.scoredQuestions} | ${gate} |`)
  }
  L.push('')

  L.push('## Probes')
  L.push('')
  for (let i = 0; i < report.probes.length; i++) {
    const probe = report.probes[i]
    const perPair = m.pairs.map((p) => p.perQuestion[i]?.divergence).filter((v) => v !== null && v !== undefined)
    const worst = perPair.length > 0 ? Math.max(...perPair).toFixed(3) : '–'
    L.push(`### ${i + 1}. ${probe.question}`)
    L.push('')
    L.push(`Worst pair divergence on this probe: **${worst}**. Graph's own answer: \`${probe.graphAnswer || '–'}\`.`)
    L.push('')
    for (const name of m.agents) {
      const a = m.answers[name]?.[i]
      L.push(`- \`${name}\`: ${a === null ? '_(no answer)_' : oneLine(a)}`)
    }
    L.push('')
  }

  const traps = report.consensus.filter((c) => c.trapped)
  if (traps.length > 0) {
    L.push('## Consensus traps')
    L.push('')
    L.push('Unanimous agreement is not evidence of correctness — it is also what a copied error looks like.')
    L.push('')
    for (const c of traps) L.push(`- Probe ${c.index + 1} (${c.level}): ${c.note}`)
    L.push('')
  }

  L.push('## Verdict')
  L.push('')
  L.push(`**[${report.verdict.level}]** ${report.verdict.message}`)
  L.push('')
  L.push(
    `Fleet mean is ${m.fleetMean === null ? '–' : m.fleetMean.toFixed(3)}. ` +
      'It is reported for completeness only: averaging across pairs is exactly what conceals ' +
      'a single contradicting pair.'
  )
  return L.join('\n')
}

function findPair(pairs, a, b) {
  return pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a))
}

function clip(s, n = NAME_W) {
  const str = String(s)
  return str.length <= n ? str : `${str.slice(0, n - 1)}…`
}

function oneLine(s, n = 96) {
  const flat = String(s).replace(/\s+/g, ' ').trim()
  return flat.length <= n ? flat : `${flat.slice(0, n - 1)}…`
}
