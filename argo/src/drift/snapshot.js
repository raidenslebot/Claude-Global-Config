/**
 * snapshot.js — everything that touches disk: find the installed agent, hash it,
 * harvest its prose, and record the config surface around it.
 *
 * split from extract.js so the heuristics stay testable. this half is all IO and
 * all defensive: the install may be missing, may be a native binary, may be a
 * desktop app rather than an npm package, and none of those may crash the tool.
 *
 * two things get fingerprinted, because both of them change your agent's
 * behaviour and only one of them is your fault:
 *   - the vendor's build (version, bundle hashes, the English inside it)
 *   - your own config surface (settings.json, CLAUDE.md, hooks, plugins)
 */

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  createReadStream, existsSync, mkdirSync, readdirSync, readFileSync,
  statSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { onPath, spawnPlan } from '../spawn.js'
import { createHarvester } from './extract.js'

const execFileAsync = promisify(execFile)

/** Files worth hashing inside an install. Everything else is docs and icons. */
const BUNDLE_EXT = new Set([
  '.js', '.mjs', '.cjs', '.exe', '.node', '.wasm', '.asar', '.dll', '.dylib', '.so', '.sh',
])

/** Directories inside an install that are noise. */
const SKIP = new Set(['.git', 'logs', 'Cache', 'GPUCache', 'Crashpad', 'blob_storage'])

const SCHEMA = 1

function toPosix(p) {
  return p.split(sep).join('/')
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * Read JSON, tolerating a UTF-8 BOM.
 *
 * Windows editors write settings.json with one and JSON.parse rejects it, so
 * without this the config surface of every Windows machine reads as "malformed"
 * and its key list silently goes missing from the snapshot.
 */
/**
 * Every JSON read in this module goes through here. Windows editors write a
 * UTF-8 BOM that JSON.parse rejects, and the store is plain files a user can
 * open, so any read can meet one.
 */
export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
}

/** Hash a file without holding it in memory — the main bundle is ~240 MB. */
export function hashFile(path) {
  return new Promise((res, rej) => {
    const h = createHash('sha256')
    const s = createReadStream(path)
    s.on('error', rej)
    s.on('data', (c) => h.update(c))
    s.on('end', () => res(h.digest('hex')))
  })
}

/* ------------------------------------------------------------------ *
 * Resolving the install
 * ------------------------------------------------------------------ */

/**
 * Candidate CLI binaries, best first. ARGO_CLAUDE_BIN wins so a machine with an
 * unusual layout stays usable without a code change.
 */
export function claudeBinCandidates() {
  const out = []
  if (process.env.ARGO_CLAUDE_BIN) out.push(process.env.ARGO_CLAUDE_BIN)
  if (process.env.APPDATA) out.push(join(process.env.APPDATA, 'npm', 'claude.cmd'))
  out.push(join(homedir(), '.claude', 'local', 'claude'))
  out.push(join(homedir(), '.local', 'bin', 'claude'))
  out.push('/usr/local/bin/claude')
  out.push('claude')
  return [...new Set(out)]
}

/**
 * Ask the installed CLI what version it thinks it is.
 *
 * Deliberately separate from the package.json version: when the two disagree,
 * the binary you actually run is not the one npm believes is installed, and
 * that gap is itself drift.
 *
 * Never throws — an absent CLI returns { version: null, reason }.
 */
export async function probeCliVersion({ timeout = 20000 } = {}) {
  const tried = []
  for (const bin of claudeBinCandidates()) {
    if (bin.includes(sep) && !existsSync(bin)) {
      tried.push(`${bin} (not found)`)
      continue
    }
    const plan = spawnPlan(bin, ['--version'])
    if (plan.unsafe !== null) {
      tried.push(`${bin} (unsafe for the cmd.exe shim route)`)
      continue
    }
    try {
      const { stdout } = await execFileAsync(plan.file, plan.args, {
        timeout,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      })
      const m = String(stdout).trim().match(/\d+\.\d+\.\d+[\w.-]*/)
      if (m) return { version: m[0], bin, raw: String(stdout).trim() }
      tried.push(`${bin} (unparseable: ${String(stdout).trim().slice(0, 60)})`)
    } catch (err) {
      tried.push(`${bin} (${err?.code ?? 'failed'})`)
    }
  }
  return {
    version: null,
    bin: null,
    reason:
      'no working claude binary. set ARGO_CLAUDE_BIN to its full path. tried: ' +
      tried.join(', '),
  }
}

