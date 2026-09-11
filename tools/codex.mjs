#!/usr/bin/env node
// codex.mjs — install this package's mandates and MCP servers into Codex.
//
//   node tools/codex.mjs            install / refresh
//   node tools/codex.mjs --check    report only, as JSON, for the doctor
//   node tools/codex.mjs --dry-run  say what would change, write nothing
//   node tools/codex.mjs --help     this text, and nothing else
//
// WHY THIS IS A SEPARATE SURFACE RATHER THAN MORE PATHS IN install.mjs.
//
// Codex is not Claude Code with different filenames, and one fact decides the design: hooks there
// must be TRUSTED or they are silently skipped (see tools/codex-hooks.mjs). Codex has them — `codex --help` documents
// `--dangerously-bypass-hook-trust`, and the CLI carries PreToolUse / PermissionRequest /
// PostToolUse / PreCompact / PostCompact / SessionStart / SessionEnd / UserPromptSubmit /
// SubagentStart / SubagentStop / Stop / Interrupt, a `command` handler type beside `mcp_tool`, and
// the same hookSpecificOutput / additionalContext / decision / updatedInput wire shape Claude Code
// uses. So everything this package enforces mechanically over there is, for now, carried by an
// instruction the agent follows. That is genuinely weaker and the installed text says so in its
// first paragraph.
//
// THE COMMENT THAT USED TO BE HERE SAID CODEX HAD NO HOOKS AT ALL. It was written from one look
// at `codex --help` that did not find them, and the whole design below was justified by it. An
// absence asserted from a single failed look is not a finding, and `cgc behaviour --only=claims`
// exists because of exactly this shape.
//
// Two things are NOT weaker. `cgc` is a set of Node programs, so every gate, render and audit
// behaves identically on both harnesses. And Codex ships `codex mcp add|list|remove` with
// `--json`, so registration goes through its own CLI and this package never writes a line of
// TOML — which is the same reason the Claude Code side calls `claude mcp` rather than editing
// ~/.claude.json by hand where it can.
//
// AGENTS.md is the user's file FIRST. On this machine it was three kilobytes of their own
// preferences, written before this package existed. So the block goes BELOW what is there,
// between markers, and a refresh replaces only what is between them. That is the opposite shape
// from CLAUDE.md, where the package's content comes first and the user writes below a marker —
// because there the package created the file and here it did not.

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO, buildVars, realize, unresolved, askedForHelp, codexHome, resolveCodexCli } from './paths.mjs'
import { applyHooks, hookPlan, programRuns } from './codex-hooks.mjs'

if (askedForHelp(import.meta.url)) process.exit(0)

const CHECK = process.argv.includes('--check')
const DRY = process.argv.includes('--dry-run')

const BEGIN = '<!-- CGC:BEGIN — managed by Claude-Global-Config; edits between these markers are overwritten -->'
const END = '<!-- CGC:END -->'

const say = (m) => { if (!CHECK) console.log(m) }
const ok = (m) => say(`  \x1b[32mok\x1b[0m    ${m}`)
const warn = (m) => say(`  \x1b[33mwarn\x1b[0m  ${m}`)
const skip = (m) => say(`  \x1b[90mskip\x1b[0m  ${m}`)
const fail = (m) => say(`  \x1b[31mFAIL\x1b[0m  ${m}`)

/** The mandate text with this machine's paths substituted, wrapped in its markers. */
export function codexBlock(vars = buildVars()) {
  const src = readFileSync(join(REPO, 'config', 'AGENTS.md'), 'utf8')
  const text = realize(src, vars)
  const left = unresolved(text)
  if (left.length) throw new Error(`config/AGENTS.md has unresolved tokens: ${left.join(', ')}`)
  return `${BEGIN}\n\n${text.trim()}\n\n${END}\n`
}

/**
 * The text with every fenced code block's CONTENTS blanked to spaces, length and lines preserved,
 * so an index found in the result indexes the original. Markdown fences only — ``` and ~~~ — with
 * the usual rule that a fence closes on a run of at least as many characters of the same kind.
 */
export function maskFences(text) {
  const out = text.split('')
  const lines = text.split('\n')
  let at = 0
  let open = null
  for (const line of lines) {
    const m = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (!open && m && !(m[1][0] === '`' && m[2].includes('`'))) {
      open = m[1]
    } else if (open && m && m[1][0] === open[0] && m[1].length >= open.length && !m[2].trim()) {
      open = null
    } else if (open) {
      for (let k = at; k < at + line.length; k++) out[k] = ' '
    }
    at += line.length + 1
  }
  return out.join('')
}

