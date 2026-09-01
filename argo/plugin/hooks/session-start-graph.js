// SessionStart hook: when a session opens in a repo that already carries graph
// artifacts, state them once, up front — a stale fan-out plan and a broken
// agent graph are both things the model would otherwise rediscover halfway
// through dispatching workers, which is after the damage.
//
// Conditional on purpose, like the UserPromptSubmit hook next to it. A
// session-start hook that prints on every session trains the reader to skip it,
// and a skipped hook is worth exactly as much as no hook. Nothing worth saying
// about this directory means no output and exit 0.

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** A plan older than this has usually been outgrown by the repo it describes. */
const STALE_DAYS = 7

/**
 * Decide what the session needs told, from facts already read off disk.
 *
 * Pure, so the decision is testable without a repo and without a clock: a
 * `null` field means that artifact is absent, and absent artifacts say nothing.
 *
 * `frozen: null` and `broken: true` both mean "the artifact is there and we
 * could not read it" — said out loud, never rounded down to a clean zero.
 *
 * @param {{
 *   fanout?: {ageDays: number, frozen: number|null} | null,
 *   topology?: {broken?: boolean, agents: number, edges: number, errors: number, warnings: number, linted: boolean} | null,
 *   selfreport?: {added: string[], removed: string[], storedAt: string} | null
 * }} facts
 * @returns {string[]} lines to emit; empty means stay silent
 */
export function sessionNotes(facts = {}) {
  const lines = []
  const { fanout, topology, selfreport } = facts

  if (fanout) {
    const age = Math.round(fanout.ageDays)
    // A count this hook could not take is not a count of zero. Zero frozen
    // files reads as "fan out freely", which is the wrong way to be wrong.
    const scope =
      fanout.frozen === null
        ? 'frozen list unreadable (not the format `argo graph --brief` writes, so open it before you trust it)'
        : `${fanout.frozen} frozen file(s)`
    lines.push(
      'GRAPH ENGINEERING — this repo already has a fan-out plan at .argo/fanout.md: ' +
        `${scope}, ${age} day(s) old. Frozen files are read-only for ` +
        'every worker; if the task needs one changed, you make that edit yourself in a ' +
        'serial pre-step before anyone fans out.'
    )
    if (fanout.ageDays > STALE_DAYS) {
      lines.push(
        `That plan is ${age} days old and a hub grows out of habit — re-run ` +
          '`argo graph .` before trusting its worker count or its frozen list.'
      )
    }
  }

  if (topology && topology.broken) {
    lines.push(
      '.argo/topology.json exists but does not parse, so the declared agent graph could ' +
        'not be checked at all — treat this fleet as undeclared and fix the file with ' +
        '`argo topology lint` before dispatching anything.'
    )
  } else if (topology) {
    lines.push(
      `Declared agent graph at .argo/topology.json: ${topology.agents} agent(s), ` +
        `${topology.edges} edge(s), ${describeLint(topology)}.`
    )
  }

  if (selfreport && (selfreport.added.length > 0 || selfreport.removed.length > 0)) {
    lines.push(
      `The delegation gates written in .argo/selfprobe.txt differ from the stored report of ` +
        `${selfreport.storedAt}: ${selfreport.added.length} added, ${selfreport.removed.length} removed. ` +
        'A gate that appeared is an edge someone else cut in your graph — run /argo:selfprobe ' +
        'to re-probe and `argo drift selfreport` to record it dated.'
    )
  }

  return lines
}

/** Lint state as one clause, with the consequence attached when there is one. */
function describeLint(t) {
  if (!t.linted) return 'not linted here (run `argo topology lint`)'
  if (t.errors > 0) {
    return `${t.errors} lint error(s) and ${t.warnings} warning(s) — the declared graph is ` +
      'broken, fix it with /argo:topology lint before dispatching anything'
  }
  if (t.warnings > 0) return `lints with ${t.warnings} warning(s)`
  return 'lints clean'
}

