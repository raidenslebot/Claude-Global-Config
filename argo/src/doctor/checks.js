/**
 * checks.js — turn five separate measurements into one prioritised verdict.
 *
 * the six tools in this repo each answer one question well, and none of them
 * answers "is this fleet safe to run today". that answer is a join across all
 * of them, and the join has one rule that matters more than the rest:
 *
 *   a check that was never run is not a check that passed.
 *
 * so every check here reports in one of exactly two states — measured, with the
 * timestamp of the measurement, or never measured — and never-measured is an
 * error rather than silence. a doctor that prints "no problems" over an empty
 * .argo directory is the false-green failure this project exists to delete, and
 * it is worse than no doctor at all because it is signed.
 *
 * pure on purpose: no filesystem, no clock, no model. cmd.js gathers the facts,
 * this file decides what they mean, and the same facts give the same verdict on
 * every machine — which is the only way a verdict is worth failing CI over.
 */

/** Severities, worst first. Also the sort order of the report. */
export const SEVERITY_ORDER = ['error', 'warn', 'info', 'ok']

const RANK = new Map(SEVERITY_ORDER.map((s, i) => [s, i]))

/** Checks in the order they run, which is also the tie-break inside a severity. */
export const CHECK_ORDER = ['graph', 'topology', 'drift', 'baseline', 'diverge']

/**
 * Findings that mean "nobody ever measured this", as opposed to "we measured
 * and it is bad". The verdict line counts these separately, because they are
 * the ones a passing exit code would otherwise launder into confidence.
 */
export const NEVER_MEASURED = new Set([
  'graph.unavailable',
  'topology.missing',
  'drift.no-snapshots',
  'drift.no-selfreport',
  'baseline.missing',
  'baseline.dry-run-only',
  'baseline.unreadable',
  'diverge.missing',
  'diverge.dry-run-only',
  'diverge.no-data',
])

/** The only verdicts `argo baseline` writes. Anything else is not a result. */
const BASELINE_LEVELS = new Set(['crew-pays', 'crew-neutral', 'crew-subtracts'])

function finding(id, severity, title, detail, fix = null) {
  return { id, severity, title, detail, fix }
}

/** Emit `ok` only when a check actually produced nothing worse. */
function orOk(list, id, title, detail) {
  return list.length > 0 ? list : [finding(id, 'ok', title, detail)]
}

const pct = (n) => `${(n * 100).toFixed(1)}%`

/** A timestamp, or the loudest available admission that there is not one. */
function when(at) {
  return at ? at : 'never'
}

/* ------------------------------------------------------------------ *
 * 1. GRAPH — is the plan built on a graph we actually resolved
 * ------------------------------------------------------------------ */

/**
 * @param {object|null} graph  { files, coverage, missedRefs, sharedFiles,
 *   sharedFraction, recommendedWorkers, verdict: { level, message } }
 * @returns {object[]} findings
 */
export function checkGraph(graph) {
  if (!graph) {
    return [finding('graph.unavailable', 'error',
      'the repo graph could not be built',
      'without a reference graph there is no shared surface, so every worker count is a guess.',
      'argo graph .')]
  }

  const out = []
  const head =
    `${graph.files} files · ${graph.sharedFiles} shared (${pct(graph.sharedFraction)}) · ` +
    `${graph.recommendedWorkers} workers recommended · coverage ${pct(graph.coverage)}`

  // Coverage is the honesty check on every other number in the plan. A reference
  // that claims to point inside the tree and resolves to nothing is a missing
  // edge, and missing edges only ever make a fan-out look SAFER than it is.
  if (graph.coverage < 0.9) {
    out.push(finding('graph.coverage', 'warn',
      `graph coverage is ${pct(graph.coverage)} — the plan is built on a partial graph`,
      `${graph.missedRefs} intra-repo reference(s) did not resolve to a file. Every unresolved ` +
      'edge is coupling the partitioner could not see, so the shared surface is a lower bound ' +
      'and the recommended worker count is optimistic.',
      'argo graph . --json --out .argo/graph.json'))
  }

  if (graph.verdict?.level === 'empty') {
    out.push(finding('graph.empty', 'error',
      'no source files found under this path',
      graph.verdict.message ?? 'nothing to partition.',
      'argo doctor <path-to-your-repo>'))
  } else if (graph.verdict?.level === 'serialise') {
    out.push(finding('graph.serialise', 'error',
      'a dependency cycle crosses a partition boundary',
      `${graph.verdict.message} No ordering of the workers makes that safe — this tree cannot ` +
      'be fanned out as it stands.',
      'argo graph . --brief --out .argo/fanout.md'))
  } else if (graph.verdict?.level === 'hub-bound') {
    out.push(finding('graph.hub-bound', 'warn',
      'this tree is hub-bound: adding workers will not buy parallelism',
      graph.verdict.message,
      'argo graph . --brief --out .argo/fanout.md'))
  }

  return orOk(out, 'graph.ok', 'graph measured and fans out cleanly', head)
}

