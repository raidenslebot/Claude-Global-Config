// codex-hooks.mjs — register this package's hooks with Codex, and get them TRUSTED.
//
// Codex has a full hook system and this package spent a release claiming it did not. The claim
// came from reading `codex --help` once and not finding one; `codex --help` documents
// `--dangerously-bypass-hook-trust`, and the CLI carries the same twelve events Claude Code has.
// Everything below was established by running the thing, not by reading about it.
//
// WHAT IS THE SAME AS CLAUDE CODE
//   - `$CODEX_HOME/hooks.json`, top level `{ "hooks": { "<Event>": [ { matcher?, hooks: [...] } ] } }`
//   - handler `{ "type": "command", "command": "...", "timeout": <seconds> }`
//   - the payload arrives on STDIN as JSON, with session_id, cwd, hook_event_name, and `source`
//     ∈ startup|resume|clear|compact on SessionStart, exactly as here
//   - stdout `{ "hookSpecificOutput": { "hookEventName": ..., "additionalContext": ... } }` is
//     honoured; it lands as a developer-role message in the conversation, which is precisely what
//     the CGC status line needs
//
// THE TWO THINGS THAT ARE NOT, AND BOTH OF THEM BITE
//
// 1. UNTRUSTED HOOKS ARE SILENTLY SKIPPED. Not a prompt, not an error, not a log line — a freshly
//    written hooks.json loads, reports `enabled: true`, and does nothing at all. Measured: three
//    hooks written, `hooks/list` reported all three `trustStatus: "untrusted"`, and no session ran
//    one. So writing the file is NOT installing the hook, and an installer that stopped there
//    would report success while enforcing nothing — the exact defect this package's own gate is
//    named after. Trust is persisted per handler in `$CODEX_HOME/config.toml`:
//
//        [hooks.state.'<sourcePath>:<snake_case_event>:<group>:<handler>']
//        enabled = true
//        trusted_hash = "sha256:<hex>"
//
//    The key is an exact match on the path as the running session resolves it, and the hash is
//    over normalised handler content, so BOTH are read back from the app-server rather than
//    computed here. Change a command and the hash changes and trust reverts by itself, which is
//    the behaviour you want from a trust store and the reason not to guess at its formula.
//
// 2. THERE IS NO SHELL, and quotes are honoured on arguments but NOT on the program token. So
//    `"C:\Program Files\nodejs\node.exe" hook.js` fails — quoted or not, a program path with a
//    space in it is unusable. A bare name resolved through PATH works, and so does an unquoted
//    space-free absolute path. That is what `program()` below picks between.

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { REPO, IS_WIN, buildVars, realize } from './paths.mjs'

/**
 * The events whose payload means the same thing on both harnesses.
 *
 * PreToolUse and PostToolUse are deliberately NOT here. They exist in Codex and they would load
 * and trust perfectly — and then never fire, because this package's tool hooks match `Write|Edit|
 * MultiEdit` and Codex's tools are `exec`, `spawn_agent`, `send_message`, `wait`, `list_agents`
 * (counted from this machine's own session rollouts: exec 108, send_message 13, spawn_agent 3).
 * A hook that is installed, trusted, and matches nothing is worse than an absent one, because
 * everything reports healthy. When those hooks learn Codex's tool names they belong here too.
 */
export const PORTABLE_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'Stop'])

/**
 * Hooks that mean nothing on Codex even on a portable event, with the reason each is left out.
 * A skip with no reason is indistinguishable from an oversight.
 */
export const NOT_PORTABLE = {
  'user-prompt-model-policy.js': 'routes Claude Code\'s Agent tool by coarse model alias; Codex has no such aliases',
  'restore-dispatch.js': "restores Claude Code's own dispatch settings, which Codex does not have",
}

