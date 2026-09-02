#!/usr/bin/env node
/**
 * pre-tool-model-route.js — assign the model for every spawned agent. AUTHORITATIVELY.
 *
 * This hook does not advise and it does not defer. It rewrites the Agent tool's input before
 * the call runs (`hookSpecificOutput.updatedInput`), so the caller cannot spawn an agent on a
 * model this file did not choose. A model passed by the caller is treated as a SUGGESTION and
 * is overridden — an instruction that can be ignored is not a rule.
 *
 * ── THE SAFETY INVARIANT ───────────────────────────────────────────────────────────────────
 *
 * A classifier over free text cannot be right every time, so it is built so its mistakes only
 * ever fall in one direction:
 *
 *   UNDER-assignment (too weak for the task) is a CORRECTNESS failure. The agent returns
 *   something plausible and wrong, and nobody notices without redoing the work. This must be
 *   impossible.
 *
 *   OVER-assignment (stronger than needed) is a COST failure. It is visible, bounded, and
 *   recoverable.
 *
 * So: a downgrade below the session model requires a POSITIVE high-confidence signal that the
 * task needs no judgment, AND the absence of any judgment signal. Ambiguity always resolves
 * upward. That is what makes "never too low" structural rather than aspirational.
 *
 * Over-assignment is minimised the only honest way — by widening the high-confidence downgrade
 * rules one measured case at a time, each pinned by a labelled corpus test. See
 * tools/test/model-corpus.test.mjs; the gate there is ZERO under-assignments, with
 * over-assignment reported as a number rather than assumed away.
 *
 * ── THE PINNED EXCEPTION ───────────────────────────────────────────────────────────────────
 *
 * When the session runs a version the coarse aliases cannot express (Opus 4.7, Sonnet 4.6,
 * Opus 4.8 ...), every agent inherits and the option is stripped. Inheritance is the ONLY
 * mechanism that reproduces an exact version: `opus` from an Opus 4.7 session may resolve to a
 * different Opus. That case is purely mechanical, so it is absolute.
 *
 * Universal: no hardcoded path, no project assumption, node built-ins only. Never returns a
 * permissionDecision — it sets an argument, it does not grant approval. Exits 0 always.
 */

const fs = require('node:fs')

const TAIL_BYTES = 256 * 1024
const AGENT_TOOLS = /^(Agent|Task)$/i

/** Sentinel: remove the model option entirely so the agent inherits the session model. */
const INHERIT = null

// ── Signals ─────────────────────────────────────────────────────────────────────────────────
// Each is deliberately narrow. A signal that fires broadly would either downgrade something it
// should not (unsafe) or upgrade everything (useless).

