#!/usr/bin/env node
// install.mjs — set up this entire Claude global config on a machine that has nothing.
//
//   node tools/install.mjs                 full install
//   node tools/install.mjs --dry-run       show every action, change nothing
//   node tools/install.mjs --skip-library  skip cloning the Tier-3 skill library (~200MB)
//   node tools/install.mjs --skip-npm      skip global npm packages
//   node tools/install.mjs --only=config   run one phase: config|skills|hooks|deps|npm|mcp|library|argo
//   node tools/install.mjs --only=config,hooks,skills,deps   several (what the auto-update hook re-applies)
//
// Idempotent: re-running is safe and repairs drift. Never touches .credentials.json,
// and merges settings.json rather than overwriting it.
//
// This config wins. A skill directory already present under a name this repo ships — an
// older copy, a hand-made one, another package's — is moved aside (kept under
// <config>/.cgc-replaced) and replaced by the link, and a plugin known to shadow what ships
// here is disabled in settings.json. Both are reversible in one move; neither is silent.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync, lstatSync, symlinkSync, cpSync, realpathSync, renameSync } from 'node:fs'
import { join, dirname, relative, basename } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { REPO, HOME, IS_WIN, CONFIG_ROOT, CLAUDE_JSON, buildVars, realize, unresolved } from './paths.mjs'
import { spawnPlan, onPath } from '../argo/src/spawn.js'

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const ONLY = new Set(((args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '').split(',').filter(Boolean))
const SKIP = new Set(args.filter((a) => a.startsWith('--skip-')).map((a) => a.replace('--skip-', '')))
const vars = buildVars()

const results = []
let failures = 0

const say = (m) => console.log(m)
const phase = (n) => say(`\n\x1b[1m── ${n} ${'─'.repeat(Math.max(0, 58 - n.length))}\x1b[0m`)
const ok = (m) => { say(`  \x1b[32mok\x1b[0m    ${m}`); results.push(['ok', m]) }
const skip = (m) => { say(`  \x1b[90mskip\x1b[0m  ${m}`); results.push(['skip', m]) }
const warn = (m) => { say(`  \x1b[33mwarn\x1b[0m  ${m}`); results.push(['warn', m]) }
const fail = (m) => { say(`  \x1b[31mFAIL\x1b[0m  ${m}`); results.push(['fail', m]); failures++ }
const wants = (p) => !ONLY.size || ONLY.has(p)

// Launch without a shell. On Windows a bare name like `npm` is really `npm.cmd`, and node
// resolves only .com/.exe for a bare name — so `npm` gives ENOENT while `npm.cmd` gives
// EINVAL (node refuses to exec a .cmd directly since the 2024 argument-injection CVE).
// argo/src/spawn.js already solves this: resolve the real shim via PATH+PATHEXT, then
// route .cmd/.bat through cmd.exe as its own argv entry, refusing any argument cmd.exe
// would reinterpret rather than trying to out-quote two parsers at once.
function run(cmd, argv, opts = {}) {
  if (DRY) { say(`  [dry] ${cmd} ${argv.join(' ')}`); return { status: 0, stdout: '' } }
  let file = String(cmd)
  if (IS_WIN && !/[\\/]/.test(file)) file = onPath(file) || file
  const plan = spawnPlan(file, argv)
  if (plan.unsafe !== null) {
    return { status: 1, stdout: '', stderr: `refusing to run via shim: argument would be reparsed by cmd.exe (${plan.unsafe})` }
  }
  return spawnSync(plan.file, plan.args, { encoding: 'utf8', timeout: opts.timeout ?? 300000, shell: false, ...opts })
}

/** Windows paths compare case-insensitively; realpathSync keeps the case it was given. */
const samePath = (a, b) => (IS_WIN ? a.toLowerCase() === b.toLowerCase() : a === b)

/** Cross-platform directory link. Windows junctions need no admin rights; POSIX uses symlinks.
 *  An existing entry that does not resolve to `target` is a foreign copy under our name; it
 *  would shadow the repo's version on every session, so it is moved aside and replaced. */
function linkDir(target, linkPath) {
  let replaced = ''
  // lstat, not existsSync: existsSync follows the link, so a dangling junction reads as absent,
  // mklink then fails on it, and the copy fallback crashed the whole installer.
  let present = false
  try { lstatSync(linkPath); present = true } catch { /* nothing there */ }
  if (present) {
    let same = false
    try { same = samePath(realpathSync(linkPath), realpathSync(target)) } catch { /* a dangling link: replace it */ }
    if (same) return 'exists'
    if (DRY) return 'would replace'
    const aside = join(CONFIG_ROOT, '.cgc-replaced', `${basename(linkPath)}-${Date.now()}`)
    mkdirSync(dirname(aside), { recursive: true })
    // Move it aside; if that fails, COPY it aside and only then remove it. Nothing of the
    // user's is deleted before a copy exists, and the message never names a copy that is not there.
    try { renameSync(linkPath, aside) } catch {
      try { cpSync(linkPath, aside, { recursive: true }); rmSync(linkPath, { recursive: true, force: true }) } catch (e) {
        return `failed: ${linkPath} could not be moved aside (${e.message}) — left in place, not linked`
      }
    }
    replaced = ` — replaced; the previous copy is at ${aside}`
  }
  if (DRY) return 'dry'
  mkdirSync(dirname(linkPath), { recursive: true })
  try {
    if (IS_WIN) {
      const r = spawnSync('cmd', ['/c', 'mklink', '/J', linkPath, target], { encoding: 'utf8' })
      if (r.status !== 0) throw new Error(r.stderr || r.stdout)
    } else {
      symlinkSync(target, linkPath, 'dir')
    }
    return 'linked' + replaced
  } catch (e) {
    // Fall back to a copy — a working config beats a clever one.
    try { cpSync(target, linkPath, { recursive: true }); return 'copied' + replaced } catch { return `failed: ${e.message}` }
  }
}

// Plugins that shadow what this config ships. Disabled in settings.json, not uninstalled —
// one key flips it back. open-design vendors stale copies of eleven official Anthropic skills
// under the same names, so with it enabled the real ones never load.
const SHADOWING_PLUGINS = ['open-design']

say(`\n\x1b[1mClaude Global Config\x1b[0m`)
say(`  repo   ${REPO}`)
say(`  target ${CONFIG_ROOT}`)
say(`  node   ${vars.NODE}`)
if (DRY) say(`  \x1b[33mDRY RUN — nothing will be written\x1b[0m`)

// ── 0. Prerequisites ────────────────────────────────────────────────────────
phase('Prerequisites')
{
  const major = Number(process.versions.node.split('.')[0])
  if (major >= 20) ok(`node ${process.versions.node}`)
  else fail(`node ${process.versions.node} — need 20+ (node:sqlite and --env-file are used)`)

  const git = run(IS_WIN ? 'where' : 'which', ['git'])
  if (git.status === 0) ok('git present')
  else warn('git not found — the Tier-3 library cannot be fetched (everything else still installs)')

  if (IS_WIN && !DRY) {
    // Long paths bite the biggest library repos on Windows. Set it for git; the OS
    // registry flag is a system setting and is left to the user.
    run('git', ['config', '--global', 'core.longpaths', 'true'])
    ok('git core.longpaths enabled (Windows MAX_PATH guard)')
  }
  // Wire the repo pre-commit gate. .githooks/pre-commit runs the secret scanner, but git
  // ignores it unless core.hooksPath points there — so without this the gate existed only
  // where someone had configured it by hand, while the docs claimed it always ran.
  if (!DRY && existsSync(join(REPO, '.githooks', 'pre-commit'))) {
    const r = run('git', ['config', 'core.hooksPath', '.githooks'], { cwd: REPO })
    r.status === 0 ? ok('pre-commit secret-scan gate wired (core.hooksPath)')
      : warn('could not set core.hooksPath — run: git config core.hooksPath .githooks')
  }
  // --dry-run must change nothing, including creating the target directory.
  if (!DRY) mkdirSync(CONFIG_ROOT, { recursive: true })
}

// ── 1. Mandate files ────────────────────────────────────────────────────────
if (wants('config')) {
  phase('Config — mandates')
  for (const name of ['CLAUDE.md', 'ui-design-stack.md', 'react-tooling-stack.md', 'security-stack.md']) {
    const src = join(REPO, 'config', name)
    if (!existsSync(src)) { warn(`${name} missing from repo`); continue }
    const text = realize(readFileSync(src, 'utf8'), vars)
    const left = unresolved(text)
    if (left.length) warn(`${name} has unresolved tokens: ${left.join(', ')}`)
    const dest = join(CONFIG_ROOT, name)
    // CLAUDE.md may hold the user's own notes. The shipped file ends with a marker; anything
    // a user writes below it survives every update. A file that is already there WITHOUT the
    // marker is the user's own — it is kept, never overwritten and lost.
    if (name === 'CLAUDE.md') {
      const MARK = '<!-- user-additions-below -->'
      const body = text.includes(MARK) ? text : text.trimEnd() + '\n\n' + MARK + '\n'
      if (existsSync(dest)) {
        const cur = readFileSync(dest, 'utf8')
        if (cur.includes(MARK)) {
          const keep = cur.slice(cur.indexOf(MARK) + MARK.length)
          if (!DRY) writeFileSync(dest, body.trimEnd() + '\n' + keep.replace(/^\s*\n/, '\n'), 'utf8')
          ok(`${name} (user additions below the marker preserved)`); continue
        }
        const aside = join(CONFIG_ROOT, '.cgc-replaced', `CLAUDE.md-${Date.now()}`)
        if (!DRY) { mkdirSync(dirname(aside), { recursive: true }); cpSync(dest, aside) }
        if (!DRY) writeFileSync(dest, body, 'utf8')
        ok(`${name} — the existing file had no marker; it is kept at ${aside}, and anything you add below the marker in the new one survives updates`)
        continue
      }
      if (!DRY) writeFileSync(dest, body, 'utf8')
      ok(name); continue
    }
    if (!DRY) writeFileSync(dest, text, 'utf8')
    ok(name)
  }
}

// ── 2. Hooks ────────────────────────────────────────────────────────────────
if (wants('hooks')) {
  phase('Config — hooks')
  const hooksDir = join(CONFIG_ROOT, 'hooks')
  if (!DRY) mkdirSync(hooksDir, { recursive: true })
  // Hooks are collected from three places into ONE directory. They must all live under
  // {{CONFIG_ROOT}}: a hook registered at a path outside it (in a plugin dir, say) is dead
  // on any machine that does not happen to have that exact path.
  const hookSources = [
    join(REPO, 'config', 'hooks'),
    join(REPO, 'argo', 'plugin', 'hooks'),
    join(REPO, 'skills', 'visual-design-mastery', 'hooks'),
  ]
  for (const srcDir of hookSources) {
    if (!existsSync(srcDir)) continue
    for (const f of readdirSync(srcDir).filter((f) => /\.(js|mjs|cjs)$/.test(f))) {
      // FORWARD slashes, always. A Windows path substituted into a JS string literal
      // gets read as escapes: "C:\Users\npm" becomes "C:Users" + a newline + "pm".
      // Node accepts forward slashes on Windows, so this is safe and unambiguous.
      const dest = join(hooksDir, f)
      const text = realize(readFileSync(join(srcDir, f), 'utf8'), vars, { slash: 'forward' })
      if (!DRY) {
        writeFileSync(dest, text, 'utf8')
        // A hook with a syntax error fails silently at runtime. Catch it at install.
        const chk = run(vars.NODE, ['--check', dest], { timeout: 20000 })
        if (chk.status !== 0) {
          fail(`hooks/${f} does not parse — ${String(chk.stderr || '').split('\n')[1] || 'syntax error'}`)
          continue
        }
      }
      ok(`hooks/${f}`)
    }
  }

  // Merge hook registrations into settings.json without clobbering anything else.
  const hooksManifest = join(REPO, 'config', 'hooks.json')
  const settingsPath = join(CONFIG_ROOT, 'settings.json')
  if (existsSync(hooksManifest)) {
    // Parse FIRST, then substitute into the parsed values. Substituting into the raw JSON
    // text injects unescaped Windows backslashes and produces invalid JSON.
    const parsed = JSON.parse(readFileSync(hooksManifest, 'utf8')).hooks || {}
    const incoming = Object.fromEntries(Object.entries(parsed).map(([event, groups]) => [
      event,
      groups.map((g) => ({ ...g, hooks: (g.hooks || []).map((h) => ({ ...h, command: realize(String(h.command), vars) })) })),
    ]))
    let settings = {}
    if (existsSync(settingsPath)) {
      try { settings = JSON.parse(readFileSync(settingsPath, 'utf8').replace(/^﻿/, '')) }
      catch { fail('settings.json is not valid JSON — fix it before installing, refusing to overwrite'); settings = null }
    }
    if (settings) {
      settings.hooks ??= {}
      let added = 0, kept = 0
      for (const [event, groups] of Object.entries(incoming)) {
        settings.hooks[event] ??= []
        for (const g of groups) {
          // A group's `matcher` scopes the hook to specific tools. Always writing into
          // group[0] silently DROPPED it, so a PostToolUse hook meant for Write|Edit fired
          // on every Read and every Bash call instead. Match the destination group by its
          // matcher so the scope survives, and create the group when it does not exist.
          const wanted = g.matcher ?? null
          let bucket = settings.hooks[event].find((x) => (x.matcher ?? null) === wanted)
          if (!bucket) {
            bucket = wanted ? { matcher: wanted, hooks: [] } : { hooks: [] }
            settings.hooks[event].push(bucket)
          }
          bucket.hooks ??= []
          for (const h of g.hooks || []) {
            // Identify a hook by its script basename, so re-installs update rather than duplicate.
            const base = (String(h.command).match(/([\w.-]+\.(?:js|mjs|cjs))/) || [])[1]
            // A hook can only live in one group; if it was previously registered under a
            // different matcher, remove it there before adding it here, or it fires twice.
            for (const other of settings.hooks[event]) {
              if (other === bucket || !base) continue
              const stale = (other.hooks || []).findIndex((x) => String(x.command).includes(base))
              if (stale >= 0) other.hooks.splice(stale, 1)
            }
            const idx = bucket.hooks.findIndex((x) => base && String(x.command).includes(base))
            if (idx >= 0) { bucket.hooks[idx] = h; kept++ } else { bucket.hooks.push(h); added++ }
          }
        }
      }
      // Drop any group this merge emptied, so settings.json does not accrete husks.
      for (const event of Object.keys(settings.hooks)) {
        settings.hooks[event] = settings.hooks[event].filter((g) => (g.hooks || []).length > 0)
      }
      const disabled = []
      for (const [key, on] of Object.entries(settings.enabledPlugins || {})) {
        if (on && SHADOWING_PLUGINS.includes(key.split('@')[0])) { settings.enabledPlugins[key] = false; disabled.push(key) }
      }
      if (!DRY) writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8')
      ok(`settings.json merged — ${added} added, ${kept} updated, other settings untouched`)
      if (disabled.length) ok(`disabled shadowing plugin(s): ${disabled.join(', ')} (set enabledPlugins back to true to undo)`)
    }
  }
}

// ── 3. Skills ───────────────────────────────────────────────────────────────
if (wants('skills')) {
  phase('Skills')
  const skillsDir = join(CONFIG_ROOT, 'skills')
  if (!DRY) mkdirSync(skillsDir, { recursive: true })

  // Skills this repo authors.
  const owned = join(REPO, 'skills')
  if (existsSync(owned)) {
    for (const name of readdirSync(owned)) {
      if (!existsSync(join(owned, name, 'SKILL.md'))) continue
      const r = linkDir(join(owned, name), join(skillsDir, name))
      if (r === 'exists') skip(`${name} (already installed)`)
      else if (r.startsWith('failed')) fail(`${name}: ${r}`)
      else ok(`${name} (${r})`)
    }
  }

  // Saved workflows: multi-agent procedures that are too structural to live in a skill.
  // design-divergence is the mechanism behind creative-divergence -- N blind workers, one
  // operator each, adversarial genericness scoring. Prose alone cannot enforce that.
  const wfSrc = join(REPO, 'workflows')
  if (existsSync(wfSrc)) {
    const wfDest = join(CONFIG_ROOT, 'workflows')
    if (!DRY) mkdirSync(wfDest, { recursive: true })
    let n = 0
    for (const f of readdirSync(wfSrc).filter((f) => /.(js|mjs)$/.test(f))) {
      if (!DRY) writeFileSync(join(wfDest, f), realize(readFileSync(join(wfSrc, f), 'utf8'), vars, { slash: 'forward' }), 'utf8')
      n++
    }
    ok(`workflows installed (${n})`)
  }
  // argo's skills, agents and commands are NOT linked here. They are delivered by the
  // argonaut plugin (see the argo phase). Doing both double-loads all 22 of its
  // components into every session for no benefit.
  skip('argo skills — delivered by the argonaut plugin, not loose-linked')
}

// ── 4. argo CLI ─────────────────────────────────────────────────────────────
if (wants('argo')) {
  phase('argo — graph engineering toolkit')
  const argoDir = join(REPO, 'argo')
  if (!existsSync(join(argoDir, 'package.json'))) { warn('argo/package.json missing'); }
  else {
    const r = run('npm', ['link'], { cwd: argoDir })
    if (r.status === 0 || DRY) ok('argo linked globally (`argo graph .`, `argo diverge`, `argo drift`)')
    else warn(`npm link failed: ${String(r.stderr || '').split('\n')[0]} — run 'npm link' in ${argoDir} manually`)

    // Register argo as a proper local marketplace plugin rather than scattering its
    // skills, agents and commands as loose files. The plugin route gives namespacing,
    // a real uninstall, and one source of truth — copies in ~/.claude would shadow the
    // repo and drift. Its 22 components cost ~1,559 tokens always-on.
    const claudeBin = IS_WIN
      ? join(HOME, '.local', 'bin', 'claude.exe')
      : join(HOME, '.local', 'bin', 'claude')
    const cli = existsSync(claudeBin) ? claudeBin : 'claude'
    if (!existsSync(join(argoDir, '.claude-plugin', 'marketplace.json'))) {
      warn('argo/.claude-plugin/marketplace.json missing — cannot register as a plugin')
    } else {
      const add = run(cli, ['plugin', 'marketplace', 'add', argoDir], { timeout: 120000 })
      const addOut = String(add.stdout || '') + String(add.stderr || '')
      if (add.status === 0 || /already/i.test(addOut) || DRY) ok('marketplace argonaut-local registered')
      else warn(`marketplace add failed: ${addOut.split('\n')[0]}`)

      const inst = run(cli, ['plugin', 'install', 'argonaut@argonaut-local'], { timeout: 120000 })
      const instOut = String(inst.stdout || '') + String(inst.stderr || '')
      if (inst.status === 0 || /already/i.test(instOut) || DRY) {
        ok('argonaut plugin installed — 22 skills, 3 agents, 2 hooks')
      } else warn(`plugin install failed: ${instOut.split('\n')[0]} — run: claude plugin install argonaut@argonaut-local`)
    }
  }
}

// ── 4b. Repo dependencies ───────────────────────────────────────────────────
// The one runtime dependency the tools carry (fontkit, for outline-text) lives in the repo's
// own package.json and installs into its node_modules. Run only when it is absent, so an
// offline session start does not wait on the registry.
if (wants('deps')) {
  phase('Repo dependencies')
  const deps = Object.keys(JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).dependencies || {})
  const missing = deps.filter((d) => !existsSync(join(REPO, 'node_modules', d)))
  if (!deps.length) skip('no dependencies declared')
  else if (!missing.length) skip(`dependencies present (${deps.join(', ')})`)
  else {
    const r = run('npm', ['i', '--no-audit', '--no-fund'], { cwd: REPO, timeout: 180000 })
    r.status === 0 || DRY ? ok(`installed ${missing.join(', ')}`) : warn(`npm i failed in ${REPO} — outline-text needs fontkit; run npm i there`)
  }
}

