// The per-prompt updater, checked as a STATE MACHINE rather than one scenario at a time.
//
// WHY THIS FILE EXISTS. Five consecutive releases of this hook pair each had defects found in
// the previous release's fixes, and three of those defects were introduced BY a fix. Every one
// was found by a person reading a diff and reasoning about a case, and every fix came with a
// test for that case — so the tests grew one row at a time while the STATE SPACE grew
// combinatorially, and the next defect always sat in a combination nobody had written down.
//
// So this file does not test scenarios. It enumerates the cross product of the states the hook
// can actually meet — what the clone looks like × what this machine remembers × what the last
// background attempt did — runs the real hook against every one, and asserts the handful of
// properties that must hold in ALL of them. A property here is not "case N prints string S";
// it is "there is no state in which this hook merges", "there is no state in which it claims a
// re-apply that did not happen", "there is no state in which it exceeds its budget".
//
// Adding a state to a list below multiplies the coverage instead of adding one row, and a
// defect of the shape the last five rounds found — one path forgetting an invariant every other
// path keeps — fails here without anyone having predicted it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'

const HOOK = join(REPO, 'config', 'hooks', 'user-prompt-cgc-update.js')
const SESSION_HOOK = join(REPO, 'config', 'hooks', 'session-start-cgc.js')
const STUB_INSTALL = "import { writeFileSync } from 'node:fs'\nwriteFileSync(new URL('../installed.txt', import.meta.url), process.argv.slice(2).join(' '))\n"

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args],
    { cwd, encoding: 'utf8', timeout: 30000 })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const head = (repo) => git(repo, 'rev-parse', 'HEAD')

/** A real origin, an author clone and a friend clone. The friend is what the hook is pointed at. */
function world(t) {
  const root = mkdtempSync(join(tmpdir(), 'cgc-inv-'))
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 }))
  const origin = join(root, 'origin.git')
  git(root, 'init', '--bare', '-b', 'main', origin)
  const author = join(root, 'author')
  git(root, 'clone', '-q', origin, author)
  mkdirSync(join(author, 'tools'))
  writeFileSync(join(author, 'package.json'), JSON.stringify({ version: '1.0.0' }))
  writeFileSync(join(author, 'tools', 'install.mjs'), STUB_INSTALL)
  // The updater the hook hands off to is the real session-start hook, run from the clone.
  writeFileSync(join(author, 'tools', 'noop.txt'), 'x')
  git(author, 'add', '-A'); git(author, 'commit', '-q', '-m', 'Initial'); git(author, 'push', '-q', 'origin', 'main')
  const friend = join(root, 'friend')
  git(root, 'clone', '-q', origin, friend)
  return { root, author, friend, config: join(root, 'config') }
}

const release = (w, v, subject = 'a release') => {
  writeFileSync(join(w.author, 'package.json'), JSON.stringify({ version: v }))
  git(w.author, 'commit', '-q', '-am', subject); git(w.author, 'push', '-q', 'origin', 'main')
}

// ── the states a clone can be in ─────────────────────────────────────────────────────────────
// Each returns a note of what it did, so a failure names the combination rather than a number.
const CLONES = {
  current: () => {},
  behind: (w) => { release(w, '1.1.0') },
  'behind and dirty': (w) => { release(w, '1.1.0'); writeFileSync(join(w.friend, 'package.json'), '{"version":"mine"}') },
  'behind with an untracked collision': (w) => {
    writeFileSync(join(w.friend, 'newthing.txt'), 'mine')
    writeFileSync(join(w.author, 'newthing.txt'), 'theirs')
    git(w.author, 'add', '-A'); release(w, '1.1.0')
  },
  ahead: (w) => { git(w.friend, 'commit', '-q', '--allow-empty', '-m', 'mine') },
  diverged: (w) => { release(w, '1.1.0'); git(w.friend, 'commit', '-q', '--allow-empty', '-m', 'mine') },
  detached: (w) => { release(w, '1.1.0'); git(w.friend, 'checkout', '-q', '--detach') },
  'on another branch': (w) => { release(w, '1.1.0'); git(w.friend, 'checkout', '-q', '-b', 'side') },
  'with no origin': (w) => { release(w, '1.1.0'); git(w.friend, 'remote', 'remove', 'origin') },
  'not a clone': (w) => { rmSync(join(w.friend, '.git'), { recursive: true, force: true }) },
}

