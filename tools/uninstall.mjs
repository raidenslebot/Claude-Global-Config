#!/usr/bin/env node
// uninstall.mjs — undo install.mjs. Removes what this repo put on the machine, nothing else.
//
//   node tools/uninstall.mjs                          DRY RUN (default) — prints every change, writes nothing
//   node tools/uninstall.mjs --dry-run                the same thing, said out loud
//   node tools/uninstall.mjs --yes                    actually remove
//   node tools/uninstall.mjs --yes --purge-library    also delete the cloned Tier-3 repos (~200MB)
//
// The dry run is the DEFAULT on purpose. Read the list, then opt in with --yes.
//
// NEVER TOUCHED, under any flag:
//   ~/.claude/.credentials.json      live OAuth access + refresh tokens
//   ~/.claude/history.jsonl          your prompt history
//   ~/.claude/projects/              per-project session state
//   ~/.claude/todos/                 your todo lists
//   ~/.claude/settings.local.json    and every key in settings.json this repo did not add
//   ~/.claude/skills/<name>          when it is a REAL directory rather than one of our links
//   CLAUDE.md below the <!-- user-additions-below --> marker
//
// The removal list is DERIVED from the repo — config/*.md, the three hook source
// directories, config/hooks.json, library/sources.json, argo's marketplace manifest — so it
// cannot drift into a guess, and it can never widen into "wipe ~/.claude".

import { renameSync,
  readFileSync, writeFileSync, existsSync, readdirSync, statSync, lstatSync,
  rmSync, rmdirSync, mkdirSync, copyFileSync,
} from 'node:fs'
import { join, basename, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { spawnPlan, onPath } from '../argo/src/spawn.js'
import { REPO, HOME, IS_WIN, CONFIG_ROOT, CLAUDE_JSON, buildVars, askedForHelp } from './paths.mjs'

// A request for help is never a request to do the thing.
if (askedForHelp(import.meta.url)) process.exit(0)

const args = process.argv.slice(2)
const DRY = !args.includes('--yes')

// No update lock here, deliberately: it lives under the config root this is removing, so
// taking it would recreate the directory the uninstall just deleted — a door cannot be locked
// while it is being taken off its hinges. The install and the sync hold it; this asks the user
// for --yes instead, which is the only signal that matters for a removal.
const PURGE = args.includes('--purge-library')
const vars = buildVars()

// Backups land OUTSIDE the repo and OUTSIDE the directory being emptied, so a later
// `rm -rf ~/.claude` cannot take them with it. The path is fixed and printed in the summary.
const BACKUP_DIR = join(HOME, '.claude-uninstall-backup')

const results = []
const removed = []
const backups = []
let failures = 0

const say = (m) => console.log(m)
const phase = (n) => say(`\n\x1b[1m── ${n} ${'─'.repeat(Math.max(0, 58 - n.length))}\x1b[0m`)
const ok = (m) => { say(`  \x1b[32mok\x1b[0m    ${m}`); results.push(['ok', m]) }
const skip = (m) => { say(`  \x1b[90mskip\x1b[0m  ${m}`); results.push(['skip', m]) }
const warn = (m) => { say(`  \x1b[33mwarn\x1b[0m  ${m}`); results.push(['warn', m]) }
const fail = (m) => { say(`  \x1b[31mFAIL\x1b[0m  ${m}`); results.push(['fail', m]); failures++ }

/** Every destructive step reports through here, so a dry run prints exactly the list a
 *  real run would act on — the opt-in is only meaningful if the two agree. */
const gone = (m) => {
  removed.push(m)
  if (DRY) { say(`  \x1b[33mwould\x1b[0m ${m}`); results.push(['would', m]) }
  else { say(`  \x1b[32mok\x1b[0m    ${m}`); results.push(['ok', m]) }
}

// Same shell-less launch rule as install.mjs. On Windows a bare `npm` is really npm.cmd:
// node resolves only .com/.exe for a bare name (ENOENT), and refuses to exec a .cmd
// directly since the 2024 argument-injection CVE (EINVAL). Without this the plugin and
// global-link removal silently warn instead of running, leaving half an install behind.
function run(cmd, argv, opts = {}) {
  if (DRY) return { status: 0, stdout: '', stderr: '' }
  let file = String(cmd)
  if (IS_WIN && !/[\\/]/.test(file)) file = onPath(file) || file
  const plan = spawnPlan(file, argv)
  if (plan.unsafe !== null) {
    return { status: 1, stdout: '', stderr: `refusing to run via shim: cmd.exe would reparse ${plan.unsafe}` }
  }
  return spawnSync(plan.file, plan.args, { encoding: 'utf8', timeout: opts.timeout ?? 120000, shell: false, ...opts })
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''))

