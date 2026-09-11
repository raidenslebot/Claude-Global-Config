// Codex, the second harness — and the one file this package writes that belonged to the user
// first.
//
// Codex has NO HOOKS: no SessionStart, no UserPromptSubmit. Everything CGC enforces mechanically
// in Claude Code is, over there, an instruction the agent is asked to follow, and the installed
// text says so in its first paragraph. So the few things that ARE mechanical on that side are
// exactly what is tested here: that the merge never eats a line the user wrote, that the text
// installed carries no token that failed to resolve, and that a machine with no Codex on it
// reports nothing to do rather than a failure — because most machines have no Codex, and a
// package that calls that broken is permanently DEGRADED for almost everyone.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO, unresolved } from '../paths.mjs'
import { codexBlock, mergeAgents, wantedServers } from '../codex.mjs'
import { discard } from './_teardown.mjs'

const TOOL = join(REPO, 'tools', 'codex.mjs')

// The markers are a wire format — the installer writes them, the doctor reads them, and every
// later refresh finds its region by them. They are spelled out here rather than read back off
// codexBlock(), so that changing either one has to be a decision instead of a no-op.
const BEGIN = '<!-- CGC:BEGIN — managed by Claude-Global-Config; edits between these markers are overwritten -->'
const END = '<!-- CGC:END -->'

const BLOCK = codexBlock()

// 77 lines of somebody else's preferences, because that is the file this actually met on a real
// machine: an AGENTS.md written before this package existed. A three-line fixture would not
// notice a merge that keeps the first line and the last and loses the middle.
const USER = `${Array.from({ length: 77 }, (_, i) => (
  i === 0 ? '# My own instructions' : `- rule ${i}: ask me before running anything that writes`
)).join('\n')}\n`

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cgc-codex-'))
  t.after(() => discard(dir))
  return dir
}

test('with no AGENTS.md at all, the merge creates one holding the block and nothing else', () => {
  const r = mergeAgents(null, BLOCK)
  assert.equal(r.how, 'created')
  assert.equal(r.text, BLOCK)
})

test("a user's own AGENTS.md survives the append byte for byte, with the block below it", () => {
  const r = mergeAgents(USER, BLOCK)
  assert.equal(r.how, 'appended')
  // The one assertion that matters. Not "contains a line of it" — the whole file, unaltered.
  assert.ok(r.text.includes(USER), 'the user file was altered or truncated by the append')
  assert.ok(r.text.startsWith(USER), 'their text must stay at the top; AGENTS.md is theirs first')
  assert.ok(r.text.indexOf(BEGIN) >= USER.length, 'the block landed inside their text, not below it')
  assert.ok(r.text.includes(BLOCK.trimEnd()), 'the block itself did not arrive whole')
  assert.equal(r.text.split(BEGIN).length - 1, 1, 'more than one managed region')
})

test('running the merge again over its own output changes not one byte', () => {
  const installed = mergeAgents(USER, BLOCK).text
  const r = mergeAgents(installed, BLOCK)
  assert.equal(r.how, 'unchanged')
  assert.equal(r.text, installed)
})

test('a stale block is replaced, and the user text on BOTH sides of it is kept', () => {
  const above = '# My own instructions\n\n- always run the tests before you tell me it works\n'
  const below = '## Notes I keep at the bottom\n\n- never force-push my branches\n'
  const stale = `${above}\n${BEGIN}\n\nOLD MANDATE naming {{LIBRARY_ROOT}}, which nothing substituted\n\n${END}\n\n${below}`

  const r = mergeAgents(stale, BLOCK)
  assert.equal(r.how, 'refreshed')
  assert.ok(!r.text.includes('OLD MANDATE'), 'the stale block is still there')
  assert.deepEqual(unresolved(r.text), [], 'a token from the stale block survived the refresh')
  assert.ok(r.text.includes(above), 'the text above the markers was lost')
  assert.ok(r.text.includes(below), 'the text below the markers was lost')
  assert.ok(r.text.indexOf(above) < r.text.indexOf(BEGIN), 'their text moved below the block')
  assert.ok(r.text.indexOf(below) > r.text.indexOf(END), 'their closing text moved above the block')
  assert.ok(r.text.includes(BLOCK.trimEnd()), 'the fresh block did not arrive whole')

  // And a refresh settles: the second run has nothing left to do.
  const again = mergeAgents(r.text, BLOCK)
  assert.equal(again.how, 'unchanged')
  assert.equal(again.text, r.text)
})