/** Walk up from a binary looking for the package root that owns it. */
function packageRootFor(binPath) {
  let dir = existsSync(binPath) && statSync(binPath).isDirectory() ? binPath : dirname(binPath)
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

/**
 * Where the agent tooling might live, best first.
 * Returns [{ path, source }] for every candidate that exists on this machine.
 */
export function installRoots() {
  const out = []
  const add = (path, source) => {
    if (path && existsSync(path) && !out.some((r) => r.path === path)) out.push({ path, source })
  }

  if (process.env.ARGO_CLAUDE_BIN) {
    add(packageRootFor(process.env.ARGO_CLAUDE_BIN), 'ARGO_CLAUDE_BIN')
  }
  if (process.env.APPDATA) {
    add(join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code'), 'npm-global')
  }
  if (process.env.LOCALAPPDATA) {
    add(join(process.env.LOCALAPPDATA, 'AnthropicClaude'), 'desktop-app')
  }
  add(join(homedir(), '.claude', 'local', 'node_modules', '@anthropic-ai', 'claude-code'), 'local-install')
  add('/usr/local/lib/node_modules/@anthropic-ai/claude-code', 'npm-global')
  add(join(homedir(), '.npm-global', 'lib', 'node_modules', '@anthropic-ai', 'claude-code'), 'npm-global')
  return out
}

/** Last resort: ask npm where global packages live. Never throws. */
async function npmGlobalRoot({ timeout = 30000 } = {}) {
  try {
    // `npm` on Windows is npm.cmd, which node will not exec without a shell —
    // so resolve it through PATHEXT and let spawnPlan take the shim route.
    const npmBin = process.platform === 'win32' ? (onPath('npm') ?? 'npm') : 'npm'
    const plan = spawnPlan(npmBin, ['root', '-g'])
    if (plan.unsafe !== null) return null
    const { stdout } = await execFileAsync(plan.file, plan.args, {
      timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    })
    const root = join(String(stdout).trim(), '@anthropic-ai', 'claude-code')
    return existsSync(root) ? { path: root, source: 'npm-root-g' } : null
  } catch {
    return null
  }
}

/** Collect the files worth fingerprinting under an install root. */
function collectFiles(root, { maxFiles = 500 } = {}) {
  const files = []
  const recurse = (dir, depth) => {
    if (depth > 8 || files.length >= maxFiles) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (files.length >= maxFiles) return
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (SKIP.has(e.name)) continue
        recurse(full, depth + 1)
      } else if (e.isFile()) {
        const dot = e.name.lastIndexOf('.')
        const ext = dot === -1 ? '' : e.name.slice(dot).toLowerCase()
        if (!BUNDLE_EXT.has(ext) && e.name !== 'package.json') continue
        try {
          files.push({ path: toPosix(full.slice(root.length + 1)), abs: full, bytes: statSync(full).size })
        } catch {
          // vanished between readdir and stat; nothing to record
        }
      }
    }
  }
  recurse(root, 0)
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** Read the version out of the install's own package.json, if it has one. */
function packageVersion(root, files) {
  const candidates = files.filter((f) => basename(f.path) === 'package.json')
  // The shallowest package.json is the install's own; deeper ones are its deps.
  candidates.sort((a, b) => a.path.split('/').length - b.path.split('/').length)
  for (const c of candidates) {
    try {
      const pkg = readJson(c.abs)
      if (pkg?.version) return { version: pkg.version, name: pkg.name ?? null, from: c.path }
    } catch {
      // unreadable or malformed; try the next one
    }
  }
  return { version: null, name: null, from: null }
}

/* ------------------------------------------------------------------ *
 * Config surface
 * ------------------------------------------------------------------ */

/** Flatten an object to sorted dotted key paths. Keys only — values may hold secrets. */
function keyPaths(value, prefix = '', out = []) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out
  for (const k of Object.keys(value).sort()) {
    const path = prefix ? `${prefix}.${k}` : k
    out.push(path)
    keyPaths(value[k], path, out)
  }
  return out
}

function fileEntry(label, abs, kind = 'file') {
  try {
    const buf = readFileSync(abs)
    return { path: label, kind, bytes: buf.length, sha256: sha256(buf), abs }
  } catch {
    return null
  }
}

/**
 * Fingerprint the user's own configuration.
 *
 * A hook you added last week changes the agent exactly as much as a line the
 * vendor shipped. Only the hashes and the key names are recorded — never the
 * values, which is where tokens live.
 */