// ── what this machine remembers ──────────────────────────────────────────────────────────────
const MEMORIES = {
  'a session that has never been seen': () => {},
  'a session recorded before an update that landed': (w, state) => {
    mkdirSync(join(state, 'seen'), { recursive: true })
    writeFileSync(join(state, 'seen', 's'), 'a'.repeat(40))
    const old = new Date(Date.now() - 5 * 60 * 1000)
    utimesSync(join(state, 'seen', 's'), old, old)
    writeFileSync(join(state, 'last-applied'), JSON.stringify({ at: Date.now(), head: head(w.friend), before: '1.0.0', after: '1.1.0', applied: true }))
  },
  'a session recorded before an update whose re-apply FAILED': (w, state) => {
    mkdirSync(join(state, 'seen'), { recursive: true })
    writeFileSync(join(state, 'seen', 's'), 'a'.repeat(40))
    const old = new Date(Date.now() - 5 * 60 * 1000)
    utimesSync(join(state, 'seen', 's'), old, old)
    writeFileSync(join(state, 'last-applied'), JSON.stringify({ at: Date.now(), head: head(w.friend), before: '1.0.0', after: '1.1.0', applied: false }))
  },
  'a session already up to date with the last update': (w, state) => {
    mkdirSync(join(state, 'seen'), { recursive: true })
    const old = new Date(Date.now() - 5 * 60 * 1000)
    writeFileSync(join(state, 'last-applied'), JSON.stringify({ at: Date.now() - 5 * 60 * 1000, head: head(w.friend), applied: true }))
    utimesSync(join(state, 'last-applied'), old, old)
    writeFileSync(join(state, 'seen', 's'), head(w.friend))       // written after: newer mtime
  },
  'a background attempt that failed on a dirty tree': (w, state) => {
    mkdirSync(state, { recursive: true })
    writeFileSync(join(state, 'update-bg'), '1')
    const old = new Date(Date.now() - 60 * 1000)
    utimesSync(join(state, 'update-bg'), old, old)
    writeFileSync(join(state, 'update.json'), JSON.stringify({ at: Date.now(), status: 'dirty', error: 'error: Your local changes would be overwritten by merge: package.json' }))
  },
  'a record written by an older version, with no applied key': (w, state) => {
    mkdirSync(join(state, 'seen'), { recursive: true })
    writeFileSync(join(state, 'seen', 's'), 'a'.repeat(40))
    const old = new Date(Date.now() - 5 * 60 * 1000)
    utimesSync(join(state, 'seen', 's'), old, old)
    writeFileSync(join(state, 'last-applied'), JSON.stringify({ at: Date.now(), head: head(w.friend) }))
  },
  'a corrupt state directory': (w, state) => {
    mkdirSync(join(state, 'seen'), { recursive: true })
    writeFileSync(join(state, 'seen', 's'), 'a'.repeat(40))
    writeFileSync(join(state, 'last-applied'), 'not json at all')
    writeFileSync(join(state, 'update.json'), '{{{')
  },
}

/** Run the real hook for one (clone, memory) pair and return everything an invariant needs. */
function run(w, extraEnv = {}) {
  const before = existsSync(join(w.friend, '.git')) ? head(w.friend) : null
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ session_id: 's' }), encoding: 'utf8', timeout: 60000,
    env: { ...process.env, CGC_REPO: w.friend, CLAUDE_CONFIG_DIR: w.config, CGC_FETCH_TTL_MS: '0', ...extraEnv },
  })
  const ms = Date.now() - t0
  let said = null
  let parsed = true
  if (r.stdout.trim()) {
    try { said = JSON.parse(r.stdout).hookSpecificOutput.additionalContext } catch { parsed = false }
  }
  const after = existsSync(join(w.friend, '.git')) ? head(w.friend) : null
  return { r, ms, said, parsed, before, after }
}

