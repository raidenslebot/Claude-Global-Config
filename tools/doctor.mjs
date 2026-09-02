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
import { findPlaywright } from './print-render.mjs'

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
    // Every scope a server can hide in. `install.mjs` writes the global map, and this
    // check used to read only that one — so a project-scoped server was invisible here
    // while being perfectly live in the session. Same blind spot the skills check already
    // learned about plugins: what you enumerate has to match what actually loads.
    const scopes = [['', cfg?.mcpServers]]
    for (const [proj, v] of Object.entries(cfg?.projects || {})) {
      const m = v && typeof v === 'object' ? v.mcpServers : null
      if (m && Object.keys(m).length) scopes.push([` (project ${basename(String(proj))})`, m])
    }
    const servers = scopes.flatMap(([where, map]) =>
      Object.entries(map || {}).map(([name, s]) => ({ name, where, s: s || {} })))

    if (cfg && !servers.length) warn('no MCP servers registered')
    for (const { name, where, s } of servers) {
      // THE MANDATE, checked rather than assumed: this package is subscription-only.
      // A server addressed by URL is somebody else's service over the network, and every
      // one of those ends at a login prompt. install.mjs only ever writes `command`
      // servers (its phase is literally titled "MCP servers — local only"), so anything
      // with a url arrived by another route. Reported as the policy break it is — the old
      // check called it "command not found", which reads as a broken install and sends
      // you off to fix the wrong thing.
      const url = s.url || s.serverUrl || s.httpUrl
      const remoteType = /^(sse|http|https|ws|wss|streamable-http)$/i.test(String(s.type || ''))
      if (url || remoteType) {
        fail(`${name}${where}: external service (${url || s.type}) — this config is ` +
          `subscription-only. Remove it, or replace it with a locally installed server.`)
        continue
      }
      const entry = (s.args || [])[0]
      if (!resolveExe(String(s.command || ''))) fail(`${name}${where}: command not found — ${s.command}`)
      else if (!entry) warn(`${name}${where}: no entry point in args`)
      else if (!existsSync(entry)) fail(`${name}${where}: server entry missing — ${entry}`)
      else ok(`${name}${where} · ${basename(entry)}`)
    }
    // Stated because it is a real limit, not a covered case: connectors provided by the
    // host application do not appear in this file at all, so nothing here can see them.
    // Those are managed in the app's own connector settings.
  }
}

