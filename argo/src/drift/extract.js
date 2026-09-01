/**
 * extract.js — pull the shipped English out of a compiled agent bundle, and
 * diff two of those extractions.
 *
 * the motivating case: a line like "Do not call the AgentTool unless the user
 * requested it" appears in a shipped build between two patch versions. no
 * setting, no flag, no env var, no changelog entry — and delegation stops
 * firing. session logs never record a system prompt, so your own logs will
 * insist nothing happened. the only way to see it is to hold the two builds
 * side by side and read what changed.
 *
 * a bundle is mostly machine text: identifiers, symbol tables, base64, paths.
 * shipped policy is the rare thing in there that reads like a sentence a person
 * wrote to another person. so the filter is not "find strings", it is "find
 * prose", and everything here exists to draw that line.
 *
 * nothing in this file touches the filesystem or the network — it is the part
 * that can be tested.
 */

/**
 * Characters that end a candidate. Quotes and brackets delimit string literals
 * in every bundle format we care about; the two-character escapes \n \r \t \u
 * are how a multi-line prompt is stored inside one literal, so they split lines
 * apart the same way a real newline would.
 */
const SEGMENT = /(?:\\[nrtu]|[^\x20-\x7e]|["'`{}[\]<>|=])+/

/** Beyond this a run has no delimiter in sight and cannot be a sentence. */
const MAX_CARRY = 1 << 16

/**
 * A sentence needs a verb. Matching English properly is out of scope, so this
 * is a closed list of the verbs, auxiliaries and modals that instruction prose
 * actually leans on. It is the gate that rejects a run of noun-ish identifiers
 * that happens to contain spaces.
 */
const VERB = new RegExp(
  '\\b(' + [
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
    'do', 'does', 'did', 'done', 'have', 'has', 'had',
    'can', 'could', 'may', 'might', 'must', 'shall', 'should', 'will', 'would',
    'need', 'needs', 'use', 'uses', 'used', 'call', 'calls', 'called',
    'make', 'makes', 'made', 'run', 'runs', 'return', 'returns',
    'ask', 'asks', 'asked', 'read', 'reads', 'write', 'writes', 'wrote',
    'create', 'creates', 'update', 'updates', 'delete', 'deletes',
    'check', 'checks', 'ensure', 'ensures', 'avoid', 'avoids',
    'allow', 'allows', 'require', 'requires', 'include', 'includes',
    'set', 'sets', 'get', 'gets', 'send', 'sends', 'report', 'reports',
    'provide', 'provides', 'prefer', 'prefers', 'consider', 'considers',
    'explain', 'explains', 'describe', 'describes', 'want', 'wants',
    'expect', 'expects', 'try', 'tries', 'keep', 'keeps', 'give', 'gives',
    'take', 'takes', 'start', 'starts', 'stop', 'stops', 'show', 'shows',
    'find', 'finds', 'help', 'helps', 'know', 'knows', 'think', 'thinks',
    'see', 'sees', 'say', 'says', 'tell', 'tells', 'let', 'lets',
    'put', 'puts', 'add', 'adds', 'remove', 'removes', 'change', 'changes',
    'work', 'works', 'follow', 'follows', 'respond', 'responds',
    'answer', 'answers', 'mention', 'mentions', 'assume', 'assumes',
    'treat', 'treats', 'apply', 'applies', 'pick', 'picks', 'choose', 'chooses',
  ].join('|') + ')\\b',
  'i'
)

/** Punctuation a sentence is allowed to carry. Everything else is code. */
const SOFT_PUNCT = /[.,;:!?'"()\-/%&]/

/** Structural characters that never appear in a shipped English sentence. */
const HARD_SYMBOL = /["'`{}[\]<>|=$#@^~\\]/

/** Imperative shapes. These are the strings that silently change behaviour. */
const POLICY_PATTERNS = [
  ['do not', /\bdo\s+not\b|\bdon't\b/i],
  ['never', /\bnever\b/i],
  ['always', /\balways\b/i],
  ['unless the user', /\bunless\s+the\s+user\b/i],
  ['only when', /\bonly\s+when\b/i],
  ['avoid', /\bavoid(s|ed|ing)?\b/i],
  ['must not', /\bmust\s+not\b|\bmustn't\b/i],
  ['should not', /\bshould\s+not\b|\bshouldn't\b/i],
  ['only if', /\bonly\s+if\b/i],
  ['not allowed', /\bnot\s+(allowed|permitted)\b/i],
  ['refuse', /\brefuse[sd]?\b/i],
]

/** Stable ordering. localeCompare varies with ICU; code-unit order does not. */
export function byCodeUnit(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Does this string read like a sentence a human wrote?
 *
 * Every gate below exists because a real bundle produced a false positive
 * without it. The expensive one is the run-on check: string tables store
 * adjacent literals with no separator, so "…before it could be read.Cinternal
 * error…" arrives as one candidate and has to be thrown out on the seam.
 *
 * @param {string} s
 * @param {{minLength?: number, maxLength?: number}} [opts]
 * @returns {boolean}
 */
export function isProsey(s, opts = {}) {
  const minLength = opts.minLength ?? 40
  const maxLength = opts.maxLength ?? 400
  if (typeof s !== 'string') return false

  const t = s.trim()
  if (t.length < minLength || t.length > maxLength) return false

  // Prose starts with a word. Minified fragments start mid-token.
  if (!/^[A-Za-z]/.test(t)) return false

  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    if (c < 32 || c > 126) return false
  }
  if (HARD_SYMBOL.test(t)) return false
  if (/\\[nrtu]/.test(t)) return false
  if (/(https?:\/\/|www\.|:\/\/)/i.test(t)) return false

  // A lowercase letter, a full stop, then a capital with no space is not a
  // sentence boundary — it is two table entries that got concatenated.
  if (/[a-z][.,;:!?][A-Z]/.test(t)) return false

  const words = t.split(/\s+/)
  if (words.length < 7) return false

  let long = 0
  let camel = 0
  let ident = 0
  for (const w of words) {
    // No English word is this long. Hashes, paths and mangled names are.
    if (w.length > 20) return false
    if (w.length > 14) long++
    if (/[a-z][A-Z]/.test(w)) camel++
    if (/_|\d/.test(w)) ident++
  }
  // Some camelCase is fine — real policy names real tools ("the AgentTool").
  // A lot of it means we are reading a symbol table.
  if (camel / words.length > 0.15) return false
  if (long / words.length > 0.12) return false
  if (ident / words.length > 0.12) return false

  let letters = 0
  let spaces = 0
  let digits = 0
  let symbols = 0
  for (const c of t) {
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) letters++
    else if (c === ' ') spaces++
    else if (c >= '0' && c <= '9') digits++
    else if (!SOFT_PUNCT.test(c)) symbols++
  }
  if ((letters + spaces) / t.length < 0.85) return false
  if (digits / t.length > 0.04) return false
  if (symbols / t.length > 0.02) return false
  if (spaces / t.length < 0.08) return false

  // ALL CAPS with no lowercase is a constant name, not a sentence.
  if (!/[a-z]/.test(t)) return false

  return VERB.test(t)
}

/**
 * Streaming collector. A bundle is hundreds of megabytes, so the caller feeds
 * it chunks; this keeps the tail of each chunk so a sentence straddling a chunk
 * boundary is still found.
 *
 * @param {{minLength?: number, maxLength?: number, limit?: number}} [opts]
 */
export function createHarvester(opts = {}) {
  const limit = opts.limit ?? 20000
  const found = new Set()
  let carry = ''
  let skipNext = false
  let truncated = false

  const take = (raw) => {
    if (truncated) return
    const t = raw.trim()
    if (!isProsey(t, opts)) return
    found.add(t)
    if (found.size >= limit) truncated = true
  }

  return {
    /** Feed the next chunk of text. */
    push(text) {
      const parts = (carry + text).split(SEGMENT)
      carry = parts.pop() ?? ''
      for (const p of parts) {
        if (skipNext) {
          // Tail of a run we already gave up on; it is a fragment, not prose.
          skipNext = false
          continue
        }
        take(p)
      }
      if (carry.length > MAX_CARRY) {
        // No delimiter for 64k — far past any sentence. Drop it, and drop the
        // fragment that closes it too.
        carry = ''
        skipNext = true
      }
    },
    /** Finish and return the deduped, sorted result. */
    finish() {
      if (carry && !skipNext) take(carry)
      carry = ''
      skipNext = false
      return { strings: [...found].sort(byCodeUnit), truncated }
    },
  }
}

/**
 * One-shot extraction from a buffer or string.
 *
 * Deterministic: same bytes in, same array out, deduped and sorted by code unit
 * so two snapshots taken on different machines diff cleanly.
 *
 * @param {Buffer|string} input
 * @param {{minLength?: number, maxLength?: number, limit?: number}} [opts]
 * @returns {string[]}
 */
export function extractStrings(input, opts = {}) {
  const h = createHarvester(opts)
  h.push(typeof input === 'string' ? input : Buffer.from(input).toString('latin1'))
  return h.finish().strings
}

/**
 * Is this string shaped like an instruction that constrains the agent?
 *
 * Not every added sentence matters. The ones that do tell the model what it may
 * not do, or gate an action on a condition — those change behaviour without
 * changing any setting you own.
 *
 * @param {string} s
 * @returns {{isPolicy: boolean, patterns: string[]}}
 */
export function classifyPolicy(s) {
  if (typeof s !== 'string' || s.length === 0) return { isPolicy: false, patterns: [] }
  const patterns = []
  for (const [name, re] of POLICY_PATTERNS) {
    if (re.test(s)) patterns.push(name)
  }
  return { isPolicy: patterns.length > 0, patterns }
}

/** Effective version of a snapshot: what the package claims, else what the CLI said. */
export function snapshotVersion(snap) {
  const install = snap?.install ?? {}
  return install.packageVersion ?? install.cliVersion ?? null
}

function hashMap(snap) {
  const out = new Map()
  for (const f of snap?.install?.files ?? []) out.set(f.path, f.sha256)
  return out
}

function configMap(snap) {
  const out = new Map()
  for (const e of snap?.config?.entries ?? []) out.set(e.path, e.sha256)
  return out
}

function diffMaps(a, b) {
  const rows = []
  for (const [path, from] of a) {
    const to = b.get(path)
    if (to === undefined) rows.push({ path, from, to: null, status: 'removed' })
    else if (to !== from) rows.push({ path, from, to, status: 'changed' })
  }
  for (const [path, to] of b) {
    if (!a.has(path)) rows.push({ path, from: null, to, status: 'added' })
  }
  return rows.sort((x, y) => byCodeUnit(x.path, y.path))
}

function classify(list) {
  return list
    .map((text) => ({ text, ...classifyPolicy(text) }))
    .filter((e) => e.isPolicy)
    .map(({ text, patterns }) => ({ text, patterns }))
}

/**
 * Diff two snapshots, oldest first.
 *
 * `added` is the interesting half — a removed sentence loosens the agent, an
 * added one constrains it, and the constraints are what break a fan-out you
 * already shipped.
 *
 * @param {object} a  older snapshot
 * @param {object} b  newer snapshot
 */
export function diffSnapshots(a, b) {
  const before = new Set(a?.strings?.items ?? [])
  const after = new Set(b?.strings?.items ?? [])

  const added = [...after].filter((s) => !before.has(s)).sort(byCodeUnit)
  const removed = [...before].filter((s) => !after.has(s)).sort(byCodeUnit)

  const fromV = snapshotVersion(a)
  const toV = snapshotVersion(b)
  const fromCli = a?.install?.cliVersion ?? null
  const toCli = b?.install?.cliVersion ?? null

  return {
    from: a?.id ?? null,
    to: b?.id ?? null,
    versionChanged: fromV === toV ? null : { from: fromV, to: toV },
    cliVersionChanged: fromCli === toCli ? null : { from: fromCli, to: toCli },
    hashChanged: diffMaps(hashMap(a), hashMap(b)),
    configChanged: diffMaps(configMap(a), configMap(b)),
    added,
    removed,
    policyAdded: classify(added),
    policyRemoved: classify(removed),
    // A truncated side means the string sets are not comparable — every string
    // past the cap looks "removed" for reasons that have nothing to do with the
    // vendor. Say so rather than reporting a fake diff.
    truncated: Boolean(a?.strings?.truncated || b?.strings?.truncated),
  }
}
