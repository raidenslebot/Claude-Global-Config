// UserPromptSubmit hook: verify this package matches its repository, on EVERY interaction, and
// bring it up to date without being asked.
//
// WHY THIS EXISTS SEPARATELY FROM THE SESSION-START HOOK. That one runs at startup, resume and
// compact. A session opened this morning and still going at midnight has not checked since this
// morning — so a machine can sit for a whole working day on a version that was superseded hours
// ago, and every mandate, gate and fix released since then is simply absent. "Checked at some
// point" is not the same as "current", and the gap is invisible: nothing in the transcript says
// the package is stale.
//
// So the check runs per prompt. The cost is bounded three ways, because a hook that makes every
// prompt wait on the network gets deleted, and a deleted hook checks nothing:
//
//   1. A local HEAD comparison against the last known remote ref costs one git command and no
//      network. That is the common path and it is effectively free.
//   2. The network fetch is rate-limited by a timestamp file. Inside the window the hook is a
//      no-op; outside it, one fetch.
//   3. Everything heavier — the install re-apply — happens only when the refs actually differ,
//      and runs under the same lock the session-start hook uses, so two of them cannot collide.
//
// It never blocks and never fails a prompt: every path exits 0, and an error becomes a line
// saying what could not be checked. A hook that can break the session it is protecting is worse
// than no hook.

const { spawnSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

// The installed copy lives in ~/.claude/hooks, where ../.. is the HOME directory, not the repo.
// Resolving relatively made this report "not a git clone" on every prompt from the installed
// hook while passing every test from the repo — the token is realized at install time and is
// the only thing that is right in both places.
const REPO_TOKEN = '{{REPO_ROOT:url}}'
const REPO = process.env.CGC_REPO || (REPO_TOKEN.includes('{{') ? path.resolve(__dirname, '..', '..') : REPO_TOKEN)
const CONFIG_ROOT = process.env.CLAUDE_CONFIG_DIR || path.join(require('node:os').homedir(), '.claude')
const STATE = path.join(CONFIG_ROOT, '.cgc')

// The session this prompt belongs to. Once-per-window reporting is machine-wide, so when one
// session fast-forwards, every other live session's next prompt reads "current" from the local
// ref comparison — with its hooks, config and mandates changed under it and nothing said. Each
// session records the head it was last told about; a head it has not seen is announced once.
let SESSION = null
try {
  const id = String(JSON.parse(fs.readFileSync(0, 'utf8') || '{}').session_id || '')
  if (/^[A-Za-z0-9._-]{1,80}$/.test(id)) SESSION = id
} catch { /* no payload, or not JSON: no per-session memory, nothing else changes */ }
const STAMP = path.join(STATE, 'last-remote-check')
const LOCK = path.join(STATE, 'update.lock')

// Sixty seconds. The local ref comparison below runs on EVERY prompt and costs no network; this
// bounds only how old the remote knowledge may be. A burst of prompts is one fetch, and a release
// reaches a live session within a minute of being pushed.
const FETCH_TTL_MS = Number(process.env.CGC_FETCH_TTL_MS || 60 * 1000)
const LOCK_STALE_MS = 5 * 60 * 1000
const GIT_TIMEOUT = 4000

// The host kills this hook at 10 s (hooks.json). Every budget here fits inside that, and git is
// told never to prompt: a credential prompt is a hang that ends in the kill, which orphans the
// fetch. The session-start hook sets the same two variables.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
const git = (args, timeout = GIT_TIMEOUT) =>
  spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8', timeout, windowsHide: true, env: GIT_ENV })
const out = (r) => (r && r.status === 0 ? String(r.stdout || '').trim() : null)

/**
 * Run one git command with a timeout that kills the WHOLE process tree. spawnSync's timeout
 * kills only its direct child, and on Git for Windows that child is a launcher: the real git
 * and its git-remote-http helper survived every timed-out fetch, one orphan pair per minute,
 * each alive for as long as a TCP connect takes to give up. Resolves like spawnSync's result.
 */
const gitTree = (args, timeout) => new Promise((resolve) => {
  const child = spawn('git', ['-C', REPO, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: GIT_ENV,
    detached: process.platform !== 'win32',            // POSIX: own process group, killable as one
  })
  let stdout = '', stderr = '', settled = false, timedOut = false
  child.stdout.on('data', (d) => { stdout += d })
  child.stderr.on('data', (d) => { stderr += d })
  const finish = (status) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve({ status: timedOut ? null : status, stdout, stderr, timedOut })
  }
  const timer = setTimeout(() => {
    timedOut = true
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 2000 })
      else process.kill(-child.pid, 'SIGKILL')
    } catch { /* already gone */ }
    // If the tree will not die, do not hang the hook on it: report the timeout and move on.
    setTimeout(() => finish(null), 500).unref()
  }, timeout)
  child.on('error', () => finish(null))
  child.on('close', (code) => finish(code))
})

