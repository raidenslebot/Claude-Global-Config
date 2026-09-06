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
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 3000 })
      else process.kill(-child.pid, 'SIGKILL')
    } catch { /* already gone */ }
    // If the tree will not die, do not hang the hook on it: report the timeout and move on.
    setTimeout(() => finish(null), 1000).unref()
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
function withLock(fn) {
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
    return fn()
  } finally {
    if (held) { try { fs.rmSync(LOCK, { force: true }) } catch { /* another process cleared it */ } }
  }
}

function version() {
  try { return JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version || '?' } catch { return '?' }
}

(async () => {
try {
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

  if (!fresh) {
    // Stamp BEFORE the fetch. Stamping after meant a fetch the host killed at 10 s never
    // stamped, so an unreachable remote stalled every prompt for the full 10 s, each kill
    // leaving another orphaned git process behind.
    stamp()
    // Four seconds, inside a 10 s hook: a remote that has not answered by then will not, and an
    // unreachable one measured 6.2 s end to end at 6 s — too little headroom on a slow machine.
    const f = await gitTree(['fetch', '--quiet', 'origin', branch], 4000)
    if (f.status !== 0) {
      // A branch origin has never heard of is not an outage. Without this, a local-only branch
      // was reported as "offline" once a minute for the whole session.
      if (/couldn't find remote ref|Remote branch .* not found|invalid refspec/i.test(String(f.stderr || ''))) {
        emit(`CGC ${version()} is on branch "${branch}", which origin has no branch of, so currency cannot be verified. Updates resume on a branch origin carries.`)
      }
      // Offline is not a failure to report loudly every prompt, but it must not read as current.
      emit(`CGC ${version()} could not reach its repository to check for updates (offline or the remote refused). It is running whatever was last pulled; it is NOT confirmed current.`)
    }
  }

  const remote = out(git(['rev-parse', `origin/${branch}`]))
  if (!remote) once(`CGC ${version()}: no origin/${branch} to compare against, so currency is unverified.`)
  if (remote === local) process.exit(0)          // current: the common path says nothing at all

  // Behind (or diverged). Only fast-forward — never discard local work.
  const behind = out(git(['rev-list', '--count', `HEAD..origin/${branch}`])) || '?'
  const ahead = out(git(['rev-list', '--count', `origin/${branch}..HEAD`])) || '0'
  // Ahead and not behind — the author's clone between a commit and its push — has nothing to
  // update. Saying "NOT updated, fast-forwarding would not be safe" on every prompt was wrong
  // twice over: nothing was behind, and nothing was unsafe.
  if (behind === '0') process.exit(0)

  // A block is said once per fetch window, not once per prompt. The ref comparison above runs
  // on every prompt, so a diverged or dirty clone was told the same thing on every message for
  // the rest of the session — which is how a hook ends up deleted, and a deleted hook checks
  // nothing. `fresh` is true when this prompt did not fetch; the one that fetched speaks.
  if (ahead !== '0') {
    once(`CGC ${version()} has ${ahead} local commit(s) not in origin/${branch} and is ${behind} behind it. It was NOT updated automatically, because fast-forwarding would not be safe here. Resolve it before relying on any gate: git -C "${REPO}" status`)
  }

  const dirty = out(git(['status', '--porcelain', '--untracked-files=no']))
  if (dirty) {
    once(`CGC ${version()} is ${behind} commit(s) behind origin/${branch} and has uncommitted changes, so it was NOT updated automatically. Commit or stash, then it updates itself: git -C "${REPO}" status`)
  }

  // The fast-forward is quick; the install that follows it is not — `deps` can run npm for
  // three minutes on a release that adds a dependency, which is exactly the release that most
  // needs re-applying. Inside a 10 s hook that install was killed mid-run, leaving the merge
  // landed, the config stale, update.lock on disk, and nothing said. So the merge happens here
  // under the lock, and the re-apply is HANDED OFF to a detached process that owns the lock's
  // lifetime; the next prompt sees the new HEAD as current and reports it.
  const result = withLock(() => {
    const pull = git(['merge', '--ff-only', `origin/${branch}`], 5000)
    if (pull.status !== 0) return { ok: false, why: String(pull.stderr || '').split('\n')[0] }
    return { ok: true, head: out(git(['rev-parse', '--short', 'HEAD'])) }
  })

  if (!result) process.exit(0)                   // another process holds the lock and is doing it
  if (!result.ok) {
    once(`CGC was ${behind} commit(s) behind origin/${branch} and could not fast-forward: ${result.why}. It is running a stale version.`)
  }
  try {
    const bg = spawn(process.execPath,
      [path.join(REPO, 'tools', 'install.mjs'), '--only=config,hooks,skills,deps,mcp-register'],
      { cwd: REPO, detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env } })
    bg.unref()
  } catch (e) {
    emit(`CGC fast-forwarded to v${version()} (${result.head}), ${behind} commit(s), but could not start the re-apply (${String(e.message || e).slice(0, 60)}). Run: node "${path.join(REPO, 'tools', 'install.mjs')}"`)
  }
  emit(`CGC updated itself to v${version()} (${result.head}), ${behind} commit(s) applied. The config is being re-applied in the background; the mandates, gates and fixes in those commits are in force from this message on.`)
} catch (e) {
  // Never break a prompt. An unexpected failure is a line, not an exception.
  emit(`CGC could not verify it is up to date (${String(e && e.message || e).slice(0, 120)}). It is NOT confirmed current.`)
}
})()
