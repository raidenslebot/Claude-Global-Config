// The session hook: update, verify, repair, one line. These build a real origin, an author
// clone and a friend clone in a temp dir and run the shipped hook against them with stub
// tools, so nothing touches this machine's ~/.claude. The cases that must NOT act are the
// important ones: a hook that pulled onto a dirty tree, a feature branch or unpushed work
// would be removed within a day.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'

const HOOK = join(REPO, 'config', 'hooks', 'session-start-cgc.js')

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args],
    { cwd, encoding: 'utf8', timeout: 30000 })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const head = (repo) => git(repo, 'rev-parse', 'HEAD')

// Stub tools. install writes a marker with its argv; doctor fails until that marker exists,
// which is what a repair looks like; run-tests counts its runs so the daily cache is provable.
const STUB_INSTALL = "import { writeFileSync } from 'node:fs'\nwriteFileSync(new URL('../installed.txt', import.meta.url), process.argv.slice(2).join(' '))\n"
const STUB_DOCTOR = "import { existsSync } from 'node:fs'\nconst ok = existsSync(new URL('../installed.txt', import.meta.url))\n"
  + "console.log(JSON.stringify(ok ? { healthy: true, counts: { ok: 4 }, results: [] } : { healthy: false, counts: { ok: 3, fail: 1 }, results: [{ level: 'fail', message: 'hooks/post-tool-slop.js not registered' }] }))\n"
const STUB_TESTS = "import { writeFileSync, readFileSync, existsSync } from 'node:fs'\nconst f = new URL('../testruns.txt', import.meta.url)\n"
  + "const n = existsSync(f) ? Number(readFileSync(f, 'utf8')) + 1 : 1\nwriteFileSync(f, String(n))\nconsole.log('ℹ tests 4\\nℹ pass 3\\nℹ fail 0\\nℹ skipped 1')\n"

function world(t, { doctor = false, tests = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cgc-session-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const origin = join(root, 'origin.git')
  git(root, 'init', '--bare', '-b', 'main', origin)
  const author = join(root, 'author')
  git(root, 'clone', '-q', origin, author)
  mkdirSync(join(author, 'tools'))
  writeFileSync(join(author, 'package.json'), JSON.stringify({ version: '1.0.0' }))
  writeFileSync(join(author, 'tools', 'install.mjs'), STUB_INSTALL)
  if (doctor) writeFileSync(join(author, 'tools', 'doctor.mjs'), STUB_DOCTOR)
  if (tests) writeFileSync(join(author, 'tools', 'run-tests.mjs'), STUB_TESTS)
  git(author, 'add', '-A'); git(author, 'commit', '-q', '-m', 'Initial'); git(author, 'push', '-q', 'origin', 'main')
  const friend = join(root, 'friend')
  git(root, 'clone', '-q', origin, friend)
  const release = (v, subject) => {
    writeFileSync(join(author, 'package.json'), JSON.stringify({ version: v }))
    git(author, 'commit', '-q', '-am', subject); git(author, 'push', '-q', 'origin', 'main')
  }
  return { root, author, friend, release, config: join(root, 'config') }
}

function fire(w, repo, source = 'startup') {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ source }), encoding: 'utf8', timeout: 120000,
    env: { ...process.env, CGC_REPO: repo, CLAUDE_CONFIG_DIR: w.config },
  })
  assert.equal(r.status, 0, `hook must always exit 0: ${r.stderr}`)
  assert.ok(r.stdout.trim(), 'the hook always reports a line')
  const j = JSON.parse(r.stdout)
  return { line: j.systemMessage, ctx: j.hookSpecificOutput.additionalContext }
}

test('up to date: one line, shown to the user and to the session, no update text', (t) => {
  const w = world(t)
  const { line, ctx } = fire(w, w.friend)
  assert.match(line, /^CGC v1\.0\.0 enabled · checks unavailable · up to date \([0-9a-f]{7}\)$/)
  assert.match(ctx, /^CGC STATUS — CGC v1\.0\.0/)
  assert.match(ctx, /Open your first reply with it/)
  assert.doesNotMatch(ctx, /CGC updated|waiting on/)
})

test('behind main: fast-forwards, re-applies config/hooks/skills, reports the version and the commits', (t) => {
  const w = world(t)
  w.release('1.1.0', 'Add the thing')
  const { line, ctx } = fire(w, w.friend)
  assert.match(line, /updated 1\.0\.0 → 1\.1\.0/)
  assert.match(ctx, /CGC updated 1\.0\.0 → 1\.1\.0 \([0-9a-f]{7} → [0-9a-f]{7}, 1 commit\)/)
  assert.match(ctx, /- Add the thing/)
  assert.equal(head(w.friend), head(w.author))
  const marker = join(w.friend, 'installed.txt')
  assert.ok(existsSync(marker), 'install.mjs must run after the pull')
  assert.equal(readFileSync(marker, 'utf8'), '--only=config,hooks,skills')
})