test('codexBlock resolves this machine into the text and refuses to ship a token that did not', () => {
  assert.ok(BLOCK.startsWith(BEGIN), 'the block does not open with the BEGIN marker')
  assert.ok(BLOCK.trimEnd().endsWith(END), 'the block does not close with the END marker')
  assert.deepEqual(unresolved(BLOCK), [], 'an unsubstituted {{TOKEN}} would install as literal text')
  assert.ok(BLOCK.slice(BEGIN.length, BLOCK.indexOf(END)).trim().length > 0, 'the markers are empty')

  // The guard has to FIRE, not merely exist: an empty table resolves nothing.
  assert.throws(() => codexBlock({}), /unresolved/i, 'an unresolvable table installed silently')

  // And what it does resolve is the table it was handed, not the ambient machine.
  const names = unresolved(readFileSync(join(REPO, 'config', 'AGENTS.md'), 'utf8'))
  assert.ok(names.length, 'config/AGENTS.md carries no tokens — this check proves nothing now')
  const table = Object.fromEntries(names.map((n) => [n, `/sentinel/${n}`]))
  const realized = codexBlock(table)
  for (const n of names) {
    assert.ok(realized.includes(`/sentinel/${n}`), `{{${n}}} was not substituted from the table`)
  }
})

test('wantedServers skips what the manifest marks opt-in and returns only servers present on disk', () => {
  const dir = join(REPO, 'library', 'mcp-servers')
  const manifest = JSON.parse(readFileSync(join(dir, 'servers.json'), 'utf8')).servers
  const optIn = Object.keys(manifest).filter((n) => manifest[n].registerByDefault === false)
  assert.ok(optIn.length, 'nothing in the manifest is opt-in any more — this test would pass vacuously')

  const got = wantedServers()
  const names = got.map((s) => s.name)
  for (const n of optIn) {
    assert.ok(!names.includes(n), `${n} is registerByDefault:false and was registered anyway`)
  }
  // The other direction, so "return nothing at all" cannot satisfy the rule above.
  for (const [n, spec] of Object.entries(manifest)) {
    if (spec.registerByDefault === false || !spec.entry) continue
    if (!existsSync(join(dir, 'node_modules', ...spec.entry))) continue   // not installed on this machine
    assert.ok(names.includes(n), `${n} is installed and default-registered but was left out`)
  }
  for (const s of got) {
    assert.ok(typeof s.command === 'string' && s.command.length, `${s.name} has no command to run`)
    assert.ok(Array.isArray(s.args) && s.args.length, `${s.name} has no args`)
    assert.ok(existsSync(s.args[0]), `${s.name} would be registered pointing at ${s.args[0]}, which is not there`)
  }
})

test('an opt-in server is left out even when it IS installed and could be registered', (t) => {
  // Needed because the only registerByDefault:false server in the real manifest also has no
  // entry point, so it is skipped for two reasons at once and the rule above cannot be watched
  // failing. wantedServers reads the manifest beside its own module, so a scratch copy of the
  // two modules is the only place to give an opt-in server a real entry and see it declined.
  const root = scratch(t)
  const servers = join(root, 'library', 'mcp-servers')
  mkdirSync(join(root, 'tools'), { recursive: true })
  mkdirSync(join(servers, 'node_modules', 'fake'), { recursive: true })
  writeFileSync(join(servers, 'node_modules', 'fake', 'server.js'), '', 'utf8')
  // codex-hooks.mjs is in the list because codex.mjs imports it. A scratch copy that omits one
  // import fails at resolve time with a message about a missing module, which reads like a broken
  // test rather than a stale copy list — so this is the whole module's import closure, not a
  // hand-kept pair.
  for (const f of ['paths.mjs', 'codex.mjs', 'codex-hooks.mjs']) copyFileSync(join(REPO, 'tools', f), join(root, 'tools', f))
  writeFileSync(join(servers, 'servers.json'), JSON.stringify({
    servers: {
      optin: { registerByDefault: false, entry: ['fake', 'server.js'] },
      wanted: { entry: ['fake', 'server.js'] },
    },
  }), 'utf8')
  const probe = join(root, 'tools', 'probe.mjs')
  writeFileSync(probe, [
    "import { wantedServers } from './codex.mjs'",
    'console.log(JSON.stringify(wantedServers({ NODE: process.execPath }).map((s) => s.name)))',
    '',
  ].join('\n'), 'utf8')

  const r = spawnSync(process.execPath, [probe], { encoding: 'utf8', timeout: 60000 })
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
  assert.deepEqual(JSON.parse(r.stdout), ['wanted'], 'registerByDefault:false was registered anyway')
})

