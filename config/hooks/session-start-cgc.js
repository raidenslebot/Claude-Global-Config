// SessionStart hook: CGC's own start-of-session check — update, verify, repair, one line.
//
// Every session start and resume — clear and compact too, every time, with no throttle,
// because a stale version line looks exactly like a healthy one — this:
//   1. fetches the origin's default branch and fast-forwards when behind, re-applying the
//      config, hooks and skills — never rewriting history, never discarding local work: a
//      dirty tree, another branch or unpushed commits are reported and left alone; offline
//      is a word in the line, not an error;
//   2. runs the doctor — every mandate, hook, skill, MCP registration and cost check — and
//      when anything FAILS re-applies the install and checks again, so a hook or skill that
//      was removed by hand or shadowed by another package is back before the session begins;
//   3. runs the package's own test suite, once per commit and at most once a day, keeping
//      the result beside the config;
//   4. reports one line, to the user (systemMessage) and to the session (additionalContext):
//        CGC v1.1.0 enabled · 34/34 checks · 206/206 tests · up to date (d971142)
//
// Exit 0 always; a failure inside any step becomes a word in the line, never a thrown error.
// Hook files pulled in take effect from the next session — Claude Code reads settings.json
// at start — and the line says so when it applies.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// Templated by install.mjs. Run straight from the repo (the tests do) the tokens are
// unresolved: the repo is two directories up from this file, the config root is ~/.claude.
// Every token in its :url form: install writes hooks with forward slashes, and sync reads a
// forward-slashed path back as the :url token — any other form round-trips as drift.
const REPO_TOKEN = '{{REPO_ROOT:url}}'
const NODE_TOKEN = '{{NODE:url}}'
const CONFIG_TOKEN = '{{CONFIG_ROOT:url}}'
const REPO = process.env.CGC_REPO || (REPO_TOKEN.includes('{{') ? path.resolve(__dirname, '..', '..') : REPO_TOKEN)
const NODE = NODE_TOKEN.includes('{{') ? process.execPath : NODE_TOKEN
const CONFIG_ROOT = process.env.CLAUDE_CONFIG_DIR || (CONFIG_TOKEN.includes('{{') ? path.join(os.homedir(), '.claude') : CONFIG_TOKEN)
const STATE = path.join(CONFIG_ROOT, '.cgc')
const TEST_TTL_MS = 24 * 60 * 60 * 1000
// A claim older than this belongs to a run that died. The suite takes about a minute and a half
// and is capped at 240s, so five minutes is well past any honest run.
const TEST_CLAIM_STALE_MS = 5 * 60 * 1000

function git(args, timeout = 15000) {
  return spawnSync('git', args, {
    cwd: REPO, encoding: 'utf8', timeout, windowsHide: true,
    // A credential prompt would hang the session start. Never ask.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
  })
}
const out = (r) => String(r.stdout || '').trim()
const short = (sha) => String(sha || '').slice(0, 7)
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const writeJson = (p, v) => { try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v)) } catch { /* state is a convenience */ } }
const tool = (name) => path.join(REPO, 'tools', name)
const version = () => readJson(path.join(REPO, 'package.json'))?.version || '?'

function runInstall() {
  // This runs inside withLock, so the installer must not queue behind its own parent.
  // mcp-register is in the list and `mcp` is not: registering the servers is a JSON write that
  // takes a tenth of a second, while `mcp` fetches packages and a browser over the network. A
  // machine where CGC was installed before Claude Code had ever run had no ~/.claude.json to
  // write into, so its MCP servers were never registered and no later session put that right.
  const r = spawnSync(NODE, [tool('install.mjs'), '--only=config,hooks,skills,deps,mcp-register'],
    { cwd: REPO, encoding: 'utf8', timeout: 120000, windowsHide: true, env: { ...process.env, CGC_UPDATE_LOCK_HELD: '1' } })
  return r.status === 0
}

