// stop-verify.js — Stop hook. When a turn ends, run the checks the project itself
// declares and report what they say. CommonJS, node built-ins only, no imports from any
// repo: this file is copied to ~/.claude/hooks on machines where its source tree does
// not exist.
//
// WHY THIS EXISTS.
// The failure it answers is a confident "done" with nothing behind it — tests described
// as passing that were never run, a claim of portability nobody executed, a warning
// stepped over. Every one of those is a sentence, not a result.
//
// WHY A HOOK AND NOT MORE ADVICE.
// Advisory text is read by the same turn that is already sure it is finished, so it
// changes nothing. A check that runs on its own and disagrees does. This hook does not
// argue about process; it runs the command and quotes the output.
//
// WHY IT IS NOT REDUNDANT WITH CI — do not delete it for that reason.
// CI answers after the fact: after a push, minutes later, to whoever is watching a
// pipeline. This answers before the claim reaches the reader, in the same seconds the
// claim is made, while the mistake is still cheap to undo.
//
// WHY IT REPORTS AND NEVER BLOCKS.
// Exit is always 0 and no `decision` is ever emitted. A Stop hook that blocks turns one
// false positive into a loop the user cannot escape, and a hook people fight is a hook
// people rip out. Everything below follows from that: silence when clean, silence when
// nothing changed, silence when a check cannot produce evidence. Output is rare, so
// output means something.
//
// UNIVERSAL BY CONSTRUCTION. Nothing here is specific to a project, a language, or a
// machine. The working directory comes from the hook payload, state lives in the OS temp
// directory, and a check runs only when the project positively declares it. Where
// detection is not certain, the hook says nothing rather than guessing a command.

'use strict'

const { spawnSync } = require('node:child_process')
const { existsSync, readFileSync, readdirSync, statSync, writeFileSync, writeSync } = require('node:fs')
const { createHash } = require('node:crypto')
const os = require('node:os')
const path = require('node:path')

const IS_WIN = process.platform === 'win32'
const START = Date.now()
const BUDGET_MS = 10000 // whole-hook ceiling; every per-command timeout derives from it
const MIN_SLICE_MS = 1500 // below this there is no point starting another command
const MAX_BUFFER = 4 * 1024 * 1024
const MAX_LINES = 5
const LINE_CAP = 160

const remaining = () => BUDGET_MS - (Date.now() - START)

const SOURCE_RE = /\.(m?[jt]sx?|cjs|cts|mts|py|rb|go|rs|java|kt|kts|swift|mm|c|h|cc|cpp|hpp|cs|php|ex|exs|erl|scala|sh|bash|ps1|lua|dart|sql|vue|svelte)$/i
const DOC_RE = /\.(md|mdx|markdown|txt|rst|adoc|log)$/i

// ── process helpers ─────────────────────────────────────────────────────────

// PATH is searched here rather than shelling out: `which` does not exist on Windows,
// `where` does not exist elsewhere, and neither is worth a subprocess.
const whichCache = new Map()
function which(cmd) {
  if (whichCache.has(cmd)) return whichCache.get(cmd)
  let found = null
  const exts = IS_WIN
    ? ['', ...String(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
    : ['']
  outer: for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const p = path.join(dir.replace(/^"|"$/g, ''), cmd + ext)
      try { if (statSync(p).isFile()) { found = p; break outer } } catch { /* unreadable PATH entry */ }
    }
  }
  whichCache.set(cmd, found)
  return found
}

/** A tool installed inside the project beats one on PATH, and is often the only copy. */
function localBin(dir, name) {
  const candidates = IS_WIN
    ? ['node_modules\\.bin\\' + name + '.cmd', '.venv\\Scripts\\' + name + '.exe', 'venv\\Scripts\\' + name + '.exe']
    : ['node_modules/.bin/' + name, '.venv/bin/' + name, 'venv/bin/' + name]
  for (const c of candidates) {
    const p = path.join(dir, c)
    try { if (statSync(p).isFile()) return p } catch { /* not installed */ }
  }
  return null
}