/** Deterministic backup path. The stamp is the file's OWN mtime, never Date.now(): a
 *  wall-clock stamp makes the path unpredictable and drops a fresh copy on every run,
 *  while an mtime stamp names the version that was actually there and lets a re-run land
 *  on the same file. Same mtime but different bytes gets a counter suffix, never a silent
 *  overwrite. */
function backup(src) {
  if (!existsSync(src)) return null
  const t = new Date(statSync(src).mtimeMs)
  const p = (n) => String(n).padStart(2, '0')
  const stamp = `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`
  const body = readFileSync(src)
  let dest = join(BACKUP_DIR, `${basename(src)}.${stamp}.bak`)
  for (let i = 2; existsSync(dest) && !readFileSync(dest).equals(body); i++) {
    dest = join(BACKUP_DIR, `${basename(src)}.${stamp}-${i}.bak`)
  }
  if (!DRY) { mkdirSync(BACKUP_DIR, { recursive: true }); copyFileSync(src, dest) }
  backups.push(dest)
  say(`  \x1b[90mbkup\x1b[0m  ${dest}`)
  return dest
}

/** Remove a directory LINK without following it. lstat never resolves the target, and
 *  neither rm(recursive:false) nor rmdir will descend into one, so the source repo a
 *  junction points at survives. A REAL directory is refused — that is user data, and
 *  deleting through a junction here would destroy the skill repo on the other end. */
function unlinkDir(p) {
  const st = lstatSync(p) // lstat, not stat — stat follows the link and describes the target
  if (!st.isSymbolicLink()) return 'real'
  if (DRY) return 'link'
  // Windows junctions refuse unlink() with EPERM; rmdir drops the reparse point only.
  try { rmSync(p, { recursive: false }) } catch { rmdirSync(p) }
  return 'link'
}

const under = (child, parent) => {
  // Windows paths compare case-insensitively: a repo typed in lower case is the same repo.
  const norm = (p) => (IS_WIN ? resolve(p).toLowerCase() : resolve(p))
  const c = norm(child), a = norm(parent)
  return c === a || c.startsWith(a.endsWith(sep) ? a : a + sep)
}

// ── What this repo installed, read off the repo itself ──────────────────────
const mandates = existsSync(join(REPO, 'config'))
  ? readdirSync(join(REPO, 'config')).filter((f) => f.endsWith('.md'))
  : []

// The same three directories install.mjs gathers hooks from.
const HOOK_SOURCES = [
  join(REPO, 'config', 'hooks'),
  join(REPO, 'argo', 'plugin', 'hooks'),
  join(REPO, 'skills', 'visual-design-mastery', 'hooks'),
]
const ownedHooks = new Set(
  HOOK_SOURCES.flatMap((d) => (existsSync(d) ? readdirSync(d).filter((f) => /\.(js|mjs|cjs)$/.test(f)) : []))
)
// A registration in config/hooks.json belongs to us even if the repo has stopped shipping
// that script — otherwise the dead entry outlives the uninstall and doctor.mjs keeps
// reporting a hook that can never run.
const hooksManifest = join(REPO, 'config', 'hooks.json')
if (existsSync(hooksManifest)) {
  for (const groups of Object.values(readJson(hooksManifest).hooks || {})) {
    for (const g of groups || []) for (const h of g.hooks || []) {
      const b = (String(h.command || '').match(/([\w.-]+\.(?:js|mjs|cjs))/) || [])[1]
      if (b) ownedHooks.add(b)
    }
  }
}

