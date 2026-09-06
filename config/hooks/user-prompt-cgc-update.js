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
// Written by the session-start hook when, and only when, an update actually LANDS. Its mtime
// is the moment the installed config last changed under everybody. update.json cannot answer
// that question — it is one slot, rewritten by every later session start with 'current', so a
// real update was reported to still-open sessions as "a local commit, not an update".
const LAST_APPLIED = path.join(STATE, 'last-applied')
// A background attempt that failed is retried this often, rather than every two minutes: a
// clone blocked by a dirty tree cannot be unblocked by trying again, and the reason is said.
const BG_RETRY_MS = 30 * 60 * 1000
const BG_RUNNING_MS = 2 * 60 * 1000

const mtime = (p) => { try { return fs.statSync(p).mtimeMs } catch { return 0 } }

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

  // This session's memory. The FILE holds the head this session was last told about; its
  // MTIME is when it was told. The session-start hook writes it at every start, so a session's
  // first prompt already knows what its own start line said.
  const seenFile = SESSION ? path.join(STATE, 'seen', SESSION) : null
  const seen = (() => { try { return seenFile ? fs.readFileSync(seenFile, 'utf8').trim() : null } catch { return null } })()
  const noteSeen = (h) => {
    if (!seenFile || !h) return
    try {
      fs.mkdirSync(path.dirname(seenFile), { recursive: true })
      fs.writeFileSync(seenFile, h)
      // One file per session, for ever, unless somebody sweeps. This runs only when a session
      // is first seen or is told something — never on the silent common path — so the readdir
      // is rare. (The first version swept only when `seen` was null, and the session-start
      // hook then began writing the file at every start, which made `seen` never null and the
      // sweep dead code: 251 files left of 250 stale ones.)
      const dir = path.dirname(seenFile)
      const names = fs.readdirSync(dir)
      if (names.length > 100) {
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
        for (const n of names) { try { const p = path.join(dir, n); if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true }) } catch { /* next */ } }
      }
    } catch { /* a convenience */ }
  }

  // Has an update landed since this session was last told anything? One question, asked the
  // same way on every path below — current, ahead, behind — because the thing a session needs
  // to hear is not "the head changed" but "the config under you was re-applied".
  const appliedSinceSeen = () => Boolean(seenFile) && mtime(LAST_APPLIED) > mtime(seenFile)
  const tellApplied = () => {
    let u = null
    try { u = JSON.parse(fs.readFileSync(LAST_APPLIED, 'utf8')) } catch { u = null }
    noteSeen(local)
    const to = u && u.after ? `v${u.after}` : `v${version()}`
    const from = u && u.before ? `v${u.before} → ` : ''
    emit(`CGC updated itself since this session last checked: ${from}${to} (${String((u && u.head) || local).slice(0, 7)}). The config, hooks and skills were re-applied; the mandates, gates and fixes in those commits are in force from this message on.`)
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

  // Whatever the ref comparison says, an update that landed since this session was last told
  // is told to it — the session that started the update included, and a window that was open
  // before it and has only now prompted. A head that moved by a LOCAL COMMIT writes no
  // last-applied record, so it is silent: a commit re-applies nothing.
  if (appliedSinceSeen()) tellApplied()
  if (!seen) noteSeen(local)

  if (remote === local) process.exit(0)            // current: the common path says nothing at all

  // Behind (or diverged). Only fast-forward — never discard local work.
  const behind = out(git(['rev-list', '--count', `HEAD..origin/${main}`])) || '?'
  // "git did not answer" is not "zero", and not "clean". Every call below is clamped to what is
  // left of the budget, so a slow machine can time one out — and `out()` returns null for that
  // exactly as it does for an empty answer. Read as 0 commits ahead and a clean tree, those two
  // conflations hand a DIVERGED or DIRTY clone to the updater. Unknown is its own answer.
  const aheadR = git(['rev-list', '--count', `origin/${main}..HEAD`])
  const dirtyR = git(['status', '--porcelain', '--untracked-files=no'])
  if (aheadR.status !== 0 || dirtyR.status !== 0) {
    once(`CGC ${version()} is ${behind} commit(s) behind origin/${main}, but git could not answer about local commits or local changes, so it was NOT updated automatically. It will try again shortly.`)
  }
  const ahead = String(aheadR.stdout || '').trim() || '0'
  const dirty = String(dirtyR.stdout || '').trim()

  // Ahead and not behind — the author's clone between a commit and its push — has nothing to
  // update. Saying "NOT updated, fast-forwarding would not be safe" on every prompt was wrong
  // twice over: nothing was behind, and nothing was unsafe.
  if (behind === '0') { if (local !== seen) noteSeen(local); process.exit(0) }

  if (ahead !== '0') {
    once(`CGC ${version()} has ${ahead} local commit(s) not in origin/${main} and is ${behind} behind it. It was NOT updated automatically, because fast-forwarding would not be safe here. Resolve it before relying on any gate: git -C "${REPO}" status`)
  }
  if (dirty) {
    once(`CGC ${version()} is ${behind} commit(s) behind origin/${main} and has uncommitted changes, so it was NOT updated automatically. Commit or stash, then it updates itself: git -C "${REPO}" status`)
  }

  // BEHIND, AND CLEAN. The update is the session-start hook's job, and it is started here
  // DETACHED to do exactly what it does at every start: pull under the lock with a timeout git
  // can clean up after, re-apply the config, run the doctor, repair, record what it did. Nothing
  // here merges: a merge killed at a hook's deadline left .git/index.lock and a half checkout
  // behind, and both hooks then told the user to commit changes the user never made.
  //
  // AND THE ANSWER IS READ BACK. The first version said "updating in the background now — the
  // next prompt reports the result" and then never looked: a fast-forward blocked by an
  // untracked file that would be overwritten (which the porcelain probe above cannot see, and
  // only the pull discovers) left every prompt saying "updating now" for ever, with a fresh
  // detached updater launched every two minutes and the real reason recorded in update.json
  // where nothing read it.
  const asked = mtime(BG_STAMP)
  let ran = null
  try { ran = JSON.parse(fs.readFileSync(path.join(STATE, 'update.json'), 'utf8')) } catch { ran = null }
  // An outcome recorded after we last asked is the answer to our request.
  const answered = ran && asked && (ran.at || 0) >= asked && ran.status !== 'updated' && ran.status !== 'current'
    ? ran : null
  const since = Date.now() - asked
  if (since > (answered ? BG_RETRY_MS : BG_RUNNING_MS)) {
    if (!fs.existsSync(UPDATER)) {
      once(`CGC ${version()} is ${behind} commit(s) behind origin/${main} and cannot update: its updater is missing at ${UPDATER}. Re-install: node "${path.join(REPO, 'tools', 'install.mjs')}"`)
    }
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

  if (answered) {
    const why = {
      // 200, not 90: the FILENAME git names is the whole content of this message, and it sits
      // at the end of git's sentence — truncating cut it off.
      dirty: `files it changes were edited locally (${String(answered.error || '').slice(0, 200)})`,
      failed: `the fast-forward failed (${String(answered.error || '').slice(0, 200)})`,
      diverged: 'this clone has local commits that are not on the remote branch',
      ahead: 'this clone is ahead of the remote branch',
      offline: 'the remote could not be reached',
      'no-git': 'it is not a git clone',
      'no-git-cli': 'git is not on PATH',
      detached: 'it is a detached checkout',
      branch: 'another branch is checked out',
      'no-remote-branch': 'the origin has no branch to follow',
    }[answered.status] || `the update reported "${answered.status}"`
    once(`CGC ${version()} is ${behind} commit(s) behind origin/${main} and the update did NOT land: ${why}. It is running a stale version — the mandates, gates and fixes in those commits are not in force. Fix it and it resumes on its own: git -C "${REPO}" status`)
  }

  const target = (() => { try { return JSON.parse(out(git(['show', `origin/${main}:package.json`])) || '{}').version } catch { return '' } })()
  once(`CGC ${version()} is ${behind} commit(s) behind origin/${main}${target ? ` (v${target} available)` : ''}. It is updating in the background now — the fast-forward, the config re-apply and the doctor — and the next prompt reports the result, landed or blocked. Until then the mandates, gates and fixes in those commits are NOT yet in force.`)

} catch (e) {
  // Never break a prompt. An unexpected failure is a line, not an exception — once per window.
  once(`CGC could not verify it is up to date (${String(e && e.message || e).slice(0, 120)}). It is NOT confirmed current.`)
}
})()