// ── 4c. The design toolkit on PATH ───────────────────────────────────────────
// Without this, every command the skills name — `cgc lint`, `cgc audit`, `cgc render` — is a
// command the machine does not have, and the gates silently never run outside this repository.
// That is not a convenience: it is the difference between a mandate that is checked and one
// that is decoration.
if (wants('deps')) {
  phase('Design toolkit on PATH')
  const already = run(IS_WIN ? 'where' : 'which', ['cgc'])
  if (already.status === 0 && !DRY) skip('cgc already on PATH')
  else {
    const r = run('npm', ['link'], { cwd: REPO, timeout: 180000 })
    if (r.status === 0 || DRY) ok('cgc linked globally — `cgc lint`, `cgc audit`, `cgc render`, `cgc print` work in any project')
    else warn(`npm link failed in ${REPO} — the skills' commands will not resolve elsewhere. `
      + `Run 'npm link' there by hand, or invoke the tools as node "${join(REPO, 'tools', 'cgc.mjs')}" <command>.`)
  }
}

// ── 5. Global npm packages ──────────────────────────────────────────────────
if (wants('npm') && !SKIP.has('npm')) {
  phase('Global npm packages')
  const pkgs = [
    ['eslint', 'eslint'], ['react-scan', 'react-scan'], ['react-doctor', 'react-doctor'],
  ]
  for (const [bin, pkg] of pkgs) {
    const found = run(IS_WIN ? 'where' : 'which', [bin])
    if (found.status === 0) { skip(`${bin} already on PATH`); continue }
    const r = run('npm', ['i', '-g', pkg], { timeout: 300000 })
    r.status === 0 || DRY ? ok(`installed ${pkg}`) : warn(`could not install ${pkg}`)
  }
} else if (wants('npm')) skip('global npm packages (--skip-npm)')