/** How Codex must be told to run node here: see note 2 at the top of this file. */
export function program(nodePath) {
  const abs = String(nodePath || process.execPath)
  // An unquoted absolute path is only safe when it has no whitespace, because the command string
  // is split on whitespace and the program token cannot be quoted.
  if (abs && !/\s/.test(abs)) return { token: abs, why: 'absolute path, no whitespace' }
  return { token: IS_WIN ? 'node' : 'node', why: `resolved through PATH because ${abs} contains a space, and the program token cannot be quoted` }
}

/**
 * Translate this package's hooks manifest into a Codex hooks document.
 * @returns {{ doc: object, installed: Array, skipped: Array, program: object }}
 */
export function hookPlan(vars = buildVars(), manifestPath = join(REPO, 'config', 'hooks.json')) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const prog = program(vars.NODE)
  const doc = { hooks: {} }
  const installed = []
  const skipped = []

  for (const [event, groups] of Object.entries(manifest.hooks || {})) {
    for (const group of groups) {
      const out = []
      for (const h of group.hooks || []) {
        const file = (String(h.command).match(/hooks\/([A-Za-z0-9._-]+)/) || [])[1] || String(h.command)
        if (!PORTABLE_EVENTS.has(event)) { skipped.push({ event, file, why: `Codex fires ${event}, but this package's ${event} hooks match Claude Code's tool names` }); continue }
        if (NOT_PORTABLE[file]) { skipped.push({ event, file, why: NOT_PORTABLE[file] }); continue }
        // The script path is an ARGUMENT, so it may be quoted, which is what makes a path with a
        // space work at all.
        const script = realize('{{CONFIG_ROOT:url}}/hooks/', vars) + file
        out.push({ type: 'command', command: `${prog.token} "${script}"`, timeout: h.timeout || 30 })
        installed.push({ event, file })
      }
      if (out.length) (doc.hooks[event] ||= []).push(group.matcher ? { matcher: group.matcher, hooks: out } : { hooks: out })
    }
  }
  return { doc, installed, skipped, program: prog }
}

/** One JSON-RPC round trip to `codex app-server`. Needs no model turn, so it costs nothing. */
export function listHooks(cli, home, cwd, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cli, ['app-server'], { env: { ...process.env, CODEX_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    } catch (e) { resolve({ rows: null, error: String(e.message) }); return }

    let buf = ''
    const frames = []
    let done = false
    const finish = (v) => { if (done) return; done = true; try { child.kill() } catch { /* already gone */ } resolve(v) }

    child.on('error', (e) => finish({ rows: null, error: String(e.message) }))
    child.stdout.on('data', (d) => {
      buf += d
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1)
        if (!line.trim()) continue
        let m = null
        try { m = JSON.parse(line) } catch { continue }
        frames.push(m)
        if (m.id === 2) {
          if (m.error) finish({ rows: null, error: JSON.stringify(m.error).slice(0, 200) })
          else finish({
            rows: (m.result?.data || []).flatMap((d) => d.hooks || []),
            warnings: (m.result?.data || []).flatMap((d) => d.warnings || []),
            // errors[] is NOT decoration. A duplicate key in config.toml makes hooks/list return
            // ZERO hooks from every layer and put the reason here alone — so a reader that takes
            // an empty rows[] at face value cannot tell "no hooks configured" from "every hook
            // just died". That is the exact shape an append-based installer produces on its
            // second run, which is why this is surfaced and treated as fatal below.
            errors: (m.result?.data || []).flatMap((d) => d.errors || []),
          })
        }
      }
    })

    const send = (o) => { try { child.stdin.write(`${JSON.stringify(o)}\n`) } catch { /* the finish path reports it */ } }
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'cgc', title: 'cgc', version: '1' }, capabilities: { experimentalApi: true } } })
    setTimeout(() => send({ jsonrpc: '2.0', id: 2, method: 'hooks/list', params: { cwds: [cwd] } }), 1200)
    setTimeout(() => finish({ rows: null, error: `no answer from hooks/list within ${timeoutMs} ms` }), timeoutMs)
  })
}

