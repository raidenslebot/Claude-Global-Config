// The headline promise of this package is "no external accounts, no API keys". Until now
// nothing checked it. Connectors were removed by hand and a table was written in the README,
// which is exactly the shape of claim this repo elsewhere refuses to accept: a standard nobody
// checks is a preference. Re-register one OAuth server tomorrow and no test, hook or doctor
// phase would have said a word.
//
// So the mandate is a gate now, in two halves:
//   1. What this package WRITES — install.mjs may only ever register a local `command`
//      server. Asserted against its source, because that is the decision, not its effect.
//   2. What doctor SEES — a URL-addressed server is reported as a policy break, in every
//      scope a server can hide in, including the project-scoped map the old check never read.
//
// Half 2 runs the real doctor against a scratch HOME. Doctor exits non-zero on a scratch
// profile for a dozen unrelated reasons (no mandates, no hooks), so these assert on the
// finding text, never on the exit code.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cgc-mcp-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, '.claude'), { recursive: true })
  return dir
}

/** Run the real doctor against a scratch profile holding this .claude.json. */
function doctorWith(t, config) {
  const home = scratch(t)
  writeFileSync(join(home, '.claude.json'), JSON.stringify(config, null, 2), 'utf8')
  const r = spawnSync(process.execPath, [join(REPO, 'tools', 'doctor.mjs')], {
    cwd: REPO, encoding: 'utf8', timeout: 180000,
    env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1', FORCE_COLOR: '0' },
  })
  return String(r.stdout || '') + String(r.stderr || '')
}

const LOCAL = { command: process.execPath, args: [join(REPO, 'tools', 'doctor.mjs')], env: {} }

test('install.mjs only ever registers a local command server', () => {
  const src = readFileSync(join(REPO, 'tools', 'install.mjs'), 'utf8')
  // The registration site: whatever it assigns into cfg.mcpServers.
  const assignment = src.match(/cfg\.mcpServers\[[^\]]+\]\s*=\s*\{[^}]*\}/)
  assert.ok(assignment, 'could not find where install.mjs registers an MCP server — update this test')
  assert.match(assignment[0], /\bcommand\b/, 'registration must pin a local command')
  assert.doesNotMatch(assignment[0], /\burl\b|\bserverUrl\b|\btype\s*:/,
    'install.mjs registered a URL-addressed server — this package is subscription-only')
  // And the servers it installs are packages fetched to disk, never remote endpoints.
  const list = src.match(/const servers = \[[^\]]*\]/)
  assert.ok(list, 'could not find the MCP package list — update this test')
  assert.doesNotMatch(list[0], /https?:/, 'an MCP server is being pointed at a remote URL')
})

test('doctor accepts a locally installed server', (t) => {
  const out = doctorWith(t, { mcpServers: { playwright: LOCAL } })
  assert.doesNotMatch(out, /external service/, 'a local command server must not trip the mandate check')
  assert.match(out, /playwright/, 'the server was not reported at all')
})

test('doctor fails a URL-addressed server and names the mandate', (t) => {
  const out = doctorWith(t, { mcpServers: { somevendor: { url: 'https://mcp.example.com/sse' } } })
  assert.match(out, /somevendor.*external service/s)
  assert.match(out, /subscription-only/)
  // The old check called this "command not found", which reads as a broken install and
  // sends the reader to fix the wrong thing.
  assert.doesNotMatch(out, /somevendor: command not found/)
})

test('a server declared only by transport type is caught too', (t) => {
  for (const type of ['sse', 'http', 'streamable-http']) {
    const out = doctorWith(t, { mcpServers: { vendor: { type, command: process.execPath } } })
    assert.match(out, /vendor.*external service/s, type)
  }
})

test('a project-scoped server is not invisible — the scope the old check never read', (t) => {
  const out = doctorWith(t, {
    mcpServers: { playwright: LOCAL },
    projects: { 'C:\\somewhere\\a-project': { mcpServers: { vendor: { url: 'https://mcp.example.com' } } } },
  })
  assert.match(out, /vendor.*\(project a-project\).*external service/s,
    'a project-scoped external server was not reported')
})

test('the shipped tree registers no MCP server by URL', () => {
  // config/ is realized onto the machine at install; nothing in it may carry a remote server.
  const files = ['config/hooks.json']
  for (const rel of files) {
    const p = join(REPO, ...rel.split('/'))
    let text = ''
    try { text = readFileSync(p, 'utf8') } catch { continue }
    assert.doesNotMatch(text, /"(url|serverUrl)"\s*:/, `${rel} declares a URL-addressed server`)
  }
})