// ── the lock ─────────────────────────────────────────────────────────────────
// Sessions start together. Four of them starting at once each ran `git pull` in the same
// clone, and git answered every one of them "fatal: Cannot fast-forward to multiple branches"
// — one process reading FETCH_HEAD while another rewrites it. Every session then reported the
// OLD version and carried on, which is exactly what a stale version line looks like: healthy.
// Anyone running more than one session at a time was pinned to whatever version they had.
//
// So the writing half — the pull, and the install that follows it — happens under an exclusive
// lock. Waiting is bounded and never fatal: a session that cannot get the lock proceeds anyway
// rather than hanging on someone else's git.
const LOCK = path.join(STATE, 'update.lock')
const LOCK_STALE_MS = 5 * 60 * 1000
const LOCK_WAIT_MS = 30 * 1000

function sleep(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch { /* no sleep, so spin once */ }
}

/** Run `fn` with the update lock held, waiting for another session rather than racing it. */
function withLock(fn) {
  let held = false
  const deadline = Date.now() + LOCK_WAIT_MS
  while (Date.now() < deadline) {
    try {
      fs.mkdirSync(path.dirname(LOCK), { recursive: true })
      const fd = fs.openSync(LOCK, 'wx')
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }))
      fs.closeSync(fd)
      held = true
      break
    } catch (e) {
      if (e.code !== 'EEXIST') break            // cannot lock at all: do the work unguarded
      // A holder that died leaves its lock behind. After five minutes it is not a holder.
      try {
        if (Date.now() - fs.statSync(LOCK).mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(LOCK); continue }
      } catch { continue }
      sleep(250)
    }
  }
  try { return fn() } finally { if (held) { try { fs.unlinkSync(LOCK) } catch { /* already gone */ } } }
}