// ── 5. Tier-2 skills ────────────────────────────────────────────────────────
// ── Design tools ────────────────────────────────────────────────────────────
// The render, lint, audit and specimen tools are what make the design skills' demands checkable.
// A tool that does not parse fails silently from inside a skill's instructions, so it is
// checked here; the browser they render through is named, or its absence and the fix are.
phase('Design tools')
{
  const tools = ['print-render.mjs', 'print-lint.mjs', 'screen-render.mjs', 'slop-lint.mjs', 'page-audit.mjs', 'specimen.mjs']
  const missing = tools.filter((t) => !existsSync(join(REPO, 'tools', t)))
  const broken = tools.filter((t) => !missing.includes(t) && spawnSync(process.execPath, ['--check', join(REPO, 'tools', t)], { encoding: 'utf8', timeout: 20000 }).status !== 0)
  if (missing.length || broken.length) fail(`design tools: ${[...missing.map((t) => `${t} missing`), ...broken.map((t) => `${t} does not parse`)].join(', ')}`)
  else ok(`${tools.length} design tools present and parse (render, lint, audit, specimen)`)
  const pw = findPlaywright()
  if (pw) ok(`browser for render and audit: playwright-core from ${pw.from}`)
  else warn('no browser — print-render, screen-render, page-audit and specimen cannot run; node tools/install.mjs --only=mcp installs the Playwright MCP that brings it')
}

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
let packageTokens = 0
// The skills this package is responsible for: the ones it authors and the tier-2 residents it
// links. Everything else on the machine came from a host plugin or the user's own hand.
const ownSkills = new Set()
// Two numbers, because two owners. Everything installed costs the session; only this package's
// own skills are this package's to prune. The old single-number warning fired on every run on
// any machine with host plugins, and a gate that always warns is ignored — decoration.
const PACKAGE_BUDGET = 4000
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
  const ownDir = join(REPO, 'skills')
  for (const d of existsSync(ownDir) ? readdirSync(ownDir) : []) ownSkills.add(d)
  try {
    for (const s of JSON.parse(readFileSync(join(REPO, 'library', 'sources.json'), 'utf8')).tier2 || []) ownSkills.add(s.name)
  } catch { /* no sources.json — only authored skills count as ours */ }
  const ours = weights.filter(([d]) => ownSkills.has(d))
  packageTokens = ours.reduce((sum, [, t]) => sum + t, 0)
  const hostTokens = tokens - packageTokens
  say(`  ${n} installed skills · ${chars} frontmatter chars · ~${tokens} tokens per session in total`)
  say(`        this package: ${ours.length} skills, ~${packageTokens} tokens · other plugins and loose skills: ${n - ours.length}, ~${hostTokens}`)
  if (packageTokens > PACKAGE_BUDGET) {
    warn(`this package's skills cost ~${packageTokens} tokens per session — over its ${PACKAGE_BUDGET} budget`)
    // A bare number is not actionable. Name the skills actually paying for it, so
    // pruning is a decision about specific skills rather than a vague diet.
    const top = ours.sort((a, b) => b[1] - a[1]).slice(0, 5)
    say(`        heaviest: ${top.map(([d, t]) => `${d} (${t})`).join(', ')}`)
    say(`        every installed skill costs its name+description every session, invoked or not.`)
  } else ok(`this package's skills cost ~${packageTokens} tokens per session (budget ${PACKAGE_BUDGET})`)
  if (hostTokens > PACKAGE_BUDGET) {
    say(`        note: skills from other plugins add ~${hostTokens} tokens — not this package's to prune; the heaviest are in --json`)
  }

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
    it its is are be as by from at into any all more most other should must skill skills claude user
    if then than so not no which what how you your also can may per via each
    them they will would about across after before between during over under only just
    asks ask asked says say said need needs want wants request requests requested
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
    let desc = value.join(' ').trim()
    // The rule this check enforces is "quoted phrases, not bare topic words". So a word inside
    // a quoted trigger phrase ("build a scroll animation") is NOT a claim — the phrase is. Strip
    // the YAML wrapper quotes, then every quoted phrase, and count only what is left bare.
    if (/^".*"$/s.test(desc)) desc = desc.slice(1, -1)
    desc = desc
      .replace(/\\"[^"]{2,120}\\"/g, ' ')                       // escaped "phrase" inside the YAML string
      .replace(/(^|[\s(,;:—-])'[^']{2,120}'(?=[\s),.;:]|$)/g, '$1 ') // 'phrase' — not an apostrophe inside a word
      .toLowerCase()
    for (const w of new Set(desc.match(/[a-z][a-z-]{3,}/g) || [])) {
      if (STOP.has(w)) continue
      claims.set(w, [...(claims.get(w) || []), d])
    }
  }
  contention = [...claims].filter(([, ds]) => ds.length >= 6).sort((a, b) => b[1].length - a[1].length)
  // Three kinds of claimant, three verdicts. A skill this repo AUTHORS is fixable here and is a
  // warning. A Tier-2 resident is third-party text; the lever is curation (sources.json), so it
  // is reported as information. A host plugin is not this install's defect. One authored skill
  // is exempt by design: the taste layer claims every visual word on purpose, because it must
  // fire alongside any technique skill rather than instead of one — contention with it is
  // additive, not a coin flip.
  const authoredDir = join(REPO, 'skills')
  const authored = new Set(existsSync(authoredDir) ? readdirSync(authoredDir) : [])
  const INTENTIONALLY_BROAD = new Set(['visual-design-mastery'])
  const byAuthored = contention.filter(([, ds]) => ds.some((d) => authored.has(d) && !INTENTIONALLY_BROAD.has(d)))
  const byTier2 = contention.filter(([, ds]) => ds.some((d) => ownSkills.has(d) && !authored.has(d)))
  if (!contention.length) ok('no bare trigger word claimed by 6+ skills')
  else if (byAuthored.length) {
    warn(`${byAuthored.length} contended bare word(s) are claimed by skills this repo authors — narrow those descriptions`)
    for (const [w, ds] of byAuthored.slice(0, 6)) {
      const mine = ds.filter((d) => authored.has(d) && !INTENTIONALLY_BROAD.has(d))
      say(`        "${w}" — ${ds.length} claimants; authored here: ${mine.join(', ')}`)
    }
    say(`        Fix by moving the word into a quoted phrase ("build a scroll animation") or dropping it.`)
  } else {
    ok(`${contention.length} bare word(s) contended machine-wide; none by a skill this repo authors` +
      (byTier2.length ? ` (${byTier2.length} involve Tier-2 residents — third-party text; the lever is sources.json)` : '') +
      ' — full list in --json')
  }
}

// ── Summary ─────────────────────────────────────────────────────────────────
const counts = results.reduce((a, r) => ({ ...a, [r.level]: (a[r.level] || 0) + 1 }), {})
if (JSON_OUT) {
  console.log(JSON.stringify({
    healthy: failures === 0, counts, contextTokens: tokens, packageTokens,
    configRoot: CONFIG_ROOT, repo: REPO, results,
    // The text report shows the five worst; a machine acting on this needs every one, with
    // the skills that claim it — that is how a new description finds the word it tipped over.
    contention: contention.map(([word, skills]) => ({ word, skills })),
  }, null, 2))
} else {
  say(`\n\x1b[1m── Summary ${'─'.repeat(52)}\x1b[0m`)
  say(`  ${counts.ok || 0} ok · ${counts.warn || 0} warnings · ${counts.fail || 0} failed`)
  say(failures ? `\n  \x1b[31mInstall is broken.\x1b[0m Fix the FAILs above, then re-run node tools/install.mjs.`
    : counts.warn ? `\n  \x1b[33mInstall works, with warnings.\x1b[0m`
      : `\n  \x1b[32mInstall is healthy.\x1b[0m`)
}
process.exit(failures ? 1 : 0)