const srcFile = join(REPO, 'library', 'sources.json')
const sources = existsSync(srcFile) ? readJson(srcFile) : { repos: [], tier2: [] }
const ownedSkills = [
  ...(existsSync(join(REPO, 'skills'))
    ? readdirSync(join(REPO, 'skills')).filter((n) => existsSync(join(REPO, 'skills', n, 'SKILL.md')))
    : []),
  ...(sources.tier2 || []).map((s) => s.name),
]

say(`\n\x1b[1mClaude Global Config — uninstall\x1b[0m`)
say(`  repo    ${REPO}`)
say(`  target  ${CONFIG_ROOT}`)
say(`  backups ${BACKUP_DIR}`)
if (DRY) say(`  \x1b[33mDRY RUN — nothing will be removed. Re-run with --yes to apply.\x1b[0m`)
else say(`  \x1b[31mLIVE RUN — changes will be written.\x1b[0m`)

// ── 1. settings.json — only the hook entries this repo added ────────────────
phase('settings.json — hook registrations')
{
  const settingsPath = join(CONFIG_ROOT, 'settings.json')
  if (!existsSync(settingsPath)) skip('settings.json not present')
  else {
    let settings = null
    try { settings = readJson(settingsPath) }
    catch (e) { fail(`settings.json is not valid JSON (${e.message}) — refusing to touch it; remove the hook entries by hand`) }
    if (settings && !settings.hooks) skip('no hooks block in settings.json')
    else if (settings) {
      // The identity rule install.mjs writes with, read back: a hook IS the script
      // basename in its command. Anything whose basename we do not own is someone
      // else's hook and is copied through untouched.
      const ownedBasename = (h) => {
        const b = (String(h.command || '').match(/([\w.-]+\.(?:js|mjs|cjs))/) || [])[1]
        return b && ownedHooks.has(b) ? b : null
      }
      // Count before touching anything: a backup taken on a run that changes nothing
      // is a fresh .bak on every --yes, which is noise that trains people to ignore
      // the backup directory.
      const registered = Object.values(settings.hooks)
        .filter(Array.isArray)
        .flatMap((groups) => groups.flatMap((g) => (g.hooks || []).filter(ownedBasename))).length
      if (registered) backup(settingsPath)
      let hit = 0, kept = 0
      for (const [event, groups] of Object.entries(settings.hooks)) {
        if (!Array.isArray(groups)) continue
        const emptied = new Set()
        for (const g of groups) {
          const before = (g.hooks || []).length
          g.hooks = (g.hooks || []).filter((h) => {
            const b = ownedBasename(h)
            if (b) { gone(`settings.json  ${event} · ${b}`); hit++; return false }
            return true
          })
          kept += g.hooks.length
          if (before > g.hooks.length && g.hooks.length === 0) emptied.add(g)
        }
        // Prune only the groups WE emptied. A group the user left empty stays empty.
        if (emptied.size) {
          const survivors = groups.filter((g) => !emptied.has(g))
          if (survivors.length) settings.hooks[event] = survivors
          else delete settings.hooks[event]
        }
      }
      if (!hit) skip('no hooks from this repo registered')
      else {
        if (!DRY) writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8')
        ok(`${hit} registration(s) removed · ${kept} foreign hook(s) and every other setting left intact`)
      }
    }
  }
}