// ── 1. update ────────────────────────────────────────────────────────────────
function update() {
  const gitDir = path.join(REPO, '.git')
  if (!fs.existsSync(gitDir)) return { status: 'no-git' }
  // git missing from PATH is the case the user most needs to hear, and the one every later
  // call would otherwise misreport as an empty branch.
  const probe = git(['--version'])
  if (probe.error || probe.status !== 0) return { status: 'no-git-cli' }
  const stamp = path.join(STATE, 'update.json')
  // Deliberately unthrottled: every session start and every resume checks. A stale version
  // line is the one failure nobody notices, because it looks exactly like a healthy one.
  const finish = (res) => { writeJson(stamp, { at: Date.now(), ...res }); return res }

  // Follow the origin's default branch, whatever it is called; another branch checked out
  // is deliberate work and is left alone. origin/HEAD is unset in a clone made before a
  // rename, or after git init + remote add: then follow the current branch if the origin has
  // it, else main, else master — never assume, never blame the user's branch for it.
  let main = out(git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).replace(/^origin\//, '')
  const branch = out(git(['symbolic-ref', '--short', 'HEAD']))
  const head = out(git(['rev-parse', 'HEAD']))
  if (!branch) return finish({ status: 'detached', head })
  if (!main) {
    main = [branch, 'main', 'master'].find((b) => git(['rev-parse', '-q', '--verify', `refs/remotes/origin/${b}`]).status === 0) || ''
    if (!main) return finish({ status: 'no-remote-branch', head, branch })
  }
  if (branch !== main) return finish({ status: 'branch', branch, main, head })
  if (git(['fetch', '--quiet', 'origin', main], 10000).status !== 0) return finish({ status: 'offline', head })

  const remote = out(git(['rev-parse', `origin/${main}`]))
  if (!head || !remote || head === remote) return finish({ status: 'current', head })
  if (git(['merge-base', '--is-ancestor', head, remote]).status !== 0) {
    if (git(['merge-base', '--is-ancestor', remote, head]).status === 0) return finish({ status: 'ahead', head })
    return finish({ status: 'diverged', head, remote, main })
  }
  const before = version()
  const pull = git(['pull', '--ff-only', '--quiet', 'origin', main], 60000)
  if (pull.status !== 0) {
    // Keep the lines that name the problem. The last line of a failed pull is always
    // "Aborting", which tells the reader nothing at all.
    const lines = String(pull.stderr || '').trim().split('\n').map((s) => s.trim()).filter(Boolean)
    const err = lines.filter((l) => !/^Aborting$/i.test(l)).slice(0, 3).join(' ') || lines.pop() || 'unknown error'
    // Name the version it is stuck below, because the version alone reads as healthy.
    const target = (() => { try { return JSON.parse(out(git(['show', `origin/${main}:package.json`])) || '{}').version } catch { return '' } })()
    // An untracked file the pull would overwrite is a local change too, and the tracked-only
    // probe is blind to exactly that case — which is how one kind of block became DEGRADED and
    // the other a calm report of the same situation.
    const dirty = Boolean(out(git(['status', '--porcelain'])))
      || /untracked working tree files|local changes|would be overwritten/i.test(lines.join(' '))
    return finish({ status: dirty ? 'dirty' : 'failed', head, remote, main, target, error: err })
  }
  const subjects = out(git(['log', '--format=%s', `${head}..${remote}`])).split('\n').filter(Boolean)
  const hookDirs = ['config/hooks', 'config/hooks.json', 'argo/plugin/hooks', 'skills/visual-design-mastery/hooks']
  const hooksChanged = out(git(['diff', '--name-only', head, remote, '--', ...hookDirs])) !== ''
  // Re-apply what a pull changes on disk but not in the live config. argo's CLI and plugin
  // point into the repo and are updated by the pull itself.
  const applied = runInstall()
  return finish({ status: 'updated', head: remote, from: head, before, after: version(), subjects, hooksChanged, applied })
}

// ── 2. verify and repair ─────────────────────────────────────────────────────
function doctor() {
  if (!fs.existsSync(tool('doctor.mjs'))) return null
  const r = spawnSync(NODE, [tool('doctor.mjs'), '--json'], { cwd: REPO, encoding: 'utf8', timeout: 30000, windowsHide: true })
  const j = readJsonText(r.stdout)
  if (!j || !j.counts) return { ok: 0, total: 0, failed: ['doctor did not answer'] }
  const c = j.counts
  const fails = (j.results || []).filter((x) => x.level === 'fail')
  const failed = fails.map((x) => x.message)
  // Only a failure an install could actually repair is worth re-installing for. Without this,
  // one unfixable finding makes EVERY session start run a full install and report DEGRADED
  // for ever — the same per-session multiplication these checks exist to prevent.
  const repairable = fails.some((x) => x.repairable !== false)
  return { ok: c.ok || 0, total: (c.ok || 0) + (c.warn || 0) + (c.fail || 0), warn: c.warn || 0, failed, repairable }
}
function readJsonText(s) { try { return JSON.parse(String(s || '')) } catch { return null } }

function verify() {
  let d = doctor()
  if (!d) return null
  let repaired = false
  if (d.failed.length && d.repairable !== false) {
    // Something a session relies on is missing. Put it back, then look again.
    repaired = runInstall()
    d = doctor() || d
  }
  return { ...d, repaired }
}

// ── 3. the package's own tests, once per commit and at most daily ─────────────
function selfTest(head) {
  if (!fs.existsSync(tool('run-tests.mjs'))) return null
  const cache = path.join(STATE, 'selftest.json')
  const last = readJson(cache)
  if (last && last.head === head && Date.now() - (last.at || 0) < TEST_TTL_MS) return { ...last, cached: true }
  // Claim the run before starting it. Written before, not after, because the gap between
  // "started" and "finished" is the whole problem.
  //
  // Three distinct outcomes, and conflating any two of them broke this once already:
  //   taken   — this session owns the run, and must release the claim afterwards
  //   held    — another session is running it; report what is known and start nothing
  //   broken  — the claim cannot be made at all, which is not permission to run N of them
  const claim = path.join(STATE, 'selftest.running')
  const take = () => {
    // The state directory first, and separately: mkdirSync throws EEXIST when STATE exists as
    // a FILE, and reading that as "the claim is held" wedged the self-test off permanently
    // while the line still said "enabled".
    try {
      fs.mkdirSync(STATE, { recursive: true })
    } catch (e) {
      return { state: 'broken', why: `the state directory ${STATE} is not usable (${e.code || e.message})` }
    }
    try {
      const fd = fs.openSync(claim, 'wx')
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }))
      fs.closeSync(fd)
      return { state: 'taken' }
    } catch (e) {
      if (e.code !== 'EEXIST') return { state: 'broken', why: `the claim file could not be written (${e.code || e.message})` }
      // A claim left behind by a run that died is not a claim. It may also be a directory,
      // which unlink refuses on Windows — remove it either way, or say it cannot be removed.
      let age = 0
      try { age = Date.now() - fs.statSync(claim).mtimeMs } catch { return { state: 'held' } }
      if (age <= TEST_CLAIM_STALE_MS) return { state: 'held' }
      try { fs.rmSync(claim, { recursive: true, force: true }) } catch (e2) {
        return { state: 'broken', why: `a stale claim at ${claim} could not be removed (${e2.code || e2.message})` }
      }
      return { state: 'held' }                      // removed; the caller's retry takes it
    }
  }

  let got = take()
  if (got.state === 'held') got = take()            // the stale one was just cleared: try once
  if (got.state !== 'taken') {
    // Never run unguarded. A broken claim means every session would run its own suite, which
    // is the failure this exists to prevent — so it is reported, not worked around.
    const known = last && last.head === head ? { ...last, cached: true } : { total: 0, pass: 0, fail: 0, skipped: 0 }
    return { ...known, deferred: true, claimBroken: got.state === 'broken' ? got.why : null }
  }

  let r
  try {
    r = spawnSync(NODE, [tool('run-tests.mjs')], { cwd: REPO, encoding: 'utf8', timeout: 240000, windowsHide: true })
  } finally {
    // Only ours to release — this session took it, or it would not have got here.
    try { fs.rmSync(claim, { force: true }) } catch { /* another session cleared a stale claim */ }
  }
  const text = String(r.stdout || '') + String(r.stderr || '')
  const num = (k) => { const m = new RegExp(`(?:ℹ|#)\\s*${k}\\s+(\\d+)`).exec(text); return m ? Number(m[1]) : null }
  // A skipped test is one that could not run here (no browser, say), not one that failed; the
  // line counts passes against the tests that ran, so 215/215 rather than a false 215/216.
  // A run that produced no counts is a run that did not happen — a crashed runner, a syntax
  // error mid-edit, a suite that never started. Recording it as 0 of 0 and printing "0/0 tests"
  // says the package has no tests, which is a confident answer to a question nothing answered.
  const unread = num('tests') === null && num('pass') === null
  const res = { head, at: Date.now(), total: num('tests') ?? 0, pass: num('pass') ?? 0, fail: num('fail') ?? (r.status === 0 ? 0 : 1), skipped: num('skipped') ?? 0, timedOut: Boolean(r.error), unread }
  writeJson(cache, res)
  return res
}

