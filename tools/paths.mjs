// Shared path vocabulary for sync (live -> repo) and install (repo -> live).
//
// Files in config/ and skills/ are stored TEMPLATED: machine-specific absolute paths are
// replaced by {{TOKENS}}. install.mjs substitutes them back using values detected on the
// target machine. This is what makes the repo work on a setup that is not this one.

import { homedir, platform } from 'node:os'
import { existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const HOME = homedir()
export const IS_WIN = platform() === 'win32'
export const CONFIG_ROOT = join(HOME, '.claude')

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
    LIBRARY_ROOT: [
      'C:\\Claude\\dskills',
      join(HOME, 'dskills'),
      join(REPO, 'library', 'repos'),
    ].find(existsSync) || join(REPO, 'library', 'repos'),
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
  return text.replace(/\{\{([A-Z_]+)(:url)?\}\}/g, (m, key, url) => {
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
  return [...new Set([...text.matchAll(/\{\{([A-Z_]+)(?::url)?\}\}/g)].map((m) => m[1]))]
}