// The vocabulary lives as SERIALIZABLE SOURCE STRINGS, not RegExp objects, for one reason:
// workflow agents are dispatched by the Workflow runtime, never through the Agent tool, so
// this hook never fires for them. A sibling hook on the Workflow tool injects this same
// vocabulary into the script's `args`, and the script rebuilds the regexes itself (scripts
// have no filesystem access and cannot import anything). Hooks may not import each other
// either, so that sibling carries its own copy — and a test holds the two copies identical.
// Change a signal HERE, and the drift test names the other file.
const SIGNAL_SOURCES = {
  /** Work where being wrong is expensive and hard to detect. Vetoes every downgrade. */
  JUDGMENT: [
    // `design` and `architecture` as VERBS or bare nouns are judgment. As the first half of a
    // compound domain noun — "design direction", "design tokens", "architecture diagram" —
    // they name the artifact, not the task, and the task is whatever verb governs them.
    // Without the lookahead "review this design direction" inherited the session model
    // instead of routing to opus: safe, but pure over-assignment on the judge role.
    '\\b(design(?! (direction|directions|system|systems|token|tokens|language|brief|file|files|doc|docs))|architect|architecture(?! (diagram|diagrams|doc|docs|document|overview))|decide|decision|choose|recommend|evaluate|assess)\\b',
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
  // A mutating verb beside a mechanical one — "run the tests and fix any failures", "grep for
  // TODO and remove each one" — means the agent decides what to change. This vetoes only the
  // haiku downgrade; it routes nothing upward on its own.
  MUTATE: [
    '\\b(fix|fixes|fixing|repair|repairs|resolve|resolves|remove|delete|replace|rewrite|refactor|migrate|correct)\\b',
  ],
  /** Agent types whose job is fixed by their definition, regardless of prompt wording. */
  TYPE_VERIFY: 'review|verif|audit|critic|security|adversar|scan-verifier|patch-verifier',
  TYPE_SEARCH: '^(explore|.*:explore)$',
}

/** Build one case-insensitive RegExp from a source list (joined as alternation) or string. */
const rx = (src) => new RegExp(Array.isArray(src) ? src.join('|') : src, 'i')

const JUDGMENT = rx(SIGNAL_SOURCES.JUDGMENT)
const VERIFY = rx(SIGNAL_SOURCES.VERIFY)
const SPECIFIED = rx(SIGNAL_SOURCES.SPECIFIED)
const MECHANICAL = rx(SIGNAL_SOURCES.MECHANICAL)
const MUTATE = rx(SIGNAL_SOURCES.MUTATE)
const TYPE_VERIFY = rx(SIGNAL_SOURCES.TYPE_VERIFY)
const TYPE_SEARCH = rx(SIGNAL_SOURCES.TYPE_SEARCH)

/**
 * Decide the model for one dispatch.
 *
 * @returns {'haiku'|'sonnet'|'opus'|null} null means INHERIT (strip the option).
 */
function decide(input) {
  const type = String((input && (input.subagent_type || input.subagentType)) || '')
  const text = `${(input && input.description) || ''}\n${(input && input.prompt) || ''}`

  // 1. Agent TYPE is the strongest signal: it is chosen deliberately and names the job.
  //    A verifier type stays high even if its prompt reads mechanically.
  if (TYPE_VERIFY.test(type)) return 'opus'

  const judgment = JUDGMENT.test(text)

  // 2. A read-only search agent may still be handed a judgment question. The type only
  //    downgrades when nothing in the prompt asks it to decide something.
  if (TYPE_SEARCH.test(type) && !judgment) return 'haiku'

  // 3. Judgment vetoes EVERY downgrade. This is the invariant: anything that has to decide
  //    for itself runs on the session model, whatever else the text looks like.
  if (judgment) return INHERIT

  // 4. Verification: named explicitly so a weaker session model never becomes the gate.
  if (VERIFY.test(text)) return 'opus'

  // 5. Specified work — the thinking is already in the prompt.
  if (SPECIFIED.test(text)) return 'sonnet'

  // 6. Pure retrieval and mechanical transformation.
  if (MECHANICAL.test(text) && !MUTATE.test(text)) return 'haiku'

  // 7. Unrecognised. Inherit: the safe direction, by construction.
  return INHERIT
}

// ── Session model ───────────────────────────────────────────────────────────────────────────

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
  // Scan backwards: the most recent fact about the model wins. A `/model` command is recorded
  // as a user-side record before any assistant turn on the new model exists, so it must beat
  // the last assistant message or a switch to a PINNED model would route by difficulty for one
  // turn — the exact violation the pin rule forbids. Only the structured command form is
  // matched; the plain "Set model to" confirmation can be quoted inside tool output.
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
  if (!AGENT_TOOLS.test(tool)) return

  const input = payload.tool_input || payload.toolInput || payload.input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return

  const mode = classify(currentModel(payload.transcript_path))
  if (!mode) return // session model unknown: change nothing rather than guess

  // AUTHORITATIVE. Whatever the caller passed, the decision is recomputed here. On a pinned
  // session the answer is always INHERIT; otherwise it is whatever decide() returns.
  const chosen = mode === 'pinned' ? INHERIT : decide(input)

  const updated = { ...input }
  if (chosen === INHERIT) delete updated.model
  else updated.model = chosen

  // Only speak when something actually changes.
  const had = 'model' in input ? input.model : undefined
  const now = 'model' in updated ? updated.model : undefined
  if (had === now) return

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      updatedInput: updated,
    },
  }))
}

// Exported so a labelled corpus can exercise the classifier directly, without spawning a
// process per case. Running the file still behaves as a hook.
module.exports = { decide, classify, INHERIT, SIGNAL_SOURCES }

if (require.main === module) {
  try {
    main()
  } catch {
    // A hook that throws is worse than one that does nothing.
  }
  process.exit(0)
}