// ── 4. the line ──────────────────────────────────────────────────────────────
function compose(ver, u, v, t) {
  const bad = (v && v.failed.length) || (t && (t.fail > 0 || t.timedOut)) || u.status === 'failed'
  const parts = [`CGC v${ver} ${bad ? 'DEGRADED' : 'enabled'}`]
  if (v) parts.push(`${v.ok}/${v.total} checks${v.failed.length ? ` (${v.failed.length} failed: ${v.failed[0]})` : ''}${v.repaired ? ' · repaired' : ''}`)
  else parts.push('checks unavailable')
  if (t) {
    const counts = `${t.pass}/${Math.max(0, t.total - (t.skipped || 0))} tests${t.fail ? ` (${t.fail} failed)` : ''}${t.skipped ? ` (${t.skipped} skipped)` : ''}`
    parts.push(t.timedOut ? 'tests timed out'
      : t.claimBroken ? `tests not run — ${t.claimBroken}`
        : t.deferred ? (t.total ? `${counts} (another session is re-running them)` : 'tests running in another session')
        : t.unread ? 'the test suite could not be read'
          : counts)
  }
  const upd = {
    'no-git': 'not a git clone — cannot auto-update',
    'no-git-cli': 'git is not on PATH — cannot update',
    detached: `detached HEAD at ${short(u.head)}, not followed`,
    'no-remote-branch': `no remote branch to follow from ${u.branch}`,
    branch: `on ${u.branch}, ${u.main} not followed`,
    offline: `offline, at ${short(u.head)}`,
    current: `up to date (${short(u.head)})`,
    ahead: `ahead of origin (${short(u.head)})`,
    diverged: 'update blocked: diverged from origin',
    dirty: 'UPDATE BLOCKED by local changes',
    failed: 'update failed',
    updated: `updated ${u.before} → ${u.after}${u.applied ? '' : ', install step failed'}`,
  }[u.status] || u.status
  parts.push(upd)
  return parts.join(' · ')
}

