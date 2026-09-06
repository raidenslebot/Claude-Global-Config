// The session hook: update, verify, repair, one line. These build a real origin, an author
// clone and a friend clone in a temp dir and run the shipped hook against them with stub
// tools, so nothing touches this machine's ~/.claude. The cases that must NOT act are the
// important ones: a hook that pulled onto a dirty tree, a feature branch or unpushed work
// would be removed within a day.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, utimesSync, copyFileSync } from 'node:fs'
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

  // Behind: it updates itself and says what it applied. CGC_FETCH_TTL_MS=0 forces the network
  // check — the default 60s window is what stops a burst of prompts becoming a burst of fetches,
  // and without overriding it here the second call would reuse the ref it just cached.
  w.release('1.1.0', 'a release the running session has never seen')
  const said = fire(w.friend, { CGC_FETCH_TTL_MS: '0' })
  assert.match(String(said), /updated itself to v1\.1\.0/, said)
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
  assert.match(String(noUp), /updated itself to v1\.1\.0/, noUp)
  // The detached re-apply has the clone as its cwd; let it finish before the world is removed.
  waitFor(() => existsSync(join(w.friend, 'installed.txt')), 8000, 'the detached re-apply')
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

test('a stale clone fast-forwards and hands the re-apply off, leaving no lock behind', (t) => {
  // The merge is quick; the install after it is not (deps can run npm for minutes). Inside a
  // 10 s hook that install was killed mid-run: merge landed, config stale, update.lock left on
  // disk, nothing said. The re-apply is a detached process now, and the lock is released here.
  const HOOK = join(REPO, 'config', 'hooks', 'user-prompt-cgc-update.js')
  const w = world(t, {})
  w.release('1.5.0', 'a release with a slow install')
  const r = spawnSync(process.execPath, [HOOK], {
    input: '{}', encoding: 'utf8', timeout: 120000,
    env: { ...process.env, CGC_REPO: w.friend, CLAUDE_CONFIG_DIR: w.config, CGC_FETCH_TTL_MS: '0' },
  })
  assert.equal(r.status, 0)
  const said = JSON.parse(r.stdout).hookSpecificOutput.additionalContext
  assert.match(said, /updated itself to v1\.5\.0/, said)
  const shown = spawnSync('git', ['-C', w.friend, 'show', 'HEAD:package.json'], { encoding: 'utf8' }).stdout
  assert.equal(JSON.parse(shown).version, '1.5.0', 'the fast-forward landed')
  assert.equal(existsSync(join(w.config, '.cgc', 'update.lock')), false, 'the lock is not held past the hook')
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
