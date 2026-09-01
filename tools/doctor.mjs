#!/usr/bin/env node
// doctor.mjs — prove the install actually worked. CHECKS ONLY: never writes, never repairs.
//
//   node tools/doctor.mjs          human-readable report
//   node tools/doctor.mjs --json   machine-readable report
//
// Exit 1 if any check FAILS. Warnings alone exit 0.

import { readFileSync, existsSync, readdirSync, lstatSync, readlinkSync } from 'node:fs'
import { join, basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO, HOME, IS_WIN, CONFIG_ROOT, unresolved } from './paths.mjs'

const JSON_OUT = process.argv.includes('--json')
const results = []
let current = ''
let failures = 0

const say = (m) => { if (!JSON_OUT) console.log(m) }
const phase = (n) => { current = n; say(`\n\x1b[1m── ${n} ${'─'.repeat(Math.max(0, 58 - n.length))}\x1b[0m`) }
const push = (level, m) => results.push({ phase: current, level, message: m })
const ok = (m) => { say(`  \x1b[32mok\x1b[0m    ${m}`); push('ok', m) }
const warn = (m) => { say(`  \x1b[33mwarn\x1b[0m  ${m}`); push('warn', m) }
const fail = (m) => { say(`  \x1b[31mFAIL\x1b[0m  ${m}`); push('fail', m); failures++ }

/** A bare command name is resolved through PATH; anything with a separator must exist as written. */
function resolveExe(cmd) {
  if (/[\\/]/.test(cmd)) return existsSync(cmd) ? cmd : null
  const r = spawnSync(IS_WIN ? 'where' : 'which', [cmd], { encoding: 'utf8' })
  const hits = String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  return r.status === 0 && hits.length ? hits : null
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''))

say(`\n\x1b[1mClaude Global Config — doctor\x1b[0m`)
say(`  repo   ${REPO}`)
say(`  target ${CONFIG_ROOT}`)

// ── 1. Prerequisites ────────────────────────────────────────────────────────
phase('Prerequisites')
{
  const major = Number(process.versions.node.split('.')[0])
  major >= 20 ? ok(`node ${process.versions.node}`) : fail(`node ${process.versions.node} — need 20+`)
  resolveExe('git') ? ok('git present') : warn('git not found — the Tier-3 library cannot be updated')
}

// ── 2. Mandate files ────────────────────────────────────────────────────────
phase('Mandates')
if (!existsSync(CONFIG_ROOT)) fail(`${CONFIG_ROOT} does not exist — nothing is installed`)
else {
  ok(`${CONFIG_ROOT} exists`)
  for (const name of ['CLAUDE.md', 'ui-design-stack.md', 'react-tooling-stack.md', 'security-stack.md']) {
    const p = join(CONFIG_ROOT, name)
    if (!existsSync(p)) { fail(`${name} missing`); continue }
    // A surviving {{TOKEN}} means install.mjs could not resolve a path: the mandate ships
    // pointing at nothing, and every rule inside it silently references a bad location.
    const left = unresolved(readFileSync(p, 'utf8'))
    left.length ? fail(`${name} has unresolved tokens: ${left.join(', ')}`) : ok(name)
  }
}