// ── 6. MCP servers (local only — no external auth anywhere) ─────────────────
if (wants('mcp')) {
  phase('MCP servers — local only')
  const mcpRoot = join(REPO, 'library', 'mcp-servers')
  mkdirSync(mcpRoot, { recursive: true })
  if (!existsSync(join(mcpRoot, 'package.json')) && !DRY) {
    writeFileSync(join(mcpRoot, 'package.json'), JSON.stringify({ name: 'claude-global-mcp', private: true, version: '1.0.0' }, null, 2) + '\n')
  }
  const servers = ['@playwright/mcp', '@upstash/context7-mcp']
  const r = run('npm', ['i', '--no-audit', '--no-fund', ...servers], { cwd: mcpRoot, timeout: 420000 })
  if (r.status === 0 || DRY) ok(`installed ${servers.join(', ')}`)
  else warn('MCP server install failed — run npm i in library/mcp-servers')

  const cfgPath = CLAUDE_JSON
  if (existsSync(cfgPath) && !DRY) {
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8').replace(/^﻿/, ''))
      cfg.mcpServers ??= {}
      const entries = {
        playwright: join(mcpRoot, 'node_modules', '@playwright', 'mcp', 'cli.js'),
        context7: join(mcpRoot, 'node_modules', '@upstash', 'context7-mcp', 'dist', 'index.js'),
      }
      let n = 0
      for (const [name, entry] of Object.entries(entries)) {
        if (!existsSync(entry)) { warn(`${name} entry not found, skipping registration`); continue }
        // Pin the node binary: relying on PATH is how MCP servers silently die.
        cfg.mcpServers[name] = { command: vars.NODE, args: [entry], env: {} }
        n++
      }
      writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
      ok(`registered ${n} MCP server(s), node pinned to ${vars.NODE}`)
    } catch (e) { warn(`could not update .claude.json: ${e.message}`) }
  } else if (!existsSync(cfgPath)) {
    warn('~/.claude.json not found — launch Claude Code once, then re-run with --only=mcp')
  }
}

