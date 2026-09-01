#!/usr/bin/env node
/**
 * user-prompt-model-policy.js — decide, per session, how spawned agents pick a model.
 *
 * WHY A HOOK AND NOT A DOCUMENT
 * A routing rule written in a mandate is advisory: it is read and then not applied. This runs
 * every prompt, reads the model the session is ACTUALLY using, and states the rule that applies
 * to that model. The policy can therefore never be stale or generic.
 *
 * THE MECHANISM, VERIFIED RATHER THAN ASSUMED
 *   - Subagents INHERIT the parent's model by default. (Claude Code changelog records fixes for
 *     "subagents sometimes not inheriting the parent's model" and "team agents inherit the
 *     leader's model".) Omitting a model is therefore an active choice, not an oversight.
 *   - The Agent tool's model parameter takes COARSE ALIASES ONLY — sonnet | opus | haiku | fable.
 *     There is no way to name a specific version through it. So a session pinned to an older
 *     Opus CANNOT be matched by passing "opus": that alias may resolve to a different Opus
 *     entirely. Inheritance is the only mechanism that reproduces an exact version.
 *
 * That second fact is what makes the pin rule below correct rather than merely convenient.
 *
 * Reads the session model from the transcript the payload points at — the hook payload itself
 * carries session_id, transcript_path, cwd and hook_event_name, but not the model.
 *
 * Universal: no hardcoded path, no project assumption, node built-ins only. Exits 0 always and
 * says nothing when it cannot determine the model — a wrong routing instruction is worse than
 * none.
 */

const fs = require('node:fs')

/** Bounded tail read. A long session transcript can be tens of megabytes; the model is on the
 *  most recent assistant message, so only the end is ever needed. */
const TAIL_BYTES = 256 * 1024

function readPayload() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}')
  } catch {
    return {}
  }
}

/** The model id on the most recent assistant message, or null. */
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
  // Scan backwards: the last recorded model is the one in force.
  const lines = text.split(/\r?\n/).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    let j
    try { j = JSON.parse(lines[i]) } catch { continue }   // a truncated first line is expected
    const m = (j && j.message && j.message.model) || (j && j.model)
    if (typeof m === 'string' && m.length > 3) return m
  }
  return null
}

/**
 * Does this model support role-based routing, or must every agent inherit it?
 *
 * PINNED means: the user deliberately selected a specific version, and no alias can reproduce
 * it. Anything that is not a current-generation alias target falls here, which is the safe
 * default — an unrecognised model is one we cannot route for.
 */
function classify(model) {
  if (!model) return null
  const id = model.toLowerCase()
  // Current generation: what the coarse aliases resolve to, so an override is meaningful and
  // routing by task difficulty is safe. Anything else is a version the aliases CANNOT express,
  // so the only correct behaviour is inheritance -> pinned.
  const routable =
    /(^|[^0-9])claude-(opus-5|sonnet-5|fable-5|haiku-4-5)/.test(id) ||
    /^(opus|sonnet|fable|haiku)$/.test(id)
  return routable ? 'routable' : 'pinned'
}

function main() {
  const payload = readPayload()
  const model = currentModel(payload.transcript_path)
  const mode = classify(model)
  if (!mode) return // cannot tell — say nothing rather than guess

  const context = mode === 'pinned'
    ? `MODEL POLICY — this session runs \`${model}\`, which is a PINNED selection.\n`
      + 'EVERY spawned agent, subagent and workflow agent MUST run on this same model. Do NOT '
      + 'pass a `model` option to the Agent tool, to Workflow `agent()` calls, or in agent '
      + 'frontmatter. Subagents inherit the parent model by default, and inheritance is the ONLY '
      + 'mechanism that reproduces an exact version: the model parameter accepts coarse aliases '
      + 'only (sonnet/opus/haiku/fable), so passing one could silently resolve to a different '
      + 'version of the same family. Omitting the option is the instruction, not an oversight.'
    : `MODEL POLICY — this session runs \`${model}\`. Choose each spawned agent's model by TASK `
      + 'DIFFICULTY. Judge difficulty by the hardest decision the agent must make ON ITS OWN — '
      + 'never by how much text it reads.\n'
      + '  - TRIVIAL, no judgment at all: search, locate files, inventory, count, run a test '
      + 'command, apply a mechanical transform, summarise -> `haiku`. This tier fans out widest, '
      + 'so it is where the choice compounds.\n'
      + '  - SPECIFIED work, the thinking already done: implement a decided change, write tests '
      + 'to a stated spec, a bounded refactor -> `sonnet`. It executes a decision rather than '
      + 'making one.\n'
      + '  - VERIFICATION and REVIEW: is this correct, is this finding real, adversarial checking '
      + '-> `opus`. Name it explicitly. A gate that cannot out-reason what it reviews is '
      + 'decoration, and this work is high-reasoning but narrow — the context is handed to it.\n'
      + '  - GENUINELY HARD: open-ended design, unresolved ambiguity, deciding what "good" means, '
      + 'synthesising many conflicting results -> INHERIT (omit the option) so it runs on this '
      + 'session\'s model.\n'
      + 'Pair a `sonnet` coder with an `opus` reviewer: the gate is what makes the cheaper coder '
      + 'safe. If you cannot state what the agent must NOT have to decide, do not downgrade it. '
      + 'See the `model-routing` skill.'

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: context,
    },
  }))
}

try {
  main()
} catch {
  // A hook that throws is worse than one that does nothing.
}
process.exit(0)