/**
 * Merge the block into an AGENTS.md, preserving everything outside the markers.
 * @returns {{ text: string, how: 'created'|'appended'|'refreshed'|'unchanged' }}
 */
export function mergeAgents(current, block) {
  if (current == null) return { text: block, how: 'created' }
  // Fenced regions are masked out first: a user who quotes the markers in their own notes — a
  // ```md block showing what CGC writes is the obvious way — is DOCUMENTING them, not declaring a
  // managed region, and the first version replaced everything between the quoted pair.
  const masked = maskFences(current)
  const a = masked.indexOf(BEGIN)
  // LAST end, not first. A stray or reversed END made `indexOf` return a position before BEGIN,
  // which fell through to append — and the appended block's own END was never the first one found
  // either, so every single run appended another copy. Three runs took a 54-byte file to 26 KB.
  const b = masked.lastIndexOf(END)
  if (a >= 0 && b > a) {
    const next = current.slice(0, a) + block.trimEnd() + current.slice(b + END.length)
    return { text: next, how: next === current ? 'unchanged' : 'refreshed' }
  }
  // No markers: their whole file is theirs. The block goes after it, nothing is removed.
  const sep = current.endsWith('\n') ? '\n' : '\n\n'
  return { text: current + sep + block, how: 'appended' }
}

/** The servers this package registers, minus any the manifest marks opt-in. */
export function wantedServers(vars = buildVars()) {
  const manifest = JSON.parse(readFileSync(join(REPO, 'library', 'mcp-servers', 'servers.json'), 'utf8')).servers
  const out = []
  for (const [name, spec] of Object.entries(manifest)) {
    if (spec.registerByDefault === false) continue
    if (!spec.entry) continue                       // a standalone binary is opt-in on both harnesses
    const entry = join(REPO, 'library', 'mcp-servers', 'node_modules', ...spec.entry)
    if (!existsSync(entry)) continue
    out.push({ name, command: vars.NODE, args: [entry, ...(spec.flags || [])] })
  }
  return out
}

function codex(cli, args, timeout = 60000) {
  return spawnSync(cli, args, { encoding: 'utf8', timeout, windowsHide: true })
}

/** What Codex currently has registered, by name. */
function registered(cli) {
  const r = codex(cli, ['mcp', 'list', '--json'])
  if (r.status !== 0) return null
  try {
    const rows = JSON.parse(r.stdout || '[]')
    const by = {}
    for (const row of rows) by[row.name] = row
    return by
  } catch { return null }
}

