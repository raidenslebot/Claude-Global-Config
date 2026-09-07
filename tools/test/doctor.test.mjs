// The doctor's MCP phase, which is the one that reads configuration this package does not own.
//
// Every test here isolates CLAUDE_CONFIG_DIR and HOME so the doctor reads a scratch machine and
// never the real one. What is asserted is the part that went wrong in v1.46.0: a check that
// reads several config files has to know which of them LOAD TOGETHER, and has to grade a
// finding by what can actually be done about it. A FAIL nothing can clear is not a strict
// gate — it is a session-start hook running a full install for ever.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'
import { discard } from './_teardown.mjs'

const TOOL = join(REPO, 'tools', 'doctor.mjs')

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cgc-doctor-'))
  t.after(() => discard(dir))
  return dir
}

/** Run the doctor against a scratch config root and return its JSON. */
function runDoctorJson(dir, extra = {}) {
  const r = spawnSync(process.execPath, [TOOL, '--json'], {
    cwd: REPO, encoding: 'utf8', timeout: 120000,
    // APPDATA/XDG_CONFIG_HOME too: the host application's config is found through them, and a
    // test that left them pointing at the real machine would read the real machine.
    env: {
      ...process.env, CLAUDE_CONFIG_DIR: dir, HOME: dir, USERPROFILE: dir,
      APPDATA: join(dir, 'AppData', 'Roaming'), XDG_CONFIG_HOME: join(dir, '.config'),
      ...extra,
    },
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
  // Asserting the flag is "a boolean" could not fail — push() stamps one on every result. What
  // matters is the value, on the failures where getting it wrong costs an install per session.
  const dupe = j.results.find((r) => /registered 2 times/.test(r.message))
  if (dupe && dupe.level === 'fail') {
    assert.equal(dupe.repairable, false, 'the install the hook runs never passes --dedupe')
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
    pluginUsage: {
      'desktop-commander@inline': { usageCount: 3 },
      'sanity@inline': { usageCount: 1 },
      // The alias case, and the reason this said twelve where seven was true: an INSTALLED
      // plugin also carries an @inline usage record, and keying on name@marketplace counted it
      // twice — naming plugins the doctor had just read from disk as ones it cannot see.
      'superpowers@inline': { usageCount: 9 },
      'superpowers@claude-plugins-official': { usageCount: 9 },
    },
  }), 'utf8')
  mkdirSync(join(d, '.claude', 'plugins'), { recursive: true })
  writeFileSync(join(d, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2, plugins: { 'superpowers@claude-plugins-official': [{ scope: 'user', installPath: join(d, 'sp') }] },
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

test('a remote server is reported at every scope it can hide in', (t) => {
  // The docs claim each scope is planted and proved. Four scopes carry a server, and the
  // grading differs by ownership: user scope is this package's to fix, the rest are not.
  const d = scratch(t)
  const remote = { type: 'http', url: 'https://example.invalid/mcp' }
  const hostDir = process.platform === 'win32' ? join(d, 'AppData', 'Roaming', 'Claude')
    : process.platform === 'darwin' ? join(d, 'Library', 'Application Support', 'Claude')
      : join(d, '.config', 'Claude')
  mkdirSync(hostDir, { recursive: true })
  writeFileSync(join(hostDir, 'claude_desktop_config.json'), JSON.stringify({ mcpServers: { fromHost: remote } }), 'utf8')

  const proj = join(d, 'work')
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { fromProjectFile: remote } }), 'utf8')

  const inst = join(d, '.claude', 'plugins', 'cache', 'm', 'p', '1.0.0')
  mkdirSync(inst, { recursive: true })
  writeFileSync(join(inst, '.mcp.json'), JSON.stringify({ mcpServers: { fromPlugin: remote } }), 'utf8')
  mkdirSync(join(d, '.claude', 'plugins'), { recursive: true })
  writeFileSync(join(d, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { 'p@m': [{ scope: 'user', installPath: inst }] } }), 'utf8')
  writeFileSync(join(d, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'p@m': true } }), 'utf8')

  writeFileSync(join(d, '.claude.json'), JSON.stringify({
    mcpServers: { fromUser: remote },
    projects: { [proj]: { mcpServers: { fromProjectMap: remote } } },
  }), 'utf8')

  const byName = new Map()
  for (const r of runDoctorJson(d).results.filter((x) => /external service/.test(x.message))) {
    byName.set(/^(\w+)/.exec(r.message)[1], r.level)
  }
  assert.equal(byName.get('fromUser'), 'fail', 'user scope is this package\'s own to fix')
  for (const name of ['fromHost', 'fromProjectFile', 'fromPlugin', 'fromProjectMap']) {
    assert.equal(byName.get(name), 'warn', `${name} is reported, and is not this package's to remove`)
  }
})

