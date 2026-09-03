#!/usr/bin/env node
// scan-secrets.mjs — the last line of defence before this repo is published publicly.
//
//   node tools/scan-secrets.mjs          scan the tree, exit 1 on any finding
//   node tools/scan-secrets.mjs --json   same checks, machine-readable, same exit code
//   node tools/scan-secrets.mjs --help   this text, and nothing else
//
// WHY this file is the highest-stakes one in the repo: the tree mirrors ~/.claude, which
// lives next door to .credentials.json (live Claude OAuth access + refresh tokens) and
// .claude.json (whose mcpOAuth block has held a real third-party client secret). One
// false negative publishes the user's account. So the posture is: broad prefix rules for
// every token shape we can name, a narrow entropy rule for the shapes we cannot, and
// an explicit absence check for the three files that must never be in the tree at all.
//
// Suppressing a deliberate example value: put `scan-secrets:allow` on the same or the
// previous line, or add the literal string to .secretsallow at the repo root. Both are
// opt-in per string — there is deliberately no way to exclude a whole file.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, relative, basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO, askedForHelp } from './paths.mjs'

// A request for help is never a request to do the thing.
if (askedForHelp(import.meta.url)) process.exit(0)

const args = process.argv.slice(2)
const JSON_OUT = args.includes('--json')

const results = []
const findings = []
let failures = 0

// House output style, identical to install.mjs. Silenced under --json so stdout stays
// parseable — the exit code carries the verdict either way.
const say = (m) => { if (!JSON_OUT) console.log(m) }
const phase = (n) => say(`\n\x1b[1m── ${n} ${'─'.repeat(Math.max(0, 58 - n.length))}\x1b[0m`)
const ok = (m) => { say(`  \x1b[32mok\x1b[0m    ${m}`); results.push(['ok', m]) }
const skip = (m) => { say(`  \x1b[90mskip\x1b[0m  ${m}`); results.push(['skip', m]) }
const warn = (m) => { say(`  \x1b[33mwarn\x1b[0m  ${m}`); results.push(['warn', m]) }
const fail = (m) => { say(`  \x1b[31mFAIL\x1b[0m  ${m}`); results.push(['fail', m]); failures++ }

// ── What never gets read ────────────────────────────────────────────────────
// .git holds packed objects (binary, and already-committed content is a different
// problem); node_modules and library/repos are third-party trees we neither own nor
// publish. Everything else in the tree is fair game — no per-file exclusions.
const SKIP_DIRS = ['.git', 'node_modules', 'library/repos', 'dist', 'coverage', '__pycache__', '.venv']
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'svgz', 'pdf', 'zip', 'gz', 'tgz', 'bz2',
  'xz', '7z', 'rar', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'mp4', 'mov', 'avi', 'webm',
  'wasm', 'exe', 'dll', 'so', 'dylib', 'class', 'jar', 'pyc', 'node', 'bin', 'db', 'sqlite',
])
// A single line longer than this is minified/encoded blob territory. Prefix rules still run
// on it (a real token is cheap to spot); the entropy rule does not, because base64 payloads
// are exactly what it would otherwise flag on every line.
const LONG_LINE = 500
const MAX_BYTES = 8 * 1024 * 1024

