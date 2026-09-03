// Every hook this package ships must be REGISTERED, and every registration must ship a hook.
//
// A hook that exists on disk but appears in no event is an orphan: it installs cleanly, passes
// a syntax check, shows up in the hooks directory, and never runs. Nothing reports it. That is
// the same silent-no-op class that once left a set of hooks dead for weeks, and this repo
// shipped a live instance of it — config/hooks/react-doctor.mjs, 4,100 bytes, zero
// registrations — while the docs described the hook system as enforced.
//
// The existing checks could not catch it, and it is worth being precise about why:
//   - doctor.mjs walks settings.hooks and verifies each registration RESOLVES to a file. It
//     never looks in the other direction.
//   - config.test.mjs checks registered -> shipped. Also one direction.
//   - cli.test.mjs asserts the installed hook count is >= 8, a floor, which an orphan passes.
//
// So this asserts SET EQUALITY, both directions. It is safe to state that strongly because
// universality.test.mjs already forbids a hook importing another file, so every file in a hooks
// directory is an entry point rather than a shared helper.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { join, basename } from 'node:path'
import { REPO } from '../paths.mjs'

/** Every hook FILE this package ships, from all three source directories install gathers. */
function shippedHooks() {
  const dirs = [
    join(REPO, 'config', 'hooks'),
    join(REPO, 'argo', 'plugin', 'hooks'),
    join(REPO, 'skills', 'visual-design-mastery', 'hooks'),
  ]
  const out = new Set()
  for (const d of dirs) {
    if (!existsSync(d)) continue
    for (const f of readdirSync(d)) if (/\.(js|mjs|cjs)$/.test(f)) out.add(f)
  }
  return out
}

/** Every hook script NAMED by a registration in the manifest. */
function registeredHooks() {
  const manifest = join(REPO, 'config', 'hooks.json')
  const out = new Set()
  if (!existsSync(manifest)) return out
  const j = JSON.parse(readFileSync(manifest, 'utf8'))
  for (const groups of Object.values(j.hooks || {})) {
    for (const g of groups) {
      for (const h of g.hooks || []) {
        const m = String(h.command || '').match(/([\w.-]+\.(?:js|mjs|cjs))/)
        if (m) out.add(m[1])
      }
    }
  }
  return out
}

test('every shipped hook is registered to an event — no orphans', () => {
  const shipped = shippedHooks()
  const registered = registeredHooks()
  const orphans = [...shipped].filter((f) => !registered.has(f)).sort()
  assert.deepEqual(orphans, [],
    'These hooks install and then never run. Register them in config/hooks.json, or delete '
    + `them — an unregistered hook is dead weight that reads as a working feature:\n  ${orphans.join('\n  ')}`)
})

test('every registration names a hook this package actually ships', () => {
  const shipped = shippedHooks()
  const registered = registeredHooks()
  const missing = [...registered].filter((f) => !shipped.has(f)).sort()
  assert.deepEqual(missing, [],
    'These registrations point at files that do not exist. Claude Code reports nothing when a '
    + `hook script is missing, so the failure is silent:\n  ${missing.join('\n  ')}`)
})

test('every registered hook pins its interpreter rather than relying on PATH', () => {
  // A hook launched via a bare command name dies whenever PATH differs — under a different
  // shell, a service account, or a GUI-launched process. That is how hooks went dead here.
  const manifest = join(REPO, 'config', 'hooks.json')
  if (!existsSync(manifest)) return
  const j = JSON.parse(readFileSync(manifest, 'utf8'))
  for (const [event, groups] of Object.entries(j.hooks || {})) {
    for (const g of groups) {
      for (const h of g.hooks || []) {
        assert.match(String(h.command), /\{\{NODE(?::url)?\}\}/,
          `${event}: ${basename(String(h.command))} does not pin its interpreter`)
      }
    }
  }
})

test('the pre-commit gate is wired by install, not only on the author machine', () => {
  // .githooks/pre-commit runs the secret scanner, and standard-of-work cites it as one of the
  // gates that held with zero escapes. But git only uses it when core.hooksPath points there,
  // and that was configured by hand on one machine — so a fresh clone had no gate at all while
  // the documentation claimed otherwise.
  const install = readFileSync(join(REPO, 'tools', 'install.mjs'), 'utf8')
  assert.match(install, /core\.hooksPath/,
    'install.mjs must run `git config core.hooksPath .githooks`, or the pre-commit secret scan '
    + 'exists only where someone remembered to configure it')

  const hook = join(REPO, '.githooks', 'pre-commit')
  assert.ok(existsSync(hook), '.githooks/pre-commit must exist for the wiring to mean anything')
  assert.match(readFileSync(hook, 'utf8'), /scan-secrets/,
    'the pre-commit gate must still invoke the secret scanner')
})

