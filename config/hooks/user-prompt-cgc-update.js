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
//   3. Everything heavier — the fast-forward and the re-apply — is not done here at all. When
//      the refs differ, the session-start hook is started DETACHED to do what it does at every
//      start: pull under the lock with a timeout git can clean up after, re-apply, verify. The
//      first version merged inside this hook and tree-killed a slow merge, which left
//      .git/index.lock and a half checkout behind — a clone wedged for good, with both hooks
//      blaming the user's "uncommitted changes". One updater, in a process nobody kills.
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
// The session-start hook, which does the update when this hook finds one. A sibling in both
// places this file lives: config/hooks in the repo, <config>/hooks once installed.
const UPDATER = path.join(__dirname, 'session-start-cgc.js')
const BG_STAMP = path.join(STATE, 'update-bg')

// Sixty seconds. The local ref comparison below runs on EVERY prompt and costs no network; this
// bounds only how old the remote knowledge may be. A burst of prompts is one fetch, and a release
// reaches a live session within a minute of being pushed.
const FETCH_TTL_MS = Number(process.env.CGC_FETCH_TTL_MS || 60 * 1000)

// THE BUDGET. The host kills this hook at 10 s. So this process ends itself: every wait below
// gets what is left of 8.5 s when it would start, a git call that would not fit answers null
// and is reported as "git did not answer", and a fetch that would not fit is skipped for this
// prompt. The next window tries again. Measured: the whole common path is ~130 ms.
const T0 = Date.now()
const left = () => 8500 - (Date.now() - T0)
const GIT_TIMEOUT = 4000

// The host kills this hook at 10 s (hooks.json). Every budget here fits inside that, and git is
// told never to prompt: a credential prompt is a hang that ends in the kill, which orphans the
// fetch. The session-start hook sets the same two variables.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
const git = (args, timeout = GIT_TIMEOUT) =>
  spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8', timeout: Math.max(50, Math.min(timeout, left())), windowsHide: true, env: GIT_ENV })
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

function version() {
  try { return JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version || '?' } catch { return '?' }
}

// The fetch window. Only the NETWORK is rate-limited by it — the ref comparison runs on every
// prompt — and so is every report of a condition that does not change between prompts. Those
// exited before the window was ever opened, so "not a git clone", "detached" and "offline" were
// said on every single message for the rest of the session.
let fresh = false
try { fresh = Date.now() - fs.statSync(STAMP).mtimeMs < FETCH_TTL_MS } catch { fresh = false }
const stamp = () => { try { fs.mkdirSync(STATE, { recursive: true }); fs.writeFileSync(STAMP, String(Date.now())) } catch { /* stamp is an optimisation */ } }
/** Say a standing condition once per fetch window; inside the window, say nothing. */
const once = (text) => { if (fresh) process.exit(0); stamp(); emit(text) };