// ── Known token shapes ──────────────────────────────────────────────────────
// Ordered most-specific first: overlapping matches are deduped by span, so the generic
// `sk-` rule never re-reports an Anthropic key the specific rule already caught.
const RULES = [
  ['anthropic-api-key', /\bsk-ant-api\d{2}-[A-Za-z0-9_\-]{24,}/g],
  // oat01 = OAuth access token, ort01 = refresh token. Exactly what .credentials.json holds.
  ['anthropic-oauth-token', /\bsk-ant-(?:oat|ort|sid)\d{2}-[A-Za-z0-9_\-]{24,}/g],
  ['anthropic-admin-key', /\bsk-ant-admin\d{2}-[A-Za-z0-9_\-]{24,}/g],
  // `-` is not in the documented PAT alphabet, but permitting it costs nothing and a
  // charclass that stops one char early turns a catch into a miss.
  ['github-pat', /\bgithub_pat_[A-Za-z0-9_\-]{40,}/g],
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g],
  ['aws-access-key-id', /\b(?:AKIA|ASIA|ABIA|ACCA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[A-Z0-9]{16}\b/g],
  ['google-api-key', /\bAIza[A-Za-z0-9_\-]{35}\b/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9\-]{10,}/g],
  // Discord: base64(user id).base64(timestamp).hmac — the three-segment shape is distinctive.
  ['discord-bot-token', /\b[MNO][A-Za-z0-9_\-]{22,25}\.[A-Za-z0-9_\-]{6}\.[A-Za-z0-9_\-]{27,}/g],
  ['private-key-pem', /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g],
  ['jwt', /\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{8,}/g],
  ['stripe-key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g],
  ['npm-token', /\bnpm_[A-Za-z0-9]{36}\b/g],
  // Generic OpenAI-style key. Last, so the Anthropic/Stripe rules claim their spans first.
  ['openai-style-key', /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_\-]{32,}/g],
]