const quote = (s) => (/[\s&|<>^()"]/.test(s) ? '"' + String(s).replace(/"/g, '') + '"' : s)

/** Read-only spawn. Returns null rather than throwing; a hook must not crash the loop. */
function run(exe, args, cwd, timeout) {
  if (!(timeout >= MIN_SLICE_MS)) return null
  const opts = {
    cwd,
    timeout,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Colour codes and interactive prompts are noise in a captured buffer.
    env: Object.assign({}, process.env, { NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' }),
  }
  let r = null
  try {
    // A Windows .cmd/.bat shim (npm, npx, eslint, …) cannot be spawned directly since
    // Node closed CVE-2024-27980 — it needs a shell. Passing an args ARRAY together with
    // shell:true is deprecated (DEP0190), so on Windows the command is assembled as one
    // pre-quoted string, and everywhere else it stays argv with no shell at all.
    r = IS_WIN
      ? spawnSync([quote(exe)].concat(args.map(quote)).join(' '), Object.assign({}, opts, { shell: true }))
      : spawnSync(exe, args, Object.assign({}, opts, { shell: false }))
  } catch {
    return null
  }
  if (!r) return null
  const timedOut = (r.error && r.error.code === 'ETIMEDOUT') || (!!r.signal && r.status === null)
  if (r.error && !timedOut) return null // never launched — that is no evidence either way
  const stdout = String(r.stdout || '')
  return { timedOut, status: r.status, stdout, out: stdout + '\n' + String(r.stderr || '') }
}

const git = (args, cwd, ms) => {
  const exe = which('git')
  return exe ? run(exe, args, cwd, Math.min(ms || 4000, remaining())) : null
}

// ── check detection ─────────────────────────────────────────────────────────
// Every detector reads a check the project ALREADY declares, or the standard invocation
// of a tool the project has visibly adopted, and returns null when it is not certain.
// No detector invents a command. First match wins, so a language-native runner is
// preferred over a generic task runner in a repo that has both. To support another
// ecosystem, add a detector — nothing else in the file needs to change.

const readText = (p) => { try { return readFileSync(p, 'utf8') } catch { return '' } }

function nodeTest(dir) {
  const pkgPath = path.join(dir, 'package.json')
  if (!existsSync(pkgPath)) return null
  let pkg = null
  try { pkg = JSON.parse(readText(pkgPath).replace(/^\uFEFF/, '')) } catch { return null }
  const script = pkg && pkg.scripts && pkg.scripts.test
  if (typeof script !== 'string' || !script.trim()) return null
  // `npm init` writes a placeholder test script that always exits 1. Running it would
  // manufacture a failure the project never claimed to have.
  if (/no test specified/i.test(script)) return null
  const pm = existsSync(path.join(dir, 'pnpm-lock.yaml')) ? 'pnpm'
    : existsSync(path.join(dir, 'yarn.lock')) ? 'yarn'
      : (existsSync(path.join(dir, 'bun.lockb')) || existsSync(path.join(dir, 'bun.lock'))) ? 'bun'
        : 'npm'
  const exe = which(pm) || which('npm')
  if (!exe) return { missing: pm, reproduce: pm + ' run test' }
  const name = path.basename(exe).replace(/\.(cmd|exe|bat|ps1)$/i, '')
  return { exe, args: ['run', 'test'], reproduce: name + ' run test' }
}

function pythonTest(dir) {
  const declared = existsSync(path.join(dir, 'pytest.ini'))
    || /\[tool\.pytest/.test(readText(path.join(dir, 'pyproject.toml')))
    || /\[tool:pytest\]/.test(readText(path.join(dir, 'setup.cfg')))
    || /\[pytest\]/.test(readText(path.join(dir, 'tox.ini')))
  if (!declared) return null
  const exe = localBin(dir, 'pytest') || which('pytest')
  if (!exe) return { missing: 'pytest', reproduce: 'pytest' }
  return { exe, args: ['-q', '-x'], reproduce: 'pytest -q -x' }
}

function goTest(dir) {
  if (!existsSync(path.join(dir, 'go.mod'))) return null
  const exe = which('go')
  if (!exe) return { missing: 'go', reproduce: 'go test ./...' }
  return { exe, args: ['test', './...'], reproduce: 'go test ./...' }
}

function rustTest(dir) {
  if (!existsSync(path.join(dir, 'Cargo.toml'))) return null
  const exe = which('cargo')
  if (!exe) return { missing: 'cargo', reproduce: 'cargo test' }
  return { exe, args: ['test', '--quiet'], reproduce: 'cargo test' }
}

function elixirTest(dir) {
  if (!existsSync(path.join(dir, 'mix.exs'))) return null
  const exe = which('mix')
  if (!exe) return { missing: 'mix', reproduce: 'mix test' }
  return { exe, args: ['test'], reproduce: 'mix test' }
}

function dotnetTest(dir) {
  let entries = []
  try { entries = readdirSync(dir) } catch { return null }
  if (!entries.some((e) => /\.(sln|slnx|csproj|fsproj)$/i.test(e))) return null
  const exe = which('dotnet')
  if (!exe) return { missing: 'dotnet', reproduce: 'dotnet test' }
  return { exe, args: ['test', '--nologo', '--verbosity', 'quiet'], reproduce: 'dotnet test' }
}

function justTest(dir) {
  const f = ['justfile', 'Justfile', '.justfile'].map((n) => path.join(dir, n)).find(existsSync)
  if (!f || !/^test\b[^\n]*:/m.test(readText(f))) return null
  const exe = which('just')
  if (!exe) return { missing: 'just', reproduce: 'just test' }
  return { exe, args: ['test'], reproduce: 'just test' }
}

function makeTest(dir) {
  const f = ['Makefile', 'makefile', 'GNUmakefile'].map((n) => path.join(dir, n)).find(existsSync)
  if (!f || !/^test\s*:/m.test(readText(f))) return null
  const exe = which('make') || which('gmake')
  if (!exe) return { missing: 'make', reproduce: 'make test' }
  return { exe, args: ['test'], reproduce: 'make test' }
}

const TEST_DETECTORS = [nodeTest, pythonTest, goTest, rustTest, elixirTest, dotnetTest, justTest, makeTest]

// Linters run only over the files that actually changed — fast, and scoped to the claim
// being made. Both are config-gated: no config, no lint. Both exit non-zero only on
// errors, so a style warning never produces output here.
function lintCheck(dir, files) {
  // Relative only where it is genuinely shorter. The payload's directory and git's root
  // can spell the same place differently (a Windows 8.3 short name against the long one),
  // and path.relative then walks all the way up and back down — an argument that works but
  // is unreadable in a reproduce line.
  const rel = (f) => {
    const r = path.relative(dir, f)
    return (!r || r.startsWith('..')) ? f : r
  }
  const js = files.filter((f) => /\.(m?[jt]sx?|cjs|cts|mts|vue|svelte)$/i.test(f))
  if (js.length) {
    const cfg = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts',
      '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml']
      .some((n) => existsSync(path.join(dir, n)))
    const exe = cfg ? localBin(dir, 'eslint') : null // locally installed only: never fetch one
    if (exe) return { exe, args: js.map(rel), reproduce: 'eslint ' + js.slice(0, 3).map(rel).join(' ') }
  }
  const py = files.filter((f) => /\.pyi?$/i.test(f))
  if (py.length) {
    const cfg = existsSync(path.join(dir, 'ruff.toml')) || existsSync(path.join(dir, '.ruff.toml'))
      || /\[tool\.ruff/.test(readText(path.join(dir, 'pyproject.toml')))
    const exe = cfg ? (localBin(dir, 'ruff') || which('ruff')) : null
    if (exe) return { exe, args: ['check'].concat(py.map(rel)), reproduce: 'ruff check ' + py.slice(0, 3).map(rel).join(' ') }
  }
  return null
}

// ── reporting ───────────────────────────────────────────────────────────────

const strip = (s) => String(s).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')

/** The first few lines that look like the failure itself, else the tail (the summary). */
function evidence(out) {
  const lines = strip(out).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const hot = lines.filter((l) => /(^|\s)(fail(ed|ing|ures?)?|errors?|assert\w*|not ok|panicked|traceback|✕|✗|×)(\s|:|$)/i.test(l))
  return (hot.length ? hot : lines.slice(-MAX_LINES))
    .slice(0, MAX_LINES)
    .map((l) => (l.length > LINE_CAP ? l.slice(0, LINE_CAP - 1) + '…' : l))
}

// `systemMessage` is the common field every hook event supports and is surfaced to the
// reader; `additionalContext` carries the same text to the model. Neither can block, and
// `decision` is deliberately absent. Unrecognised fields are dropped rather than
// rejected, so emitting both is safe across Claude Code versions.
function emit(message) {
  try {
    writeSync(1, JSON.stringify({ systemMessage: message, additionalContext: message }) + '\n')
  } catch { /* stdout closed */ }
}

// ── main ────────────────────────────────────────────────────────────────────

function main() {
  let payload = {}
  try { payload = JSON.parse(readFileSync(0, 'utf8') || '{}') || {} } catch { payload = {} }

  const cwd = (typeof payload.cwd === 'string' && payload.cwd && existsSync(payload.cwd))
    ? payload.cwd
    : process.cwd()

  // No git means no baseline, and no way to tell a change from the status quo. Every
  // directory that is not a repository exits here, silently.
  const status = git(['-c', 'core.quotePath=false', 'status', '--porcelain'], cwd)
  if (!status || status.timedOut || status.status !== 0) return

  // Trailing whitespace only. Porcelain lines are `XY<space>path`, and X is a space for
  // a modified-but-unstaged file — a plain .trim() would eat the first line's leading
  // space and silently shift every path in it by one character.
  const porcelain = status.stdout.replace(/\s+$/, '')
  if (!porcelain.trim()) return // nothing changed, so there is no claim to verify

  const top = git(['rev-parse', '--show-toplevel'], cwd)
  const root = (top && top.status === 0 && top.out.trim().split(/\r?\n/)[0]) || cwd
  const head = git(['rev-parse', 'HEAD'], cwd) // fails in a repo with no commits yet
  const headSha = (head && head.status === 0 && head.out.trim()) || ''

  // Porcelain paths are relative to the repository root, whatever directory git ran in.
  const changed = porcelain.split(/\r?\n/).map((line) => {
    const p = line.slice(3).trim()
    const renamed = p.includes(' -> ') ? p.slice(p.indexOf(' -> ') + 4) : p
    return renamed ? path.join(root, renamed.replace(/^"|"$/g, '')) : ''
  }).filter(Boolean)

  // Cache. A given tree is verified once: re-running an unchanged tree every turn burns
  // seconds on a result already known, and repeating a message the reader has already
  // seen is nagging rather than evidence.
  //
  // The key has to cover the CONTENT of the change, not just its shape. Porcelain lists
  // paths and status letters only, so a second edit to an already-modified file leaves it
  // byte for byte identical — key on that alone and that edit is never checked. Size and
  // mtime per changed path cost no subprocess and do move.
  const sig = changed.slice(0, 500).map((f) => {
    try { const s = statSync(f); return f + ':' + s.size + ':' + s.mtimeMs } catch { return f + ':-' }
  }).join('\n')
  const key = createHash('sha1').update(root + ' ' + headSha + ' ' + porcelain + ' ' + sig).digest('hex')
  const statePath = path.join(
    os.tmpdir(),
    'claude-stop-verify-' + createHash('sha1').update(root).digest('hex').slice(0, 16) + '.json'
  )
  try {
    if (JSON.parse(readFileSync(statePath, 'utf8')).key === key) return
  } catch { /* no prior state, or unreadable — treat as a first run */ }
  const remember = () => {
    try { writeFileSync(statePath, JSON.stringify({ key, at: new Date().toISOString() })) } catch { /* read-only tmp */ }
  }

  const sourceFiles = changed.filter((f) => SOURCE_RE.test(f))
  // A documentation-only turn has nothing a test suite can speak to.
  if (!sourceFiles.length && changed.every((f) => DOC_RE.test(f))) return remember()

  // A turn can happen below the repository root, so the closest manifest wins.
  const dirs = [...new Set([cwd, root])]
  let dir = null
  let test = null
  for (const d of dirs) {
    for (const detect of TEST_DETECTORS) {
      let hit = null
      try { hit = detect(d) } catch { hit = null }
      if (hit) { dir = d; test = hit; break }
    }
    if (test) break
  }

  const findings = []

  if (test && test.exe) {
    const r = run(test.exe, test.args, dir, Math.min(remaining() - 1500, 8000))
    if (r && r.timedOut) {
      // A killed command proves nothing. Report it as unverified, never as a failure.
      findings.push(test.reproduce + ' did not finish inside the hook time budget, so this change is unverified.'
        + '\n  Reproduce: ' + test.reproduce + '  (in ' + dir + ')')
    } else if (r && r.status !== 0) {
      const lines = evidence(r.out)
      findings.push(test.reproduce + ' exited ' + r.status
        + (lines.length ? '\n    ' + lines.join('\n    ') : '')
        + '\n  Reproduce: ' + test.reproduce + '  (in ' + dir + ')')
    } else if (r && r.status === 0 && remaining() > MIN_SLICE_MS + 500) {
      let lint = null
      try { lint = lintCheck(dir, sourceFiles) } catch { lint = null }
      if (lint) {
        const lr = run(lint.exe, lint.args, dir, Math.min(remaining() - 1000, 5000))
        if (lr && !lr.timedOut && lr.status !== 0) {
          const lines = evidence(lr.out)
          findings.push('lint errors in the changed files'
            + (lines.length ? '\n    ' + lines.join('\n    ') : '')
            + '\n  Reproduce: ' + lint.reproduce + '  (in ' + dir + ')')
        }
      }
    }
  } else if (test && test.missing && sourceFiles.length) {
    // The grounded form of "claimed without evidence": the project declares a check, this
    // turn edited source, and the runner is absent — so nothing verified the change. With
    // no declared check, or no source touched, there is nothing actionable and this stays
    // quiet rather than nagging.
    findings.push(sourceFiles.length + ' source file(s) changed and this project declares `' + test.reproduce
      + '`, but `' + test.missing + '` is not on PATH here, so nothing verified the change.'
      + '\n  Reproduce: ' + test.reproduce + '  (in ' + dir + ')')
  }

  remember()
  if (findings.length) emit('stop-verify — ' + findings.join('\n\n'))
}

// The exit code is always 0: nothing above throws out of the hook, and no blocking
// decision is ever emitted.
try { main() } catch { /* a hook that throws is worse than no hook */ }