// ── 2. Hook scripts ─────────────────────────────────────────────────────────
phase('Hook scripts')
{
  const hooksDir = join(CONFIG_ROOT, 'hooks')
  if (!existsSync(hooksDir)) skip('~/.claude/hooks not present')
  else {
    for (const f of [...ownedHooks].sort()) {
      const p = join(hooksDir, f)
      if (!existsSync(p)) { skip(`hooks/${f} (already gone)`); continue }
      if (!DRY) rmSync(p, { force: true })
      gone(`hooks/${f}`)
    }
    const left = readdirSync(hooksDir).filter((f) => !ownedHooks.has(f))
    if (left.length) warn(`kept ${left.length} hook file(s) not from this repo: ${left.join(', ')}`)
    else { if (!DRY) rmdirSync(hooksDir); gone('hooks/ (directory, now empty)') }
  }
}

// ── 3. Mandate files ────────────────────────────────────────────────────────
phase('Mandates')
{
  const MARK = '<!-- user-additions-below -->'
  for (const name of mandates) {
    const dest = join(CONFIG_ROOT, name)
    if (!existsSync(dest)) { skip(`${name} (already gone)`); continue }
    if (name === 'CLAUDE.md') {
      const cur = readFileSync(dest, 'utf8')
      const at = cur.indexOf(MARK)
      // install.mjs preserves everything below this marker, which makes it the user's text
      // by definition. Truncate back to it rather than deleting the file. A marker already
      // at offset 0 means nothing of ours is left — say so instead of rewriting it.
      if (at === 0) { skip(`${name} (already reduced to your own additions)`); continue }
      if (at > 0) {
        backup(dest)
        if (!DRY) writeFileSync(dest, cur.slice(at), 'utf8')
        gone(`${name} (repo section only — your additions below the marker kept)`)
        continue
      }
    }
    if (!DRY) rmSync(dest, { force: true })
    gone(name)
  }
}

// ── 4. Skills ───────────────────────────────────────────────────────────────
phase('Skills')
{
  const skillsDir = join(CONFIG_ROOT, 'skills')
  if (!existsSync(skillsDir)) skip('~/.claude/skills not present')
  else {
    for (const name of ownedSkills) {
      const p = join(skillsDir, name)
      // lstat, not existsSync: existsSync follows the link, so a junction whose target
      // is already gone would read as "not installed" and the dead link would survive.
      try { lstatSync(p) } catch { skip(`${name} (not installed)`); continue }
      let r
      try { r = unlinkDir(p) } catch (e) { fail(`${name}: could not unlink — ${e.message}`); continue }
      if (r === 'real') {
        // install.mjs falls back to a copy when mklink is unavailable, so this MIGHT be
        // ours — but it might equally be a skill the user wrote by hand. A wrong guess
        // here deletes their work, so it is refused and named instead.
        warn(`${name}: a real directory, not one of our links — left in place, delete it yourself if you want it gone`)
        continue
      }
      gone(`skills/${name} (link removed, target repo untouched)`)
      // install.mjs moves a foreign directory it found under this name to .cgc-replaced and
      // links ours in its place. The override is reversible: the newest copy goes back.
      const aside = join(CONFIG_ROOT, '.cgc-replaced')
      if (existsSync(aside)) {
        const prev = readdirSync(aside).filter((d) => d.startsWith(`${name}-`)).sort().pop()
        if (prev) {
          if (!DRY) renameSync(join(aside, prev), p)
          gone(`skills/${name}: the copy install replaced (${prev}) is back in its place`)
        }
      }
    }
    if (!DRY && existsSync(skillsDir) && !readdirSync(skillsDir).length) { rmdirSync(skillsDir); gone('skills/ (directory, now empty)') }
  }
}

