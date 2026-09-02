#!/usr/bin/env node
// sync.mjs — pull the live global config INTO this repo, templatizing machine paths.
//
//   node tools/sync.mjs          # sync live -> repo
//   node tools/sync.mjs --check  # report drift, write nothing (use in CI / pre-commit)
//
// The inverse of install.mjs. Run this after editing ~/.claude by hand so the repo
// stays the source of truth instead of silently falling behind.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { REPO, CONFIG_ROOT, buildVars, templatize, unresolved } from './paths.mjs'

const CHECK = process.argv.includes('--check')
const vars = buildVars()

// What the repo owns. Anything not listed is deliberately NOT tracked — notably
// .credentials.json, .claude.json, projects/, history.jsonl.
const TRACKED = [
  { from: join(CONFIG_ROOT, 'CLAUDE.md'), to: join(REPO, 'config', 'CLAUDE.md'), tmpl: true },
  { from: join(CONFIG_ROOT, 'ui-design-stack.md'), to: join(REPO, 'config', 'ui-design-stack.md'), tmpl: true },
  { from: join(CONFIG_ROOT, 'react-tooling-stack.md'), to: join(REPO, 'config', 'react-tooling-stack.md'), tmpl: true },
  { from: join(CONFIG_ROOT, 'security-stack.md'), to: join(REPO, 'config', 'security-stack.md'), tmpl: true },
]

const TRACKED_DIRS = [
  { from: join(CONFIG_ROOT, 'hooks'), to: join(REPO, 'config', 'hooks'), match: /\.(js|mjs|cjs)$/, tmpl: true },
]

// install.mjs gathers hooks into ~/.claude/hooks from three places. Syncing all of them
// back into config/hooks would give those files TWO homes in this repo, which then drift
// apart silently. A file has exactly one canonical source: if it ships inside argo/ or a
// skill, that is where it is edited, and sync must not shadow it.
const FOREIGN_HOOK_DIRS = [
  join(REPO, 'argo', 'plugin', 'hooks'),
  join(REPO, 'skills', 'visual-design-mastery', 'hooks'),
]
const foreignHooks = new Set(
  FOREIGN_HOOK_DIRS.flatMap((d) => (existsSync(d) ? readdirSync(d) : []))
)

let changed = 0, checked = 0, warnings = []

function syncFile(from, to, tmpl) {
  if (!existsSync(from)) { warnings.push(`missing on disk, not synced: ${from}`); return }
  let text = readFileSync(from, 'utf8')
  if (tmpl) text = templatize(text, vars)
  // install.mjs ends the live CLAUDE.md with a marker and keeps whatever the user writes below
  // it. The repo owns only what is above: the marker and the user's notes never sync back.
  if (/CLAUDE\.md$/i.test(from)) {
    const MARK = '<!-- user-additions-below -->'
    if (text.includes(MARK)) text = text.slice(0, text.indexOf(MARK)).trimEnd() + '\n'
  }
  checked++
  const prev = existsSync(to) ? readFileSync(to, 'utf8') : null
  if (prev === text) return

  // The repo is the source of truth, but sync copies live -> repo. So if the REPO file is
  // newer than the live one, the edit being overwritten is the authored one: someone changed
  // the repo and has not installed it yet. Refuse rather than silently reverting their work.
  // (This ate a real edit before the guard existed.)
  if (prev !== null && existsSync(to) && statSync(to).mtimeMs > statSync(from).mtimeMs + 1000) {
    warnings.push(`${relative(REPO, to)} is NEWER than the live file — refusing to overwrite. `
      + `Run: node tools/install.mjs   (then sync), or delete the repo copy to accept live.`)
    return
  }
  changed++
  if (CHECK) { console.log(`  DRIFT  ${relative(REPO, to)}`); return }
  mkdirSync(dirname(to), { recursive: true })
  writeFileSync(to, text, 'utf8')
  console.log(`  synced ${relative(REPO, to)}`)
}

for (const t of TRACKED) syncFile(t.from, t.to, t.tmpl)

