/**
 * selfreport.js — capture a runtime-delivered system prompt without a proxy.
 *
 * Two doors were tried and closed first, and both are worth recording so nobody
 * reopens them expecting a different result:
 *
 *   1. Scanning the shipped bundle. `argo drift snapshot` read 241 MB and
 *      harvested 10,299 prose strings on this machine; the delegation gate was
 *      in none of them, because the service attaches it at request time.
 *   2. Proxying the request. Pointing the client at a loopback proxy via
 *      ANTHROPIC_BASE_URL works mechanically — the proxy receives the client's
 *      reachability check — but subscription auth refuses a custom base URL and
 *      the CLI drops to "Not logged in". Wire capture is closed for OAuth
 *      subscriptions specifically.
 *
 * The third door is open and needs neither. The system prompt is IN CONTEXT for
 * any running agent. So the agent is the instrument: ask it to write down the
 * instructions governing its own delegation, and store that the same way a
 * bundle snapshot is stored. It is a first-person report rather than a byte
 * capture, so it is treated as evidence with a source, not as ground truth —
 * see `confidence` below.
 *
 * The `/argo:selfprobe` slash command drives this from inside a live session.
 */

import { createHash } from 'node:crypto'

/** Instruction shapes that gate delegation. */
const GATE_PATTERNS = [
  { id: 'agent-tool', re: /\bagent\s?tool\b|\bAgentTool\b/i, weight: 3 },
  { id: 'task-tool', re: /\bTask tool\b/i, weight: 2 },
  { id: 'subagent', re: /\bsub-?agents?\b/i, weight: 2 },
  { id: 'workflow', re: /\bworkflows?\b/i, weight: 2 },
  { id: 'deep-research', re: /\bdeep[- ]research\b/i, weight: 2 },
  { id: 'parallel', re: /\bin parallel\b|\bfan[- ]?out\b/i, weight: 1 },
]

/** Restriction shapes — the verb that turns a mention into a gate. */
const RESTRICTION_PATTERNS = [
  { id: 'prohibition', re: /\bdo not\b|\bdon't\b|\bnever\b|\bmust not\b|\bavoid\b/i, weight: 3 },
  { id: 'conditional', re: /\bunless\b|\bonly (?:when|if)\b|\brequires?\b/i, weight: 3 },
  { id: 'user-gated', re: /\bunless the user\b|\buser (?:has )?requested\b|\bexplicitly ask/i, weight: 4 },
]

/**
 * Classify one reported sentence.
 * A sentence is a GATE only when it names a delegation mechanism AND restricts
 * it. Naming alone is documentation; restricting alone is unrelated policy.
 */
export function classifySentence(sentence) {
  const s = String(sentence ?? '').trim()
  if (!s) return null

  const mechanisms = GATE_PATTERNS.filter((p) => p.re.test(s))
  const restrictions = RESTRICTION_PATTERNS.filter((p) => p.re.test(s))
  if (mechanisms.length === 0) return null

  const score =
    mechanisms.reduce((n, m) => n + m.weight, 0) +
    restrictions.reduce((n, r) => n + r.weight, 0)

  return {
    text: s,
    mechanisms: mechanisms.map((m) => m.id),
    restrictions: restrictions.map((r) => r.id),
    isGate: restrictions.length > 0,
    score,
  }
}

/**
 * Parse a self-report. The expected format is one sentence per line, each
 * prefixed with `GATE:`, or the literal `NONE`. Tolerant of extra prose around
 * it, because the reporter is a language model and will sometimes add a
 * preamble no matter how the instruction is worded.
 */
export function parseSelfReport(text) {
  const raw = String(text ?? '')
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  if (lines.some((l) => /^NONE$/i.test(l)) && !lines.some((l) => /^GATE:/i.test(l))) {
    return { declaredNone: true, sentences: [], gates: [], mentions: [] }
  }

  const claimed = lines
    .filter((l) => /^GATE:/i.test(l))
    .map((l) => l.replace(/^GATE:\s*/i, '').replace(/^["']|["']$/g, '').trim())
    .filter(Boolean)

  const classified = claimed.map(classifySentence).filter(Boolean)
  return {
    declaredNone: false,
    sentences: claimed,
    gates: classified.filter((c) => c.isGate),
    mentions: classified.filter((c) => !c.isGate),
  }
}

/**
 * Confidence in a self-report.
 *
 * A first-person report can be wrong in two directions: a model can paraphrase
 * an instruction it does see, and it can confabulate one it does not. Neither
 * is detectable from the text alone, so the score reflects how gate-shaped the
 * evidence is, and the label always says the source is a report.
 */
export function confidence(parsed) {
  if (parsed.declaredNone) {
    return { level: 'reported-absent', score: 0, note: 'Agent reported no delegation gate. Absence of evidence from a first-person report — confirm behaviourally before relying on it.' }
  }
  if (parsed.gates.length === 0) {
    return { level: 'inconclusive', score: 0, note: 'Delegation mechanisms were named but nothing restricted them. Not a gate.' }
  }
  const top = Math.max(...parsed.gates.map((g) => g.score))
  if (top >= 8) {
    return { level: 'strong', score: top, note: 'A named delegation mechanism restricted by a user-conditional. This is the shape of a gate.' }
  }
  if (top >= 5) {
    return { level: 'probable', score: top, note: 'A delegation mechanism under an explicit restriction.' }
  }
  return { level: 'weak', score: top, note: 'Restriction language present but loosely coupled to the mechanism.' }
}

/** Build the stored record. */
export function buildRecord({ text, model = null, source = 'self-report', label = '', capturedAt }) {
  const parsed = parseSelfReport(text)
  const conf = confidence(parsed)
  return {
    schema: 1,
    kind: 'self-report',
    capturedAt: capturedAt ?? new Date().toISOString(),
    label,
    model,
    source,
    hash: createHash('sha256').update(parsed.sentences.join('\n')).digest('hex').slice(0, 16),
    declaredNone: parsed.declaredNone,
    gates: parsed.gates,
    mentions: parsed.mentions,
    confidence: conf,
    // A first-person report is evidence, not a byte capture. Say so in the file.
    caveat:
      'Reported by the agent from its own context, not captured off the wire. ' +
      'Wording may be paraphrased. Confirm behaviourally: run one delegating ' +
      'task on two models and count the child tasks that start.',
  }
}

/** Diff two self-reports by sentence text. */
export function diffSelfReports(a, b) {
  const A = new Set((a.gates ?? []).map((g) => g.text))
  const B = new Set((b.gates ?? []).map((g) => g.text))
  return {
    added: [...B].filter((s) => !A.has(s)),
    removed: [...A].filter((s) => !B.has(s)),
    unchanged: [...B].filter((s) => A.has(s)),
  }
}