const STATE_BLOCK = /^\[hooks\.state\.(?:'([^']*)'|"([^"]*)")\][^[]*/gm

/**
 * Merge trust entries into a config.toml's text, replacing any entry for the same key and leaving
 * every other line of the user's file exactly as it was.
 */
export function mergeTrust(toml, rows) {
  const wanted = new Map(rows.map((r) => [r.key, r.currentHash]))
  // Drop existing blocks for keys we are about to restate. Anything else — a hook the user
  // trusted themselves, a stale entry for a path we no longer write — is left alone.
  const kept = String(toml || '').replace(STATE_BLOCK, (block, a, b) => (wanted.has(a ?? b) ? '' : block))
  const added = [...wanted].map(([key, hash]) =>
    `[hooks.state.'${key}']\nenabled = true\ntrusted_hash = "${hash}"\n`).join('\n')
  // A duplicate key is not a cosmetic defect: Codex answers hooks/list with ZERO hooks from every
  // layer and reports the reason only in errors[], so every hook on the machine stops firing and
  // the surface that would tell you says "none configured". Refuse to write one.
  const keys = [...String(kept).matchAll(STATE_BLOCK)].map((m) => m[1] ?? m[2]).concat([...wanted.keys()])
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
  if (dupes.length) throw new Error(`refusing to write a duplicate trust key, which would silence every Codex hook: ${dupes[0]}`)
  const sep = kept.length && !kept.endsWith('\n\n') ? (kept.endsWith('\n') ? '\n' : '\n\n') : ''
  return `${kept}${sep}${added}`
}

/** Read back which of `rows` config.toml currently trusts, by key. */
export function trustedKeys(toml) {
  const out = new Set()
  for (const m of String(toml || '').matchAll(STATE_BLOCK)) {
    const key = m[1] ?? m[2]
    if (/enabled\s*=\s*true/.test(m[0]) && /trusted_hash\s*=/.test(m[0])) out.add(key)
  }
  return out
}

/**
 * Write the hooks document and trust every handler in it.
 * @returns {Promise<{ wrote: boolean, listed: number, trusted: number, untrusted: Array, notes: Array }>}
 */