function emit(text) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text },
  }) + '\n')
  process.exit(0)
}

/** The lock the session-start hook uses, so an update and a session start cannot overlap. */
async function withLock(fn) {
  let held = false
  try {
    fs.mkdirSync(STATE, { recursive: true })
    try {
      const fd = fs.openSync(LOCK, 'wx')
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }))
      fs.closeSync(fd)
      held = true
    } catch (e) {
      if (e.code !== 'EEXIST') return null
      // A lock left by a process that died is not a lock.
      try {
        if (Date.now() - fs.statSync(LOCK).mtimeMs > LOCK_STALE_MS) fs.rmSync(LOCK, { force: true })
        else return null                         // somebody else is mid-update: leave it to them
      } catch { return null }
      try {
        const fd = fs.openSync(LOCK, 'wx')
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }))
        fs.closeSync(fd)
        held = true
      } catch { return null }
    }
    return await fn()
  } finally {
    // Only OUR lock. A holder that outlived the stale window has had its lock reclaimed by
    // another process; removing that one would let a third in beside it.
    if (held) {
      try { if (JSON.parse(fs.readFileSync(LOCK, 'utf8')).pid === process.pid) fs.rmSync(LOCK, { force: true }) } catch { /* gone, or not ours to read */ }
    }
  }
}

function version() {
  try { return JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version || '?' } catch { return '?' }
}