function check(env = {}) {
  // PATH is dropped case-insensitively first: on Windows the parent's copy is spelled "Path",
  // and leaving it in alongside an overriding "PATH" leaves which one the child reads undefined.
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^path$/i.test(k)))
  const r = spawnSync(process.execPath, [TOOL, '--check'], {
    cwd: REPO, encoding: 'utf8', timeout: 120000, env: { ...base, PATH: process.env.PATH, ...env },
  })
  const out = r.stdout || ''
  const at = out.indexOf('{')
  assert.ok(at >= 0, `--check printed no JSON:\n${out.slice(-500)}${r.stderr || ''}`)
  return { r, report: JSON.parse(out.slice(at)) }
}

test('--check on a machine with no Codex reports installed:false and still exits 0', (t) => {
  const dir = scratch(t)
  // Every route resolveCodexCli takes is pointed somewhere empty: the variable Codex exports to
  // its own children, PATH, the Windows install root, and the POSIX ones under HOME.
  const { r, report } = check({
    CODEX_CLI_PATH: join(dir, 'no-such-codex.exe'),
    CODEX_HOME: join(dir, '.codex'),
    PATH: '',
    HOME: dir,
    USERPROFILE: dir,
    LOCALAPPDATA: join(dir, 'AppData', 'Local'),
  })
  assert.equal(report.installed, false, 'a Codex was found where none was planted')
  assert.equal(r.status, 0, `a missing Codex must never be a failure:\n${r.stdout}${r.stderr}`)
  assert.ok(report.notes.length, 'nothing said why there was nothing to do')
})

test('the first write keeps the original, even when that write is a refresh', (t) => {
  // A user file can take the 'refreshed' branch on the very first run — quote the BEGIN marker
  // in your own notes and the text between your quoted markers is what gets replaced. Backing up
  // only on 'appended' left exactly that case with no copy of the original anywhere.
  const dir = scratch(t)
  const own = `# mine\n\nWhat CGC writes looks like this:\n\n\`\`\`md\n${BEGIN}\n(its mandates)\n${END}\n\`\`\`\n\nand these are my rules.\n`
  writeFileSync(join(dir, 'AGENTS.md'), own, 'utf8')
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^path$/i.test(k)))
  const r = spawnSync(process.execPath, [TOOL], {
    cwd: REPO, encoding: 'utf8', timeout: 120000,
    env: { ...base, PATH: process.env.PATH, CODEX_CLI_PATH: process.execPath, CODEX_HOME: dir },
  })
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
  assert.equal(readFileSync(join(dir, 'AGENTS.md.cgc-backup'), 'utf8'), own,
    'the file this package did not create was rewritten with no copy of the original kept')
})

test('--check is report-only even when there IS a Codex and a merge to do', (t) => {
  // The no-Codex case above cannot watch this: it returns before the write can happen, so an
  // assertion there that nothing was written passes no matter what the write guard says. Any
  // existing file resolves as the CLI, so this runs on a machine with no Codex too — and then
  // the merge is a real 'created' that --check must still decline to perform. The doctor shells
  // this on every run, so a --check that wrote would edit the user's AGENTS.md at every start.
  const dir = scratch(t)
  const { r, report } = check({ CODEX_CLI_PATH: process.execPath, CODEX_HOME: dir })
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
  assert.equal(report.installed, true, 'the planted CLI was not resolved, so nothing was proven')
  assert.ok(report.agents && report.agents.how !== 'unchanged', 'nothing to write; the check is idle')
  assert.ok(!existsSync(join(dir, 'AGENTS.md')), '--check wrote AGENTS.md; it is report-only')
})

test('--check on this machine, whatever it has, exits 0 with a parseable installed boolean', () => {
  const { r, report } = check()
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
  assert.equal(typeof report.installed, 'boolean')
  // The doctor branches on these, so they have to be present in both states.
  assert.ok('agents' in report && 'servers' in report && Array.isArray(report.notes))
  if (report.installed) {
    assert.ok(report.agents && typeof report.agents.how === 'string',
      'Codex is installed here, so --check must say what would happen to AGENTS.md')
    assert.ok(['created', 'appended', 'refreshed', 'unchanged'].includes(report.agents.how),
      `unknown merge verdict ${report.agents.how}`)
  } else {
    assert.equal(report.agents, null)
  }
})