/* ------------------------------------------------------------------ *
 * 2. TOPOLOGY — is the agent graph declared at all
 * ------------------------------------------------------------------ */

/**
 * @param {object|null} topology  null when no declaration exists, else
 *   { path, rulesRan, errors, warnings, agents, edges }
 * @returns {object[]} findings
 */
export function checkTopology(topology) {
  if (!topology) {
    return [finding('topology.missing', 'error',
      'no declared graph',
      'nothing in this repo says which agents exist or which may talk to which. An edge that ' +
      'is not written down cannot be linted, and the edges that do the damage — a worker ' +
      'reading another worker, a second supervisor nobody meant to create — are exactly the ' +
      'ones nobody declared.',
      'argo topology init .')]
  }

  const head = `${topology.agents} agents · ${topology.edges} edges · ${topology.path}`

  if (!topology.rulesRan) {
    return [finding('topology.malformed', 'error',
      'the declaration does not parse into a graph',
      `${topology.path} failed its schema checks, so rules R1-R8 never ran. You have a file, ` +
      'not a declaration.',
      'argo topology lint --json')]
  }

  const out = []
  if (topology.errors > 0) {
    out.push(finding('topology.errors', 'error',
      `${topology.errors} error-severity lint finding(s) in the declared graph`,
      `each one is a channel that will carry a mistake further than you meant it to go. ${head}`,
      'argo topology lint'))
  }
  if (topology.warnings > 0) {
    out.push(finding('topology.warnings', 'warn',
      `${topology.warnings} warning(s) in the declared graph`,
      'allowlisted peer edges and soft limits — the edges worth re-reading at the next review.',
      'argo topology lint'))
  }

  return orOk(out, 'topology.ok', 'agent graph declared and clean', head)
}

/* ------------------------------------------------------------------ *
 * 3. DRIFT — did the build under you change, and is a gate recorded
 * ------------------------------------------------------------------ */

/**
 * @param {object} drift  { snapshots, selfreports } — both newest-first
 * @returns {object[]} findings
 */