// ── 7. Tier-3 skill library ─────────────────────────────────────────────────
if (wants('library') && !SKIP.has('library')) {
  phase('Tier-3 skill library')
  const srcFile = join(REPO, 'library', 'sources.json')
  if (!existsSync(srcFile)) warn('library/sources.json missing')
  else {
    const sources = JSON.parse(readFileSync(srcFile, 'utf8'))
    const root = vars.LIBRARY_ROOT
    mkdirSync(root, { recursive: true })
    for (const s of sources.repos.filter((r) => !r.rejected)) {
      const dest = join(root, s.name)
      if (existsSync(join(dest, '.git'))) { skip(`${s.name} (already cloned)`); continue }
      const r = run('git', ['clone', '--depth', '1', '-q', s.url, dest], { timeout: 420000 })
      r.status === 0 || DRY ? ok(`cloned ${s.name}`) : warn(`clone failed: ${s.name}`)
    }
    const idx = join(REPO, 'library', 'build-index.mjs')
    if (existsSync(idx)) {
      const r = run(vars.NODE, [idx], { env: { ...process.env, LIBRARY_ROOT: root } })
      r.status === 0 || DRY ? ok('index rebuilt') : warn('index build failed')
    }
    // Tier-2 residents: the 12 skills that earn a place in every session.
    const t2 = sources.tier2 || []
    let n = 0
    for (const s of t2) {
      const target = join(root, ...s.path.split('/'))
      if (!existsSync(target)) { warn(`tier-2 skill missing: ${s.name}`); continue }
      const r = linkDir(target, join(CONFIG_ROOT, 'skills', s.name))
      if (r.startsWith('failed')) fail(`${s.name}: ${r}`)
      else if (r !== 'exists') n++
    }
    ok(`tier-2 skills linked (${n} new, ${t2.length} total)`)
  }
} else if (wants('library')) skip('Tier-3 library (--skip-library)')

// ── Summary ─────────────────────────────────────────────────────────────────
const counts = results.reduce((a, [k]) => ({ ...a, [k]: (a[k] || 0) + 1 }), {})
say(`\n\x1b[1m── Summary ${'─'.repeat(52)}\x1b[0m`)
say(`  ${counts.ok || 0} ok · ${counts.skip || 0} skipped · ${counts.warn || 0} warnings · ${counts.fail || 0} failed`)
if (failures) { say(`\n  \x1b[31mInstall incomplete.\x1b[0m Fix the failures above and re-run.`); process.exit(1) }
say(`\n  Next: \x1b[1mnode tools/doctor.mjs\x1b[0m to verify, then restart Claude Code.`)