export function captureConfig({ home, projectDir } = {}) {
  const root = home ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
  const entries = []
  const notes = []

  for (const name of ['settings.json', 'settings.local.json']) {
    const e = fileEntry(name, join(root, name), 'settings')
    if (!e) continue
    try {
      e.keys = keyPaths(readJson(e.abs))
    } catch {
      notes.push(`${name} is not valid JSON`)
    }
    delete e.abs
    entries.push(e)
  }

  const md = fileEntry('CLAUDE.md', join(root, 'CLAUDE.md'), 'memory')
  if (md) {
    md.lines = readFileSync(join(root, 'CLAUDE.md'), 'utf8').split(/\r?\n/).length
    delete md.abs
    entries.push(md)
  }

  const hooksDir = join(root, 'hooks')
  if (existsSync(hooksDir)) {
    for (const name of listNames(hooksDir)) {
      const e = fileEntry(`hooks/${name}`, join(hooksDir, name), 'hook')
      if (e) {
        delete e.abs
        entries.push(e)
      }
    }
  }

  const pluginsDir = join(root, 'plugins')
  if (existsSync(pluginsDir)) {
    const installed = fileEntry('plugins/installed_plugins.json', join(pluginsDir, 'installed_plugins.json'), 'plugins')
    if (installed) {
      delete installed.abs
      entries.push(installed)
    }
    for (const sub of ['marketplaces', 'cache']) {
      const dir = join(pluginsDir, sub)
      if (!existsSync(dir)) continue
      const names = listNames(dir)
      entries.push({
        path: `plugins/${sub}/`,
        kind: 'listing',
        bytes: names.length,
        sha256: sha256(names.join('\n')),
        names,
      })
    }
  }

  if (projectDir) {
    for (const rel of ['CLAUDE.md', '.claude/settings.json', '.claude/settings.local.json']) {
      const e = fileEntry(`project:${rel}`, join(projectDir, ...rel.split('/')), 'project')
      if (e) {
        delete e.abs
        entries.push(e)
      }
    }
  }

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { root, entries, notes }
}

function listNames(dir) {
  try {
    return readdirSync(dir).sort()
  } catch {
    return []
  }
}

/* ------------------------------------------------------------------ *
 * Capture
 * ------------------------------------------------------------------ */

/** Stream a file through the prose harvester. */
async function harvestFile(abs, harvester) {
  const stream = createReadStream(abs, { highWaterMark: 4 * 1024 * 1024 })
  for await (const chunk of stream) harvester.push(chunk.toString('latin1'))
}

/**
 * Take a full snapshot.
 *
 * @param {object} [opts]
 * @param {string} [opts.projectDir]  repo whose local config also counts
 * @param {number} [opts.limit]       max strings kept                    [20000]
 * @param {number} [opts.bundles]     how many of the largest files to read [2]
 * @param {number} [opts.maxBytes]    hashing budget                       [4 GiB]
 * @param {boolean} [opts.dryRun]     skip the `claude --version` spawn
 * @param {string} [opts.label]
 */
export async function captureSnapshot(opts = {}) {
  const limit = opts.limit ?? 20000
  const bundleCount = opts.bundles ?? 2
  const maxBytes = opts.maxBytes ?? 4 * 1024 * 1024 * 1024

  let roots = installRoots()
  if (roots.length === 0 && !opts.dryRun) {
    const fallback = await npmGlobalRoot()
    if (fallback) roots = [fallback]
  }

  const cli = opts.dryRun
    ? { version: null, bin: claudeBinCandidates()[0], dryRun: true }
    : await probeCliVersion()

  const install = {
    found: roots.length > 0,
    source: roots[0]?.source ?? null,
    root: roots[0]?.path ?? null,
    otherRoots: roots.slice(1).map((r) => ({ path: r.path, source: r.source })),
    packageName: null,
    packageVersion: null,
    versionFrom: null,
    cliVersion: cli.version,
    cliBin: cli.bin ?? null,
    files: [],
    skipped: [],
    bundlesRead: [],
  }
  if (!install.found) install.reason = cli.reason ?? 'no claude-code install found on this machine'

  const harvester = createHarvester({ limit })
  let scannedBytes = 0

  if (roots.length > 0) {
    const root = roots[0].path
    const found = collectFiles(root)
    const pkg = packageVersion(root, found)
    install.packageName = pkg.name
    install.packageVersion = pkg.version
    install.versionFrom = pkg.from

    let budget = maxBytes
    for (const f of found) {
      if (f.bytes > budget) {
        install.skipped.push({ path: f.path, bytes: f.bytes, reason: 'byte budget' })
        continue
      }
      try {
        f.sha256 = await hashFile(f.abs)
        budget -= f.bytes
        install.files.push({ path: f.path, bytes: f.bytes, sha256: f.sha256 })
      } catch {
        install.skipped.push({ path: f.path, bytes: f.bytes, reason: 'unreadable' })
      }
    }

    // Read prose out of the biggest bundles only. Identical files (the npm
    // package ships the same binary twice) are read once.
    const seen = new Set()
    const targets = found
      .filter((f) => f.sha256)
      .sort((a, b) => b.bytes - a.bytes || (a.path < b.path ? -1 : 1))
      .filter((f) => (seen.has(f.sha256) ? false : (seen.add(f.sha256), true)))
      .slice(0, bundleCount)

    for (const t of targets) {
      try {
        await harvestFile(t.abs, harvester)
        scannedBytes += t.bytes
        install.bundlesRead.push({ path: t.path, bytes: t.bytes })
      } catch {
        install.skipped.push({ path: t.path, bytes: t.bytes, reason: 'unreadable during harvest' })
      }
    }
  }

  const { strings, truncated } = harvester.finish()
  const config = captureConfig({ projectDir: opts.projectDir })

  const snap = {
    schema: SCHEMA,
    tool: 'argo drift',
    capturedAt: new Date().toISOString(),
    label: opts.label ?? null,
    platform: `${process.platform}-${process.arch}`,
    install,
    strings: { count: strings.length, scannedBytes, truncated, limit, items: strings },
    config,
  }
  snap.fingerprint = fingerprint(snap)
  snap.id = snapshotId(snap)
  return snap
}