// ── 4a. Workflows ────────────────────────────────────────────────────────────
// install.mjs realizes REPO/workflows/*.js into <config>/workflows. A realized file points into
// the repo, so after the repo is gone it is a dead workflow; only ours are removed, by name.
phase('Workflows')
{
  const src = join(REPO, 'workflows'), dest = join(CONFIG_ROOT, 'workflows')
  if (!existsSync(src) || !existsSync(dest)) skip('workflows not present')
  else {
    for (const f of readdirSync(src).filter((f) => /\.(js|mjs)$/.test(f))) {
      const p = join(dest, f)
      if (!existsSync(p)) continue
      if (!DRY) rmSync(p, { force: true })
      gone(`workflows/${f}`)
    }
    if (!DRY && existsSync(dest) && !readdirSync(dest).length) { rmdirSync(dest); gone('workflows/ (directory, now empty)') }
  }
}

// ── 4b. State this config kept beside itself ─────────────────────────────────
phase('State')
{
  const state = join(CONFIG_ROOT, '.cgc')
  if (!existsSync(state)) skip('.cgc (update stamps, self-test cache, font cache) not present')
  else { if (!DRY) rmSync(state, { recursive: true, force: true }); gone('.cgc (update stamps, self-test cache, font cache)') }
  const aside = join(CONFIG_ROOT, '.cgc-replaced')
  if (existsSync(aside) && readdirSync(aside).length === 0) { if (!DRY) rmdirSync(aside); gone('.cgc-replaced/ (empty)') }
}

// ── 5. argo — plugin, marketplace, global CLI link ──────────────────────────
phase('argo — plugin, marketplace, CLI')
{
  const claudeBin = join(HOME, '.local', 'bin', IS_WIN ? 'claude.exe' : 'claude')
  const cli = existsSync(claudeBin) ? claudeBin : 'claude'
  const claudeAvailable = existsSync(claudeBin) ||
    spawnSync(IS_WIN ? 'where' : 'which', ['claude'], { encoding: 'utf8' }).status === 0

  const mktFile = join(REPO, 'argo', '.claude-plugin', 'marketplace.json')
  if (!existsSync(mktFile)) warn('argo/.claude-plugin/marketplace.json missing — cannot name the plugin to remove')
  else {
    const mkt = readJson(mktFile)
    // Not having the CLI is a warning, never a failure: everything else here still
    // uninstalls, and the plugin can be removed by hand later.
    if (!claudeAvailable) warn(`claude CLI not found — remove the plugin yourself: claude plugin uninstall ${(mkt.plugins || [{}])[0].name}@${mkt.name}`)
    else {
      for (const p of mkt.plugins || []) {
        const r = run(cli, ['plugin', 'uninstall', `${p.name}@${mkt.name}`])
        const out = String(r.stdout || '') + String(r.stderr || '')
        if (r.status === 0 || /not installed|not found/i.test(out)) gone(`plugin ${p.name}@${mkt.name}`)
        else warn(`plugin uninstall failed: ${out.split('\n')[0] || `exit ${r.status}`}`)
      }
      const r = run(cli, ['plugin', 'marketplace', 'remove', mkt.name])
      const out = String(r.stdout || '') + String(r.stderr || '')
      if (r.status === 0 || /not found|no such/i.test(out)) gone(`marketplace ${mkt.name}`)
      else warn(`marketplace remove failed: ${out.split('\n')[0] || `exit ${r.status}`}`)
    }
  }

  const pkgFile = join(REPO, 'argo', 'package.json')
  if (!existsSync(pkgFile)) skip('argo/package.json missing — nothing to unlink')
  else {
    const pkg = readJson(pkgFile)
    const r = run('npm', ['unlink', '-g', pkg.name], { timeout: 120000 })
    if (r.status === 0) gone(`global npm link ${pkg.name} (the argo CLI)`)
    else warn(`npm unlink -g ${pkg.name} failed — run it by hand if 'argo' is still on PATH`)
  }
}