test('the doctor notices a hook that was REMOVED from settings.json, not only one whose file is gone', (t) => {
  // The doctor walked what settings.json contains, so a hook deleted from it produced no row at
  // all: the check deleted itself along with the registration, 42/42 quietly became 41/41, and
  // the line still read perfect. That is the silent removal the mandates say is impossible.
  const home = mkdtempSync(join(tmpdir(), 'cgc-hookreg-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const config = join(home, '.claude')
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config }
  const doctor = () => {
    const r = spawnSync(process.execPath, [join(REPO, 'tools', 'doctor.mjs'), '--json'],
      { cwd: REPO, encoding: 'utf8', timeout: 300000, env })
    try { return JSON.parse(r.stdout) } catch { return null }
  }
  const install = spawnSync(process.execPath, [join(REPO, 'tools', 'install.mjs'), '--only=config,hooks'],
    { cwd: REPO, encoding: 'utf8', timeout: 300000, env })
  assert.equal(install.status, 0, install.stdout.slice(-600))

  const settings = join(config, 'settings.json')
  const before = doctor()
  assert.ok(before, 'the doctor answered with JSON')
  const failsOf = (j) => j.results.filter((x) => x.level === 'fail').map((x) => x.message)
  const baseline = failsOf(before)
  assert.ok(before.results.some((r) => /hooks this package requires are registered/.test(r.message)),
    'the doctor states how many hooks it requires')

  const original = readFileSync(settings, 'utf8')
  const j = JSON.parse(original)
  for (const arr of Object.values(j.hooks || {})) for (const g of arr) g.hooks = (g.hooks || []).filter((h) => !/post-tool-slop/.test(String(h.command)))
  writeFileSync(settings, JSON.stringify(j, null, 2))

  const after = failsOf(doctor())
  const fresh = after.filter((m) => !baseline.includes(m))
  assert.ok(fresh.some((m) => /post-tool-slop\.js is NOT registered/.test(m)),
    `the doctor did not notice the hook was unregistered. New failures: ${JSON.stringify(fresh)}`)

  writeFileSync(settings, original)
  assert.deepEqual(failsOf(doctor()), baseline, 'and it goes quiet again when the registration is back')
})

test('the doctor notices an MCP server that was removed from the registrations, and the repair puts it back', (t) => {
  // Same shape as the hook case: the check enumerated what ~/.claude.json CONTAINS, so a server
  // deleted from it produced no row at all. And the phase that registers them fetched packages
  // over the network, so the session repair could not afford to run it — a machine where this
  // was installed before Claude Code had ever run never got its servers registered at all.
  const home = mkdtempSync(join(tmpdir(), 'cgc-mcpreg-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const config = join(home, '.claude')
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config }
  const tool = (script, args) => spawnSync(process.execPath, [join(REPO, 'tools', script), ...args],
    { cwd: REPO, encoding: 'utf8', timeout: 300000, env })
  const doctor = () => { try { return JSON.parse(tool('doctor.mjs', ['--json']).stdout) } catch { return null } }
  const failsOf = (j) => j.results.filter((x) => x.level === 'fail').map((x) => x.message)

  mkdirSync(config, { recursive: true })
  const claudeJson = join(config, '.claude.json')
  writeFileSync(claudeJson, JSON.stringify({ mcpServers: {} }, null, 2))

  // Registration alone must not need the network: it is what the session repair runs.
  const started = Date.now()
  assert.equal(tool('install.mjs', ['--only=config,hooks,mcp-register']).status, 0)
  assert.ok(Date.now() - started < 60000, 'mcp-register must not fetch anything')

  const wanted = JSON.parse(readFileSync(join(REPO, 'library', 'mcp-servers', 'servers.json'), 'utf8')).servers
  const registered = JSON.parse(readFileSync(claudeJson, 'utf8')).mcpServers
  for (const name of Object.keys(wanted)) assert.ok(registered[name], `${name} was not registered`)

  const before = doctor()
  const baseline = failsOf(before)
  assert.ok(before.results.some((r) => /MCP servers this package requires are registered/.test(r.message)))

  const j = JSON.parse(readFileSync(claudeJson, 'utf8'))
  delete j.mcpServers.playwright
  writeFileSync(claudeJson, JSON.stringify(j, null, 2))
  const fresh = failsOf(doctor()).filter((m) => !baseline.includes(m))
  assert.ok(fresh.some((m) => /"playwright" is NOT registered/.test(m)), `not noticed. New failures: ${JSON.stringify(fresh)}`)

  // And the repair the session hook runs puts it back.
  assert.equal(tool('install.mjs', ['--only=config,hooks,skills,deps,mcp-register']).status, 0)
  assert.ok(JSON.parse(readFileSync(claudeJson, 'utf8')).mcpServers.playwright, 'the repair did not re-register it')
  // The repair also links the skills, so the failure list legitimately shrinks; what has to be
  // true is that this particular alarm has stopped.
  assert.ok(!failsOf(doctor()).some((m) => /"playwright" is NOT registered/.test(m)), 'the doctor still says it is unregistered')
})