/** Wait for any detached updater this run started to finish, so teardown does not race it. */
function quiesce(w) {
  const lock = join(w.config, '.cgc', 'update.lock')
  const until = Date.now() + 25000
  while (existsSync(lock) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
}

test('every state the updater can meet keeps every invariant', (t) => {
  const failures = []
  let ran = 0
  for (const [cloneName, setUpClone] of Object.entries(CLONES)) {
    for (const [memoryName, setUpMemory] of Object.entries(MEMORIES)) {
      const where = `${cloneName} + ${memoryName}`
      const w = world(t)
      const state = join(w.config, '.cgc')
      mkdirSync(state, { recursive: true })
      setUpClone(w)
      // The memory is written after the clone state, so it can name the clone's real head.
      if (existsSync(join(w.friend, '.git'))) setUpMemory(w, state)
      const got = run(w)
      ran++
      const bad = (why) => failures.push(`${where}: ${why}\n    said: ${JSON.stringify(got.said)}`)

      // 1. A hook that can fail a prompt is worse than no hook.
      if (got.r.status !== 0) bad(`exited ${got.r.status} — ${String(got.r.stderr || '').slice(0, 200)}`)
      // 2. Whatever it says has to be readable by the host.
      if (!got.parsed) bad('wrote something that is not the documented JSON shape')
      // 3. THE PROMPT HOOK NEVER MERGES. Two releases did, and a killed merge wedged the clone.
      if (got.before !== got.after) bad(`moved HEAD ${got.before} → ${got.after}`)
      // 4. The budget. The host kills it at 10 s; a kill mid-write is what leaves locks behind.
      if (got.ms > 9500) bad(`took ${got.ms} ms, past the 10 s the host allows`)
      // 5. It never claims the config was re-applied when the record says it was not.
      const claimsApplied = got.said && /were re-applied/.test(got.said)
      if (claimsApplied) {
        let rec = null
        try { rec = JSON.parse(readFileSync(join(state, 'last-applied'), 'utf8')) } catch { rec = null }
        if (!rec) bad('claimed a re-apply with no record of one')
        else if (rec.applied === false) bad('claimed a re-apply the record says FAILED')
      }
      // 6. It never announces an update to a session that has no record of its own: there is no
      //    stale belief to correct, and the update may pre-date the session entirely.
      if (memoryName === 'a session that has never been seen' && got.said && /updated itself|re-apply FAILED/.test(got.said)) {
        bad('announced an update to a session that had never been seen before')
      }
      // 7. A clone that is current and has nothing to report says nothing at all. A hook that
      //    speaks on every prompt is a hook that gets removed, and a removed hook checks nothing.
      if (cloneName === 'current' && memoryName === 'a session already up to date with the last update' && got.said !== null) {
        bad('spoke when there was nothing to say')
      }
      // 8. Anything it says about being behind must not also claim to be current.
      if (got.said && /is \d+ commit\(s\) behind/.test(got.said) && /in force from this message on/.test(got.said)) {
        bad('said it is behind and that the new gates are in force')
      }
      quiesce(w)
    }
  }
  assert.equal(failures.length, 0, `${failures.length} of ${ran} states broke an invariant:\n\n${failures.join('\n\n')}`)
  assert.ok(ran >= 60, `the matrix must actually be a matrix, ran ${ran}`)
})

test('the session-start hook keeps its own invariants in every clone state', (t) => {
  // The updater the prompt hook hands off to. Its one line is what a session is told to repeat
  // verbatim, so "always exits 0 and always produces a line" is the property that matters, in
  // every clone state — including the ones where it must refuse to act.
  const failures = []
  for (const [cloneName, setUpClone] of Object.entries(CLONES)) {
    const w = world(t)
    setUpClone(w)
    const before = existsSync(join(w.friend, '.git')) ? head(w.friend) : null
    const r = spawnSync(process.execPath, [SESSION_HOOK], {
      input: JSON.stringify({ source: 'startup', session_id: 'x' }), encoding: 'utf8', timeout: 120000,
      env: { ...process.env, CGC_REPO: w.friend, CLAUDE_CONFIG_DIR: w.config },
    })
    const bad = (why) => failures.push(`${cloneName}: ${why}`)
    if (r.status !== 0) bad(`exited ${r.status} — ${String(r.stderr || '').slice(0, 200)}`)
    let j = null
    try { j = JSON.parse(r.stdout) } catch { bad('produced no readable line') }
    if (j) {
      if (!j.systemMessage) bad('produced no systemMessage')
      if (!/^CGC v/.test(String(j.systemMessage))) bad(`line does not start with the version: ${j.systemMessage}`)
      // The states where moving the clone would destroy work: it must report, not act.
      if (['ahead', 'diverged', 'detached', 'on another branch', 'behind and dirty'].includes(cloneName)) {
        const after = existsSync(join(w.friend, '.git')) ? head(w.friend) : null
        if (before !== after) bad(`moved a clone it must leave alone: ${before} → ${after}`)
      }
    }
    quiesce(w)
  }
  assert.equal(failures.length, 0, `${failures.length} clone states broke an invariant:\n\n${failures.join('\n')}`)
})