(async () => {
try {
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
  // (out() is null on a non-zero exit — origin/HEAD unset is exit 128 — so it is guarded.)
  let main = (out(git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])) || '').replace(/^origin\//, '')
  if (!main) main = [branch, 'main', 'master'].find((b) => git(['rev-parse', '-q', '--verify', `refs/remotes/origin/${b}`]).status === 0) || ''
  if (!main) once(`CGC ${version()}: origin has no branch to follow (no origin/HEAD, and no ${branch}, main or master), so currency cannot be verified. Fetch once: git -C "${REPO}" fetch origin`)
  if (branch !== main) once(`CGC ${version()} is on branch "${branch}"; ${main} is not followed here, so it is not updated automatically. Updates resume on ${main}.`)

  // This session's memory of the head it was last told about. The session-start hook writes
  // it at every start, so a session's first prompt already knows what its start line said.
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
    // The fetch gets what is left after room for the kill path (2 s taskkill + 0.5 s grace)
    // and the comparison that follows.
    const budget = Math.min(3500, left() - 3000)
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
    // Current — but was THIS session told? The update may have been applied by the session-start
    // hook this hook started in the background, or by another session; either way the local ref
    // comparison reads "current" here while this session's hooks, config and mandates changed
    // under it. Once per session, per head. The session-start hook records what it did, so a
    // head that moved by an UPDATE is told apart from one that moved by a local commit made in
    // this clone — the first re-applied the config; the second did not.
    if (seen && seen !== local) {
      noteSeen(local)
      let u = null
      try { u = JSON.parse(fs.readFileSync(path.join(STATE, 'update.json'), 'utf8')) } catch { u = null }
      if (u && u.status === 'updated' && u.head === local) {
        emit(`CGC updated itself to v${version()} (${local.slice(0, 7)}) since this session last checked, ${seen.slice(0, 7)} → ${local.slice(0, 7)}. The config was re-applied; the mandates, gates and fixes in between are in force from this message on.`)
      }
      emit(`CGC's clone is at v${version()} (${local.slice(0, 7)}), moved from ${seen.slice(0, 7)} since this session last checked by a local commit, not an update. The installed config is re-applied only by an update or by: node "${path.join(REPO, 'tools', 'install.mjs')}"`)
    }
    if (!seen) noteSeen(local)
    process.exit(0)                                // the common path says nothing at all
  }

  // Behind (or diverged). Only fast-forward — never discard local work.
  const behind = out(git(['rev-list', '--count', `HEAD..origin/${main}`])) || '?'
  const ahead = out(git(['rev-list', '--count', `origin/${main}..HEAD`])) || '0'
  // Ahead and not behind — the author's clone between a commit and its push — has nothing to
  // update. Saying "NOT updated, fast-forwarding would not be safe" on every prompt was wrong
  // twice over: nothing was behind, and nothing was unsafe. The commit is this clone's own work,
  // so it is noted as seen: after the push, "current" must not read as an update this session
  // was never told about.
  if (behind === '0') { noteSeen(local); process.exit(0) }

  if (ahead !== '0') {
    once(`CGC ${version()} has ${ahead} local commit(s) not in origin/${main} and is ${behind} behind it. It was NOT updated automatically, because fast-forwarding would not be safe here. Resolve it before relying on any gate: git -C "${REPO}" status`)
  }

  const dirty = out(git(['status', '--porcelain', '--untracked-files=no']))
  if (dirty) {
    once(`CGC ${version()} is ${behind} commit(s) behind origin/${main} and has uncommitted changes, so it was NOT updated automatically. Commit or stash, then it updates itself: git -C "${REPO}" status`)
  }

  // BEHIND, AND CLEAN. The update is the session-start hook's job, and it is started here
  // DETACHED to do exactly what it does at every start: pull under the lock with a timeout git
  // can clean up after, re-apply the config, run the doctor, repair, record what it did. Nothing
  // here merges: a merge killed at a hook's deadline left .git/index.lock and a half checkout
  // behind, and both hooks then told the user to commit changes the user never made. One
  // updater, in a process nobody kills; this session hears the result on its next prompt.
  // This session's first sight of the clone is the OLD head: recorded now, so the prompt after
  // the update sees a head it was not told about and reports it — the session that started
  // the update is told it finished, like every other.
  if (!seen) noteSeen(local)
  let running = false
  try { running = Date.now() - fs.statSync(BG_STAMP).mtimeMs < 2 * 60 * 1000 } catch { running = false }
  if (!running) {
    try {
      fs.mkdirSync(STATE, { recursive: true }); fs.writeFileSync(BG_STAMP, String(process.pid))
      const bg = spawn(process.execPath, [UPDATER], { cwd: REPO, detached: true, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true, env: { ...process.env } })
      // No session_id: this run belongs to no session. Passing one would record THIS session as
      // having been told the new head by a start line it never saw, and it would never hear
      // that the update it started had landed.
      bg.stdin.end(JSON.stringify({ source: 'background-update' }))
      bg.unref()
    } catch (e) {
      once(`CGC ${version()} is ${behind} commit(s) behind origin/${main} and could not start the update (${String(e.message || e).slice(0, 60)}). Run: node "${path.join(REPO, 'tools', 'install.mjs')}"`)
    }
  }
  const target = (() => { try { return JSON.parse(out(git(['show', `origin/${main}:package.json`])) || '{}').version } catch { return '' } })()
  once(`CGC ${version()} is ${behind} commit(s) behind origin/${main}${target ? ` (v${target} available)` : ''}. It is updating in the background now — the fast-forward, the config re-apply and the doctor — and the next prompt reports the result. Until then the mandates, gates and fixes in those commits are NOT yet in force.`)
} catch (e) {
  // Never break a prompt. An unexpected failure is a line, not an exception — once per window.
  once(`CGC could not verify it is up to date (${String(e && e.message || e).slice(0, 120)}). It is NOT confirmed current.`)
}
})()