// AWS secret access keys are 40 chars of plain base64 with no prefix — matching them by
// shape alone floods on hashes. Require an aws/secret word on the same line instead.
const AWS_SECRET = /\b(?:aws|amazon)[A-Za-z0-9_\- ]{0,24}(?:secret|access)[A-Za-z0-9_\- ]{0,24}[=:]\s*['"`]?([A-Za-z0-9/+=]{40})\b/gi

// Generic "key named like a secret = opaque value". The value is captured quoted (group 2)
// or bare (group 3) — bare matters because a leaked .env line has no quotes at all. The
// value guards below are what keep this from firing on `token: string` and on every prose
// sentence containing the word "password".
const SECRET_ASSIGN =
  // The key may be quoted, as every JSON key is: `"client_secret": "…"` is the .claude.json shape.
  /(?<![A-Za-z0-9_.\-])['"]?([A-Za-z0-9_.\-]*(?:secret|token|password|passwd|api[_\-]?key|apikey|client[_\-]?secret|access[_\-]?key|auth[_\-]?token|credential|private[_\-]?key)[A-Za-z0-9_.\-]*)['"]?\s*[:=]\s*(?:['"`]([^'"`\n]{12,})['"`]|([^\s'"`,;()\[\]{}<>=&|]{12,}))/gi

// Values that look secret-shaped but are not: templates, env indirection, URLs, obvious
// samples. Anchored forms first, then substrings that disqualify a value anywhere in it.
// `Ident.member` catches unquoted code expressions (`tokens = Math.round(...)`) that the
// bare-value branch would otherwise read as an assigned credential.
const NOT_A_SECRET = /^(?:\{\{|\$\{|\$[A-Z_]|<|-|\.{0,2}\/|[A-Za-z]:[\\/]|https?:|process\.env|import\.meta|require|[A-Za-z_$][A-Za-z0-9_$]*\.[A-Za-z_$]|true$|false$|null$|undefined$|string$|number$|boolean$)|(?:\{\{|\}\}|\*{3}|x{6,}|redact|placeholder|changeme|your[_\-]|example|dummy|sample|fake|<[a-z-]+>)/i

// Lines whose long opaque strings are structurally explained: lockfile digests, inline
// image payloads, integrity hashes. Skipping the entropy rule here is the single biggest
// false-positive reduction; the prefix rules above still run on these lines.
const NOISE_LINE = /(?:sha(?:1|256|384|512)-|"integrity"|integrity:|base64,|data:image\/|\bmd5\b|[0-9a-f]{7}\.\.\.)/i

const ALLOW_MARK = 'scan-secrets:allow'
const ENTROPY_MIN_LEN = 32
const ENTROPY_MIN_BITS = 4.0
const CANDIDATE = /[A-Za-z0-9+/=_\-]{32,}/g

/** Shannon entropy in bits per character. Random base64 lands near 4.6-5.0; English
 *  prose and identifiers sit under 4.0, which is where the threshold goes. */
function entropy(s) {
  const freq = new Map()
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1)
  let e = 0
  for (const n of freq.values()) { const p = n / s.length; e -= p * Math.log2(p) }
  return e
}

/** Character-class diversity. A random secret mixes at least three of lower/upper/digit/
 *  symbol; CONSTANT_NAMES, camelCaseIdentifiers and kebab-case-slugs manage only two. */
function classes(s) {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[+/=_\-]/].filter((re) => re.test(s)).length
}

/** Path / slug / env-var shape: two or more separators AND two or more all-letter
 *  segments of 4+ chars. That is a URL path, a kebab-case skill name or a run of env
 *  var names — never a random credential. This one predicate removed every entropy
 *  false positive in this repo (URLs, skill slugs, `AGENT_NATIVE_PLANS_MODE=local-files`).
 *  ponytail: a real token that happens to contain two long all-letter runs slips past it
 *  (a few percent of the time); the named-prefix rules above are what actually guard the
 *  Anthropic and GitHub tokens, so the trade buys usable signal-to-noise. */
function looksLikeSlug(s) {
  if ((s.match(/[-_/+=.]/g) || []).length < 2) return false
  return s.split(/[-_/+=.]/).filter((p) => /^[A-Za-z]{4,}$/.test(p)).length >= 2
}

/** Base64 that decodes to readable text is encoded prose or a test fixture, not a
 *  credential — a real secret decodes to random bytes. */
function isEncodedText(s) {
  if (s.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return false
  const buf = Buffer.from(s, 'base64')
  if (buf.length < 8) return false
  let printable = 0
  for (const b of buf) if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) printable++
  return printable / buf.length >= 0.9
}

// ── Allowlists ──────────────────────────────────────────────────────────────
const allowFile = join(REPO, '.secretsallow')
let ALLOW = []
if (existsSync(allowFile)) {
  const raw = readFileSync(allowFile, 'utf8').split(/\r?\n/).map((l) => l.trim())
  for (const l of raw) {
    if (!l || l.startsWith('#')) continue
    // A short entry would allowlist half the tree by substring. Refuse it loudly.
    if (l.length < 8) { warn(`.secretsallow entry too short to be safe, ignored: ${l.slice(0, 6)}...`); continue }
    ALLOW.push(l)
  }
}

const allowedByFile = (raw) => ALLOW.some((a) => a === raw || a.includes(raw) || raw.includes(a))
const allowedInline = (lines, i) =>
  lines[i].includes(ALLOW_MARK) || (i > 0 && lines[i - 1].includes(ALLOW_MARK))

const redact = (s) => `${s.slice(0, 6)}... (${s.length} chars)`

function record(rel, lineNo, rule, raw) {
  findings.push({ file: rel, line: lineNo, rule, preview: redact(raw), length: raw.length })
}

// ── Walk ────────────────────────────────────────────────────────────────────
function* walk(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name)
    const rel = relative(REPO, abs).replace(/\\/g, '/')
    if (ent.isDirectory()) {
      if (SKIP_DIRS.some((s) => rel === s || rel.endsWith('/' + s))) continue
      yield* walk(abs)
    } else if (ent.isFile()) {
      yield { abs, rel }
    }
  }
}

const files = [...walk(REPO)]