(async () => {
try {
  // THE BUDGET. The host kills this hook at 10 s, and a kill inside the lock leaves the lock on
  // disk for five minutes — during which every prompt's updater exits silently and every
  // session start waits thirty seconds for it, twice. So this process ends itself: each wait
  // below gets what is left of 8.5 s when it would start, and a step that would not fit is
  // skipped for this prompt. The next window tries again.
  const T0 = Date.now()
  const left = () => 8500 - (Date.now() - T0)

  // The fetch window. Only the NETWORK is rate-limited by it — the ref comparison below runs
  // on every prompt — and so is every report of a condition that does not change between
  // prompts. Those exited before the window was ever opened, so "not a git clone", "detached"
  // and "offline" were said on every single message for the rest of the session.
  let fresh = false
  try { fresh = Date.now() - fs.statSync(STAMP).mtimeMs < FETCH_TTL_MS } catch { fresh = false }
  const stamp = () => { try { fs.mkdirSync(STATE, { recursive: true }); fs.writeFileSync(STAMP, String(Date.now())) } catch { /* stamp is an optimisation */ } }
  /** Say a standing condition once per fetch window; inside the window, say nothing. */
  const once = (text) => { if (fresh) process.exit(0); stamp(); emit(text) }

  // Not a clone: there is nothing to be current with, and saying so once is honest.
  if (!fs.existsSync(path.join(REPO, '.git'))) once(`CGC ${version()} is not a git clone at ${REPO}, so it cannot verify it is current. Re-install from the repository to enable automatic updates.`)

  const branch = out(git(['rev-parse', '--abbrev-ref', 'HEAD'])) || 'main'
  const local = out(git(['rev-parse', 'HEAD']))
  if (!local) once(`CGC ${version()}: git did not answer in ${REPO}, so the version could not be verified against the repository.`)
  // A detached checkout is pinned on purpose. The session-start hook refuses to move it; this
  // one merged origin/HEAD into it and called that an update.
  if (branch === 'HEAD') once(`CGC ${version()} is a detached checkout at ${local.slice(0, 7)}, so it is not moved automatically. Check out a branch to resume updates.`)
  // No remote named origin: nothing to be current with. (An upstream is NOT required — a repo
  // created locally and pushed without -u has origin/<branch> and no tracking config, which is
  // exactly the author's clone; the session-start hook follows origin/<branch> directly too.)
  if (!out(git(['remote', 'get-url', 'origin']))) {
    once(`CGC ${version()} has no remote named origin at ${REPO}, so currency cannot be verified. Add one to enable automatic updates.`)
  }

  // WHICH BRANCH IS FOLLOWED: the session-start hook's rule, and only that. The origin's default
  // branch; when origin/HEAD is unset, the current branch if the origin has it, else main, else
  // master. Another branch checked out is deliberate work and is left alone. The first version
  // of this hook followed origin/<whatever is checked out>: it fast-forwarded a feature branch
  // and re-applied that branch's config while the session-start hook refused the same clone.
  let main = out(git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).replace(/^origin\//, '')
  if (!main) main = [branch, 'main', 'master'].find((b) => git(['rev-parse', '-q', '--verify', `refs/remotes/origin/${b}`]).status === 0) || ''
  if (!main) once(`CGC ${version()}: origin has no branch to follow (no origin/HEAD, and no ${branch}, main or master), so currency cannot be verified. Fetch once: git -C "${REPO}" fetch origin`)
  if (branch !== main) once(`CGC ${version()} is on branch "${branch}"; ${main} is not followed here, so it is not updated automatically. Updates resume on ${main}.`)

  // This session's memory of the head it was last told about.
  const seenFile = SESSION ? path.join(STATE, 'seen', SESSION) : null
  const seen = (() => { try { return seenFile ? fs.readFileSync(seenFile, 'utf8').trim() : null } catch { return null } })()
  const noteSeen = (h) => {
    if (!seenFile || !h) return
    try {
      fs.mkdirSync(path.dirname(seenFile), { recursive: true })
      fs.writeFileSync(seenFile, h)
      // A file per session accumulates; on a session's first note, sweep the week-old ones.
      if (!seen) {
        const dir = path.dirname(seenFile)
        const names = fs.readdirSync(dir)
        if (names.length > 200) {
          const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
          for (const n of names) { try { const p = path.join(dir, n); if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true }) } catch { /* next */ } }
        }
      }
    } catch { /* a convenience */ }
  }

  if (!fresh) {
    // Stamp BEFORE the fetch. Stamping after meant a fetch the host killed at 10 s never
    // stamped, so an unreachable remote stalled every prompt for the full 10 s, each kill
    // leaving another orphaned git process behind.
    stamp()
    // The fetch: as much of the budget as leaves room for the kill path and the comparison.
    const budget = Math.min(3500, left() - 2500)
    if (budget > 500) {
      const f = await gitTree(['fetch', '--quiet', 'origin', main], budget)
      if (f.status !== 0) {
        // A branch origin has never heard of is not an outage. Without this, a local-only branch
        // was reported as "offline" once a minute for the whole session.
        if (/couldn't find remote ref|Remote branch .* not found|invalid refspec/i.test(String(f.stderr || ''))) {
          emit(`CGC ${version()} is on branch "${main}", which origin has no branch of, so currency cannot be verified. Updates resume on a branch origin carries.`)
        }
        // Offline is not a failure to report loudly every prompt, but it must not read as current.
        emit(`CGC ${version()} could not reach its repository to check for updates (offline or the remote refused). It is running whatever was last pulled; it is NOT confirmed current.`)
      }
    }
  }

  const remote = out(git(['rev-parse', `origin/${main}`]))
  if (!remote) once(`CGC ${version()}: no origin/${main} to compare against, so currency is unverified.`)
  if (remote === local) {
    // Current — but was THIS session told? Another session may have applied the update, and the
    // local ref comparison then reads "current" here while this session's hooks, config and
    // mandates changed under it. Once per session, per head.
    if (seen && seen !== local) {
      noteSeen(local)
      emit(`CGC is at v${version()} (${local.slice(0, 7)}): it moved from ${seen.slice(0, 7)} since this session last checked — another session applied the update and re-applied the config. The mandates, gates and fixes in between are in force from this message on.`)
    }
    if (!seen) noteSeen(local)
    process.exit(0)                                // the common path says nothing at all
  }

  // Behind (or diverged). Only fast-forward — never discard local work.
  const behind = out(git(['rev-list', '--count', `HEAD..origin/${main}`])) || '?'
  const ahead = out(git(['rev-list', '--count', `origin/${main}..HEAD`])) || '0'
  // Ahead and not behind — the author's clone between a commit and its push — has nothing to
  // update. Saying "NOT updated, fast-forwarding would not be safe" on every prompt was wrong
  // twice over: nothing was behind, and nothing was unsafe.
  if (behind === '0') { if (!seen) noteSeen(local); process.exit(0) }

  if (ahead !== '0') {
    once(`CGC ${version()} has ${ahead} local commit(s) not in origin/${main} and is ${behind} behind it. It was NOT updated automatically, because fast-forwarding would not be safe here. Resolve it before relying on any gate: git -C "${REPO}" status`)
  }

  const dirty = out(git(['status', '--porcelain', '--untracked-files=no']))
  if (dirty) {
    once(`CGC ${version()} is ${behind} commit(s) behind origin/${main} and has uncommitted changes, so it was NOT updated automatically. Commit or stash, then it updates itself: git -C "${REPO}" status`)
  }

  // The fast-forward is quick; the install that follows it is not — `deps` can run npm for
  // three minutes on a release that adds a dependency, which is exactly the release that most
  // needs re-applying. Inside a 10 s hook that install was killed mid-run, leaving the merge
  // landed, the config stale, update.lock on disk, and nothing said. So the merge happens here
  // under the lock, and the re-apply is HANDED OFF to a detached process — install.mjs takes
  // the same lock itself, so it cannot overlap a session start.
  const mergeBudget = Math.min(3000, left() - 1500)
  if (mergeBudget < 500) process.exit(0)          // out of time this prompt: the next window
  const result = await withLock(async () => {
    const pull = await gitTree(['merge', '--ff-only', `origin/${main}`], mergeBudget)
    if (pull.status !== 0) return { ok: false, why: pull.timedOut ? `the merge did not finish in ${mergeBudget} ms` : String(pull.stderr || '').split('\n')[0] }
    return { ok: true, head: out(git(['rev-parse', 'HEAD'])) }
  })

  if (!result) process.exit(0)                   // another process holds the lock and is doing it
  if (!result.ok) {
    once(`CGC was ${behind} commit(s) behind origin/${main} and could not fast-forward: ${result.why}. It is running a stale version.`)
  }
  noteSeen(result.head)
  try {
    const bg = spawn(process.execPath,
      [path.join(REPO, 'tools', 'install.mjs'), '--only=config,hooks,skills,deps,mcp-register'],
      { cwd: REPO, detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env } })
    bg.unref()
  } catch (e) {
    emit(`CGC fast-forwarded to v${version()} (${result.head.slice(0, 7)}), ${behind} commit(s), but could not start the re-apply (${String(e.message || e).slice(0, 60)}). Run: node "${path.join(REPO, 'tools', 'install.mjs')}"`)
  }
  emit(`CGC updated itself to v${version()} (${result.head.slice(0, 7)}), ${behind} commit(s) applied. The config is being re-applied in the background; the mandates, gates and fixes in those commits are in force from this message on.`)
} catch (e) {
  // Never break a prompt. An unexpected failure is a line, not an exception.
  emit(`CGC could not verify it is up to date (${String(e && e.message || e).slice(0, 120)}). It is NOT confirmed current.`)
}
})()