export function checkDrift(drift) {
  const snaps = drift?.snapshots ?? []
  const reports = drift?.selfreports ?? []
  const out = []

  if (snaps.length === 0) {
    out.push(finding('drift.no-snapshots', 'error',
      'no drift snapshot has ever been taken — you have no before',
      'the agent build you depend on can change without a release note. With zero snapshots ' +
      'there is nothing to diff against, so "nothing changed" is not something this repo can ' +
      'say — only something it cannot contradict.',
      'argo drift snapshot --label "first"'))
  } else if (snaps.length === 1) {
    const s = snaps[0]
    out.push(finding('drift.one-snapshot', 'warn',
      `one snapshot stored (${s.packageVersion ?? 'unknown version'}, ${when(s.capturedAt)}) — a before with no after`,
      'a single snapshot records the build as it was that day. It becomes a measurement of ' +
      'drift only once a second one exists to diff it against.',
      'argo drift snapshot'))
  } else {
    const [latest, prev] = snaps
    const versions = latest.packageVersion === prev.packageVersion
      ? `both ${latest.packageVersion ?? 'unknown'}`
      : `${prev.packageVersion ?? 'unknown'} -> ${latest.packageVersion ?? 'unknown'}`
    if (latest.fingerprint !== prev.fingerprint) {
      out.push(finding('drift.build-changed', 'warn',
        `the agent build changed between the last two snapshots (${versions})`,
        `fingerprints differ: ${prev.id} (${when(prev.capturedAt)}) vs ${latest.id} ` +
        `(${when(latest.capturedAt)}). Every number measured before that change was measured ` +
        'against a different agent.',
        'argo drift diff'))
    } else {
      out.push(finding('drift.stable', 'info',
        `no build change between the last two snapshots (${versions})`,
        `same fingerprint at ${when(prev.capturedAt)} and ${when(latest.capturedAt)}. That is a ` +
        'statement about the build as of the newer one, not about the build right now.',
        'argo drift snapshot'))
    }
  }

  if (reports.length === 0) {
    out.push(finding('drift.no-selfreport', 'error',
      'no delegation gate has ever been recorded',
      'the instruction deciding whether your agent will delegate at all lives in a prompt you ' +
      'do not control. With no stored self-report there is no record of what it said today, so ' +
      'the next model upgrade has nothing to be diffed against.',
      'argo drift selfreport --file report.txt'))
  } else {
    const r = reports[0]
    if (r.gateCount === 0 && r.declaredNone) {
      out.push(finding('drift.no-gate', 'info',
        `no delegation gate recorded as of ${when(r.capturedAt)}`,
        `${r.model ?? 'unreported model'} reported no instruction gating its own delegation. ` +
        'Reported by the agent from its own context, not captured off the wire.',
        null))
    } else if (r.gateCount === 0) {
      // A report that parsed no gate and did not say "there are none" is not a
      // measurement of absence. Reading it as one is the exact false-green this
      // command exists to refuse.
      out.push(finding('drift.selfreport-inconclusive', 'warn',
        `the stored self-report (${when(r.capturedAt)}) named no gate and declared none either`,
        `${r.model ?? 'unreported model'}, confidence ${r.confidence ?? 'unknown'}. Zero gates ` +
        'parsed out of a report that never said there were zero is an unreadable answer, not a ' +
        'clean one. Re-record it and have the agent state plainly whether anything gates it.',
        'argo drift selfreport --file report.txt'))
    } else {
      out.push(finding('drift.gate-recorded', 'warn',
        `${r.gateCount} delegation gate(s) recorded as of ${when(r.capturedAt)}`,
        `${r.model ?? 'unreported model'}, confidence ${r.confidence ?? 'unknown'}. Your fleet ` +
        'is being told when it may delegate, which is a topology decision taken outside your ' +
        'repo. Re-record it after every upgrade and diff the two.',
        'argo drift selfreport --diff'))
    }
  }

  return out
}

/* ------------------------------------------------------------------ *
 * 4. BASELINE — is the crew still earning its calls, on today's build
 * ------------------------------------------------------------------ */

/**
 * The build we believe is installed, and when it was first seen here. Both come
 * from the snapshot store, because that is the only thing in this repo that
 * records a version at all — which is also why zero snapshots makes staleness
 * unanswerable rather than false.
 *
 * @param {object[]} snapshots newest-first
 * @returns {{version: string|null, firstSeen: string|null}}
 */
export function installedVersion(snapshots = []) {
  if (snapshots.length === 0) return { version: null, firstSeen: null }
  const version = snapshots[0].packageVersion ?? null
  let firstSeen = snapshots[0].capturedAt ?? null
  for (const s of snapshots) {
    if ((s.packageVersion ?? null) !== version) continue
    if (s.capturedAt && (!firstSeen || s.capturedAt < firstSeen)) firstSeen = s.capturedAt
  }
  return { version, firstSeen }
}

/**
 * @param {object|null} baseline  { path, at, label, dryRun, verdict }
 * @param {object[]} snapshots    newest-first, for the staleness comparison
 * @returns {object[]} findings
 */
