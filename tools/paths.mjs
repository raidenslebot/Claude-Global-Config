// Shared path vocabulary for sync (live -> repo) and install (repo -> live).
//
// Files in config/ and skills/ are stored TEMPLATED: machine-specific absolute paths are
// replaced by {{TOKENS}}. install.mjs substitutes them back using values detected on the
// target machine. This is what makes the repo work on a setup that is not this one.

import { homedir, platform } from 'node:os'
import { existsSync, readFileSync, statSync, mkdirSync, openSync, writeSync, closeSync, unlinkSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const HOME = homedir()
export const IS_WIN = platform() === 'win32'
// Claude Code itself honours CLAUDE_CONFIG_DIR; an install that ignored it would write to a
// directory the running Claude never reads. The tests use it to install into a scratch root.
export const CONFIG_ROOT = process.env.CLAUDE_CONFIG_DIR || join(HOME, '.claude')
// Claude Code reads .claude.json from CLAUDE_CONFIG_DIR when that is set, else from HOME.
// Registering MCP servers in the other file is registering them nowhere.
export const CLAUDE_JSON = join(process.env.CLAUDE_CONFIG_DIR || HOME, '.claude.json')

/** Locate the node executable to hard-pin in hook commands.
 *  Pinning matters: a hook that relies on PATH silently dies when PATH differs
 *  (this exact failure took a set of hooks offline for weeks on the origin machine). */
export function detectNode() {
  if (process.execPath && existsSync(process.execPath)) return process.execPath
  try {
    const cmd = IS_WIN ? 'where' : 'which'
    const out = execFileSync(cmd, ['node'], { encoding: 'utf8', timeout: 5000 })
    const hit = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0]
    if (hit && existsSync(hit)) return hit
  } catch { /* fall through */ }
  return 'node'
}

/** Global eslint flat config (react-hooks). Optional — the react mandate degrades without it. */
export function detectEslintConfig() {
  const candidates = IS_WIN
    ? [join(HOME, 'AppData', 'Roaming', 'npm', 'node_modules', '.global-eslint', 'eslint.config.mjs')]
    : [
        '/usr/local/lib/node_modules/.global-eslint/eslint.config.mjs',
        join(HOME, '.npm-global', 'lib', 'node_modules', '.global-eslint', 'eslint.config.mjs'),
      ]
  return candidates.find(existsSync) || candidates[0]
}

/** Optional third-party tool roots. Absent is fine; the mandates say so. */
export function detectOptional(name, fallbacks) {
  return fallbacks.find(existsSync) || fallbacks[0]
}

/** Build the substitution table for this machine. */
export function buildVars(overrides = {}) {
  const vars = {
    CONFIG_ROOT,
    REPO_ROOT: REPO,
    HOME,
    NODE: detectNode(),
    // An ALREADY-INSTALLED library wins, so a re-install adopts it instead of cloning a
    // second copy. Only a machine with none falls through to the repo-local default.
    // CGC_LIBRARY_ROOT first, so a machine that keeps the library somewhere else says so once
    // and every tool agrees. The candidates after it are portable: a sibling of this repo, then
    // one under the home directory, then inside the repo. There was an absolute Windows path at
    // the head of this list. It worked on the machine that wrote it and was dead weight on every
    // other one, which is the one thing this package is not allowed to be.
    LIBRARY_ROOT: [
      process.env.CGC_LIBRARY_ROOT,
      process.env.LIBRARY_ROOT,
      join(REPO, '..', 'dskills'),
      join(HOME, 'dskills'),
      join(REPO, 'library', 'repos'),
    ].filter(Boolean).find(existsSync) || join(REPO, 'library', 'repos'),
    ESLINT_CONFIG: detectEslintConfig(),
    T3MP3ST_ROOT: detectOptional('t3mp3st', [
      join(HOME, 'T3MP3ST'), 'C:\\Claude\\T3MP3ST', join(HOME, 'src', 'T3MP3ST'),
    ]),
    BRIDGE_ROOT: detectOptional('bridge', [
      join(HOME, 'claude-max-bridge'), 'C:\\Claude\\claude-max-bridge',
    ]),
    ...overrides,
  }
  return vars
}

