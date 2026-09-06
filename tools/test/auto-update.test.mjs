// The session hook: update, verify, repair, one line. These build a real origin, an author
// clone and a friend clone in a temp dir and run the shipped hook against them with stub
// tools, so nothing touches this machine's ~/.claude. The cases that must NOT act are the
// important ones: a hook that pulled onto a dirty tree, a feature branch or unpushed work
// would be removed within a day.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, utimesSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
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
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }))
  const origin = join(root, 'origin.git')
  git(root, 'init', '--bare', '-b', 'main', origin)
  const author = join(root, 'author')
  git(root, 'clone', '-q', origin, author)
  mkdirSync(join(author, 'tools'))
  writeFileSync(join(author, 'package.json'), JSON.stringify({ version: '1.0.0' }))
  writeFileSync(join(author, 'tools', 'install.mjs'), STUB_INSTALL)
  if (doctor) writeFileSync(join(author, 'tools', 'doctor.mjs'), STUB_DOCTOR)
  if (tests) {
    writeFileSync(join(author, 'tools', 'run-tests.mjs'), STUB_TESTS)
    copyFileSync(join(REPO, 'tools', 'selftest.mjs'), join(author, 'tools', 'selftest.mjs'))
  }
  git(author, 'add', '-A'); git(author, 'commit', '-q', '-m', 'Initial'); git(author, 'push', '-q', 'origin', 'main')
  const friend = join(root, 'friend')
  git(root, 'clone', '-q', origin, friend)
  const release = (v, subject) => {
    writeFileSync(join(author, 'package.json'), JSON.stringify({ version: v }))
    git(author, 'commit', '-q', '-am', subject); git(author, 'push', '-q', 'origin', 'main')
  }
  return { root, author, friend, release, config: join(root, 'config') }
}

/** Block until pred() holds, or fail after ms. The background runner is a real process. */
function waitFor(pred, ms, what) {
  const until = Date.now() + ms
  while (!pred()) {
    if (Date.now() > until) assert.fail(`timed out waiting for ${what}`)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
  }
}
/** The background run is over when its claim is released. */
const settled = (w) => waitFor(() => !existsSync(join(w.config, '.cgc', 'selftest.running')), 30000, 'the background test run to finish')

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
  // mcp-register joined the list: registering the servers is a JSON write, while `mcp` would
  // fetch packages over the network and could never run at every session start.
  assert.equal(readFileSync(marker, 'utf8'), '--only=config,hooks,skills,deps,mcp-register')
})

test('a local edit to a file the update does not touch no longer blocks it', (t) => {
  const w = world(t)
  w.release('1.1.0', 'Add the thing')
  writeFileSync(join(w.friend, 'scratch.txt'), 'a note to self')
  git(w.friend, 'add', 'scratch.txt')
  const { line } = fire(w, w.friend)
  assert.match(line, /updated 1\.0\.0 → 1\.1\.0/, 'an unrelated edit must not pin the clone to an old version')
  assert.equal(head(w.friend), head(w.author))
  assert.equal(readFileSync(join(w.friend, 'scratch.txt'), 'utf8'), 'a note to self', 'the edit survives')
})

test('a local edit to a file the update DOES touch is reported, and nothing is clobbered', (t) => {
  const w = world(t)
  w.release('1.1.0', 'Add the thing')          // this release rewrites package.json
  const before = head(w.friend)
  writeFileSync(join(w.friend, 'package.json'), '{"version":"edited-by-hand"}')
  const { line, ctx } = fire(w, w.friend)
  assert.match(line, /UPDATE BLOCKED by local changes/)
  assert.match(ctx, /pull --ff-only origin main/)
  assert.match(ctx, /v1\.1\.0/, 'the line must name the version it is stuck below')
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

test('a clone whose origin/HEAD is unset still follows its branch', (t) => {
  const w = world(t)
  git(w.friend, 'symbolic-ref', '--delete', 'refs/remotes/origin/HEAD')
  w.release('1.1.0', 'Add the thing')
  assert.match(fire(w, w.friend).line, /updated 1\.0\.0 → 1\.1\.0/)
  assert.equal(head(w.friend), head(w.author))
})

test('git missing from PATH is said, not blamed on a branch', (t) => {
  const w = world(t)
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^path$/i.test(k)))
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ source: 'startup' }), encoding: 'utf8', timeout: 60000,
    env: { ...env, PATH: join(w.root, 'empty-path'), CGC_REPO: w.friend, CLAUDE_CONFIG_DIR: w.config },
  })
  assert.equal(r.status, 0, r.stderr)
  assert.match(JSON.parse(r.stdout).systemMessage, /git is not on PATH/)
})