test('local changes block the update; it is reported with the fix and nothing is pulled', (t) => {
  const w = world(t)
  w.release('1.1.0', 'Add the thing')
  const before = head(w.friend)
  writeFileSync(join(w.friend, 'package.json'), '{"version":"edited-by-hand"}')
  const { line, ctx } = fire(w, w.friend)
  assert.match(line, /update blocked: local changes/)
  assert.match(ctx, /pull --ff-only origin main/)
  assert.equal(head(w.friend), before)
  assert.equal(readFileSync(join(w.friend, 'package.json'), 'utf8'), '{"version":"edited-by-hand"}', 'the edit survives')
})

test("an unpushed local commit — the author's machine — is left alone and named", (t) => {
  const w = world(t)
  git(w.author, 'commit', '-q', '--allow-empty', '-m', 'wip')
  const before = head(w.author)
  assert.match(fire(w, w.author).line, /ahead of origin/)
  assert.equal(head(w.author), before)
})

test('a checkout on another branch is left alone even when main moved', (t) => {
  const w = world(t)
  git(w.friend, 'checkout', '-q', '-b', 'experiment')
  w.release('1.1.0', 'Add the thing')
  const before = head(w.friend)
  assert.match(fire(w, w.friend).line, /on experiment, main not followed/)
  assert.equal(head(w.friend), before)
})

test('offline is a word in the line, not an error', (t) => {
  const w = world(t)
  w.release('1.1.0', 'Add the thing')
  git(w.friend, 'remote', 'set-url', 'origin', join(w.root, 'nowhere'))
  assert.match(fire(w, w.friend).line, /offline, at [0-9a-f]{7}/)
})

test('a downloaded archive (no .git) is told how to become updatable', (t) => {
  const w = world(t)
  const dir = join(w.root, 'zip'); mkdirSync(dir)
  writeFileSync(join(dir, 'package.json'), '{"version":"1.0.0"}')
  const { line, ctx } = fire(w, dir)
  assert.match(line, /not a git clone/)
  assert.match(ctx, /Clone the repository with git/)
})

test('clear and compact do not fetch again within five minutes; resume does', (t) => {
  const w = world(t)
  fire(w, w.friend)  // writes the update stamp
  w.release('1.1.0', 'Later')
  const before = head(w.friend)
  const { line, ctx } = fire(w, w.friend, 'compact')
  assert.match(line, /· at [0-9a-f]{7}$/)
  assert.match(ctx, /Do not mention it/)
  assert.equal(head(w.friend), before, 'a throttled compact must not pull')
  assert.match(fire(w, w.friend, 'resume').line, /updated 1\.0\.0 → 1\.1\.0/)
  assert.equal(head(w.friend), head(w.author))
})

test('a failing check is repaired by re-applying the install, and the line says so', (t) => {
  const w = world(t, { doctor: true })
  const { line, ctx } = fire(w, w.friend)
  assert.match(line, /4\/4 checks · repaired/)
  assert.match(line, /enabled/)
  assert.ok(existsSync(join(w.friend, 'installed.txt')), 'the repair is the install')
  assert.doesNotMatch(ctx, /Still failing/)
})

test('the test suite runs once per commit and is cached for a day; the line counts passes against the tests that ran', (t) => {
  const w = world(t, { tests: true })
  // 4 tests, 3 passed, 1 skipped (could not run here): 3/3, with the skip named, never 3/4.
  assert.match(fire(w, w.friend).line, /3\/3 tests \(1 skipped\)/)
  assert.match(fire(w, w.friend).line, /3\/3 tests/)
  assert.equal(readFileSync(join(w.friend, 'testruns.txt'), 'utf8'), '1', 'same commit within a day: cached')
  w.release('1.1.0', 'Change')
  fire(w, w.friend)
  assert.equal(readFileSync(join(w.friend, 'testruns.txt'), 'utf8'), '2', 'a new commit runs the suite again')
  assert.ok(existsSync(join(w.config, '.cgc', 'selftest.json')), 'the result lives beside the config')
})

test('never crashes on an empty payload or a repo path that does not exist', () => {
  for (const input of ['', '{']) {
    const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', timeout: 30000, env: { ...process.env, CGC_REPO: join(tmpdir(), 'cgc-nope-' + process.pid), CLAUDE_CONFIG_DIR: join(tmpdir(), 'cgc-nope-cfg-' + process.pid) } })
    assert.equal(r.status, 0)
  }
})

test('the version is semver and the changelog leads with it', () => {
  const v = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version
  assert.match(v, /^\d+\.\d+\.\d+$/)
  const log = readFileSync(join(REPO, 'CHANGELOG.md'), 'utf8')
  const first = (log.match(/^## (\S+)/m) || [])[1]
  assert.equal(first, v, `CHANGELOG.md must lead with ${v} — bump package.json and add the entry together`)
})