function details(u) {
  const q = (s) => `"${s}"`
  switch (u.status) {
    case 'no-git': return `${REPO} is not a git clone (a downloaded archive cannot fetch updates). Clone the repository with git and run node tools/install.mjs from the clone.`
    case 'no-git-cli': return 'git was not found on PATH. The session hook updates and verifies through git; install it or add it to PATH.'
    case 'no-remote-branch': return `The origin has no branch named ${u.branch}, main or master to follow. Fetch once (git fetch origin) or set origin/HEAD (git remote set-head origin -a).`
    case 'diverged': return `This clone has local commits that are not on ${u.main}. Rebase them: git -C ${q(REPO)} rebase origin/${u.main}`
    case 'dirty': return `Update ${short(u.head)} → ${short(u.remote)}${u.target ? ` (v${u.target})` : ''} cannot fast-forward because files it changes were edited locally in ${REPO}: ${u.error}. Commit or discard them, then: git -C ${q(REPO)} pull --ff-only origin ${u.main}`
    case 'failed': return `The fast-forward failed: ${u.error}`
    case 'updated': {
      const shown = u.subjects.slice(0, 8).map((s) => `  - ${s}`)
      if (u.subjects.length > 8) shown.push(`  - … ${u.subjects.length - 8} more`)
      return `CGC updated ${u.before} → ${u.after} (${short(u.from)} → ${short(u.head)}, ${u.subjects.length} commit${u.subjects.length === 1 ? '' : 's'})`
        + (u.applied ? '' : ` — the install step failed; run: node ${q(tool('install.mjs'))}`)
        + (u.hooksChanged ? '. Hook changes take effect from the next session.' : '.') + `\n${shown.join('\n')}`
    }
    default: return ''
  }
}

function main() {
  let source = 'startup'
  try { source = JSON.parse(fs.readFileSync(0, 'utf8') || '{}').source || 'startup' } catch { /* no payload: a start */ }
  // A start or a resume opens a reply, so the line is announced. A clear or a compact happens
  // mid-conversation, where announcing it again would be noise.
  const announce = source === 'startup' || source === 'resume'

  let u
  // The pull and the install it triggers are the only writers here; both run under the lock.
  try { u = withLock(update) } catch (e) { u = { status: 'failed', error: e.message } }
  let v = null
  try { v = withLock(verify) } catch { v = null }
  let t = null
  try { t = selfTest(u.head || out(git(['rev-parse', 'HEAD']))) } catch { t = null }

  const ver = version()
  const line = compose(ver, u, v, t)
  const extra = details(u)
  const fix = v && v.failed.length ? `\nStill failing after repair: ${v.failed.join('; ')} — run node ${tool('doctor.mjs')} and fix what it names.` : ''
  const tests = t && t.fail
    ? `\n${t.fail} of the package's tests fail on this machine — run npm test in ${REPO}.`
      + (t.failed && t.failed.length ? ` The failing case${t.failed.length === 1 ? ' is' : 's are'}: ${t.failed.join(' · ')}.` : '')
    : ''
  const say = announce
    ? 'The user sees this line too. Open your first reply with it, verbatim, on its own line, then answer the user; say nothing more about it unless it is DEGRADED or blocked, in which case add the fix in one sentence.'
    : 'Do not mention it unless it is DEGRADED or blocked.'
  process.stdout.write(JSON.stringify({
    systemMessage: line,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `CGC STATUS — ${line}${extra ? '\n' + extra : ''}${fix}${tests}\n${say}`,
    },
  }) + '\n')
}

try { main() } catch { /* never block a session start */ }