test('a detached HEAD is named and left alone', (t) => {
  const w = world(t)
  git(w.friend, 'checkout', '-q', '--detach')
  w.release('1.1.0', 'Add the thing')
  const before = head(w.friend)
  assert.match(fire(w, w.friend).line, /detached HEAD at [0-9a-f]{7}, not followed/)
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

test('every source checks every time — no throttle, however fast the sessions come', (t) => {
  const w = world(t)
  fire(w, w.friend)
  assert.match(fire(w, w.friend).line, /up to date/)
  // Each source in turn, with a release landing between each one. Every one must arrive.
  for (const [i, source] of ['compact', 'resume', 'clear', 'startup'].entries()) {
    const from = `1.${i}.0`
    const to = `1.${i + 1}.0`
    w.release(to, 'Later ' + source)
    const { line } = fire(w, w.friend, source)
    assert.match(line, new RegExp(`updated ${from.replace(/\./g, '\\.')} → ${to.replace(/\./g, '\\.')}`),
      `a ${source} must fetch and fast-forward, however recently the last check ran`)
    assert.equal(head(w.friend), head(w.author), `${source} must land the update`)
  }
})

test('a failing check is repaired by re-applying the install, and the line says so', (t) => {
  const w = world(t, { doctor: true })
  const { line, ctx } = fire(w, w.friend)
  assert.match(line, /4\/4 checks · repaired/)
  assert.match(line, /enabled/)
  assert.ok(existsSync(join(w.friend, 'installed.txt')), 'the repair is the install')
  assert.doesNotMatch(ctx, /Still failing/)
})

test('the test suite runs once per commit, in the background, and is cached for a day; the line counts passes against the tests that ran', (t) => {
  const w = world(t, { tests: true })
  const runs = join(w.friend, 'testruns.txt')
  // The first start on a commit does not wait for the suite: it says so and returns.
  const t0 = Date.now()
  assert.match(fire(w, w.friend).line, /tests running in background/)
  assert.ok(Date.now() - t0 < 15000, 'the session start does not block on the suite')
  settled(w)
  // 4 tests, 3 passed, 1 skipped (could not run here): 3/3, with the skip named, never 3/4.
  assert.match(fire(w, w.friend).line, /3\/3 tests \(1 skipped\)/)
  assert.match(fire(w, w.friend).line, /3\/3 tests/)
  assert.equal(readFileSync(runs, 'utf8'), '1', 'same commit within a day: cached')
  w.release('1.1.0', 'Change')
  // A new commit re-runs it, and meanwhile the line carries the last FINISHED result, named.
  assert.match(fire(w, w.friend).line, /3\/3 tests \(1 skipped\) at [0-9a-f]{7} · re-running in background/)
  settled(w)
  assert.equal(readFileSync(runs, 'utf8'), '2', 'a new commit runs the suite again')
  assert.ok(existsSync(join(w.config, '.cgc', 'selftest.json')), 'the result lives beside the config')
  assert.match(fire(w, w.friend).line, /3\/3 tests \(1 skipped\) · up to date/)
})

test('a run that does not finish is unfinished, not failed — and is re-tried after a cooldown, never cached for the day', (t) => {
  // The inline version cached "tests timed out" with a failure count of 1 that no test had
  // earned, for a DAY, and every session on that commit repeated it. Measured: the suite takes
  // 130 s idle on a fast machine and blew a 240 s budget while the same machine was thrashing.
  const w = world(t, { tests: true })
  const runner = join(w.friend, 'tools', 'run-tests.mjs')
  writeFileSync(runner, 'setInterval(() => {}, 1000)\n')       // a suite that never ends
  const env = { CGC_SELFTEST_BUDGET_MS: '1500' }
  const r1 = spawnSync(process.execPath, [HOOK], { input: '{"source":"startup"}', encoding: 'utf8', timeout: 60000, env: { ...process.env, CGC_REPO: w.friend, CLAUDE_CONFIG_DIR: w.config, ...env } })
  assert.match(JSON.parse(r1.stdout).systemMessage, /tests running in background/)
  settled(w)
  const rec = JSON.parse(readFileSync(join(w.config, '.cgc', 'selftest.json'), 'utf8'))
  assert.equal(rec.timedOut, true)
  assert.equal(rec.fail, 0, 'a run that did not finish failed nothing')
  const { line, ctx } = fire(w, w.friend)
  assert.match(line, /DEGRADED/, 'unverified is not "enabled"')
  assert.match(line, /tests did not finish in \d+ min/, line)
  assert.doesNotMatch(line, /tests timed out|1 failed/)
  assert.match(ctx, /No test failed; the run is unfinished/, ctx)
  assert.doesNotMatch(ctx, /of the package's tests fail/, 'a time-out is never reported as a failing test')
  assert.equal(existsSync(join(w.friend, 'testruns.txt')), false)
  // Inside the cooldown: not re-tried. Past it: re-tried, and with a working suite it recovers.
  fire(w, w.friend)
  assert.equal(existsSync(join(w.config, '.cgc', 'selftest.running')), false, 'no new run inside the cooldown')
  writeFileSync(runner, STUB_TESTS)
  writeFileSync(join(w.config, '.cgc', 'selftest.json'), JSON.stringify({ ...rec, at: Date.now() - 11 * 60 * 1000 }))
  assert.match(fire(w, w.friend).line, /tests running in background/, 'past the cooldown it is re-tried')
  settled(w)
  assert.match(fire(w, w.friend).line, /enabled .* 3\/3 tests/)
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

test('sessions that start together all update: the pull is not raced', async (t) => {
  // Four sessions starting at once each ran `git pull` in the same clone, and git answered
  // every one of them "fatal: Cannot fast-forward to multiple branches" — one process reading
  // FETCH_HEAD while another rewrites it. Every session then reported the OLD version and
  // carried on, which is exactly what a stale version line looks like: healthy. Anyone running
  // more than one session at a time was pinned to whatever version they happened to have.
  const w = world(t)
  w.release('1.1.0', 'Add the thing')
  // spawnSync would run these one after another and prove nothing: the race needs four real
  // processes in flight at once.
  const runs = await Promise.all([0, 1, 2, 3].map((i) => new Promise((res) => {
    const p = spawn(process.execPath, [HOOK], {
      env: { ...process.env, CGC_REPO: w.friend, CLAUDE_CONFIG_DIR: w.config },
    })
    let stdout = '', stderr = ''
    p.stdout.on('data', (d) => { stdout += d })
    p.stderr.on('data', (d) => { stderr += d })
    p.on('close', (status) => res({ status, stdout, stderr }))
    p.stdin.end(JSON.stringify({ source: i % 2 ? 'resume' : 'startup' }))
  })))
  for (const [i, r] of runs.entries()) {
    assert.equal(r.status, 0, `session ${i} must exit 0: ${r.stderr}`)
    const line = JSON.parse(r.stdout).systemMessage
    assert.match(line, /v1\.1\.0/, `session ${i} reported a stale version: ${line}`)
    assert.doesNotMatch(line, /update failed|multiple branches/, `session ${i}: ${line}`)
  }
  assert.equal(head(w.friend), head(w.author), 'the clone actually moved')
})

test('a lock left behind by a session that died does not pin the next one forever', (t) => {
  const w = world(t)
  w.release('1.1.0', 'Add the thing')
  // A holder that is six minutes old is not a holder.
  const lock = join(w.config, '.cgc', 'update.lock')
  mkdirSync(join(w.config, '.cgc'), { recursive: true })
  writeFileSync(lock, JSON.stringify({ pid: 999999, at: Date.now() - 6 * 60 * 1000 }))
  const old = new Date(Date.now() - 6 * 60 * 1000)
  utimesSync(lock, old, old)
  const { line } = fire(w, w.friend)
  assert.match(line, /updated 1\.0\.0 → 1\.1\.0/, `a stale lock must not block the update: ${line}`)
  assert.equal(existsSync(lock), false, 'and the lock is released')
})

test('a test run that produces no counts is not reported as zero tests', (t) => {
  // A crashed runner, a syntax error mid-edit, a suite that never started: the run yields no
  // counts, and recording that as 0 of 0 printed "0/0 tests" — a confident statement that the
  // package has no tests, in the one line a session is told to trust and repeat verbatim.
  const w = world(t, { tests: true })
  // A runner that exits 0 and says nothing at all, which is exactly what a broken one did.
  writeFileSync(join(w.friend, 'tools', 'run-tests.mjs'), 'process.exit(0)\n')
  fire(w, w.friend)
  settled(w)
  const { line } = fire(w, w.friend)
  assert.match(line, /the test suite could not be read/, line)
  assert.doesNotMatch(line, /0\/0 tests/, 'zero of zero is an answer nothing gave')
})

test('only one session runs the suite; the rest report rather than pile on', (t) => {
  // The cache is written when a run FINISHES, so for the eighty seconds it takes, every session
  // that starts sees a miss and launches its own. One run measured 60 node processes and 5.6 GB;
  // fifteen windows opening together is how a 32 GB machine froze from a package checking itself.
  const w = world(t, { tests: true })
  const state = join(w.config, '.cgc')
  mkdirSync(state, { recursive: true })
  // A claim that a live session is running the suite right now.
  writeFileSync(join(state, 'selftest.running'), JSON.stringify({ pid: process.pid, at: Date.now() }))

  const { line } = fire(w, w.friend)
  assert.match(line, /tests running in another session/, line)
  assert.equal(existsSync(join(w.friend, 'testruns.txt')), false, 'it must not have run the suite')
  assert.ok(existsSync(join(state, 'selftest.running')), 'and it must not clear a claim it does not hold')
})

test('a claim left by a run that died is not a claim', (t) => {
  // Otherwise one crash during a test run means no session ever tests again.
  const w = world(t, { tests: true })
  const state = join(w.config, '.cgc')
  mkdirSync(state, { recursive: true })
  const claim = join(state, 'selftest.running')
  writeFileSync(claim, JSON.stringify({ pid: 999999, at: 0 }))
  utimesSync(claim, new Date(Date.now() - 30 * 60 * 1000), new Date(Date.now() - 30 * 60 * 1000))

  assert.match(fire(w, w.friend).line, /tests running in background/, 'the stale claim was taken over')
  settled(w)
  assert.equal(readFileSync(join(w.friend, 'testruns.txt'), 'utf8'), '1', 'and the suite ran')
  assert.equal(existsSync(claim), false, 'and the claim was released afterwards')
  assert.match(fire(w, w.friend).line, /3\/3 tests/)
})

test('a failure an install cannot repair does not run one, at every session start, for ever', (t) => {
  // verify() re-runs the whole install on any doctor failure. The flag that stops it was added
  // to doctor.mjs and read by the hook, but nothing tested the two ends together — and the
  // release's own flagship finding was still emitted as repairable, so the loop it was written
  // to break was still reachable on exactly the failure it was written for.
  const w = world(t, { doctor: true })
  // A doctor that always fails with something no install can put back.
  writeFileSync(join(w.friend, 'tools', 'doctor.mjs'),
    'console.log(JSON.stringify({ healthy: false, counts: { ok: 3, fail: 1 }, '
    + "results: [{ level: 'fail', repairable: false, message: 'two servers registered, and neither is ours to remove' }] }))\n")
  const { line } = fire(w, w.friend)
  assert.match(line, /DEGRADED/, 'the failure is still reported')
  assert.doesNotMatch(line, /repaired/, 'but no install was run for something an install cannot fix')

  // The other direction, so the flag cannot be switched on by accident and silence real repair.
  writeFileSync(join(w.friend, 'tools', 'doctor.mjs'),
    'console.log(JSON.stringify({ healthy: false, counts: { ok: 3, fail: 1 }, '
    + "results: [{ level: 'fail', repairable: true, message: 'hooks/post-tool-slop.js not registered' }] }))\n")
  assert.match(fire(w, w.friend).line, /repaired/, 'a repairable failure still triggers the install')

  // And a finding from before the flag existed defaults to repairable, as it always behaved.
  writeFileSync(join(w.friend, 'tools', 'doctor.mjs'),
    'console.log(JSON.stringify({ healthy: false, counts: { ok: 3, fail: 1 }, '
    + "results: [{ level: 'fail', message: 'an older finding with no flag' }] }))\n")
  assert.match(fire(w, w.friend).line, /repaired/, 'no flag means repair, which is the old behaviour')
})

test('every prompt verifies currency, and a stale clone updates itself without being asked', (t) => {
  // The session-start hook checks at startup, resume and compact. A session opened this morning
  // and still going at midnight has not checked since this morning, so a machine can sit all day
  // on a superseded version with every mandate and fix released since then simply absent — and
  // nothing in the transcript says so. This is the per-prompt guarantee.
  const HOOK = join(REPO, 'config', 'hooks', 'user-prompt-cgc-update.js')
  const w = world(t, {})
  const fire = (repo, env = {}) => {
    const r = spawnSync(process.execPath, [HOOK], {
      input: '{}', encoding: 'utf8', timeout: 120000,
      env: { ...process.env, CGC_REPO: repo, CLAUDE_CONFIG_DIR: w.config, ...env },
    })
    assert.equal(r.status, 0, `the hook must never fail a prompt: ${r.stderr}`)
    if (!r.stdout.trim()) return null
    return JSON.parse(r.stdout).hookSpecificOutput.additionalContext
  }

  // Current: silent. A hook that speaks on every prompt is a hook that gets removed.
  assert.equal(fire(w.friend), null, 'nothing to say when the clone matches its remote')

  // Behind: it starts the update and says what is coming. CGC_FETCH_TTL_MS=0 forces the network
  // check — the default 60s window is what stops a burst of prompts becoming a burst of fetches,
  // and without overriding it here the second call would reuse the ref it just cached.
  w.release('1.1.0', 'a release the running session has never seen')
  const said = fire(w.friend, { CGC_FETCH_TTL_MS: '0' })
  assert.match(String(said), /1 commit\(s\) behind origin\/main \(v1\.1\.0 available\)/, said)
  // The update itself is the session-start hook's, run detached: nothing is merged inside a
  // 10 s prompt hook, because a merge killed at that deadline wedges the clone.
  waitFor(() => head(w.friend) === head(w.author) && existsSync(join(w.friend, 'installed.txt')), 20000, 'the detached update')
  assert.equal(JSON.parse(readFileSync(join(w.friend, 'package.json'), 'utf8')).version, '1.1.0')

  // And the next prompt is silent again, because it is current — even forcing a fresh fetch.
  assert.equal(fire(w.friend, { CGC_FETCH_TTL_MS: '0' }), null)
})

test('the per-prompt update refuses rather than destroys, and never blocks the prompt', (t) => {
  const HOOK = join(REPO, 'config', 'hooks', 'user-prompt-cgc-update.js')
  const w = world(t, {})
  const fire = (repo, env = {}) => {
    const r = spawnSync(process.execPath, [HOOK], {
      input: '{}', encoding: 'utf8', timeout: 120000,
      env: { ...process.env, CGC_REPO: repo, CLAUDE_CONFIG_DIR: w.config, ...env },
    })
    assert.equal(r.status, 0, 'always exits 0')
    return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : null
  }

  // Uncommitted work is never discarded to get current.
  w.release('1.2.0', 'upstream moves')
  writeFileSync(join(w.friend, 'package.json'), JSON.stringify({ version: '1.0.0', mine: true }), 'utf8')
  const dirty = fire(w.friend)
  assert.match(String(dirty), /uncommitted changes.*NOT updated/s, dirty)
  assert.ok(JSON.parse(readFileSync(join(w.friend, 'package.json'), 'utf8')).mine, 'local work survived')

  // A repository that is not a clone says so once rather than pretending to be current.
  const bare = mkdtempSync(join(tmpdir(), 'cgc-notrepo-'))
  t.after(() => rmSync(bare, { recursive: true, force: true }))
  writeFileSync(join(bare, 'package.json'), JSON.stringify({ version: '9.9.9' }), 'utf8')
  assert.match(String(fire(bare, { CGC_FETCH_TTL_MS: '0' })), /not a git clone/)
  assert.equal(fire(bare), null, 'and once per fetch window, not once per prompt')

  // Offline must not read as current: "checked and fine" and "could not check" are different.
  const off = fire(w.friend, { GIT_ALLOW_PROTOCOL: 'none', CGC_FETCH_TTL_MS: '0' })
  if (off) assert.match(String(off), /NOT confirmed current|could not/i, off)
})

test('the per-prompt updater refuses a detached checkout, names a local-only branch, and needs no upstream', (t) => {
  // Two findings from the same review. A detached HEAD is pinned on purpose: the session-start
  // hook refuses to move it, but this hook merged origin/HEAD into it and called that an update.
  // And a local-only branch has nothing to be behind, yet was reported as "offline" once a
  // minute for the whole session — a wrong diagnosis, repeated. The first fix for THAT tested
  // for a configured upstream, and caught the author's own clone: pushed with `git push origin
  // main` and no -u, it has origin/main and no tracking config. origin/<branch> is the ref.
  const HOOK = join(REPO, 'config', 'hooks', 'user-prompt-cgc-update.js')
  const w = world(t, {})
  const prompt = (env = {}) => {
    const r = spawnSync(process.execPath, [HOOK], {
      input: '{}', encoding: 'utf8', timeout: 120000,
      env: { ...process.env, CGC_REPO: w.friend, CLAUDE_CONFIG_DIR: w.config, CGC_FETCH_TTL_MS: '0', ...env },
    })
    assert.equal(r.status, 0, 'always exits 0')
    return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : null
  }
  const git = (...a) => spawnSync('git', ['-C', w.friend, ...a], { encoding: 'utf8' }).stdout.trim()

  w.release('1.1.0', 'upstream moves')
  git('checkout', '-q', '--detach')
  const before = git('rev-parse', 'HEAD')
  const said = prompt()
  assert.match(String(said), /detached checkout/, said)
  assert.equal(git('rev-parse', 'HEAD'), before, 'a detached HEAD is never moved')
  // A standing condition is said once per fetch window. It exited before the window was ever
  // opened, so "detached" — and "not a git clone", and "offline" — was said on every prompt.
  assert.equal(prompt({ CGC_FETCH_TTL_MS: '600000' }), null, 'inside the window it is not repeated')
  assert.match(String(prompt()), /detached checkout/, 'the next window says it again')

  git('checkout', '-q', '-b', 'wip')
  const wip = prompt()
  assert.match(String(wip), /on branch "wip"; main is not followed/, wip)
  assert.doesNotMatch(String(wip), /offline/, 'a local-only branch is not an outage')

  // The author's shape: origin/main exists, nothing is configured as upstream. It updates.
  git('checkout', '-q', 'main')
  git('branch', '--unset-upstream')
  assert.equal(git('rev-parse', '--abbrev-ref', 'main@{upstream}'), '', 'precondition: no upstream configured')
  const noUp = prompt()
  assert.match(String(noUp), /is 1 commit\(s\) behind origin\/main \(v1\.1\.0 available\)\. It is updating in the background/, noUp)
  // The detached updater has the clone as its cwd; let it finish before the world is removed.
  waitFor(() => git('rev-parse', 'HEAD') === head(w.author) && existsSync(join(w.friend, 'installed.txt')), 20000, 'the detached update')
})

test('an unreachable remote answers well inside the 10 s hook budget, and never reads as current', (t) => {
  // hooks.json gives this hook 10 s. Its first version fetched for 30 s and installed for 120 s,
  // so an unreachable remote stalled every prompt for the full 10 s and each kill orphaned a git
  // process; the stamp was also written AFTER the fetch, so a killed fetch never rate-limited.
  const HOOK = join(REPO, 'config', 'hooks', 'user-prompt-cgc-update.js')
  const w = world(t, {})
  spawnSync('git', ['-C', w.friend, 'remote', 'set-url', 'origin', 'http://10.255.255.1:9/nope.git'])
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [HOOK], {
    input: '{}', encoding: 'utf8', timeout: 120000,
    env: { ...process.env, CGC_REPO: w.friend, CLAUDE_CONFIG_DIR: w.config, CGC_FETCH_TTL_MS: '0' },
  })
  const ms = Date.now() - t0
  assert.equal(r.status, 0)
  assert.ok(ms < 9000, `must return inside the hook budget with headroom, took ${ms} ms`)
  const said = JSON.parse(r.stdout).hookSpecificOutput.additionalContext
  assert.match(said, /NOT confirmed current/, said)
  assert.ok(existsSync(join(w.config, '.cgc', 'last-remote-check')), 'the stamp is written BEFORE the fetch, so a dead remote is tried once a minute, not once a prompt')
})

test('a stale clone is updated by the session-start hook, detached — nothing is merged inside the prompt hook', (t) => {
  // Two versions of this hook did the fast-forward themselves. The first also ran the install
  // inside the 10 s budget and was killed mid-run: merge landed, config stale, lock left on
  // disk. The second tree-killed a slow merge at its own deadline, which left .git/index.lock
  // and a half checkout — a clone wedged for good, with both hooks telling the user to commit
  // changes the user never made. Nothing merges here now: the session-start hook is started
  // detached to do what it does at every start, with a timeout git can clean up after.
  const HOOK = join(REPO, 'config', 'hooks', 'user-prompt-cgc-update.js')
  const w = world(t, {})
  w.release('1.5.0', 'a release with a slow install')
  const before = head(w.friend)
  const r = spawnSync(process.execPath, [HOOK], {
    input: '{}', encoding: 'utf8', timeout: 120000,
    env: { ...process.env, CGC_REPO: w.friend, CLAUDE_CONFIG_DIR: w.config, CGC_FETCH_TTL_MS: '0' },
  })
  assert.equal(r.status, 0)
  const said = JSON.parse(r.stdout).hookSpecificOutput.additionalContext
  assert.match(said, /1 commit\(s\) behind origin\/main \(v1\.5\.0 available\)\. It is updating in the background/, said)
  assert.match(said, /NOT yet in force/, 'until the update lands, the new commits are not claimed')
  assert.doesNotMatch(said, /updated itself/, 'the prompt hook does not claim an update it did not do')
  // The prompt hook itself moved nothing.
  assert.ok([before, head(w.author)].includes(head(w.friend)))
  waitFor(() => head(w.friend) === head(w.author) && existsSync(join(w.friend, 'installed.txt')), 20000, 'the detached update')
  const shown = spawnSync('git', ['-C', w.friend, 'show', 'HEAD:package.json'], { encoding: 'utf8' }).stdout
  assert.equal(JSON.parse(shown).version, '1.5.0', 'the fast-forward landed')
  assert.equal(existsSync(join(w.friend, '.git', 'index.lock')), false, 'git was not killed mid-merge')
  waitFor(() => !existsSync(join(w.config, '.cgc', 'update.lock')), 20000, 'the updater to release its lock')
  const marker = join(w.friend, 'installed.txt')
  const until = Date.now() + 8000
  while (!existsSync(marker) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
  assert.ok(existsSync(marker), 'the detached re-apply ran after the hook returned')
  assert.match(readFileSync(marker, 'utf8'), /--only=config,hooks,skills,deps,mcp-register/, 'and re-applied everything the merge could have changed')
})

test('a timed-out fetch leaves no git process behind', (t) => {
  // spawnSync's timeout kills only the process it started, and on Git for Windows that is a
  // launcher: the real git and its git-remote-http helper were measured alive nine seconds
  // after the hook had returned, one orphan pair per minute for as long as the remote stayed
  // dark. The fetch is tree-killed now, while its parent is still alive to be the root.
  const HOOK = join(REPO, 'config', 'hooks', 'user-prompt-cgc-update.js')
  const w = world(t, {})
  spawnSync('git', ['-C', w.friend, 'remote', 'set-url', 'origin', 'http://10.255.255.1:9/nope.git'])
  const r = spawnSync(process.execPath, [HOOK], {
    input: '{}', encoding: 'utf8', timeout: 120000,
    env: { ...process.env, CGC_REPO: w.friend, CLAUDE_CONFIG_DIR: w.config, CGC_FETCH_TTL_MS: '0' },
  })
  assert.equal(r.status, 0)
  // Any git still running against this clone is a leak: nothing else in the test touches it now.
  // The world's directory name is random, so it identifies this test's processes on its own.
  const tag = basename(w.root)
  const holders = process.platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "Name='git.exe' OR Name='git-remote-http.exe'" | Where-Object { $_.CommandLine -like '*${tag}*' -or $_.CommandLine -like '*10.255.255.1:9/nope.git*' } | Measure-Object).Count`], { encoding: 'utf8', timeout: 30000 }).stdout.trim()
    : spawnSync('sh', ['-c', `ps -eo args | grep -E "${tag}|10[.]255[.]255[.]1:9/nope[.]git" | grep -v grep | wc -l`], { encoding: 'utf8' }).stdout.trim()
  assert.equal(Number(holders), 0, `git processes still running against the clone: ${holders}`)
})

test('an ahead-only clone is current, and a blocked one is told once per fetch window, not once per prompt', (t) => {
  // The author's clone sits ahead of origin between every commit and its push, and was told
  // "NOT updated automatically, because fast-forwarding would not be safe" on EVERY prompt —
  // with nothing behind and nothing unsafe. And a clone that really is blocked (diverged, or
  // dirty over files the update touches) got the same line on every message for the rest of
  // the session: the ref comparison runs per prompt, so the report did too.
  const HOOK = join(REPO, 'config', 'hooks', 'user-prompt-cgc-update.js')
  const w = world(t, {})
  const prompt = (env = {}) => {
    const r = spawnSync(process.execPath, [HOOK], {
      input: '{}', encoding: 'utf8', timeout: 120000,
      env: { ...process.env, CGC_REPO: w.friend, CLAUDE_CONFIG_DIR: w.config, CGC_FETCH_TTL_MS: '0', ...env },
    })
    assert.equal(r.status, 0)
    return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : null
  }
  const fgit = (...a) => git(w.friend, ...a)

  // Ahead only: a local commit, origin unmoved. Nothing to say.
  fgit('commit', '-q', '--allow-empty', '-m', 'wip')
  assert.equal(prompt(), null, 'ahead of origin with nothing behind is current')

  // Diverged: origin moves too. The prompt that fetched says so; the next one, inside the
  // fetch window, says nothing — the block has been reported and has not changed.
  w.release('1.1.0', 'upstream moves')
  const said = prompt()
  assert.match(String(said), /1 local commit\(s\) not in origin\/main and is 1 behind/, said)
  assert.equal(prompt({ CGC_FETCH_TTL_MS: '600000' }), null, 'inside the fetch window the block is not repeated')
  assert.match(String(prompt()), /local commit/, 'the next fetch reports it again')
})

test('the per-prompt updater follows the default branch only — a pushed feature branch is left alone, as the session-start hook leaves it', (t) => {
  // The first version followed origin/<whatever is checked out>: it fast-forwarded a feature
  // branch and re-applied THAT branch's config while the session-start hook, on the same
  // clone, said "on feature, main not followed" and left it alone. One rule, both hooks.
  const HOOK = join(REPO, 'config', 'hooks', 'user-prompt-cgc-update.js')
  const w = world(t, {})
  git(w.friend, 'checkout', '-q', '-b', 'feature')
  git(w.friend, 'push', '-q', 'origin', 'feature')
  // origin's feature moves ahead of the friend's.
  git(w.author, 'fetch', '-q', 'origin')
  git(w.author, 'checkout', '-q', '-b', 'feature', 'origin/feature')
  writeFileSync(join(w.author, 'package.json'), JSON.stringify({ version: '1.1.0-feature' }))
  git(w.author, 'commit', '-q', '-am', 'feature work'); git(w.author, 'push', '-q', 'origin', 'feature')
  const before = head(w.friend)
  const r = spawnSync(process.execPath, [HOOK], {
    input: '{}', encoding: 'utf8', timeout: 120000,
    env: { ...process.env, CGC_REPO: w.friend, CLAUDE_CONFIG_DIR: w.config, CGC_FETCH_TTL_MS: '0' },
  })
  assert.equal(r.status, 0)
  const said = r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : null
  assert.match(String(said), /on branch "feature"; main is not followed/, said)
  assert.equal(head(w.friend), before, 'a feature branch is never fast-forwarded by the per-prompt hook')
  assert.equal(existsSync(join(w.friend, 'installed.txt')), false, 'and nothing was re-applied from it')
  // The session-start hook says the same thing about the same clone.
  assert.match(fire(w, w.friend).line, /on feature, main not followed/)
})

test('a time-out for THIS head while another session is re-running it reads "another session", not "did not finish"', (t) => {
  // A run times out at t=0; at t=11 min session A takes the claim and re-runs. Every start,
  // resume, clear and compact in every session for the next twenty minutes then read
  // "DEGRADED · tests did not finish in 20 min", on the strength of the record that is the
  // reason for the re-run — and told the user it would be re-tried at the next start, while
  // it was running.
  const w = world(t, { tests: true })
  const state = join(w.config, '.cgc')
  mkdirSync(state, { recursive: true })
  writeFileSync(join(state, 'selftest.json'), JSON.stringify({ head: head(w.friend), at: Date.now() - 11 * 60 * 1000, total: 0, pass: 0, fail: 0, skipped: 0, timedOut: true, unread: false, budgetMs: 1200000 }))
  writeFileSync(join(state, 'selftest.running'), JSON.stringify({ pid: process.pid, at: Date.now() }))
  const { line, ctx } = fire(w, w.friend)
  assert.match(line, /tests running in another session/, line)
  assert.doesNotMatch(line, /did not finish|DEGRADED/, line)
  assert.doesNotMatch(ctx, /did not finish within/)
  assert.equal(existsSync(join(w.friend, 'testruns.txt')), false, 'it must not have started a second run')
})


/** The per-prompt hook, for one session. Returns the additionalContext, or null when silent. */
function promptAs(w, session, env = {}) {
  const r = spawnSync(process.execPath, [join(REPO, 'config', 'hooks', 'user-prompt-cgc-update.js')], {
    input: JSON.stringify(session ? { session_id: session } : {}), encoding: 'utf8', timeout: 120000,
    env: { ...process.env, CGC_REPO: w.friend, CLAUDE_CONFIG_DIR: w.config, CGC_FETCH_TTL_MS: '0', ...env },
  })
  assert.equal(r.status, 0)
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : null
}
/** The detached updater has landed when the clone is at the author's head and re-applied. */
const updated = (w) => waitFor(() => head(w.friend) === head(w.author) && existsSync(join(w.friend, 'installed.txt')) && !existsSync(join(w.config, '.cgc', 'update.lock')), 20000, 'the detached update')

test('a clone whose origin/HEAD is unset is still followed by the per-prompt hook — no TypeError, no "could not verify" on every prompt', (t) => {
  // out() is null on a non-zero exit, and git symbolic-ref exits 128 when origin/HEAD is unset:
  // the line copied from the session-start hook (whose out() never returns null) did
  // null.replace(), and the catch-all said "could not verify (Cannot read properties of null)"
  // on every prompt — unthrottled, because the catch used emit rather than once.
  const w = world(t, {})
  git(w.friend, 'symbolic-ref', '--delete', 'refs/remotes/origin/HEAD')
  assert.equal(promptAs(w, 's'), null, 'current, and silent')
  w.release('1.1.0', 'Change')
  const said = promptAs(w, 's')
  assert.match(String(said), /updating in the background/, said)
  assert.doesNotMatch(String(said), /could not verify|null/)
  updated(w)
})

test("a session's own commit is not announced to it as somebody else's update", (t) => {
  // The author's workflow: prompt, commit, prompt, push, prompt. Version two told the session
  // after the push that the clone "moved … another session applied the update and re-applied
  // the config" — three claims, all false.
  const w = world(t, {})
  assert.equal(promptAs(w, 'author'), null)
  git(w.friend, 'commit', '-q', '--allow-empty', '-m', 'my work')
  assert.equal(promptAs(w, 'author'), null, 'ahead-only: nothing to say')
  git(w.friend, 'push', '-q', 'origin', 'main')
  assert.equal(promptAs(w, 'author'), null, 'after the push: still nothing — it was this clone\'s own commit')
})

/** A real session start for one session id, which records what that session was told. */
const start = (w, session) => spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify({ source: 'startup', session_id: session }), encoding: 'utf8', timeout: 120000,
  env: { ...process.env, CGC_REPO: w.friend, CLAUDE_CONFIG_DIR: w.config },
})

test('every session hears about an update once — the one that started it, one that was open before it, one that only started', (t) => {
  const w = world(t, {})
  // X started before the update and never prompted: its session-start hook recorded the head
  // it announced, so its first prompt after the update can be told that line is stale.
  const old = head(w.friend)
  const x = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ source: 'startup', session_id: 'x-idle' }), encoding: 'utf8', timeout: 120000, env: { ...process.env, CGC_REPO: w.friend, CLAUDE_CONFIG_DIR: w.config } })
  assert.equal(x.status, 0)
  assert.equal(readFileSync(join(w.config, '.cgc', 'seen', 'x-idle'), 'utf8').trim(), old, 'the start line is on record')
  // B prompted before the update.
  assert.equal(promptAs(w, 'b'), null)

  w.release('1.1.0', 'a release')
  // A finds it and starts the update; it is not claimed as done.
  const a1 = promptAs(w, 'a')
  assert.match(String(a1), /updating in the background/, a1)
  updated(w)

  // A SESSION START LANDS BETWEEN THE UPDATE AND THE TELLING. update.json is one slot, and a
  // start on a current clone rewrites it with {status:'current'} — which is why "was this an
  // update or a local commit?" cannot be asked of it. It is asked of last-applied, whose mtime
  // says when the config last changed under everybody, and which nothing but an update writes.
  assert.equal(start(w, 'c-new').status, 0)
  assert.equal(JSON.parse(readFileSync(join(w.config, '.cgc', 'update.json'), 'utf8')).status, 'current',
    'precondition: the later start really did overwrite update.json')

  const a2 = promptAs(w, 'a')
  assert.match(String(a2), /updated itself since this session last checked/, a2)
  assert.match(String(a2), /re-applied/)
  assert.match(String(a2), /v1\.1\.0 \([0-9a-f]{7}\), up from [0-9a-f]{7}/, a2)
  const b = promptAs(w, 'b')
  assert.match(String(b), /updated itself since this session last checked/, b)
  assert.match(String(b), /v1\.1\.0 \([0-9a-f]{7}\), up from [0-9a-f]{7}/, b)
  assert.equal(promptAs(w, 'b'), null, 'B: told once')
  const xi = promptAs(w, 'x-idle')
  assert.match(String(xi), /updated itself since this session last checked/, 'X, whose first prompt lands after the update, is told its start line is stale')
  assert.equal(promptAs(w, 'c-new'), null, 'a session that started after the update has nothing to be told')
})


test('an update that cannot land is REPORTED, not announced as still running for ever', (t) => {
  // The hand-off said "updating in the background now — the next prompt reports the result" and
  // then never looked: update.json was read only on the current path, which a clone that is
  // still behind never reaches. An untracked file the pull would overwrite is the case that
  // proves it — the porcelain probe uses --untracked-files=no and cannot see it, so only the
  // pull discovers it. Every prompt said "updating now", for ever, and launched a fresh
  // detached updater every two minutes.
  const w = world(t, {})
  writeFileSync(join(w.friend, 'newthing.txt'), 'mine', 'utf8')          // untracked, in the way
  writeFileSync(join(w.author, 'newthing.txt'), 'theirs', 'utf8')
  git(w.author, 'add', '-A')
  w.release('1.1.0', 'a release that adds newthing.txt')

  const before = head(w.friend)
  const first = promptAs(w, 's')
  assert.match(String(first), /updating in the background/, first)
  waitFor(() => existsSync(join(w.config, '.cgc', 'update.json')) && JSON.parse(readFileSync(join(w.config, '.cgc', 'update.json'), 'utf8')).status === 'dirty', 20000, 'the blocked update to record its outcome')

  const second = promptAs(w, 's')
  assert.match(String(second), /the update did NOT land/, second)
  assert.match(String(second), /newthing\.txt/, 'and says what blocked it')
  assert.match(String(second), /running a stale version/, 'and that the new commits are not in force')
  assert.doesNotMatch(String(second), /updating in the background/)
  // And it does not relaunch an updater on every prompt: the stamp is minutes old, not seconds.
  const stampAt = readFileSync(join(w.config, '.cgc', 'update-bg'), 'utf8')
  promptAs(w, 's')
  assert.equal(readFileSync(join(w.config, '.cgc', 'update-bg'), 'utf8'), stampAt, 'no respawn while the failure stands')
  assert.equal(head(w.friend), before, 'and nothing was merged')
})

test('a missing updater is said, not spawned into silence', (t) => {
  // spawn() succeeds for a path that does not exist and the child dies at once; with stdio
  // ignored, the hook reported "updating in the background" on every prompt while nothing moved.
  const w = world(t, {})
  w.release('1.1.0', 'a release')
  const hookDir = mkdtempSync(join(tmpdir(), 'cgc-nohook-'))
  t.after(() => rmSync(hookDir, { recursive: true, force: true }))
  const lone = join(hookDir, 'user-prompt-cgc-update.js')
  writeFileSync(lone, readFileSync(join(REPO, 'config', 'hooks', 'user-prompt-cgc-update.js'), 'utf8'), 'utf8')
  const r = spawnSync(process.execPath, [lone], {
    input: '{}', encoding: 'utf8', timeout: 120000,
    env: { ...process.env, CGC_REPO: w.friend, CLAUDE_CONFIG_DIR: w.config, CGC_FETCH_TTL_MS: '0' },
  })
  assert.equal(r.status, 0)
  const said = JSON.parse(r.stdout).hookSpecificOutput.additionalContext
  assert.match(said, /its updater is missing/, said)
  assert.doesNotMatch(said, /updating in the background/)
})

test('git that cannot answer about local changes is not read as a clean tree', (t) => {
  // Every git call is clamped to what is left of the budget, and out() returns null for a call
  // that failed or timed out exactly as it does for an empty answer. Read as "no local changes"
  // and "0 commits ahead", those two conflations hand a dirty or diverged clone to the updater.
  // A corrupt index is the honest way to produce exactly that: `git status` cannot answer, while
  // rev-parse, rev-list and symbolic-ref — which never read the index — all answer normally.
  // The test is a CONTRAST: one clone, one fetch window, two runs that differ only in whether
  // git can read the index. GIT_INDEX_FILE is inherited by the hook's git calls, so pointing it
  // at a damaged file makes `status --porcelain` exit non-zero while rev-parse and rev-list —
  // which never read an index — answer normally. Inside the window every standing condition is
  // silent by design, so what is asserted is the decision, not the sentence: with the index
  // readable the clone is handed to the updater, and with it unreadable it never is.
  const w = world(t, {})
  w.release('1.1.0', 'a release')
  git(w.friend, 'fetch', '-q', 'origin', 'main')       // git will not fetch with a bad index
  const state = join(w.config, '.cgc')
  mkdirSync(state, { recursive: true })
  const window = () => writeFileSync(join(state, 'last-remote-check'), String(Date.now()))
  const run = (env) => spawnSync(process.execPath, [join(REPO, 'config', 'hooks', 'user-prompt-cgc-update.js')], {
    input: '{}', encoding: 'utf8', timeout: 120000,
    env: { ...process.env, CGC_REPO: w.friend, CLAUDE_CONFIG_DIR: w.config, ...env },
  })

  const bad = join(w.root, 'not-an-index')
  writeFileSync(bad, 'x', 'utf8')
  assert.notEqual(spawnSync('git', ['-C', w.friend, 'status', '--porcelain'], { encoding: 'utf8', env: { ...process.env, GIT_INDEX_FILE: bad } }).status, 0,
    'precondition: status cannot answer')
  assert.equal(spawnSync('git', ['-C', w.friend, 'rev-parse', 'HEAD'], { encoding: 'utf8', env: { ...process.env, GIT_INDEX_FILE: bad } }).status, 0,
    'precondition: the rest of the path still answers')

  const before = head(w.friend)
  window()
  assert.equal(run({ GIT_INDEX_FILE: bad }).status, 0, 'the hook never fails a prompt')
  assert.equal(existsSync(join(state, 'update-bg')), false,
    'a tree git cannot describe is never handed to the updater — unknown is not clean')
  assert.equal(head(w.friend), before, 'and nothing was merged')

  // The contrast: everything else identical, and now it does hand off.
  window()
  assert.equal(run({}).status, 0)
  assert.ok(existsSync(join(state, 'update-bg')), 'a readable index is handed off, so the test is testing the index')
  // The DIRTY half is reachable through the index; the AHEAD half is not — nothing breaks
  // `rev-list --count` while leaving `rev-parse origin/main` working, and without that the hook
  // exits earlier for a different reason. So that half is pinned where it lives: both probes
  // must be guarded, or the conflation comes back for one of them.
  const src = readFileSync(join(REPO, 'config', 'hooks', 'user-prompt-cgc-update.js'), 'utf8')
  assert.match(src, /if \(aheadR\.status !== 0 \|\| dirtyR\.status !== 0\)/, 'both probes are guarded, not just the one a test can break')
  assert.doesNotMatch(src, /const ahead = out\(/, 'ahead is read from stdout, not through the null-on-failure reader')
  assert.doesNotMatch(src, /const dirty = out\(/, 'and so is dirty')
  // The updater's cwd is the clone; let it finish before the world is removed.
  waitFor(() => head(w.friend) === head(w.author) && existsSync(join(w.friend, 'installed.txt')), 20000, 'the detached update')
})

test('the per-session record is swept, not accumulated for ever', (t) => {
  // The sweep ran only when this session had no record — and then the session-start hook began
  // writing one at every start, which made that condition unreachable and the sweep dead code.
  const w = world(t, {})
  const dir = join(w.config, '.cgc', 'seen')
  mkdirSync(dir, { recursive: true })
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  for (let i = 0; i < 150; i++) {
    const p = join(dir, `stale-${i}`)
    writeFileSync(p, 'x')
    utimesSync(p, old, old)
  }
  promptAs(w, 'fresh-session')
  const names = readdirSync(dir)
  assert.ok(names.includes('fresh-session'), 'this session is recorded')
  assert.ok(names.length < 10, `week-old records are swept, ${names.length} left`)
})

test('a session start that could not get the lock does not tell the installer the lock is held', (t) => {
  // withLock runs its body whether or not it got the lock, and runInstall asserted "held" to the
  // installer unconditionally — and paths.mjs makes acquireUpdateLock() a no-op on that
  // assertion. So a session that waited out the lock spawned an installer with locking switched
  // off, read-modify-writing settings.json beside the process that did hold it.
  const w = world(t, { doctor: true })
  // A live lock held by somebody else, and a wait short enough to test.
  const state = join(w.config, '.cgc')
  mkdirSync(state, { recursive: true })
  writeFileSync(join(state, 'update.lock'), JSON.stringify({ pid: 999999, at: Date.now() }))
  // The stub install records the flag it was given.
  writeFileSync(join(w.friend, 'tools', 'install.mjs'),
    "import { writeFileSync } from 'node:fs'\nwriteFileSync(new URL('../installed.txt', import.meta.url), String(process.env.CGC_UPDATE_LOCK_HELD || 'unset'))\n", 'utf8')
  const r = spawnSync(process.execPath, [HOOK], {
    input: '{"source":"startup"}', encoding: 'utf8', timeout: 120000,
    env: { ...process.env, CGC_REPO: w.friend, CLAUDE_CONFIG_DIR: w.config, CGC_LOCK_WAIT_MS: '500' },
  })
  assert.equal(r.status, 0)
  assert.equal(readFileSync(join(w.friend, 'installed.txt'), 'utf8'), '0',
    'the installer must take the lock itself when its parent does not hold it')
  assert.ok(existsSync(join(state, 'update.lock')), "and the other process's lock is left alone")
})

test("a doctor warning reaches the reader, not just the count", (t) => {
  // A registration pointing at a binary that is gone is a warning, correctly — the repair cannot
  // download it — but only the COUNT reached the line, so a server that fails to start in every
  // session read as "enabled · (1 warning)" and the instruction that fixes it went nowhere.
  const w = world(t, {})
  writeFileSync(join(w.friend, 'tools', 'doctor.mjs'),
    "console.log(JSON.stringify({ healthy: true, counts: { ok: 3, warn: 1 }, results: [{ level: 'warn', message: 'codebase-memory-mcp: registered at C:/gone.exe, which is gone' }] }))\n", 'utf8')
  const { line, ctx } = fire(w, w.friend)
  assert.match(line, /3\/4 checks \(1 warning\)/, line)
  assert.match(ctx, /Warning: codebase-memory-mcp: registered at .*which is gone/, ctx)
})

test('a session with no record of its own is not greeted with an update that landed before it existed', (t) => {
  // mtime() answers 0 for a file that is not there, and the guard only tested that the prompt
  // HAS a session id — so a session with no record compared 0 against last-applied and was told
  // about whatever update happened last, however long ago. Found by running the real hooks
  // against a real clone: a session that had never prompted was greeted with an update that had
  // already landed. It also resurrects an old announcement for any session whose record the
  // week-old sweep removed.
  const w = world(t, {})
  const state = join(w.config, '.cgc')
  mkdirSync(state, { recursive: true })
  // An update that landed a while ago, and a session that has never been seen before.
  writeFileSync(join(state, 'last-applied'), JSON.stringify({ at: Date.now() - 3 * 60 * 60 * 1000, head: head(w.friend), before: '1.0.0', after: '1.1.0', applied: true }))
  const old = new Date(Date.now() - 3 * 60 * 60 * 1000)
  utimesSync(join(state, 'last-applied'), old, old)

  assert.equal(promptAs(w, 'never-seen-before'), null, 'a session with no record has no stale belief to correct')
  assert.ok(existsSync(join(state, 'seen', 'never-seen-before')), 'but it is recorded, so the NEXT update is told to it')

  // And the next update is: it now has a record, so a newer last-applied is news.
  const later = join(state, 'last-applied')
  writeFileSync(later, JSON.stringify({ at: Date.now(), head: head(w.friend), before: '1.1.0', after: '1.2.0', applied: true }))
  assert.match(String(promptAs(w, 'never-seen-before')), /updated itself since this session last checked/)
})

test('a pull that landed with an install that FAILED is not announced as "the config was re-applied"', (t) => {
  // The record carries `applied`, and the message ignored it. A fast-forward whose install step
  // failed — settings.json contention, a timeout at the 120 s cap — was announced to every open
  // session as "the config, hooks and skills were re-applied … in force from this message on".
  // That is the ONLY report anyone gets: the background updater carries no session, so nobody
  // sees its start line, and the next session start reports 'current' and erases the failure.
  const w = world(t, {})
  const state = join(w.config, '.cgc')
  mkdirSync(join(state, 'seen'), { recursive: true })
  writeFileSync(join(state, 'seen', 's'), head(w.friend))
  const old = new Date(Date.now() - 60 * 1000)
  utimesSync(join(state, 'seen', 's'), old, old)
  writeFileSync(join(state, 'last-applied'), JSON.stringify({ at: Date.now(), head: head(w.friend), before: '1.0.0', after: '1.1.0', applied: false }))

  const said = String(promptAs(w, 's'))
  assert.match(said, /config re-apply FAILED/, said)
  assert.match(said, /still the OLD ones/, 'and says what that means for the gates')
  assert.match(said, /NOT in force/)
  assert.match(said, /install\.mjs/, 'and names the command that fixes it')
  assert.doesNotMatch(said, /were re-applied/, 'it must not claim the opposite')
  assert.equal(promptAs(w, 's'), null, 'and it is said once')
})

test('a blocking reason the clone no longer has is not repeated — it is retried as soon as the floor allows', (t) => {
  // The hook reported an untracked file that blocked the fast-forward, correctly. The user then
  // deleted the file, exactly as the message said. Every prompt for the next THIRTY MINUTES
  // repeated the same reason, naming a file that no longer existed, and retried nothing — while
  // the ahead and dirty probes two lines earlier had already come back clean on that very
  // prompt. A recorded reason the current state contradicts is a reason to try again now.
  const w = world(t, {})
  writeFileSync(join(w.friend, 'newthing.txt'), 'mine', 'utf8')
  writeFileSync(join(w.author, 'newthing.txt'), 'theirs', 'utf8')
  git(w.author, 'add', '-A')
  w.release('1.1.0', 'a release that adds newthing.txt')

  assert.match(String(promptAs(w, 's')), /updating in the background/)
  waitFor(() => { try { return JSON.parse(readFileSync(join(w.config, '.cgc', 'update.json'), 'utf8')).status === 'dirty' } catch { return false } }, 20000, 'the blocked outcome')
  assert.match(String(promptAs(w, 's')), /the update did NOT land/, 'the reason is reported while it is true')

  // The user does what the message says. The working state changed, so the recorded reason is
  // no longer evidence — it is retried without waiting out the backoff, and the falsified reason
  // is not repeated. (Every attempt is under a thirty-second floor, so that a repository which
  // changes on its own cannot turn "the state changed" into a spawn per prompt; the stamp is
  // aged here to stand for a prompt a little later, which is what a person typing produces.)
  rmSync(join(w.friend, 'newthing.txt'), { force: true })
  const aMomentLater = new Date(Date.now() - 45 * 1000)
  utimesSync(join(w.config, '.cgc', 'update-bg'), aMomentLater, aMomentLater)
  const retried = String(promptAs(w, 's'))
  assert.match(retried, /updating in the background now/, retried)
  assert.doesNotMatch(retried, /newthing\.txt/, 'it must not name a file the user has deleted')
  assert.doesNotMatch(retried, /did NOT land/, 'nor ask again for a fix that has been made')
  waitFor(() => head(w.friend) === head(w.author) && existsSync(join(w.friend, 'installed.txt')), 20000, 'the retry to land')
})

test('a blocking reason that is STILL true is retried on the timer, and says so rather than reading as a fresh failure', (t) => {
  // The other half: nothing about the clone changed, so the reason stands. It is re-tried when
  // the half-hour is up — and the prompt that re-tries must not print the "nothing is happening,
  // go and fix it" sentence, which is what the first version said even on the prompt that had
  // just spawned a new attempt.
  const w = world(t, {})
  writeFileSync(join(w.friend, 'newthing.txt'), 'mine', 'utf8')
  writeFileSync(join(w.author, 'newthing.txt'), 'theirs', 'utf8')
  git(w.author, 'add', '-A')
  w.release('1.1.0', 'a release that adds newthing.txt')
  const before = head(w.friend)
  promptAs(w, 's')
  waitFor(() => { try { return JSON.parse(readFileSync(join(w.config, '.cgc', 'update.json'), 'utf8')).status === 'dirty' } catch { return false } }, 20000, 'the blocked outcome')
  const standing = String(promptAs(w, 's'))
  assert.match(standing, /retries within seconds, or within half an hour anyway/, 'the wait is stated, not left to be guessed')

  // Half an hour later, with the file still in the way.
  const stamp = join(w.config, '.cgc', 'update-bg')
  const old = new Date(Date.now() - 31 * 60 * 1000)
  utimesSync(stamp, old, old)
  const retried = String(promptAs(w, 's'))
  assert.match(retried, /trying again in the background now/, retried)
  assert.match(retried, /The last attempt did NOT land/, 'and it still says why the last one failed')
  waitFor(() => { try { return JSON.parse(readFileSync(join(w.config, '.cgc', 'update.json'), 'utf8')).status === 'dirty' } catch { return false } }, 20000, 'the retry to fail the same way')
  assert.equal(head(w.friend), before, 'still behind, still not merged')
  assert.notEqual(head(w.friend), head(w.author), 'the clone really is behind, so the assertion above means something')
  // The retry's updater has the clone as its cwd; let it release the lock and exit before the
  // world is removed, or the teardown races it and rmSync fails with EPERM on Windows.
  waitFor(() => !existsSync(join(w.config, '.cgc', 'update.lock')), 20000, 'the updater to finish')
})

test('with two updates between one session\'s prompts, the "from" is where THAT session was', (t) => {
  // last-applied is one slot. Reading `before` out of it told a session it had moved from a
  // version it was never on: two releases landed, and the session that had been on 1.0.0 was
  // told "v1.1.0 → v1.2.0". The only honest "from" is the session's own record.
  const w = world(t, {})
  const state = join(w.config, '.cgc')
  mkdirSync(join(state, 'seen'), { recursive: true })
  const wasAt = head(w.friend)
  writeFileSync(join(state, 'seen', 's'), wasAt)
  const old = new Date(Date.now() - 60 * 1000)
  utimesSync(join(state, 'seen', 's'), old, old)
  // Two updates, the record holding only the second.
  writeFileSync(join(state, 'last-applied'), JSON.stringify({ at: Date.now(), head: head(w.friend), before: '1.1.0', after: '1.2.0', applied: true }))

  const said = String(promptAs(w, 's'))
  assert.match(said, new RegExp(`up from ${wasAt.slice(0, 7)}`), said)
  assert.doesNotMatch(said, /v1\.1\.0/, 'a version this session was never on is never named as its starting point')
})

test('the sweep keeps the record of a session that is still live', (t) => {
  // The amplifier for the no-record defect: sweeping a live session's record makes it a session
  // with no record, and the guard's other half then decides what it hears.
  const w = world(t, {})
  const dir = join(w.config, '.cgc', 'seen')
  mkdirSync(dir, { recursive: true })
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  for (let i = 0; i < 150; i++) { const p = join(dir, `stale-${i}`); writeFileSync(p, 'x'); utimesSync(p, old, old) }
  writeFileSync(join(dir, 'still-here'), head(w.friend))          // written just now
  promptAs(w, 'fresh-session')
  assert.ok(existsSync(join(dir, 'still-here')), "a live session's record survives the sweep")
  assert.ok(readdirSync(dir).length < 10, 'and the stale ones do not')
})

test('a session start that DOES hold the lock still tells the installer so', (t) => {
  // The other half of the lock flag: passing it when it is true is what stops the installer
  // waiting thirty seconds for a lock its own parent holds, at every session start.
  const w = world(t, { doctor: true })
  writeFileSync(join(w.friend, 'tools', 'install.mjs'),
    "import { writeFileSync } from 'node:fs'\nwriteFileSync(new URL('../installed.txt', import.meta.url), String(process.env.CGC_UPDATE_LOCK_HELD))\n", 'utf8')
  const r = spawnSync(process.execPath, [HOOK], {
    input: '{"source":"startup"}', encoding: 'utf8', timeout: 120000,
    env: { ...process.env, CGC_REPO: w.friend, CLAUDE_CONFIG_DIR: w.config },
  })
  assert.equal(r.status, 0)
  assert.equal(readFileSync(join(w.friend, 'installed.txt'), 'utf8'), '1',
    'the installer must not queue behind the process that already holds the lock')
})

test('a blocked clone that changes for an unrelated reason retries at most once, not once per prompt', (t) => {
  // The digest was written only where a blocking reason is REPORTED — the one branch that cannot
  // run once the state has changed. So it froze at the pre-change state, every later prompt saw
  // a difference, and the clone spawned a fresh detached updater on EVERY prompt for ever while
  // never printing the reason again: worse than the every-two-minutes respawn it replaced.
  const w = world(t, {})
  writeFileSync(join(w.friend, 'newthing.txt'), 'mine', 'utf8')
  writeFileSync(join(w.author, 'newthing.txt'), 'theirs', 'utf8')
  git(w.author, 'add', '-A')
  w.release('1.1.0', 'a release that adds newthing.txt')
  const stamp = join(w.config, '.cgc', 'update-bg')
  const digest = join(w.config, '.cgc', 'update-blocked-state')

  promptAs(w, 's')
  waitFor(() => { try { return JSON.parse(readFileSync(join(w.config, '.cgc', 'update.json'), 'utf8')).status === 'dirty' } catch { return false } }, 20000, 'the blocked outcome')
  assert.ok(existsSync(digest), 'the state is recorded when the attempt is ASKED for, so every attempt refreshes it')
  assert.match(String(promptAs(w, 's')), /the update did NOT land/)
  const asked = readFileSync(stamp, 'utf8')
  const askedAt = statSync(stamp).mtimeMs

  // Something unrelated changes — a build log, an editor swap file, the user simply working.
  writeFileSync(join(w.friend, 'build-output.log'), 'noise', 'utf8')
  for (let i = 0; i < 4; i++) promptAs(w, 's')
  assert.equal(statSync(stamp).mtimeMs, askedAt, 'no respawn inside the floor, however interesting the change')
  assert.equal(readFileSync(stamp, 'utf8'), asked)

  // Past the floor, the change earns exactly one retry — and that retry refreshes the digest,
  // so the prompt after it does not spawn again.
  const old = new Date(Date.now() - 60 * 1000)
  utimesSync(stamp, old, old)
  promptAs(w, 's')
  const retriedAt = statSync(stamp).mtimeMs
  assert.ok(retriedAt > askedAt, 'the change is retried once the floor has passed')
  waitFor(() => { try { return JSON.parse(readFileSync(join(w.config, '.cgc', 'update.json'), 'utf8')).status === 'dirty' } catch { return false } }, 20000, 'the retry to finish')
  promptAs(w, 's')
  promptAs(w, 's')
  assert.equal(statSync(stamp).mtimeMs, retriedAt, 'and the refreshed digest stops it spawning again')
  waitFor(() => !existsSync(join(w.config, '.cgc', 'update.lock')), 20000, 'the updater to finish')
})

test('the two-minute floor and the thirty-minute backoff are different numbers', (t) => {
  // Deleting the backoff entirely — respawning every two minutes, which is what 1.64.0 did —
  // passed every other test in this file, because nothing back-dated the stamp by a value
  // between the two.
  const w = world(t, {})
  writeFileSync(join(w.friend, 'newthing.txt'), 'mine', 'utf8')
  writeFileSync(join(w.author, 'newthing.txt'), 'theirs', 'utf8')
  git(w.author, 'add', '-A')
  w.release('1.1.0', 'a release that adds newthing.txt')
  const stamp = join(w.config, '.cgc', 'update-bg')
  promptAs(w, 's')
  waitFor(() => { try { return JSON.parse(readFileSync(join(w.config, '.cgc', 'update.json'), 'utf8')).status === 'dirty' } catch { return false } }, 20000, 'the blocked outcome')
  promptAs(w, 's')

  // Ten minutes on, with the blocker untouched: past the floor, well inside the backoff.
  const tenAgo = new Date(Date.now() - 10 * 60 * 1000)
  utimesSync(stamp, tenAgo, tenAgo)
  const said = String(promptAs(w, 's'))
  assert.equal(statSync(stamp).mtimeMs, tenAgo.getTime(), 'a standing reason is not retried every two minutes')
  assert.match(said, /the update did NOT land/, said)
  waitFor(() => !existsSync(join(w.config, '.cgc', 'update.lock')), 20000, 'the updater to finish')
})

test('a re-apply that failed and was then REPAIRED is not reported as still broken', (t) => {
  // update() writes applied:false the moment the post-pull install exits non-zero — and verify()
  // repairs it two lines later, in the same process, and nothing wrote that back. Every open
  // session was told as fact that its hooks were stale and its gates not in force, and to run a
  // command that had already succeeded.
  const w = world(t, { doctor: true })
  writeFileSync(join(w.author, 'tools', 'install.mjs'),
    "import { writeFileSync, existsSync } from 'node:fs'\n"
    + "const tried = new URL('../tried.txt', import.meta.url)\n"
    + "if (!existsSync(tried)) { writeFileSync(tried, '1'); process.exit(3) }\n"
    + "writeFileSync(new URL('../installed.txt', import.meta.url), process.argv.slice(2).join(' '))\n", 'utf8')
  git(w.author, 'commit', '-q', '-am', 'a flaky install')
  git(w.author, 'push', '-q', 'origin', 'main')
  w.release('1.1.0', 'a release')

  const { line } = fire(w, w.friend, 'startup')
  assert.match(line, /updated 1\.0\.0 → 1\.1\.0/, line)
  assert.ok(existsSync(join(w.friend, 'installed.txt')), 'precondition: the repair really did run and succeed')
  const rec = JSON.parse(readFileSync(join(w.config, '.cgc', 'last-applied'), 'utf8'))
  assert.equal(rec.applied, true, 'a clean doctor after the repair is the evidence, not the first exit code')

  const state = join(w.config, '.cgc')
  mkdirSync(join(state, 'seen'), { recursive: true })
  writeFileSync(join(state, 'seen', 'b'), 'b'.repeat(40))
  const older = new Date(Date.now() - 10 * 60 * 1000)
  utimesSync(join(state, 'seen', 'b'), older, older)
  const said = String(promptAs(w, 'b'))
  assert.match(said, /were re-applied/, said)
  assert.doesNotMatch(said, /FAILED|NOT in force/, 'it must not report a failure that was repaired')
})

test('the background stamp is not cleared while an updater still holds the lock', (t) => {
  // The updater pulls before it installs, so a prompt from another session sees the clone as
  // current while the install is still running — and clearing the stamp there removed the guard
  // that stops a second updater starting beside the first.
  const w = world(t, {})
  const state = join(w.config, '.cgc')
  mkdirSync(state, { recursive: true })
  writeFileSync(join(state, 'update-bg'), '1')
  writeFileSync(join(state, 'update-blocked-state'), 'x')
  writeFileSync(join(state, 'update.lock'), JSON.stringify({ pid: 999999, at: Date.now() }))

  assert.equal(promptAs(w, 's'), null, 'the clone is current, so the prompt is silent')
  assert.ok(existsSync(join(state, 'update-bg')), 'the guard survives while an updater holds the lock')

  rmSync(join(state, 'update.lock'), { force: true })
  assert.equal(promptAs(w, 's'), null)
  assert.equal(existsSync(join(state, 'update-bg')), false, 'and is cleared once nothing is running')
  assert.equal(existsSync(join(state, 'update-blocked-state')), false)
})

test('the installer treats only "1" as the lock being held', () => {
  // The hook sets '1' or '0'; nothing pinned the READER, so changing it to !== '0' would make a
  // bare `node tools/install.mjs` — where the variable is unset — skip locking entirely.
  const src = readFileSync(join(REPO, 'tools', 'paths.mjs'), 'utf8')
  assert.match(src, /process\.env\.CGC_UPDATE_LOCK_HELD === '1'/, 'held is an explicit "1", never "anything but 0"')
})

test('an install that failed while the doctor saw nothing wrong is NOT recorded as applied', (t) => {
  // The correction has to be evidence of a repair that RAN. verify() re-installs only when the
  // doctor's first pass fails, so a clean first pass means nothing was repaired — and the
  // doctor's checks are not a superset of what the install writes (it has no opinion at all
  // about workflows/, which the install copies), so it can be clean while the failed install
  // left something out. Gating on "the doctor is clean" alone stamped applied:true, with a flag
  // literally named repairedAfterInstallFailure, on a machine where nothing was repaired.
  const w = world(t, {})
  writeFileSync(join(w.author, 'tools', 'install.mjs'), 'process.exit(3)\n', 'utf8')
  writeFileSync(join(w.author, 'tools', 'doctor.mjs'),
    'console.log(JSON.stringify({ healthy: true, counts: { ok: 5 }, results: [] }))\n', 'utf8')
  git(w.author, 'add', '-A')
  git(w.author, 'commit', '-q', '-m', 'a doctor that sees nothing and an install that fails')
  git(w.author, 'push', '-q', 'origin', 'main')
  w.release('1.1.0', 'a release')

  const { line, ctx } = fire(w, w.friend, 'startup')
  assert.match(line, /updated 1\.0\.0 → 1\.1\.0/, line)
  assert.doesNotMatch(line, /repaired/, 'precondition: nothing was repaired, because nothing failed')
  const rec = JSON.parse(readFileSync(join(w.config, '.cgc', 'last-applied'), 'utf8'))
  assert.equal(rec.applied, false, 'an install that failed is not "applied" because the doctor happens to be quiet')
  assert.equal(rec.repairedAfterInstallFailure, undefined, 'and nothing claims a repair that never ran')
  assert.match(ctx, /install step failed/, 'the session is told, rather than reassured')
})
