// The doctor's MCP phase, which is the one that reads configuration this package does not own.
//
// Every test here isolates CLAUDE_CONFIG_DIR and HOME so the doctor reads a scratch machine and
// never the real one. What is asserted is the part that went wrong in v1.46.0: a check that
// reads several config files has to know which of them LOAD TOGETHER, and has to grade a
// finding by what can actually be done about it. A FAIL nothing can clear is not a strict
// gate — it is a session-start hook running a full install for ever.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'

const TOOL = join(REPO, 'tools', 'doctor.mjs')

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cgc-doctor-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Run the doctor against a scratch config root and return its JSON. */
function runDoctorJson(dir) {
  const r = spawnSync(process.execPath, [TOOL, '--json'], {
    cwd: REPO, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir, HOME: dir, USERPROFILE: dir },
  })
  const out = r.stdout || ''
  const at = out.indexOf('{')
  assert.ok(at >= 0, `the doctor produced no JSON:\n${out.slice(-500)}${r.stderr || ''}`)
  return JSON.parse(out.slice(at))
}

test('a duplicate is only a duplicate among scopes that load together', (t) => {
  // A project-scoped server loads only in that project's sessions, so the same name in two
  // different projects is one server in each — never two in one. Reporting that as a duplicate
  // was a false positive on an ordinary setup, and because it was a FAIL the session hook then
  // ran a full install at every start, for ever, over something no install can change.
  const d = scratch(t)
  writeFileSync(join(d, 'x.js'), '', 'utf8')
  writeFileSync(join(d, '.claude.json'), JSON.stringify({
    mcpServers: {},
    projects: {
      [join(d, 'alpha')]: { mcpServers: { serena: { command: process.execPath, args: [join(d, 'x.js')] } } },
      [join(d, 'beta')]: { mcpServers: { serena: { command: process.execPath, args: [join(d, 'x.js')] } } },
    },
  }), 'utf8')
  const j = runDoctorJson(d)
  const dupes = j.results.filter((r) => /registered \d+ times/.test(r.message))
  assert.deepEqual(dupes.map((r) => r.message), [], 'two projects are not one session')
})

test('a name in the user scope AND one project is a duplicate in that project', (t) => {
  // The true positive the scope rule must keep: both load in a session opened in that project.
  const d = scratch(t)
  writeFileSync(join(d, 'x.js'), '', 'utf8')
  const server = { command: process.execPath, args: [join(d, 'x.js')] }
  writeFileSync(join(d, '.claude.json'), JSON.stringify({
    mcpServers: { serena: server },
    projects: { [join(d, 'alpha')]: { mcpServers: { serena: server } } },
  }), 'utf8')
  const j = runDoctorJson(d)
  const dupes = j.results.filter((r) => /"serena" is registered 2 times/.test(r.message))
  assert.equal(dupes.length, 1, 'user scope plus that project is two servers in one session')
})

test('a failure this package cannot repair does not ask the installer to try', (t) => {
  // verify() re-runs the whole install whenever the doctor reports any failure. A finding an
  // install has no power over therefore meant an install at EVERY session start and a
  // permanent DEGRADED — the same per-session multiplication these checks exist to catch.
  const d = scratch(t)
  writeFileSync(join(d, '.claude.json'), JSON.stringify({
    mcpServers: {},
    projects: { [join(d, 'p')]: { mcpServers: { remote: { type: 'http', url: 'https://example.invalid/mcp' } } } },
  }), 'utf8')
  const j = runDoctorJson(d)
  const remote = j.results.filter((r) => /external service/.test(r.message))
  assert.equal(remote.length, 1, 'the remote server is still reported')
  assert.equal(remote[0].level, 'warn', 'but not as a broken install: it is not this package\'s to remove')
  for (const r of j.results.filter((x) => x.level === 'fail')) {
    assert.equal(typeof r.repairable, 'boolean', 'every failure states whether an install could fix it')
  }
})

test('a remote server this package DID register is still a failure', (t) => {
  // The mandate binds what this package writes. Scoping it must not switch it off.
  const d = scratch(t)
  writeFileSync(join(d, '.claude.json'), JSON.stringify({
    mcpServers: { rented: { type: 'http', url: 'https://example.invalid/mcp' } },
  }), 'utf8')
  const j = runDoctorJson(d)
  const remote = j.results.filter((r) => /external service/.test(r.message))
  assert.equal(remote.length, 1)
  assert.equal(remote[0].level, 'fail', 'subscription-only is not optional at user scope')
  assert.equal(remote[0].repairable, true)
})

test('a project .mcp.json is read, because Claude Code reads it', (t) => {
  // The commonest project-level duplicate lived in a file the check never opened.
  const d = scratch(t)
  writeFileSync(join(d, 'x.js'), '', 'utf8')
  const proj = join(d, 'work')
  mkdirSync(proj, { recursive: true })
  const server = { command: process.execPath, args: [join(d, 'x.js')] }
  writeFileSync(join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { shared: server } }), 'utf8')
  writeFileSync(join(d, '.claude.json'), JSON.stringify({
    mcpServers: { shared: server },
    projects: { [proj]: {} },
  }), 'utf8')
  const j = runDoctorJson(d)
  assert.ok(j.results.some((r) => /"shared" is registered 2 times/.test(r.message)),
    'the project file loads alongside the user scope and must be counted')
})

test('the process count says what it could not count', (t) => {
  // Plugins the host application manages register their servers at runtime; no file on disk
  // describes them, and at least one starts two node processes in every session. Reporting
  // "about 3 per session" while a whole category is invisible is the same defect this phase
  // exists to catch — so the number is "at least", and it names what it left out.
  const d = scratch(t)
  writeFileSync(join(d, 'x.js'), '', 'utf8')
  writeFileSync(join(d, '.claude.json'), JSON.stringify({
    mcpServers: { local: { command: process.execPath, args: [join(d, 'x.js')] } },
    // Used, but in no installed-plugins registry: the host application owns it.
    pluginUsage: { 'desktop-commander@inline': { usageCount: 3 }, 'sanity@inline': { usageCount: 1 } },
  }), 'utf8')
  const j = runDoctorJson(d)
  const count = j.results.find((r) => /MCP process\(es\) per session/.test(r.message))
  assert.ok(count, 'the per-session cost is reported')
  assert.match(count.message, /at least/, 'never a bare number when a category is invisible')
  assert.match(count.message, /2 host-application plugin\(s\)/)
  assert.match(count.message, /desktop-commander@inline/)
  assert.equal(count.level, 'ok', 'a caveat nobody can clear is not a warning')
})

test('a machine with no host-managed plugins gets no caveat', (t) => {
  const d = scratch(t)
  writeFileSync(join(d, 'x.js'), '', 'utf8')
  writeFileSync(join(d, '.claude.json'), JSON.stringify({
    mcpServers: { local: { command: process.execPath, args: [join(d, 'x.js')] } },
  }), 'utf8')
  const count = runDoctorJson(d).results.find((r) => /MCP process\(es\) per session/.test(r.message))
  assert.doesNotMatch(count.message, /host-application/, 'nothing invisible, nothing to disclose')
})
