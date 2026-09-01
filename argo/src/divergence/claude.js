/**
 * claude.js — talk to the Claude CLI headlessly, without an API key.
 *
 * four things here are deliberate and worth the words:
 *
 * 1. the prompt goes over STDIN, not as an argv element. stdin has no quoting
 *    rules at all, so a question containing a quote, a newline or a `&` stays a
 *    question.
 * 2. nothing runs through a shell. `shell: true` hands the finished command
 *    line to cmd.exe, which re-parses it after node has already quoted it —
 *    node escapes an embedded quote as `\"` and cmd.exe reads that as a quote
 *    toggle, so one double quote in a user-authored agents file can append
 *    arguments or whole commands. node 24 deprecates exactly this (DEP0190).
 *    spawnPlan below removes the second parser instead of trying to out-quote it.
 * 3. the binary is resolved defensively and never allowed to fail as a raw
 *    ENOENT, because "spawn claude ENOENT" tells a user nothing they can act on.
 *    a plain-text failure that arrives with exit 0 is treated the same way —
 *    see looksLikeFailureText, which is the difference between "this run failed"
 *    and "your fleet agrees perfectly, on an error message".
 * 4. probes run through a bounded pool. serial probing turns a 16-call run into
 *    a coffee break, and unbounded probing turns it into a rate limit.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { CMD_UNSAFE, onPath, quoteArg, spawnPlan } from '../spawn.js'

// One implementation of "launch without a shell", shared with drift and
// baseline. Re-exported because this module's tests and callers already import
// them from here.
export { quoteArg, spawnPlan }

/**
 * Where the CLI lands on a default Windows npm global install.
 *
 * Derived, not hardcoded: this was previously a literal containing a specific
 * profile name, which silently became a dead path the moment that profile
 * changed — and a dead KNOWN_BIN degrades to the PATH fallback without saying
 * anything, so nothing looks broken until every probe fails.
 */