/** Frozen entries as written by `argo graph --brief`. */
function countFrozen(text) {
  return [...text.matchAll(/^- `([^`]+)` — (\d+) refs/gm)].length
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** Newest stored self-report record, or null. Filenames are timestamp-prefixed. */
function newestSelfReport(dir) {
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    return files.length > 0 ? readJson(join(dir, files[files.length - 1])) : null
  } catch {
    return null
  }
}

/**
 * Read the facts off disk. Every read is individually guarded: a session must
 * still start when an artifact is half-written, truncated or unreadable.
 *
 * @param {string} cwd
 * @returns {Promise<object>} facts for {@link sessionNotes}
 */
export async function gather(cwd) {
  const argo = join(cwd, '.argo')
  const facts = { fanout: null, topology: null, selfreport: null }

  const planPath = join(argo, 'fanout.md')
  if (existsSync(planPath)) {
    try {
      const text = readFileSync(planPath, 'utf8')
      facts.fanout = {
        frozen: /^# Fan-out plan/m.test(text) ? countFrozen(text) : null,
        ageDays: (Date.now() - statSync(planPath).mtimeMs) / 86_400_000,
      }
    } catch {
      // an unreadable plan is not worth failing a session over
    }
  }

  // ponytail: .json only. `argo topology` also accepts topology.yaml|yml, and a
  // hand-written YAML declaration goes unmentioned here — parse it too if that
  // form ever gets used in practice.
  const topoPath = join(argo, 'topology.json')
  const decl = existsSync(topoPath) ? readJson(topoPath) : null
  // Present but unparseable is the loudest of the three states, not the quietest.
  if (existsSync(topoPath) && (!decl || typeof decl !== 'object')) facts.topology = { broken: true }
  if (decl && typeof decl === 'object') {
    const t = {
      agents: Array.isArray(decl.agents) ? decl.agents.length : 0,
      edges: Array.isArray(decl.edges) ? decl.edges.length : 0,
      errors: 0,
      warnings: 0,
      linted: false,
    }
    // The linter lives in the toolkit, not in the plugin. Import it only if the
    // plugin is sitting next to a checkout; counts alone are still worth saying.
    try {
      const { lint } = await import(new URL('../../src/topology/lint.js', import.meta.url))
      const result = lint(decl)
      t.errors = result.errors
      t.warnings = result.warnings
      t.linted = true
    } catch {
      // no checkout reachable, or a declaration the linter refuses to parse
    }
    facts.topology = t
  }

  // The store is `.argo/drift/selfreports` — the same path `argo drift
  // selfreport` writes to. Read anywhere else and this block is silent forever,
  // which looks exactly like "no gate has changed".
  const probePath = join(argo, 'selfprobe.txt')
  const stored = newestSelfReport(join(argo, 'drift', 'selfreports'))
  if (existsSync(probePath) && stored) {
    try {
      // Classify the raw probe with the toolkit's own parser: the store keeps
      // only sentences that name AND restrict a mechanism, so comparing raw
      // `GATE:` lines against it reports a mention as a brand-new gate forever.
      const { parseSelfReport, diffSelfReports } = await import(
        new URL('../../src/drift/selfreport.js', import.meta.url)
      )
      const { added, removed } = diffSelfReports(stored, parseSelfReport(readFileSync(probePath, 'utf8')))
      facts.selfreport = {
        added,
        removed,
        storedAt: String(stored.capturedAt ?? 'unknown date').slice(0, 10),
      }
    } catch {
      // no checkout reachable, or an unreadable probe: say nothing rather than
      // diff two things that were never made comparable
    }
  }

  return facts
}

function emit(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: context,
      },
    }) + '\n'
  )
}

async function main() {
  let payload = {}
  try {
    payload = JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    payload = {} // malformed or absent stdin still leaves us a usable cwd
  }

  // Typed, not just truthy: a non-string cwd reached join() and crashed the
  // hook with a stack trace, which is a worse session start than no note.
  const cwd = typeof payload?.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd()
  const lines = sessionNotes(await gather(cwd))
  if (lines.length > 0) emit(lines.join('\n\n'))
}

// Importable for tests; only probes the filesystem when run as the hook.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
}
