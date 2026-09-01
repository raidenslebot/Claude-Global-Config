#!/usr/bin/env node
/**
 * pre-tool-workflow-policy.js — carry model routing into workflow fan-outs.
 *
 * THE GAP THIS CLOSES
 * pre-tool-model-route.js assigns every spawned agent a model by task difficulty. It fires on
 * the Agent tool. Workflow agents are dispatched by the Workflow RUNTIME, never through the
 * Agent tool, so it never fires for them — and a six-worker fan-out ran every worker on the
 * session model, including one that edited a single YAML file. On a pinned session that is
 * still correct (they inherit); on a routable one it is pure over-assignment.
 *
 * The Workflow tool itself IS a tool call. So this fires on it, reads the session model, and
 * injects the policy into the script's `args` before the script runs:
 *
 *   args.__modelPolicy = { sessionModel, pinned, signals }
 *
 * The script then applies the same classifier to each agent's prompt. Two constraints decide
 * the shape: scripts have no filesystem access and cannot import, so the vocabulary travels
 * in `args`; and hooks may not import each other, so this file carries its OWN copy of the
 * signal sources. A test asserts the copy is byte-identical to the one in
 * pre-tool-model-route.js — change a signal there and the test names this file.
 *
 * Only a plain-object (or absent) `args` can carry the policy. A primitive `args` — a bare
 * string brief — is left untouched, and that workflow inherits. Rewriting a user's string
 * into an object would change what the script sees and break it.
 *
 * Never returns a permissionDecision: it adjusts an argument, it does not grant approval.
 * Exits 0 always; silent when it has nothing to change.
 */

const fs = require('node:fs')

const TAIL_BYTES = 256 * 1024

// ── Identical to pre-tool-model-route.js SIGNAL_SOURCES. Kept in sync by test, not by hand. ──
const SIGNAL_SOURCES = {
  /** Work where being wrong is expensive and hard to detect. Vetoes every downgrade. */
  JUDGMENT: [
    '\\b(design|architect|architecture|decide|decision|choose|recommend|evaluate|assess)\\b',
    '\\b(trade-?offs?|approach|strategy|should we|best way|best approach|which is better)\\b',
    '\\b(ambigu\\w+|unclear|figure out|work out|reason about|think through)\\b',
    '\\b(refactor|redesign|rewrite|restructure|migrate)\\b',
    '\\b(root cause|diagnose|debug|investigate)\\b',
    '\\b(synthesi[sz]e|reconcile|resolve the|weigh|prioriti[sz]e)\\b',
    // BARE `why`. The narrow form `why (is|does|did|are)` missed "and why each one fails" and
    // "why the doctor command takes 8 seconds", both of which are diagnosis. Asking why is
    // always reasoning, whatever verb follows.
    '\\bwhy\\b',
    // Asking what something MEANS is interpretation, not retrieval.
    '\\b(explain|interpret|implication|what (does|do) (this|that|these|it) mean|means? for)\\b',
    // A trailing "and pick/choose one" turns an enumeration into a decision. The veto scans the
    // whole text, so naming these verbs is enough — no clause splitting required.
    '\\b(pick|select) (one|the|which)\\b',
    // "which X should ..." is a decision even when a verification NOUN sits in the subject:
    // "which model should a scan-verifier agent run on" is choosing, not verifying. Without
    // this, VERIFY matched the topic word and answered one tier below the session model.
    '\\b(which|what)\\b[^.?!]{0,24}\\bshould\\b',
    // Defect and quality nouns. "Where is the bug" reads like a lookup and is a hunt; the noun,
    // not the question frame, carries the difficulty.
    '\\b(bug|bugs|defect|defects|flaw|flaws|broken|failing|regression)\\b',
    '\\b(unsafe|unsafely|insecure|vulnerab\\w+|injection|exploit|security hole)\\b',
    // Performance work is diagnosis even when phrased as a search.
    '\\b(slow|slowness|bottleneck|takes \\d+ ?(s|ms|sec|second|minute))\\b',
    // "actually safe / actually correct" is a claim under test, never a count.
    '\\bactually (safe|correct|right|fixed|works?|working)\\b',
  ],
  /** Checking someone else's work. High reasoning, but the context is handed to it. */
  VERIFY: [
    '\\b(review|reviewing|verify|verif\\w+|validate|audit|auditing)\\b',
    '\\b(adversarial|critique|scrutin\\w+|double-?check|sanity-?check)\\b',
    // A noun may sit between the subject and the adjective: "is this FINDING real",
    // "is the fix correct". The tight form missed every one of those.
    '\\bis\\b[^.?!]{0,30}\\b(correct|right|real|valid|sound|accurate|true)\\b',
    '\\bdoes\\b[^.?!]{0,30}\\b(actually|really|correctly)\\b',
    '\\b(find|check for|look for)\\b[^.?!]{0,30}\\b(bugs|flaws|defects|vulnerabilit\\w+|problems|issues|holes)\\b',
    '\\b(security (review|audit)|threat model|check whether|confirm whether)\\b',
    '\\b(prove|disprove|refute|corroborate)\\b',
  ],
  /** Carrying out a decision that is already stated. */
  SPECIFIED: [
    '\\b(implement|apply|write|add|create) (the|this|these) (change|changes|fix|patch|spec|specification|plan|design|function|method|test|tests)\\b',
    '\\baccording to the (spec|specification|plan|design|description)\\b',
    '\\bas (described|specified|outlined|detailed) (above|below|in)\\b',
    '\\b(port|translate|convert) (this|the) \\w+ (to|into)\\b',
    '\\bwrite tests? (for|that cover) the\\b',
  ],
  /** Retrieval and mechanical transformation. No decision is required to do it correctly. */
  MECHANICAL: [
    '\\b(list|enumerate|inventory|catalogue|catalog|tally|count) (all|every|each|the)\\b',
    '\\b(find|locate) (all|every|each|the) (file|files|occurrence|occurrences|instance|instances|usage|usages|reference|references|line|lines|definition)\\b',
    '\\b(grep|search) (for|the (codebase|repo|tree|files))\\b',
    '\\b(which|what) files\\b',
    '\\bwhere (is|are) (the|it|this)\\b',
    '\\b(read|extract|collect|gather|report) (the|all|every)[^.]{0,40}\\b(and (list|report|return|output))\\b',
    '\\brun (the )?(tests?|test suite|lint|linter|build|command)\\b',
    '\\b(rename|reformat|reindent|sort|deduplicate) (all|every|the)\\b',
  ],
  /** Agent types whose job is fixed by their definition, regardless of prompt wording. */
  TYPE_VERIFY: 'review|verif|audit|critic|security|adversar|scan-verifier|patch-verifier',
  TYPE_SEARCH: '^(explore|.*:explore)$',
}