export async function applyHooks({ cli, home, vars = buildVars(), dryRun = false, cwd = REPO }) {
  const notes = []
  const plan = hookPlan(vars)
  const target = join(home, 'hooks.json')
  const next = `${JSON.stringify(plan.doc, null, 2)}\n`
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null
  const wrote = current !== next

  // A dry run still READS. The doctor's whole question is "is a hook trusted right now", and
  // answering it with zeros because nothing was written would report a machine enforcing nothing
  // as a machine with nothing to report — which is the failure this file exists to prevent.
  if (dryRun) {
    const seen = await listHooks(cli, home, cwd)
    if (seen.errors?.length) return { wrote, listed: 0, trusted: 0, untrusted: [], configError: seen.errors, plan, notes: [`Codex cannot read its hook config: ${seen.errors.join('; ').slice(0, 300)}`] }
    const mine = (seen.rows || []).filter((r) => samePath(r.sourcePath, target))
    const bad = mine.filter((r) => r.trustStatus !== 'trusted' && r.trustStatus !== 'managed')
    return {
      wrote, listed: mine.length, trusted: mine.length - bad.length, untrusted: bad, plan,
      // Only the out-of-date case is worth saying. 'everything is current' as a NOTE became a
      // warning in the doctor, and a warning that fires on every healthy run is the thing this
      // package has already learned to stop shipping.
      notes: wrote ? ['hooks.json is out of date and was NOT written (dry run)'] : [],
    }
  }

  if (wrote) {
    mkdirSync(home, { recursive: true })
    // A hooks.json this package did not write is backed up once, and never overwritten after.
    const backup = `${target}.cgc-backup`
    if (current != null && !existsSync(backup)) { try { copyFileSync(target, backup) } catch { /* best effort */ } }
    writeFileSync(target, next, 'utf8')
  }

  const listed = await listHooks(cli, home, cwd)
  // An empty rows[] with a non-empty errors[] is Codex saying "I could not read the config", and
  // it looks exactly like "you have no hooks". Never conflate the two.
  if (listed.errors?.length) {
    notes.push(`Codex could not read its own hook config, so NOTHING is registered: ${listed.errors.join('; ').slice(0, 300)}`)
    return { wrote, listed: 0, trusted: 0, untrusted: [], configError: listed.errors, plan, notes }
  }
  if (!listed.rows) {
    // NOT silently ok. Unverified trust means the hooks may be loaded and skipped, which looks
    // identical to working from every other angle.
    notes.push(`codex app-server hooks/list did not answer (${listed.error}) — the hooks were written but NOT trusted, and an untrusted hook is silently skipped`)
    return { wrote, listed: 0, trusted: 0, untrusted: [], plan, notes }
  }
  for (const w of listed.warnings || []) notes.push(`Codex: ${w}`)

  const ours = listed.rows.filter((r) => samePath(r.sourcePath, target))
  const cfg = join(home, 'config.toml')
  const before = existsSync(cfg) ? readFileSync(cfg, 'utf8') : ''
  const needed = ours.filter((r) => r.trustStatus !== 'trusted' && r.trustStatus !== 'managed')
  if (needed.length) {
    const backup = `${cfg}.cgc-backup`
    if (before && !existsSync(backup)) { try { copyFileSync(cfg, backup) } catch { /* best effort */ } }
    writeFileSync(cfg, mergeTrust(before, ours), 'utf8')
  }

  // Read it back from Codex, not from our own file: the only statement worth making is the one
  // Codex agrees with.
  const after = await listHooks(cli, home, cwd)
  if (after.errors?.length) {
    notes.push(`the trust write left Codex unable to read its config, so NOTHING is registered: ${after.errors.join('; ').slice(0, 300)}`)
    return { wrote, listed: 0, trusted: 0, untrusted: [], configError: after.errors, plan, notes }
  }
  const rows = (after.rows || ours).filter((r) => samePath(r.sourcePath, target))
  const untrusted = rows.filter((r) => r.trustStatus !== 'trusted' && r.trustStatus !== 'managed')
  return { wrote, listed: rows.length, trusted: rows.length - untrusted.length, untrusted, plan, notes }
}

/**
 * Do two path strings name the same file?
 *
 * A plain string compare is not enough and the failure is silent: `tmpdir()` hands back the 8.3
 * short form `C:\Users\ADMINI~1\…` while Codex reports the long `C:\Users\Administrator\…`, so
 * every row was filtered out, nothing was trusted, and the installer reported a clean run having
 * enforced nothing. realpathSync collapses both to the same answer; the fallback only matters for
 * a path that no longer exists, where the raw compare is all there is.
 */
export function samePath(a, b) {
  // realpathSync.native, not realpathSync: the plain one PRESERVES a Windows 8.3 short name, so
  // `C:\Users\ADMINI~1\…` stayed short, Codex's `C:\Users\Administrator\…` stayed long, and the
  // two never compared equal. That is what made the first version of this filter match nothing.
  const real = (p) => {
    const s = String(p || '')
    try { return realpathSync.native(s) } catch { /* not on disk yet */ }
    try { return realpathSync(s) } catch { return s }
  }
  return real(a).replace(/[\\/]+/g, '/').toLowerCase() === real(b).replace(/[\\/]+/g, '/').toLowerCase()
}

/** Whether this machine can run the program token the plan chose. */
export function programRuns(token) {
  const r = spawnSync(token, ['--version'], { encoding: 'utf8', timeout: 20000, windowsHide: true, shell: false })
  return r.status === 0 ? String(r.stdout || '').trim() : null
}