// ── 6. MCP servers ──────────────────────────────────────────────────────────
phase('MCP servers')
{
  const cfgPath = CLAUDE_JSON
  const mcpRoot = join(REPO, 'library', 'mcp-servers')
  if (!existsSync(cfgPath)) skip('~/.claude.json not present')
  else {
    let cfg = null
    try { cfg = readJson(cfgPath) }
    catch (e) { fail(`~/.claude.json is not valid JSON (${e.message}) — refusing to touch it`) }
    if (cfg) {
      const entries = Object.entries(cfg.mcpServers || {})
      // Match on WHERE the server lives, not on its name. A server called "playwright"
      // that the user installed from somewhere else is not ours, and stays.
      const mine = entries.filter(([, s]) => {
        const entry = String((s.args || [])[0] || '')
        return entry && under(entry, mcpRoot)
      })
      if (!mine.length) skip('no MCP servers pointing into this repo')
      else {
        backup(cfgPath)
        for (const [name] of mine) { delete cfg.mcpServers[name]; gone(`mcp server ${name}`) }
        if (!DRY) writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
        ok(`${entries.length - mine.length} other MCP server(s) and every other key in .claude.json left intact`)
      }
    }
  }
}

// ── 7. Tier-3 skill library (opt-in) ────────────────────────────────────────
phase('Tier-3 skill library')
{
  const root = vars.LIBRARY_ROOT
  if (!PURGE) skip(`library kept at ${root} — pass --purge-library to delete the clones (~200MB)`)
  else if (!existsSync(root)) skip(`${root} not present`)
  else {
    for (const s of (sources.repos || []).filter((r) => !r.rejected)) {
      const dest = join(root, s.name)
      if (!existsSync(dest)) { skip(`${s.name} (not cloned)`); continue }
      // Only delete what is demonstrably a clone. install.mjs ADOPTS a pre-existing
      // library rather than making its own, so the root can easily predate this install.
      if (!existsSync(join(dest, '.git'))) { warn(`${s.name}: not a git clone — left alone`); continue }
      if (!DRY) rmSync(dest, { recursive: true, force: true })
      gone(`library/${s.name}`)
    }
    skip(`${root} itself kept — the directory may predate this install`)
  }
}

// ── Summary ─────────────────────────────────────────────────────────────────
const counts = results.reduce((a, [k]) => ({ ...a, [k]: (a[k] || 0) + 1 }), {})
say(`\n\x1b[1m── Summary ${'─'.repeat(52)}\x1b[0m`)
say(`  ${counts.ok || 0} ok · ${counts.would || 0} planned · ${counts.skip || 0} skipped · ${counts.warn || 0} warnings · ${counts.fail || 0} failed`)

say(`\n  \x1b[1m${DRY ? 'Would remove' : 'Removed'}\x1b[0m (${removed.length})`)
if (removed.length) for (const m of removed) say(`    ${m}`)
else say(`    nothing`)

say(`\n  \x1b[1mKept, deliberately\x1b[0m`)
for (const m of [
  '.credentials.json, history.jsonl, projects/, todos/, settings.local.json — never touched',
  'every non-hook setting, and every hook this repo did not install, in settings.json',
  'global npm packages (eslint, react-scan, react-doctor) — they may predate this install',
  'git core.longpaths — a global git setting, not ours to revert',
  PURGE ? `${vars.LIBRARY_ROOT} itself — only the clones inside it were removed`
    : `the Tier-3 library at ${vars.LIBRARY_ROOT}`,
  `this repo at ${REPO}, library/mcp-servers/node_modules included — delete the folder when you are done`,
]) say(`    ${m}`)

say(`\n  \x1b[1mBackups\x1b[0m`)
if (backups.length) for (const b of backups) say(`    ${b}`)
else say(`    none needed`)

if (failures) { say(`\n  \x1b[31mUninstall incomplete.\x1b[0m Fix the failures above and re-run.`); process.exit(1) }
say(DRY
  ? `\n  Nothing was changed. Re-run with \x1b[1m--yes\x1b[0m to apply${PURGE ? '' : ', plus --purge-library to drop the clones too'}.`
  : `\n  Done. Restart Claude Code so it stops loading the removed hooks and skills.`)