/** Model id on the most recent fact in the transcript, or null. Same logic as the sibling
 *  hooks: a `/model` command record beats an older assistant message, so a switch is seen on
 *  the very next prompt rather than one turn late. */
function currentModel(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== 'string') return null
  let text
  try {
    const size = fs.statSync(transcriptPath).size
    const start = Math.max(0, size - TAIL_BYTES)
    const fd = fs.openSync(transcriptPath, 'r')
    try {
      const buf = Buffer.alloc(Math.min(size, TAIL_BYTES))
      fs.readSync(fd, buf, 0, buf.length, start)
      text = buf.toString('utf8')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
  const lines = text.split(/\r?\n/).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    const sw = line.match(/<command-name>\/model<\/command-name>[\s\S]{0,300}?<command-args>([A-Za-z0-9._\[\]-]{4,60})<\/command-args>/)
    if (sw) return sw[1]
    let j
    try { j = JSON.parse(line) } catch { continue }
    const m = (j && j.message && j.message.model) || (j && j.model)
    if (typeof m === 'string' && m.length > 3) return m
  }
  return null
}

/** 'pinned' when no coarse alias can express this model; otherwise 'routable'. */
function classify(model) {
  if (!model) return null
  const id = String(model).toLowerCase()
  const routable =
    /(^|[^0-9])claude-(opus-5|sonnet-5|fable-5|haiku-4-5)/.test(id) ||
    /^(opus|sonnet|fable|haiku)$/.test(id)
  return routable ? 'routable' : 'pinned'
}

function readPayload() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}')
  } catch {
    return {}
  }
}

function main() {
  const payload = readPayload()
  const tool = String(payload.tool_name || payload.toolName || payload.tool || '')
  if (tool !== 'Workflow') return

  const input = payload.tool_input || payload.toolInput || payload.input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return

  const model = currentModel(payload.transcript_path)
  const mode = classify(model)
  if (!mode) return // session model unknown: inject nothing rather than a guess

  const args = input.args
  // Only an object can carry the policy. A string brief stays a string; that workflow inherits.
  if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) return
  if (args && args.__modelPolicy) return // already carried (a resume, or a nested workflow)

  const updated = {
    ...input,
    args: {
      ...(args || {}),
      __modelPolicy: { sessionModel: model, pinned: mode === 'pinned', signals: SIGNAL_SOURCES },
    },
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      updatedInput: updated,
    },
  }))
}

// Exported so the drift test can compare SIGNAL_SOURCES against the routing hook's copy.
module.exports = { SIGNAL_SOURCES, classify }

if (require.main === module) {
  try {
    main()
  } catch {
    // A hook that throws is worse than one that does nothing.
  }
  process.exit(0)
}