/**
 * Content identity of a snapshot: install hashes, config hashes, prose.
 * Excludes the timestamp, so re-snapshotting an unchanged machine is a no-op
 * rather than a new file that diffs clean.
 */
export function fingerprint(snap) {
  const parts = [
    `v:${snap.install?.packageVersion ?? ''}|${snap.install?.cliVersion ?? ''}`,
    ...(snap.install?.files ?? []).map((f) => `f:${f.path}:${f.sha256}`),
    ...(snap.config?.entries ?? []).map((e) => `c:${e.path}:${e.sha256}`),
    `s:${sha256((snap.strings?.items ?? []).join('\n'))}`,
  ]
  return sha256(parts.join('\n'))
}

function snapshotId(snap) {
  const v = snap.install?.packageVersion ?? snap.install?.cliVersion ?? 'unknown'
  return `${String(v).replace(/[^\w.-]/g, '_')}-${snap.fingerprint.slice(0, 8)}`
}

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

/** Snapshots live beside the repo they were taken for, never outside it. */
export function storeDir(dir) {
  return join(resolve(dir ?? process.cwd()), '.argo', 'drift')
}

/** Write a snapshot. Returns its absolute path. */
export function saveSnapshot(dir, snap) {
  const store = storeDir(dir)
  mkdirSync(store, { recursive: true })
  const file = join(store, `${snap.id}.json`)
  writeFileSync(file, JSON.stringify(snap, null, 2) + '\n', 'utf8')
  return file
}

/** Every stored snapshot, newest first. Metadata only — strings stay on disk. */
export function listSnapshots(dir) {
  const store = storeDir(dir)
  if (!existsSync(store)) return []
  const rows = []
  for (const name of listNames(store)) {
    if (!name.endsWith('.json')) continue
    const file = join(store, name)
    try {
      const snap = readJson(file)
      rows.push({
        id: snap.id ?? name.replace(/\.json$/, ''),
        file,
        capturedAt: snap.capturedAt ?? '',
        label: snap.label ?? null,
        packageVersion: snap.install?.packageVersion ?? null,
        cliVersion: snap.install?.cliVersion ?? null,
        strings: snap.strings?.count ?? 0,
        fingerprint: snap.fingerprint ?? null,
      })
    } catch {
      // a half-written or hand-edited file should not break `list`
    }
  }
  return rows.sort(
    (a, b) => (a.capturedAt < b.capturedAt ? 1 : a.capturedAt > b.capturedAt ? -1 : a.id < b.id ? 1 : -1)
  )
}

/** Load a snapshot by store path. */
export function loadSnapshot(file) {
  return readJson(file)
}

/**
 * Resolve a user-supplied snapshot reference: `latest`, `previous`, an exact id,
 * or any unambiguous substring of one. Returns { row } or { error }.
 */
export function resolveRef(dir, ref) {
  const rows = listSnapshots(dir)
  if (rows.length === 0) return { error: 'no snapshots stored yet — run `argo drift snapshot` first' }
  const key = String(ref)
  if (key === 'latest') return { row: rows[0] }
  if (key === 'previous' || key === 'prev') {
    if (rows.length < 2) return { error: 'only one snapshot stored — nothing to compare against' }
    return { row: rows[1] }
  }
  const exact = rows.filter((r) => r.id === key || basename(r.file) === key)
  if (exact.length === 1) return { row: exact[0] }
  const partial = rows.filter((r) => r.id.includes(key))
  if (partial.length === 1) return { row: partial[0] }
  if (partial.length > 1) {
    return { error: `"${ref}" matches ${partial.length} snapshots: ${partial.map((r) => r.id).join(', ')}` }
  }
  return { error: `no snapshot matching "${ref}". stored: ${rows.map((r) => r.id).join(', ')}` }
}