// ── 3. Hooks ────────────────────────────────────────────────────────────────
phase('Hooks')
{
  const settingsPath = join(CONFIG_ROOT, 'settings.json')
  let settings = null
  if (!existsSync(settingsPath)) fail('settings.json missing')
  else {
    try { settings = readJson(settingsPath); ok('settings.json parses') }
    catch (e) { fail(`settings.json is not valid JSON: ${e.message}`) }
  }
  const events = Object.entries(settings?.hooks || {})
  if (settings && !events.length) warn('no hooks registered')
  for (const [event, groups] of events) {
    for (const g of groups || []) for (const h of g.hooks || []) {
      const cmd = String(h.command || '')
      const tok = (cmd.match(/"[^"]*"|\S+/g) || []).map((t) => t.replace(/^"|"$/g, ''))
      const script = tok.slice(1).find((t) => /\.[cm]?js$/i.test(t))
      // A hook whose interpreter or script path is wrong is a SILENT no-op: Claude Code
      // reports nothing and the hook simply never runs. That took a set of hooks
      // offline for weeks. This is the single most important check in this file.
      if (!tok.length) { fail(`${event}: empty command`); continue }
      if (!resolveExe(tok[0])) { fail(`${event}: interpreter not found — ${tok[0]}`); continue }
      if (!script) { warn(`${event}: no .js/.mjs script in command — ${cmd.slice(0, 60)}`); continue }
      existsSync(script)
        ? ok(`${event} · ${basename(script)}`)
        : fail(`${event}: script missing, hook is a silent no-op — ${script}`)
    }
  }
}

// ── 4. MCP servers ──────────────────────────────────────────────────────────
phase('MCP servers')
{
  const cfgPath = join(HOME, '.claude.json')
  if (!existsSync(cfgPath)) warn('~/.claude.json not found — launch Claude Code once')
  else {
    let cfg = null
    try { cfg = readJson(cfgPath); ok('~/.claude.json parses') }
    catch (e) { fail(`~/.claude.json is not valid JSON: ${e.message}`) }
    const servers = Object.entries(cfg?.mcpServers || {})
    if (cfg && !servers.length) warn('no MCP servers registered')
    for (const [name, s] of servers) {
      const entry = (s.args || [])[0]
      if (!resolveExe(String(s.command || ''))) fail(`${name}: command not found — ${s.command}`)
      else if (!entry) warn(`${name}: no entry point in args`)
      else if (!existsSync(entry)) fail(`${name}: server entry missing — ${entry}`)
      else ok(`${name} · ${basename(entry)}`)
    }
  }
}

// ── 5. Tier-2 skills ────────────────────────────────────────────────────────
phase('Tier-2 skills')
{
  const srcFile = join(REPO, 'library', 'sources.json')
  const skillsDir = join(CONFIG_ROOT, 'skills')
  if (!existsSync(srcFile)) fail('library/sources.json missing — cannot verify tier-2 set')
  else {
    const t2 = readJson(srcFile).tier2 || []
    let good = 0
    for (const s of t2) {
      const dir = join(skillsDir, s.name)
      let link = null
      try { link = lstatSync(dir) } catch { fail(`${s.name}: not installed`); continue }
      if (existsSync(join(dir, 'SKILL.md'))) { good++; continue }
      // A junction/symlink whose target was moved or deleted still lstats fine, so an
      // absent skill and a dangling link look identical unless you separate them.
      if (link.isSymbolicLink()) {
        let target = '?'
        try { target = readlinkSync(dir) } catch { /* unreadable link */ }
        fail(`${s.name}: broken link — target gone (${target})`)
      } else fail(`${s.name}: directory present but SKILL.md missing`)
    }
    good === t2.length ? ok(`all ${t2.length} tier-2 skills resolve to a real SKILL.md`)
      : warn(`${good}/${t2.length} tier-2 skills healthy`)
  }
}

// ── 6. argo CLI ─────────────────────────────────────────────────────────────
phase('argo CLI')
{
  const hits = resolveExe('argo')
  if (!hits) fail("argo not on PATH — run 'npm link' in argo/")
  else {
    // Windows resolves `argo` to both a shim and argo.cmd; only the .cmd is executable.
    const bin = IS_WIN ? (hits.find((h) => /\.cmd$/i.test(h)) || hits[0]) : hits[0]
    const r = spawnSync(`"${bin}"`, ['--help'], { encoding: 'utf8', shell: true, timeout: 30000 })
    r.status === 0 ? ok(`argo --help exits 0 (${bin})`)
      : fail(`argo --help exited ${r.status} — ${String(r.stderr || r.stdout || '').split('\n')[0]}`)
  }
}

// ── 7. Context cost & name collisions ───────────────────────────────────────
phase('Session context cost')
let tokens = 0
{
  const skillsDir = join(CONFIG_ROOT, 'skills')
  const byName = new Map()
  const weights = []
  let chars = 0, n = 0
  const block = (fm, key) => {
    const lines = fm.split(/\r?\n/)
    const i = lines.findIndex((l) => l.startsWith(`${key}:`))
    if (i < 0) return ''
    const out = [lines[i]]
    for (let j = i + 1; j < lines.length && !/^[A-Za-z_-]+:/.test(lines[j]); j++) out.push(lines[j])
    return out.join('\n')
  }
  for (const d of existsSync(skillsDir) ? readdirSync(skillsDir) : []) {
    const f = join(skillsDir, d, 'SKILL.md')
    if (!existsSync(f)) continue
    n++
    const fm = (readFileSync(f, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/) || [, ''])[1]
    // name + description are what every session pays for: they are loaded for dispatch
    // whether or not the skill is ever invoked. The body costs nothing until then.
    const name = block(fm, 'name'), desc = block(fm, 'description')
    const cost = name.length + desc.length
    chars += cost
    weights.push([d, Math.round(cost / 4)])
    const key = name.slice(5).trim() || d
    byName.set(key, [...(byName.get(key) || []), d])
  }
  tokens = Math.round(chars / 4)
  say(`  ${n} installed skills · ${chars} frontmatter chars`)
  if (tokens > 6000) {
    warn(`~${tokens} tokens per session — over the 6000 budget`)
    // A bare number is not actionable. Name the skills actually paying for it, so
    // pruning is a decision about specific skills rather than a vague diet.
    const top = weights.sort((a, b) => b[1] - a[1]).slice(0, 5)
    say(`        heaviest: ${top.map(([d, t]) => `${d} (${t})`).join(', ')}`)
    say(`        every installed skill costs its name+description every session, invoked or not.`)
  } else ok(`~${tokens} tokens per session (budget 6000)`)

  // Two skills with the same declared name make dispatch non-deterministic: which one
  // Claude Code picks depends on directory order, not on what you meant.
  const dupes = [...byName].filter(([, dirs]) => dirs.length > 1)
  dupes.length ? dupes.forEach(([name, dirs]) => fail(`name collision "${name}": ${dirs.join(', ')}`))
    : ok('no skill name collisions')
}

// ── 8. Trigger contention ───────────────────────────────────────────────────
// Token cost is the obvious metric but not the dangerous one. What actually degrades a
// large skill set is CONTENTION: many skills claiming the same trigger word, so dispatch
// becomes a coin flip between them. A 144-skill pack was rejected from this repo for
// exactly this — every one of its skills triggered on "animation".
phase('Trigger contention')
let contention = []
{
  const skillsDir = join(CONFIG_ROOT, 'skills')
  // Words too generic to be evidence of anything, plus ordinary English glue.
  // Two kinds of noise: ordinary English glue, and the boilerplate every skill
  // description shares ("use when the user asks to ..."). Neither is evidence of
  // contention — only domain words are.
  const STOP = new Set(`the a an and or of to in for on with when use used using this that
    it its is are be as by from at into any all more most other should skill skills claude user
    if then than so not no which what how you your also can may per via each
    them they will would about across after before between during over under only just
    asks ask asked need needs want wants request requests requested
    trigger triggers triggering covers covering provides providing including include
    whenever instead rather already actual actually real really work works working
    task tasks thing things something anything make makes making`
    .split(/\s+/).filter(Boolean))
  const claims = new Map()
  for (const d of existsSync(skillsDir) ? readdirSync(skillsDir) : []) {
    const f = join(skillsDir, d, 'SKILL.md')
    if (!existsSync(f)) continue
    const fm = (readFileSync(f, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/) || [, ''])[1]
    // Take the description VALUE only — up to the next top-level YAML key. Slicing to the
    // end of the frontmatter swallows sibling keys (license:, allowed-tools:) and reports
    // their words as triggers, which is noise dressed as a finding.
    const lines = fm.split(/\r?\n/)
    const start = lines.findIndex((l) => /^description:/.test(l))
    if (start < 0) continue
    const value = [lines[start].replace(/^description:\s*/, '')]
    for (let j = start + 1; j < lines.length && !/^[A-Za-z_-]+:/.test(lines[j]); j++) value.push(lines[j])
    const desc = value.join(' ').toLowerCase()
    for (const w of new Set(desc.match(/[a-z][a-z-]{3,}/g) || [])) {
      if (STOP.has(w)) continue
      claims.set(w, [...(claims.get(w) || []), d])
    }
  }
  contention = [...claims].filter(([, ds]) => ds.length >= 6).sort((a, b) => b[1].length - a[1].length)
  if (!contention.length) ok('no trigger word claimed by 6+ skills')
  else {
    warn(`${contention.length} trigger word(s) claimed by 6+ skills — dispatch is a coin flip on these`)
    for (const [w, ds] of contention.slice(0, 5)) say(`        "${w}" — ${ds.length}: ${ds.slice(0, 6).join(', ')}${ds.length > 6 ? '…' : ''}`)
    say(`        Fix by narrowing descriptions to quoted phrases ("build a scroll animation"),`)
    say(`        not bare topic words. Bare verbs like "create" or "draw" are the worst offenders.`)
  }
}

// ── Summary ─────────────────────────────────────────────────────────────────
const counts = results.reduce((a, r) => ({ ...a, [r.level]: (a[r.level] || 0) + 1 }), {})
if (JSON_OUT) {
  console.log(JSON.stringify({
    healthy: failures === 0, counts, contextTokens: tokens,
    configRoot: CONFIG_ROOT, repo: REPO, results,
  }, null, 2))
} else {
  say(`\n\x1b[1m── Summary ${'─'.repeat(52)}\x1b[0m`)
  say(`  ${counts.ok || 0} ok · ${counts.warn || 0} warnings · ${counts.fail || 0} failed`)
  say(failures ? `\n  \x1b[31mInstall is broken.\x1b[0m Fix the FAILs above, then re-run node tools/install.mjs.`
    : counts.warn ? `\n  \x1b[33mInstall works, with warnings.\x1b[0m`
      : `\n  \x1b[32mInstall is healthy.\x1b[0m`)
}
process.exit(failures ? 1 : 0)