export function checkBaseline(baseline, snapshots = []) {
  if (!baseline) {
    return [finding('baseline.missing', 'error',
      'no baseline has ever been run — solo vs crew is unmeasured',
      'without a solo arm there is no evidence the fan-out beats one agent on your task list, ' +
      'and a crew that adds nothing still bills for every worker.',
      'argo baseline --tasks examples/tasks.json')]
  }

  const head = `${baseline.label ? `run ${baseline.label} · ` : ''}${when(baseline.at)} · ${baseline.path}`

  if (baseline.dryRun) {
    return [finding('baseline.dry-run-only', 'error',
      `the most recent baseline (${when(baseline.at)}) was a --dry-run`,
      'synthetic answers, no model was asked anything. Its verdict is a test of the harness, ' +
      'not a measurement of your fleet, and it must not be read as one.',
      'argo baseline --tasks examples/tasks.json')]
  }

  // An artifact with no verdict this file recognises is a file, not a result.
  // Falling through to `baseline.ok` would print "the crew earns its calls" out
  // of something nobody measured.
  if (!BASELINE_LEVELS.has(baseline.verdict?.level)) {
    return [finding('baseline.unreadable', 'error',
      'the newest baseline artifact carries no verdict this tool can read',
      `${baseline.path} (${when(baseline.at)}) records no solo-vs-crew verdict, so nothing in it ` +
      'says whether the crew earned its calls. Half-written, hand-edited or from another tool — ' +
      'either way it is not a measurement.',
      'argo baseline --tasks examples/tasks.json')]
  }

  const out = []
  if (baseline.verdict?.level === 'crew-subtracts') {
    out.push(finding('baseline.crew-subtracts', 'error',
      'the crew is not earning its calls',
      `${baseline.verdict.message} (${head})`,
      'argo baseline --tasks examples/tasks.json'))
  } else if (baseline.verdict?.level === 'crew-neutral') {
    out.push(finding('baseline.crew-neutral', 'warn',
      'the crew is not clearly beating solo',
      `${baseline.verdict.message} (${head})`,
      'argo baseline --tasks examples/tasks.json --repeats 3'))
  }

  const { version, firstSeen } = installedVersion(snapshots)
  if (!version) {
    out.push(finding('baseline.age-unknown', 'warn',
      'cannot tell whether this baseline predates the installed build',
      `the baseline is dated ${when(baseline.at)}, and no snapshot exists to say which build is ` +
      'installed or since when. Staleness here is unanswerable, not absent.',
      'argo drift snapshot'))
  } else if (baseline.at && firstSeen && baseline.at < firstSeen) {
    out.push(finding('baseline.stale', 'warn',
      `the baseline predates the installed build (${version}, first seen ${firstSeen})`,
      `measured ${when(baseline.at)}, before this build was ever seen here. A better model raises ` +
      'the solo score, and the solo score is exactly what makes a crew stop paying — so a ' +
      'baseline taken on the older model reads as a crew win it may no longer be.',
      'argo baseline --tasks examples/tasks.json'))
  }

  return orOk(out, 'baseline.ok', 'the crew earns its calls on the measured list',
    `${baseline.verdict?.message ?? 'no verdict recorded'} (${head})`)
}

/* ------------------------------------------------------------------ *
 * 5. DIVERGE — do two of your own agents contradict each other
 * ------------------------------------------------------------------ */

/**
 * @param {object|null} divergence  { path, at, mode, gate, threshold, breaches, worstPair }
 * @param {boolean} dryRunPresent   a .dry-run artifact exists but no measured one
 * @returns {object[]} findings
 */
export function checkDiverge(divergence, dryRunPresent = false) {
  if (!divergence) {
    return dryRunPresent
      ? [finding('diverge.dry-run-only', 'error',
        'the only divergence artifact is a --dry-run',
        'synthetic answers, no agent was asked anything. Nothing is known about whether two of ' +
        'your agents agree.',
        'argo diverge .')]
      : [finding('diverge.missing', 'error',
        'divergence has never been measured',
        'two agents that each sound plausible and contradict each other is a failure only a ' +
        'pairwise comparison finds. Unmeasured, it reads exactly like agreement.',
        'argo diverge .')]
  }

  if (divergence.mode && divergence.mode !== 'live') {
    return [finding('diverge.dry-run-only', 'error',
      `the stored divergence report is mode "${divergence.mode}", not a measured run`,
      `${divergence.path} holds synthetic numbers. They are not evidence about your agents.`,
      'argo diverge .')]
  }

  // No worst pair means no pair scored a single probe — every call failed, or
  // fewer than two agents answered. `argo diverge` itself exits 2 on this, and
  // reading it here as "0 breaches" is the same outage-laundered-into-a-pass
  // this command exists to refuse.
  const w = divergence.worstPair
  if (!w) {
    return [finding('diverge.no-data', 'error',
      'the stored divergence run scored no pair on any probe',
      `${divergence.path} has a gate and a timestamp but not one comparison in it (${when(divergence.at)}). ` +
      'Zero breaches out of zero measurements is not agreement.',
      'argo diverge .')]
  }

  const head =
    `worst pair ${w.a} <-> ${w.b} at ${w.maxDivergence} max / ${w.meanDivergence} mean · ` +
    `gate ${divergence.gate} @ ${divergence.threshold} · ${when(divergence.at)}`

  if (divergence.breaches > 0) {
    return [finding('diverge.breach', 'error',
      `${divergence.breaches} agent pair(s) breach the divergence gate`,
      `${head}. Two of your own agents answered the same question differently — the fleet mean ` +
      'is what would hide that, so do not read it.',
      'argo diverge . --md --out .argo/divergence.md')]
  }

  return orOk([], 'diverge.ok', 'no agent pair breaches the divergence gate', head)
}