// Slash style has to survive the round trip PER OCCURRENCE, not per file. The same path can
// legitimately appear both ways in one document: a Windows CLI argument wants backslashes,
// while a `file:///` URL is only valid with forward slashes. Rendering everything in native
// style silently breaks the import. So the form a path was WRITTEN in selects the token:
//   backslash form -> {{KEY}}       rendered native at install
//   forward form   -> {{KEY:url}}   rendered forward-slashed at install
/** Longest-first so LIBRARY_ROOT wins over any path that merely contains it. */
export function templatize(text, vars) {
  const entries = Object.entries(vars).sort((a, b) => String(b[1]).length - String(a[1]).length)
  let out = text
  for (const [key, val] of entries) {
    if (!val || String(val).length < 4) continue
    const v = String(val)
    const back = v.replace(/\//g, '\\')
    const fwd = v.replace(/\\/g, '/')
    if (fwd !== back) {
      out = out.split(fwd).join(`{{${key}:url}}`)
      out = out.split(back).join(`{{${key}}}`)
    } else {
      out = out.split(v).join(`{{${key}}}`)
    }
  }
  return out
}

/** Substitute tokens back to real paths. `:url` always renders forward-slashed. */
export function realize(text, vars, { slash = 'native' } = {}) {
  // [A-Z0-9_] — digits included. With [A-Z_] a token like {{T3MP3ST_ROOT}} matched
  // nothing, so it was never substituted AND never reported unresolved: the guard below
  // shared the blind spot with the substituter, and a broken path shipped into the live
  // mandate telling Claude to cd somewhere that does not exist.
  return text.replace(/\{\{([A-Z0-9_]+)(:url)?\}\}/g, (m, key, url) => {
    const v = vars[key]
    if (v === undefined) return m
    const s = String(v)
    if (url) return s.replace(/\\/g, '/')
    if (slash === 'forward') return s.replace(/\\/g, '/')
    if (slash === 'back') return s.replace(/\//g, '\\')
    return s
  })
}

/** Any token left unresolved after install is a bug — report, don't ship silently. */
export function unresolved(text) {
  return [...new Set([...text.matchAll(/\{\{([A-Z0-9_]+)(?::url)?\}\}/g)].map((m) => m[1]))]
}

/** Print a script's own header comment as its usage, and say whether --help was asked for.
 *
 *  Every tool here documents itself in the comment block at the top of the file, and every one
 *  of these five ran its ACTION when asked for help — `cgc sync --help` performed a sync, `cgc
 *  scan --help` scanned, `cgc doctor --help` ran the doctor. A request for help must never be
 *  a request to do the thing. */
export function askedForHelp(metaUrl, argv = process.argv.slice(2)) {
  if (!argv.some((a) => a === '--help' || a === '-h')) return false
  let text = ''
  try { text = readFileSync(fileURLToPath(metaUrl), 'utf8') } catch { /* printed bare below */ }
  const lines = []
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (line.startsWith('//')) lines.push(line.replace(/^\/\/ ?/, ''))
    else if (lines.length) break
  }
  // Trailing blank comment lines read as an accident; the block itself is the usage.
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  console.log(lines.length ? lines.join('\n') : `usage: node ${fileURLToPath(metaUrl)}`)
  return true
}

/** The path both writers agree on. The session hook carries its own copy of this logic — it has
 *  to run when the repo is missing entirely — so the one thing that must not drift is where the
 *  lock lives. A test asserts the two agree. */
export const UPDATE_LOCK = join(CONFIG_ROOT, '.cgc', 'update.lock')
const LOCK_STALE_MS = 5 * 60 * 1000
const LOCK_WAIT_MS = 30 * 1000

function napSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch { /* no sleep available */ }
}

/** Run `fn` with the update lock held. Waiting is bounded and never fatal: a caller that cannot
 *  take the lock does the work anyway rather than hanging on somebody else's git.
 *
 *  Two processes writing the same config files is the same class of bug as two processes
 *  pulling the same clone — it just fails more quietly, with a half-written file instead of a
 *  message. `cgc install` typed by hand while a session starts is exactly that. */
export function acquireUpdateLock() {
  // The session hook spawns the installer while already holding the lock. Without this the
  // installer would wait the full thirty seconds on every repair, for a lock its own parent
  // holds — a stall on the one path that runs at every session start.
  if (process.env.CGC_UPDATE_LOCK_HELD === '1') return () => {}
  let held = false
  const deadline = Date.now() + LOCK_WAIT_MS
  while (Date.now() < deadline) {
    try {
      mkdirSync(dirname(UPDATE_LOCK), { recursive: true })
      const fd = openSync(UPDATE_LOCK, 'wx')
      writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }))
      closeSync(fd)
      held = true
      break
    } catch (e) {
      if (e.code !== 'EEXIST') break
      try {
        if (Date.now() - statSync(UPDATE_LOCK).mtimeMs > LOCK_STALE_MS) { unlinkSync(UPDATE_LOCK); continue }
      } catch { continue }
      napSync(250)
    }
  }
  return () => { if (held) { held = false; try { unlinkSync(UPDATE_LOCK) } catch { /* already gone */ } } }
}

export function withUpdateLock(fn) {
  const release = acquireUpdateLock()
  try { return fn() } finally { release() }
}

/** Is this local path something a browser should be pointed at?
 *
 *  Chromium renders a directory as a file listing and a binary file as mojibake, and every tool
 *  here then reports success over it: a PDF of a folder index, a proof PNG of nothing, an audit
 *  that says "no failures" about a file with no text in it. Silence reads as approval, and a
 *  render is the loudest silence there is.
 *
 *  A URL is not checked — the server decides what it serves. Returns null when the source is
 *  fine, or the sentence to print when it is not. */
export function unrenderable(src) {
  // Two characters minimum, or a Windows drive letter reads as a URL scheme and every local
  // path on this platform is waved through unchecked.
  if (/^[a-z][a-z0-9+.-]+:/i.test(src)) return null           // a URL, or file: — the caller's own business
  let st
  try { st = statSync(src) } catch { return null }           // missing is the caller's own message
  if (st.isDirectory()) return `${basename(src)} is a directory, not a design. Name the file inside it.`
  if (st.size === 0) return `${basename(src)} is empty — there is nothing here to judge, and "no failures" about an empty file is not a pass.`
  let head
  try { head = readFileSync(src) } catch { return null }
  const scan = head.subarray(0, 4096)
  if (!scan.includes(0)) return null
  // A NUL is the mark of a binary — EXCEPT in UTF-16, where every ASCII character carries one.
  // Windows editors and PowerShell redirection write UTF-16LE by default, and Chromium renders
  // it correctly from the byte-order mark. Refusing those was a false alarm on a real page.
  const bom = head.length >= 2 && ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff))
  if (bom) return null
  // No mark, but every second byte a NUL, is UTF-16 written without one. Let the browser decide
  // rather than call a page binary because of how it was saved.
  let nulls = 0, alternating = 0
  for (let i = 0; i < scan.length; i++) if (scan[i] === 0) { nulls++; if (i % 2 === 1 || scan[i + 1] !== 0) alternating++ }
  if (nulls > 0 && alternating / nulls > 0.9 && nulls / scan.length > 0.25) return null
  return `${basename(src)} is not a text file — a browser will render it as mojibake and this would report on that.`
}