// ── Phase 1: files that must not exist here at all ──────────────────────────
phase('Forbidden paths')
{
  const hasGit = spawnSync('git', ['--version'], { cwd: REPO, encoding: 'utf8' }).status === 0
  const gitignore = existsSync(join(REPO, '.gitignore'))
    ? readFileSync(join(REPO, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim())
    : []

  /** git is authoritative about its own ignore rules. The fallback exists so a checkout
   *  without git (or a pre-commit hook in a weird shell) still gets a real answer. */
  function isIgnored(rel) {
    if (hasGit) {
      // --no-index: ask whether the RULES ignore it, not whether it happens to be tracked.
      const r = spawnSync('git', ['check-ignore', '-q', '--no-index', '--', rel], { cwd: REPO })
      if (r.status === 0) return true
      if (r.status === 1) return false
    }
    const name = basename(rel)
    let ignored = false
    for (const pat of gitignore) {
      if (!pat || pat.startsWith('#')) continue
      const neg = pat.startsWith('!')
      const body = (neg ? pat.slice(1) : pat).replace(/^\*\*\//, '').replace(/^\//, '').replace(/\/$/, '')
      const re = new RegExp('^' + body.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$')
      if (re.test(name) || re.test(rel)) ignored = !neg
    }
    return ignored
  }

  const isTracked = (rel) =>
    hasGit && spawnSync('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: REPO }).status === 0

  // .env.example is the documented template and is meant to be committed; every other
  // .env variant is a real environment file until proven otherwise.
  const isForbiddenName = (name) =>
    name === '.credentials.json' || name === '.claude.json' ||
    (name.startsWith('.env') && name !== '.env.example')

  const NAMED = ['.credentials.json', '.claude.json', '.env']
  const present = files.filter((f) => isForbiddenName(basename(f.rel)))

  for (const f of present) {
    if (isTracked(f.rel)) fail(`${f.rel} is TRACKED BY GIT — remove it from the index before publishing`)
    else if (!isIgnored(f.rel)) fail(`${f.rel} is present and NOT gitignored — it would be committed`)
    else warn(`${f.rel} present on disk but gitignored (leave it out of the repo anyway)`)
  }

  for (const name of NAMED) {
    // Absent is necessary but not sufficient: ~/.claude rewrites .credentials.json
    // constantly, so a missing ignore rule is a landmine, not a non-issue.
    if (!isIgnored(name)) fail(`.gitignore does not ignore ${name} — add it before publishing`)
    else if (!present.some((f) => basename(f.rel) === name)) ok(`${name} absent and gitignored`)
  }
  if (!hasGit) warn('git not available — gitignore checked with the built-in fallback matcher')
}

// ── Phase 2 + 3: content scan ───────────────────────────────────────────────
let scanned = 0, skipped = 0
const patternHits = []
const entropyHits = []

for (const { abs, rel } of files) {
  const ext = (basename(rel).match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase()
  if (ext && BINARY_EXT.has(ext)) { skipped++; continue }
  let st
  try { st = statSync(abs) } catch { continue }
  if (st.size > MAX_BYTES) { skipped++; continue }

  let text
  try { text = readFileSync(abs) } catch { continue }
  // NUL in the head means binary regardless of extension (.excalidraw, stray blobs).
  if (text.subarray(0, 4096).includes(0)) { skipped++; continue }
  text = text.toString('utf8')
  scanned++

  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    if (allowedInline(lines, i)) continue

    // Spans already claimed by a more specific rule, so one secret is reported once.
    const claimed = []
    const overlaps = (a, b) => claimed.some(([x, y]) => a < y && b > x)

    for (const [rule, re] of RULES) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(line))) {
        const raw = m[0]
        const start = m.index, end = m.index + raw.length
        if (overlaps(start, end)) continue
        if (allowedByFile(raw)) continue
        claimed.push([start, end])
        patternHits.push({ rel, line: i + 1, rule, raw })
      }
    }

    AWS_SECRET.lastIndex = 0
    let am
    while ((am = AWS_SECRET.exec(line))) {
      if (!allowedByFile(am[1])) patternHits.push({ rel, line: i + 1, rule: 'aws-secret-access-key', raw: am[1] })
    }

    SECRET_ASSIGN.lastIndex = 0
    let sm
    while ((sm = SECRET_ASSIGN.exec(line))) {
      const val = (sm[2] ?? sm[3]).trim()
      if (NOT_A_SECRET.test(val) || allowedByFile(val)) continue
      // Real credentials are random. Requiring entropy here is what makes the rule
      // usable in a repo full of prose about tokens and hooks named "auth".
      if (entropy(val) < 3.5 || classes(val) < 2) continue
      if (overlaps(sm.index, sm.index + sm[0].length)) continue
      patternHits.push({ rel, line: i + 1, rule: `secret-assignment:${sm[1]}`, raw: val })
    }

    // Entropy sweep — only on human-length lines that carry no structural explanation.
    if (line.length > LONG_LINE || NOISE_LINE.test(line)) continue
    CANDIDATE.lastIndex = 0
    let cm
    while ((cm = CANDIDATE.exec(line))) {
      const raw = cm[0]
      if (overlaps(cm.index, cm.index + raw.length)) continue
      if (allowedByFile(raw)) continue
      if (/^[0-9a-f]+$/i.test(raw) || /^[0-9]+$/.test(raw)) continue // digests, ids, not secrets
      if (raw.length < ENTROPY_MIN_LEN) continue
      if (classes(raw) < 3) continue
      if (looksLikeSlug(raw) || isEncodedText(raw)) continue
      if (entropy(raw) < ENTROPY_MIN_BITS) continue
      entropyHits.push({ rel, line: i + 1, rule: 'high-entropy-string', raw })
    }
  }
}

// One secret on one line can trip several rules at once — the keyed AWS rule, the generic
// assignment rule and the entropy sweep all see the same string. Report it once, under the
// most specific rule that matched, so a real leak is not buried in its own echoes.
const seen = new Set()
const dedupe = (hits) => hits.filter((h) => {
  const key = `${h.rel}:${h.line}:${h.raw}`
  if (seen.has(key)) return false
  seen.add(key)
  return true
})
const patterns = dedupe(patternHits)
const entropies = dedupe(entropyHits).filter((h) =>
  !patterns.some((p) => p.rel === h.rel && p.line === h.line && (p.raw.includes(h.raw) || h.raw.includes(p.raw))))

phase('Secret patterns')
if (!patterns.length) ok(`no known credential shapes in ${scanned} text files (${skipped} binary/oversized skipped)`)
for (const h of patterns) {
  record(h.rel, h.line, h.rule, h.raw)
  fail(`${h.rel}:${h.line}  ${h.rule}  ${redact(h.raw)}`)
}

phase('Entropy')
if (!entropies.length) ok(`no unexplained high-entropy strings (>=${ENTROPY_MIN_LEN} chars, >=${ENTROPY_MIN_BITS} bits/char)`)
for (const h of entropies) {
  record(h.rel, h.line, h.rule, h.raw)
  fail(`${h.rel}:${h.line}  ${h.rule}  ${redact(h.raw)}  entropy ${entropy(h.raw).toFixed(2)}`)
}

// ── Summary ─────────────────────────────────────────────────────────────────
const counts = results.reduce((a, [k]) => ({ ...a, [k]: (a[k] || 0) + 1 }), {})
if (JSON_OUT) {
  console.log(JSON.stringify({
    ok: failures === 0,
    scanned,
    skipped,
    findings,
    // Non-finding notes (forbidden-path results) travel too, so CI can show the reason.
    notes: results.filter(([k]) => k !== 'ok').map(([kind, message]) => ({ kind, message })),
  }, null, 2))
} else {
  say(`\n\x1b[1m── Summary ${'─'.repeat(52)}\x1b[0m`)
  say(`  ${counts.ok || 0} ok · ${counts.skip || 0} skipped · ${counts.warn || 0} warnings · ${counts.fail || 0} failed`)
  if (failures) {
    say(`\n  \x1b[31m${failures} finding(s) — DO NOT COMMIT OR PUSH.\x1b[0m`)
    say(`  Remove the secret and rotate it. A deliberate example: add \x1b[1m${ALLOW_MARK}\x1b[0m on the line above,`)
    say(`  or put the literal string in \x1b[1m.secretsallow\x1b[0m.`)
  } else {
    say(`\n  \x1b[32mClean.\x1b[0m Safe to publish as far as this scanner can tell.`)
  }
}

process.exit(failures ? 1 : 0)