/* ------------------------------------------------------------------ *
 * Join
 * ------------------------------------------------------------------ */

/**
 * Run every check over one gathered observation, sorted worst first.
 *
 * @param {object} obs { graph, topology, drift, baseline, divergence, dryRunDivergence }
 * @returns {{findings: object[], counts: object, verdict: {level: string, message: string}}}
 */
export function diagnose(obs = {}) {
  const groups = [
    checkGraph(obs.graph ?? null),
    checkTopology(obs.topology ?? null),
    checkDrift(obs.drift ?? {}),
    checkBaseline(obs.baseline ?? null, obs.drift?.snapshots ?? []),
    checkDiverge(obs.divergence ?? null, obs.dryRunDivergence === true),
  ]

  // Severity first, then the order the checks ran. Sorting by check second keeps
  // the report readable as a pipeline: the graph problem that caused the
  // topology problem still prints above it.
  const findings = groups
    .flatMap((list, check) => list.map((f) => ({ f, check })))
    .sort((x, y) => (RANK.get(x.f.severity) - RANK.get(y.f.severity)) || (x.check - y.check))
    .map((x) => x.f)

  const counts = {
    error: findings.filter((f) => f.severity === 'error').length,
    warn: findings.filter((f) => f.severity === 'warn').length,
    info: findings.filter((f) => f.severity === 'info').length,
    ok: findings.filter((f) => f.severity === 'ok').length,
    neverMeasured: findings.filter((f) => NEVER_MEASURED.has(f.id)).length,
    checks: CHECK_ORDER.length,
  }

  return { findings, counts, verdict: verdict(counts) }
}

/**
 * One line. It must never let "we found nothing" and "we looked at nothing"
 * print the same sentence.
 *
 * @param {object} counts from diagnose()
 * @returns {{level: 'blocked'|'watch'|'clean', message: string}}
 */
export function verdict(counts) {
  const unmeasured = counts.neverMeasured > 0
    ? ` ${counts.neverMeasured} of them are things nobody has ever measured — an unmeasured ` +
      'check is not a passing one.'
    : ''

  if (counts.error > 0) {
    return {
      level: 'blocked',
      message:
        `${counts.error} error(s) and ${counts.warn} warning(s) across ${counts.checks} checks.` +
        `${unmeasured} Run \`argo doctor --fix\` for the ordered command list.`,
    }
  }
  if (counts.warn > 0) {
    return {
      level: 'watch',
      message:
        `0 errors, ${counts.warn} warning(s) across ${counts.checks} checks. Everything here was ` +
        'measured; these are the readings worth re-taking before the next fan-out.',
    }
  }
  return {
    level: 'clean',
    message:
      `all ${counts.checks} checks measured and clean. That is a statement about the artifacts ` +
      'on disk, which are only ever as current as the day each was taken.',
  }
}

/**
 * The ordered command sequence that closes every open finding. Printed, never
 * executed — a doctor that runs commands to make its own report green is a
 * doctor you cannot trust.
 *
 * @param {object[]} findings from diagnose()
 * @returns {{id: string, severity: string, command: string}[]}
 */
export function fixPlan(findings = []) {
  const seen = new Set()
  const out = []
  for (const f of findings) {
    if (f.severity !== 'error' && f.severity !== 'warn') continue
    if (!f.fix || seen.has(f.fix)) continue
    seen.add(f.fix)
    out.push({ id: f.id, severity: f.severity, command: f.fix })
  }
  return out
}