test('a standalone server that is absent is never a failure the repair loops on, and a vendored one still is', (t) => {
  // The original defect: codebase-memory-mcp is a `bin` the package does not vendor, and the
  // doctor failed "NOT registered" with the default repairable:true. The session-start repair
  // runs mcp-register, which cannot put a binary on disk, so the doctor failed again at every
  // start, resume, clear and compact — DEGRADED plus a full install each time, for ever, on
  // every machine but the author's.
  //
  // It is opt-in now, for a different measured reason (one process per session, 1.07 cores
  // across six windows), so the shape of the protection changed: an opt-in server that is absent
  // must produce NO failure at all. The half that must not move is the second one — a vendored
  // server the repair CAN register is still a failure, or the repair has nothing to act on.
  const d = scratch(t)
  writeFileSync(join(d, '.claude.json'), JSON.stringify({ mcpServers: {} }), 'utf8')
  // Nothing on PATH but node's own directory and the system tools; nothing under LOCALAPPDATA.
  const sys = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32') : '/usr/bin:/bin'
  const j = runDoctorJson(d, {
    LOCALAPPDATA: join(d, 'AppData', 'Local'),
    PATH: [dirname(process.execPath), sys].join(process.platform === 'win32' ? ';' : ':'),
  })
  const optIn = Object.entries(JSON.parse(readFileSync(join(REPO, 'library', 'mcp-servers', 'servers.json'), 'utf8')).servers)
    .filter(([, s]) => s.registerByDefault === false).map(([n]) => n)
  for (const name of optIn) {
    const rows = j.results.filter((r) => r.message.includes(name))
    assert.ok(rows.every((r) => r.level !== 'fail'),
      `${name} is opt-in and absent, which is not a failure:\n${rows.map((r) => r.level + ' ' + r.message).join('\n')}`)
  }
  // A vendored server, by contrast, IS registrable by the repair and stays a failure.
  const vendored = j.results.filter((r) => /is NOT registered/.test(r.message))
  assert.ok(vendored.length >= 1, 'the vendored servers are still failures')
  assert.ok(vendored.every((r) => r.level === 'fail' && r.repairable === true))
})