async function main() {
  const home = codexHome()
  const cli = resolveCodexCli()
  const report = { installed: Boolean(cli), home, cli, agents: null, servers: {}, notes: [] }

  if (!cli) {
    // NOT a failure. Most machines do not have Codex, and a package that reports a missing
    // second harness as broken would be permanently DEGRADED for almost everyone.
    report.notes.push('Codex is not installed on this machine, so there is nothing to configure.')
    if (CHECK) { console.log(JSON.stringify(report, null, 2)); return 0 }
    skip('Codex is not installed — nothing to configure')
    return 0
  }

  const vars = buildVars()
  let block
  try { block = codexBlock(vars) } catch (e) {
    report.notes.push(String(e.message))
    if (CHECK) { console.log(JSON.stringify(report, null, 2)); return 1 }
    warn(String(e.message))
    return 1
  }

  // ── the mandates ──────────────────────────────────────────────────────────────────────────
  const agentsPath = join(home, 'AGENTS.md')
  const current = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : null
  const { text, how } = mergeAgents(current, block)
  report.agents = { path: agentsPath, how, hasMarkers: text.includes(BEGIN) && text.includes(END) }
  if (!CHECK && !DRY && how !== 'unchanged') {
    mkdirSync(home, { recursive: true })
    // A backup before the FIRST write of any kind into a file this package did not create —
    // not only before an append. A user file can hit the 'refreshed' branch on the very first
    // run: quote the BEGIN marker in your own notes (a fenced example of what CGC writes is the
    // obvious way) and the region between your quoted markers is what gets replaced. Keeping the
    // original once, and never overwriting it, is what makes that recoverable instead of gone.
    const backup = `${agentsPath}.cgc-backup`
    if (current != null && !existsSync(backup)) {
      try { copyFileSync(agentsPath, backup) } catch { /* best effort */ }
    }
    writeFileSync(agentsPath, text, 'utf8')
  }
  if (!CHECK) {
    if (how === 'unchanged') skip(`AGENTS.md already current (${agentsPath})`)
    else if (how === 'appended') ok(`AGENTS.md — the block added below your own text, which is untouched (backup written)`)
    else ok(`AGENTS.md ${how} (${agentsPath})`)
  }

  // ── the MCP servers, through Codex's own CLI ───────────────────────────────────────────────
  const have = registered(cli)
  if (have === null) {
    report.notes.push('codex mcp list --json did not answer, so registrations were left alone.')
    warn('codex mcp list did not answer — MCP registration skipped rather than guessed at')
  } else {
    for (const s of wantedServers(vars)) {
      const existing = have[s.name]
      const wantArgs = JSON.stringify([s.command, ...s.args])
      const haveArgs = existing && existing.transport
        ? JSON.stringify([existing.transport.command, ...(existing.transport.args || [])])
        : null
      if (haveArgs === wantArgs) {
        report.servers[s.name] = 'current'
        skip(`${s.name} already registered with Codex`)
        continue
      }
      if (DRY || CHECK) { report.servers[s.name] = existing ? 'stale' : 'missing'; continue }
      // `add` on an existing name is a re-add, so the stale one goes first. Codex owns the TOML.
      if (existing) codex(cli, ['mcp', 'remove', s.name])
      const r = codex(cli, ['mcp', 'add', s.name, '--', s.command, ...s.args], 120000)
      if (r.status === 0) { report.servers[s.name] = 'registered'; ok(`${s.name} registered with Codex`) }
      else {
        report.servers[s.name] = 'failed'
        warn(`${s.name} could not be registered: ${String(r.stderr || r.stdout || '').trim().split('\n')[0]}`)
      }
    }
  }

  // ── the hooks ──────────────────────────────────────────────────────────────────────────────
  // The part that turns the mandate from an instruction into a mechanism. Writing hooks.json is
  // only half of it: an untrusted hook is SILENTLY SKIPPED — no prompt, no error, no log line —
  // so the trust entries have to be read back from Codex and written into its config, and the
  // verdict has to come from Codex rather than from our own file.
  const plan = hookPlan(vars)
  report.hooks = { installed: plan.installed.length, skipped: plan.skipped, program: plan.program.token, trusted: 0, untrusted: [] }
  if (!programRuns(plan.program.token)) {
    report.notes.push(`Codex hooks would be registered to run "${plan.program.token}", which does not run on this machine — ${plan.program.why}`)
    warn(`hooks NOT registered: "${plan.program.token}" does not run here (${plan.program.why})`)
  } else {
    const applied = await applyHooks({ cli, home, vars, dryRun: DRY || CHECK })
    for (const n of applied.notes) report.notes.push(n)
    report.hooks.trusted = applied.trusted
    report.hooks.listed = applied.listed
    report.hooks.untrusted = applied.untrusted.map((u) => `${u.eventName}:${u.trustStatus}`)
    if (applied.configError) report.hooks.configError = applied.configError
    if (!CHECK && !DRY) {
      if (applied.configError) fail(`Codex cannot read its hook config, so no hook runs: ${applied.configError.join('; ').slice(0, 160)}`)
      else if (applied.untrusted.length) warn(`${applied.untrusted.length} hook(s) registered but NOT trusted — an untrusted hook is silently skipped`)
      else ok(`${applied.trusted} hook(s) registered with Codex and trusted`)
    }
  }

  if (CHECK) { console.log(JSON.stringify(report, null, 2)); return 0 }
  say('')
  if (report.hooks.trusted > 0) {
    say(`  ${report.hooks.trusted} hook(s) now run in Codex, so the version check is a mechanism there too.`)
    say(`  ${plan.skipped.length} were left out on purpose; \`cgc install --only=codex\` prints why, and so does`)
    say('  the doctor. A hook that is installed and matches nothing is worse than an absent one.')
  } else {
    say('  No Codex hook is currently trusted, so the version check is an instruction rather than a')
    say('  guarantee: the installed AGENTS.md tells the agent to run session-start-cgc.js first.')
  }
  return 0
}

// argv[1] is undefined under `node -e` and in an embedder, and reading .replace off it threw
// where importing codexBlock was the whole intent.
const entry = process.argv[1] || ''
if (import.meta.url === `file:///${entry.replace(/\\/g, '/')}` || entry.endsWith('codex.mjs')) {
  process.exit(await main())
}
