#!/usr/bin/env node
/**
 * pre-tool-model-route.js — set the model on every spawned agent AUTOMATICALLY.
 *
 * WHY THIS EXISTS RATHER THAN AN INSTRUCTION
 * A routing rule delivered as context still depends on the model reading it and choosing to
 * comply. This is a PreToolUse hook: it rewrites the Agent tool's input before the call runs,
 * so the policy is applied mechanically. Nothing has to remember it and nothing can skip it.
 * (Claude Code changelog: "PreToolUse hooks can now modify tool inputs", returned as
 * `hookSpecificOutput.updatedInput`.)
 *
 * TWO BEHAVIOURS
 *
 * 1. PINNED SESSION -> STRIP the model option entirely.
 *    When the session runs a version the coarse aliases cannot express (Opus 4.7, Sonnet 4.6,
 *    Opus 4.8 ...), inheritance is the ONLY mechanism that reproduces that exact version:
 *    passing `opus` from an Opus 4.7 session may resolve to a different Opus. Removing the
 *    option is therefore not a preference, it is the only correct action — and it is purely
 *    mechanical, so it is safe to automate completely.
 *
 * 2. CURRENT-GENERATION SESSION -> FILL IN a model only when the choice is unambiguous.
 *    An explicit choice already made by the caller is always respected. Otherwise the model is
 *    inferred from the agent type and the shape of the prompt, and ONLY when the signal is
 *    strong. When in doubt the option is left unset, which means inherit — the safe direction.
 *    A wrong downgrade costs quality silently, so this never guesses downward.
 *
 * Deliberately does NOT return a permissionDecision: the user's normal approval flow for
 * spawning agents is left exactly as it was. This hook adjusts an argument, it does not grant
 * permission.
 *
 * Universal: no hardcoded path, no project assumption, node built-ins only. Exits 0 always and
 * emits nothing when it has no change to make.
 */

const fs = require('node:fs')

const TAIL_BYTES = 256 * 1024

/** Tools that spawn an agent. Both names are handled — the tool has been called Task and Agent. */
const AGENT_TOOLS = /^(Agent|Task)$/i

function readPayload() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}')
  } catch {
    return {}
  }
}

/** Model id on the most recent assistant message, or null. */
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
    let j
    try { j = JSON.parse(lines[i]) } catch { continue }
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

/**
 * Infer a model from the dispatch, or null to leave it unset (inherit).
 *
 * Only high-confidence signals downgrade. Everything ambiguous inherits, because a wrong
 * downgrade produces confident, plausible, wrong output that nobody notices — the expensive
 * failure. An unnecessary inherit only costs money, which is the cheap failure.
 */
function inferModel(input) {
  const type = String(input.subagent_type || input.subagentType || '').toLowerCase()
  const text = `${input.description || ''}\n${input.prompt || ''}`.toLowerCase()

  // Agent TYPE is the strongest signal: it is chosen deliberately and names the job.
  if (/(^|[-:])explore$/.test(type) || type === 'explore') return 'haiku'
  if (/review|verif|audit|critic|security|adversar/.test(type)) return 'opus'

  // Verification language: never downgrade this work, and name opus so a weaker session model
  // does not become the quality gate.
  if (/\b(review|verify|verif\w+|audit|adversarial|is this (correct|real|right)|find (bugs|flaws)|critique|assess whether)\b/.test(text)) {
    return 'opus'
  }

  // Purely mechanical retrieval. Requires an explicit "no judgment" shape AND the absence of
  // any decision verb, so "find the best approach" is never mistaken for "find the file".
  const mechanical = /\b(list|locate|find (all|every|the file|files|occurrences)|grep|search for|count|inventory|enumerate|which files|where is)\b/.test(text)
  const judgment = /\b(decide|design|choose|recommend|architect|evaluate|trade-?off|should we|best (way|approach)|refactor|rewrite|fix|implement|why)\b/.test(text)
  if (mechanical && !judgment) return 'haiku'

  // Specified implementation: the decision is already in the prompt. Requires an explicit
  // marker that a spec exists, not merely the word "implement".
  if (/\b(implement|apply|write) (the|this) (change|fix|spec|specification|plan|patch)\b/.test(text)
      || /\baccording to the (spec|plan|design)\b/.test(text)) {
    return 'sonnet'
  }

  return null // unsure -> inherit
}

function main() {
  const payload = readPayload()
  const tool = String(payload.tool_name || payload.toolName || payload.tool || '')
  if (!AGENT_TOOLS.test(tool)) return

  const input = payload.tool_input || payload.toolInput || payload.input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return

  const mode = classify(currentModel(payload.transcript_path))
  if (!mode) return // model unknown: change nothing rather than guess

  let updated = null

  if (mode === 'pinned') {
    // The one fully mechanical case. Any override is wrong here, so remove it.
    if ('model' in input) {
      updated = { ...input }
      delete updated.model
    }
  } else if (!input.model) {
    // Respect an explicit choice; only fill in a blank.
    const inferred = inferModel(input)
    if (inferred) updated = { ...input, model: inferred }
  }

  if (!updated) return // nothing to change; stay silent

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      updatedInput: updated,
    },
  }))
}

try {
  main()
} catch {
  // A hook that throws is worse than one that does nothing.
}
process.exit(0)