test('a standalone server registered at a path that is gone does not loop the repair either', (t) => {
  // The other branch of the same check: the binary was deleted or moved, the registration
  // still names the old path. mcp-register writes only servers it FINDS, so failing this as
  // repairable ran an install that never touched the dead entry, and failed again — the loop,
  // reached from the registration side.
  const d = scratch(t)
  const dead = join(d, 'gone', process.platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp')
  writeFileSync(join(d, '.claude.json'), JSON.stringify({ mcpServers: { 'codebase-memory-mcp': { command: dead, args: [], env: {} } } }), 'utf8')
  const sys = process.platform === 'win32' ? join(process.env.SystemRoot || process.env.windir || '', 'System32') : '/usr/bin:/bin'
  const j = runDoctorJson(d, {
    LOCALAPPDATA: join(d, 'AppData', 'Local'),
    PATH: [dirname(process.execPath), sys].join(process.platform === 'win32' ? ';' : ':'),
  })
  const rows = j.results.filter((r) => /codebase-memory-mcp/.test(r.message))
  assert.ok(rows.length >= 1)
  assert.ok(rows.every((r) => r.level !== 'fail'), 'nothing about it is a failure the repair would loop on:\n' + rows.map((r) => r.level + ' ' + r.message).join('\n'))
  const gone = rows.find((r) => /which is gone/.test(r.message))
  assert.ok(gone && /--only=mcp\b/.test(gone.message), 'and the dead registration names the step that re-downloads it')
})

test('a binary that merely MOVED is a repairable failure, and the summary stops claiming it is fine', (t) => {
  // The sibling of the dead-registration case: the registered path is gone, but the binary is
  // somewhere this package looks — which is exactly what mcp-register can put right, so it stays
  // a failure the session-start repair clears. And the summary counted names present in the
  // config, so it said "all 3 … are registered" one line under a warning that one of them
  // cannot start. Registered is not the claim that matters.
  const d = scratch(t)
  const progs = join(d, 'AppData', 'Local', 'Programs', 'codebase-memory-mcp')
  mkdirSync(progs, { recursive: true })
  writeFileSync(join(progs, process.platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp'), '', 'utf8')
  // Every server the manifest requires is registered — the vendored ones at their real entries —
  // so the summary line is reached at all. With one of them missing the doctor takes the
  // "not registered" branch instead and never states the claim under test.
  const want = JSON.parse(readFileSync(join(REPO, 'library', 'mcp-servers', 'servers.json'), 'utf8')).servers
  const mcpServers = {}
  for (const [name, spec] of Object.entries(want)) {
    mcpServers[name] = spec.entry
      ? { command: process.execPath, args: [join(REPO, 'library', 'mcp-servers', 'node_modules', ...spec.entry)], env: {} }
      : { command: join(d, 'gone', 'codebase-memory-mcp.exe'), args: [], env: {} }
  }
  writeFileSync(join(d, '.claude.json'), JSON.stringify({ mcpServers }), 'utf8')
  const sys = process.platform === 'win32' ? join(process.env.SystemRoot || process.env.windir || '', 'System32') : '/usr/bin:/bin'
  const j = runDoctorJson(d, {
    LOCALAPPDATA: join(d, 'AppData', 'Local'),
    PATH: [dirname(process.execPath), sys].join(process.platform === 'win32' ? ';' : ':'),
  })
  const shown = j.results.filter((r) => r.level !== 'ok').map((r) => `${r.level} ${r.message}`).join('\n')
  const moved = j.results.find((r) => /the binary is at/.test(r.message))
  assert.ok(moved, `the move is reported:\n${shown}`)
  assert.equal(moved.level, 'fail')
  assert.equal(moved.repairable, true, 'mcp-register can re-register a binary it can find')
  assert.match(moved.message, /--only=mcp-register/)
  // And nothing claims they are all fine.
  assert.equal(j.results.some((r) => /all \d+ MCP servers this package requires are registered$/.test(r.message)), false,
    'the summary must not contradict the row above it')
  assert.ok(j.results.some((r) => /registered but cannot start/.test(r.message)), 'it names the one that cannot start')
})

test('a VENDORED server whose entry is missing also stops the summary claiming everything is registered', (t) => {
  // The unusable set was populated from the two "command not found" branches only. The pre-
  // existing "server entry missing" branch — which is playwright and context7, i.e. BOTH vendored
  // servers — never marked the name, so the summary printed "all 3 MCP servers this package
  // requires are registered" directly under two FAILs saying their entries do not exist. That is
  // the exact sentence pair the change was written to eliminate, through the branch it missed.
  const d = scratch(t)
  const want = JSON.parse(readFileSync(join(REPO, 'library', 'mcp-servers', 'servers.json'), 'utf8')).servers
  const mcpServers = {}
  for (const [name, spec] of Object.entries(want)) {
    mcpServers[name] = spec.entry
      ? { command: process.execPath, args: [join(d, 'gone', ...spec.entry)], env: {} }   // entry does not exist
      : { command: process.execPath, args: [], env: {} }                                  // a command that resolves
  }
  writeFileSync(join(d, '.claude.json'), JSON.stringify({ mcpServers }), 'utf8')
  const j = runDoctorJson(d, { LOCALAPPDATA: join(d, 'AppData', 'Local') })
  const missing = j.results.filter((r) => /server entry missing/.test(r.message))
  assert.ok(missing.length >= 2, 'both vendored entries are reported:\n' + j.results.filter((r) => r.level !== 'ok').map((r) => r.level + ' ' + r.message).join('\n'))
  assert.equal(j.results.some((r) => /all \d+ MCP servers this package requires are registered$/.test(r.message)), false,
    'the summary must not contradict the rows above it')
  const summary = j.results.find((r) => /registered but cannot start/.test(r.message))
  assert.ok(summary, 'and it names them')
  assert.match(summary.message, /are registered but cannot start/, 'plural, because there are two')
})

test('a server the manifest marks opt-in is neither required nor registered, and is still named', (t) => {
  // A user-scope MCP server starts once per SESSION, so its idle cost is multiplied by the number
  // of open windows. Six copies of codebase-memory-mcp were measured holding 4.46% of a 24-core
  // machine — 1.07 cores — for an index of zero repositories, and killing them returned 0.87
  // cores. So it is installed and left unregistered. The doctor must not then demand it: a
  // requirement that contradicts the reason for the flag is how a flag gets reverted.
  const d = scratch(t)
  const want = JSON.parse(readFileSync(join(REPO, 'library', 'mcp-servers', 'servers.json'), 'utf8')).servers
  const optIn = Object.entries(want).filter(([, s]) => s.registerByDefault === false).map(([n]) => n)
  assert.ok(optIn.length >= 1, 'this test is about opt-in servers, and the manifest marks none')

  const mcpServers = {}
  for (const [name, spec] of Object.entries(want)) {
    if (spec.registerByDefault === false) continue          // exactly what the installer leaves out
    if (spec.entry) mcpServers[name] = { command: process.execPath, args: [join(REPO, 'library', 'mcp-servers', 'node_modules', ...spec.entry)], env: {} }
  }
  writeFileSync(join(d, '.claude.json'), JSON.stringify({ mcpServers }), 'utf8')
  const j = runDoctorJson(d, { LOCALAPPDATA: join(d, 'AppData', 'Local') })

  for (const name of optIn) {
    const rows = j.results.filter((r) => r.message.includes(name))
    assert.ok(rows.length >= 1, `${name} must still be named, or an installed-but-unstarted server is invisible`)
    assert.ok(rows.every((r) => r.level !== 'fail'),
      `${name} is opt-in, so its absence is not a failure:\n${rows.map((r) => r.level + ' ' + r.message).join('\n')}`)
    assert.ok(j.results.some((r) => r.message.includes(name) && /not started in every session/.test(r.message)),
      `${name} should be reported as installed but not started`)
  }
  // And the count must not silently include the one nobody starts.
  const summary = j.results.find((r) => /MCP servers this package requires are registered/.test(r.message))
  assert.ok(summary, 'the summary line is still emitted')
  assert.ok(!summary.message.includes(String(Object.keys(want).length)),
    `the summary counts required servers, not every server in the manifest: "${summary.message}"`)
})

test('the browser server is registered headless, because headed steals focus', () => {
  // Playwright's MCP is headed by default — its own --help says so — and a headed browser opens a
  // real window that takes focus from whatever is fullscreen. That was reported as a cursor
  // appearing over a game. Everything this package asks a browser for renders headless anyway.
  const want = JSON.parse(readFileSync(join(REPO, 'library', 'mcp-servers', 'servers.json'), 'utf8')).servers
  assert.ok(Array.isArray(want.playwright.flags) && want.playwright.flags.includes('--headless'),
    'the manifest must carry --headless for playwright')
  const install = readFileSync(join(REPO, 'tools', 'install.mjs'), 'utf8')
  assert.match(install, /args: \[entry, \.\.\.\(flagsFor\[name\] \|\| \[\]\)\]/,
    'and the installer must actually pass a manifest server its own flags')
})