for (const d of TRACKED_DIRS) {
  if (!existsSync(d.from)) { warnings.push(`missing dir: ${d.from}`); continue }
  for (const name of readdirSync(d.from)) {
    const src = join(d.from, name)
    if (!statSync(src).isFile() || !d.match.test(name)) continue
    if (foreignHooks.has(name)) continue  // canonical home is argo/ or a skill
    syncFile(src, join(d.to, name), d.tmpl)
  }
}

// Settings hooks: extract only the hook commands, templatized. Never copy settings.json
// wholesale — it carries machine-local permissions and env the next machine must not inherit.
const settingsPath = join(CONFIG_ROOT, 'settings.json')
if (existsSync(settingsPath)) {
  const s = JSON.parse(readFileSync(settingsPath, 'utf8').replace(/^﻿/, ''))
  // Hook scripts can be registered from anywhere on this machine (a plugin dir, a sibling
  // project). install.mjs gathers them all into <config>/hooks, so normalise every script
  // path to that single home here — otherwise the repo records a path that exists only on
  // the machine that wrote it, and the hook is a silent no-op everywhere else.
  //
  // FORWARD slashes, and {{CONFIG_ROOT:url}} so the root is forward-slashed too. A
  // backslash is a literal filename character on POSIX, so the native Windows form
  // produced dead hooks on every macOS and Linux install. Windows accepts forward
  // slashes in file arguments, so one form serves both.
  // Matches an absolute script path on ANY platform: a Windows drive letter (C:\ or C:/)
  // OR a POSIX root (/home/..., /Users/...). The earlier version required a drive letter,
  // so on macOS and Linux this normalisation was a SILENT NO-OP and sync recorded a
  // machine-specific hook path as though it were portable — the same Windows-only
  // assumption as the bug this very function was written to fix.
  const ABS_SCRIPT = /"(?:[A-Za-z]:|)[\\/][^"]*[\\/]([\w.-]+\.(?:js|mjs|cjs))"/g
  const normalise = (cmd) =>
    templatize(String(cmd), vars)
      .replace(ABS_SCRIPT, (_m, base) => `"{{CONFIG_ROOT:url}}/hooks/${base}"`)
      .replace(/\{\{CONFIG_ROOT\}\}[\\/]+hooks[\\/]+/g, '{{CONFIG_ROOT:url}}/hooks/')

  const hooks = {}
  for (const [event, groups] of Object.entries(s.hooks || {})) {
    hooks[event] = groups.map((g) => ({
      ...(g.matcher ? { matcher: g.matcher } : {}),
      hooks: (g.hooks || []).map((h) => ({ ...h, command: normalise(h.command) })),
    }))
  }
  const out = JSON.stringify({ hooks }, null, 2) + '\n'
  const dest = join(REPO, 'config', 'hooks.json')
  const prev = existsSync(dest) ? readFileSync(dest, 'utf8') : null
  checked++
  if (prev !== out) {
    changed++
    if (CHECK) console.log('  DRIFT  config/hooks.json')
    else {
      // A bare checkout with no config/ yet is a legal starting point.
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, out, 'utf8')
      console.log('  synced config/hooks.json')
    }
  }
}

// A token that survives templatizing into a value we cannot resolve on another machine
// is a portability bug — surface it now, not on someone else's install.
for (const t of [...TRACKED, ...TRACKED_DIRS.flatMap((d) =>
  existsSync(d.to) ? readdirSync(d.to).map((n) => ({ to: join(d.to, n) })) : [])]) {
  if (!existsSync(t.to)) continue
  // Skip comment lines. A path inside a comment is inert — never parsed as a string literal,
  // never resolved at runtime — so it is documentation, not a portability defect. Several
  // shipped hooks deliberately DEMONSTRATE the escape bug using a real-looking path, and
  // warning about those trains the reader to ignore this check.
  const left = readFileSync(t.to, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|#)/.test(line))
    .join('\n')
    .match(/[A-Za-z]:[\\/](?:Users|Claude|Program Files)/g)
  if (left) warnings.push(`${relative(REPO, t.to)} still holds ${left.length} absolute path(s) — add a token in paths.mjs`)
}

console.log(`\n  ${checked} tracked, ${changed} ${CHECK ? 'drifted' : 'updated'}`)
for (const w of warnings) console.log(`  WARN  ${w}`)
if (CHECK && changed) process.exit(1)