const KNOWN_BIN = join(homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd')

/** Envelope fields that are metadata, never the assistant's answer. */
const ENVELOPE_NOISE = new Set([
  'type', 'subtype', 'session_id', 'sessionId', 'model', 'uuid', 'id', 'role',
  'stop_reason', 'permission_denials', 'cwd', 'version', 'slug',
])

/** Fields that do hold assistant text, in the order we trust them. */
const RESULT_KEYS = ['result', 'text', 'output', 'content', 'message', 'response']

export const BIN_HINT =
  'set ARGO_CLAUDE_BIN to the full path of the Claude CLI executable, ' +
  'or put `claude` on PATH. `argo diverge --dry-run` works offline in the meantime.'

export const AUTH_HINT =
  'the CLI ran but is not authenticated. run `claude` once interactively and sign in, ' +
  'or `claude setup-token` for a headless token. `argo diverge --dry-run` works offline in the meantime.'

/**
 * Pick a binary: explicit env override, then the known install path, then
 * whatever `claude` resolves to on PATH.
 *
 * @returns {{bin: string, source: string}}
 */
export function resolveClaudeBin(env = process.env, platform = process.platform) {
  if (env.ARGO_CLAUDE_BIN) return { bin: env.ARGO_CLAUDE_BIN, source: 'ARGO_CLAUDE_BIN' }
  if (existsSync(KNOWN_BIN)) return { bin: KNOWN_BIN, source: 'known install path' }
  // Without a shell node only appends .com/.exe to a bare name, so `claude`
  // never finds the claude.cmd shim npm installs on Windows — the very install
  // KNOWN_BIN points at. Every probe then dies on ENOENT telling you to put
  // `claude` on PATH, which is exactly what you already did. Walk PATHEXT here
  // and hand spawnPlan a concrete file: .exe runs direct, .cmd via the shim
  // route. Windows only — on POSIX the loader already searches PATH properly.
  const found = platform === 'win32' ? onPath('claude', env) : null
  return { bin: found ?? 'claude', source: 'PATH' }
}



/**
 * Build the argv for one probe — real argv entries, unquoted, because they are
 * passed to the process directly. Exported so `--dry-run` can print exactly
 * what a live run would execute, rather than a description of it.
 */
export function buildArgv({ model, systemPrompt, appendPrompt, prompt, promptAsArg = false } = {}) {
  const argv = ['-p']
  if (promptAsArg && prompt) argv.push(prompt)
  argv.push('--output-format', 'json')
  if (model) argv.push('--model', model)
  if (systemPrompt) argv.push('--system-prompt', systemPrompt)
  if (appendPrompt) argv.push('--append-system-prompt', appendPrompt)
  return argv
}



/**
 * Phrases that are only ever an operational failure, never an answer to a
 * question about a repository.
 */
const FAILURE_PHRASES = new RegExp([
  'not logged in', 'please run /login', 'invalid api key', 'authentication_error',
  'rate limit', 'usage limit', 'quota', 'overloaded', 'credit balance',
  'invalid_request_error', 'internal server error', 'connection error',
  'unauthorized', 'permission denied',
].join('|'), 'i')

/**
 * Markers that make a short text a real answer rather than a failure notice:
 * a path separator between two word characters, or a source file extension.
 * `Please run /login` has a slash but not between word characters, which is
 * what keeps it on the failure side while `src/auth/login.js` is not.
 *
 * A backtick is deliberately NOT one of them. A CLI wraps the command it wants
 * you to run in backticks, so counting one as code let "Not logged in. Please
 * run `claude login`" through as an answer — measured, not theorised: a stub
 * printing exactly that line exited 0 with [consistent] before this changed.
 */
const CODEISH = /\w[\\/]\w|\.(?:js|mjs|cjs|jsx|ts|tsx|mts|cts|py|go|rs|rb|php|java|sh|sql|md|json|ya?ml|toml)\b/i

/** Longer than this and it is an explanation, not a CLI failure line. */
const FAILURE_MAX = 400

/**
 * Does this look like the CLI printing a failure where an answer should be?
 *
 * envelopeError only ever inspects PARSED JSON. When the CLI exits 0 and prints
 * `Not logged in · Please run /login` as plain text, that same string becomes
 * every agent's answer, divergence computes to 0.000, and the run reports a
 * perfectly consistent fleet — a false green produced by the tool built to
 * catch false greens. This is the guard for that, applied to the extracted text
 * before anything scores it.
 *
 * It is deliberately narrow. A legitimate answer ABOUT authentication code
 * ("the auth handler lives in src/auth/login.js") must not trip it, so the text
 * has to be short AND free of code-ish markers before the phrase list is even
 * consulted.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeFailureText(text) {
  const s = String(text ?? '').trim()
  if (s === '' || s.length >= FAILURE_MAX) return false
  if (CODEISH.test(s)) return false
  return FAILURE_PHRASES.test(s)
}

/**
 * Pull the assistant text out of `--output-format json`. Falls back through
 * plausible field names and finally to the raw stdout, because a CLI that
 * changed its envelope should degrade to "slightly noisy answer", not "crash".
 */
export function extractResult(stdout) {
  const text = String(stdout ?? '').trim()
  if (text === '') return ''
  let obj
  try {
    obj = JSON.parse(text)
  } catch {
    return text
  }
  if (typeof obj === 'string') return obj
  if (Array.isArray(obj)) {
    for (let i = obj.length - 1; i >= 0; i--) {
      const hit = extractFromObject(obj[i])
      if (hit !== null) return hit
    }
    return text
  }
  const hit = extractFromObject(obj)
  return hit === null ? text : hit
}

/**
 * Did the CLI report a failure INSIDE an otherwise successful-looking envelope?
 *
 * This matters more here than almost anywhere else in the toolkit. `claude -p`
 * can hand back `{"subtype":"success","is_error":true,"result":"Not logged in"}`,
 * and without this check that string becomes the agent's "answer". Every agent
 * would return the same one, score zero divergence, and the tool would report a
 * beautifully self-consistent fleet built entirely out of error messages —
 * which is precisely the failure this command exists to catch.
 *
 * @returns {string|null} the reason, or null when the envelope is clean
 */
export function envelopeError(stdout) {
  const text = String(stdout ?? '').trim()
  if (text === '') return null
  let obj
  try {
    obj = JSON.parse(text)
  } catch {
    return null
  }
  const env = Array.isArray(obj) ? obj[obj.length - 1] : obj
  if (!env || typeof env !== 'object') return null

  const detail = () => {
    const t = extractResult(text).trim()
    return t === '' ? '(no detail)' : t.slice(0, 300)
  }
  if (env.is_error === true) return `the CLI reported an error: ${detail()}`
  if (typeof env.subtype === 'string' && env.subtype.startsWith('error')) {
    return `the CLI reported ${env.subtype}: ${detail()}`
  }
  if (typeof env.error === 'string' && env.error.trim() !== '') return `the CLI reported an error: ${env.error.slice(0, 300)}`
  return null
}

/** looksLikeFailureText, phrased the way envelopeError phrases its reasons. */
function plainFailure(stdout) {
  const text = extractResult(stdout).trim()
  return looksLikeFailureText(text)
    ? `the CLI printed a failure instead of an answer: ${text.slice(0, 300)}`
    : null
}

function extractFromObject(obj) {
  if (!obj || typeof obj !== 'object') return null
  for (const key of RESULT_KEYS) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim() !== '') return v
    // `content` is often an array of blocks.
    if (Array.isArray(v)) {
      const joined = v
        .map((b) => (typeof b === 'string' ? b : typeof b?.text === 'string' ? b.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim()
      if (joined !== '') return joined
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    if (ENVELOPE_NOISE.has(k)) continue
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return null
}

/**
 * Ask one question. Never rejects — a failure comes back as { ok: false } so a
 * single dead probe cannot take the whole matrix down with it.
 *
 * @returns {Promise<{ok: boolean, text: string, error: string|null, ms: number}>}
 */
export function askClaude(opts = {}) {
  const {
    bin, prompt = '', cwd = process.cwd(), timeout = 180_000, promptAsArg = false,
  } = opts
  const argv = buildArgv({ ...opts, prompt, promptAsArg })
  const started = Date.now()

  return new Promise((resolve) => {
    let child
    const done = (ok, text, error) =>
      resolve({ ok, text, error: error ?? null, ms: Date.now() - started })

    const plan = spawnPlan(bin, argv)
    if (plan.unsafe !== null) {
      return done(false, '', `refusing to launch through cmd.exe: ${quoteArg(plan.unsafe)} contains a character ` +
        `cmd.exe would reinterpret. point ARGO_CLAUDE_BIN at the .exe instead of the .cmd shim, ` +
        'or remove the character from the agent config.')
    }

    try {
      child = execFile(
        plan.file,
        plan.args,
        { cwd, timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
        (err, stdout, stderr) => {
          if (err) {
            // The envelope on stdout usually says WHY far better than the exit
            // code does ("Not logged in" beats "Command failed: <cmdline>"), so
            // it is preferred over err.message wherever it exists — including
            // when it arrived as plain text rather than JSON, which is what
            // routes the caller to the auth hint instead of the binary hint.
            const inband = envelopeError(stdout) ?? plainFailure(stdout)
            const reason = err.killed
              ? `timed out after ${Math.round(timeout / 1000)}s`
              : inband
                ? inband
                : /ENOENT|not recognized|command not found|is not recognized/i.test(`${err.message}${stderr}`)
                  ? `could not run "${bin}". ${BIN_HINT}`
                  : `${err.message}`.trim()
            const tail = !inband && stderr ? ` :: ${String(stderr).trim().slice(0, 400)}` : ''
            return done(false, '', `${reason}${tail}`)
          }
          const inband = envelopeError(stdout)
          if (inband) return done(false, '', inband)
          const text = extractResult(stdout)
          if (text.trim() === '') return done(false, '', 'empty response from the CLI')
          // Exit 0, clean envelope, and the "answer" is a failure notice. A
          // failed call, not an agreement — the scorer skips nulls, and that is
          // the correct reading of a fleet that never answered.
          const plain = plainFailure(stdout)
          if (plain) return done(false, '', plain)
          return done(true, text, null)
        }
      )
    } catch (err) {
      return done(false, '', `could not run "${bin}": ${err?.message ?? err}. ${BIN_HINT}`)
    }

    if (!promptAsArg && child?.stdin) {
      child.stdin.on('error', () => {})
      child.stdin.end(prompt)
    }
  })
}

/**
 * Run `worker` over `items` with at most `concurrency` in flight. Results come
 * back in input order regardless of completion order, so the report does not
 * change shape because one probe happened to be slow.
 */
export async function runPool(items, worker, concurrency = 4) {
  const out = new Array(items.length)
  let next = 0
  const width = Math.max(1, Math.min(concurrency, items.length || 1))
  const lanes = Array.from({ length: width }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await worker(items[i], i)
    }
  })
  await Promise.all(lanes)
  return out
}

export { KNOWN_BIN, ENVELOPE_NOISE, RESULT_KEYS, CMD_UNSAFE, FAILURE_MAX }
