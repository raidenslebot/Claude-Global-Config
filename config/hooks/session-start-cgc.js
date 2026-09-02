// SessionStart hook: CGC's own start-of-session check — update, verify, repair, one line.
//
// Every session start and resume (clear and compact too, with the fetch throttled) this:
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
const FETCH_THROTTLE_MS = 5 * 60 * 1000
const TEST_TTL_MS = 24 * 60 * 60 * 1000

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
  const r = spawnSync(NODE, [tool('install.mjs'), '--only=config,hooks,skills'], { cwd: REPO, encoding: 'utf8', timeout: 120000, windowsHide: true })
  return r.status === 0
}

// ── 1. update ────────────────────────────────────────────────────────────────
function update(always) {
  const gitDir = path.join(REPO, '.git')
  if (!fs.existsSync(gitDir)) return { status: 'no-git' }
  const stamp = path.join(STATE, 'update.json')
  const last = readJson(stamp)
  if (!always && last && Date.now() - (last.at || 0) < FETCH_THROTTLE_MS) return { status: 'skipped', head: out(git(['rev-parse', 'HEAD'])) }
  const finish = (res) => { writeJson(stamp, { at: Date.now(), ...res }); return res }

  // Follow the origin's default branch, whatever it is called; another branch checked out
  // is deliberate work and is left alone.
  const main = (out(git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).replace(/^origin\//, '')) || 'main'
  const branch = out(git(['symbolic-ref', '--short', 'HEAD']))
  const head = out(git(['rev-parse', 'HEAD']))
  if (branch !== main) return finish({ status: 'branch', branch, main, head })
  if (git(['fetch', '--quiet', 'origin', main], 10000).status !== 0) return finish({ status: 'offline', head })

  const remote = out(git(['rev-parse', `origin/${main}`]))
  if (!head || !remote || head === remote) return finish({ status: 'current', head })
  if (git(['merge-base', '--is-ancestor', head, remote]).status !== 0) {
    if (git(['merge-base', '--is-ancestor', remote, head]).status === 0) return finish({ status: 'ahead', head })
    return finish({ status: 'diverged', head, remote, main })
  }
  if (out(git(['status', '--porcelain', '--untracked-files=no']))) return finish({ status: 'dirty', head, remote, main })

  const before = version()
  const pull = git(['pull', '--ff-only', '--quiet', 'origin', main], 60000)
  if (pull.status !== 0) return finish({ status: 'failed', head, remote, error: String(pull.stderr || '').trim().split('\n')[0] || 'unknown error' })
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
  const failed = (j.results || []).filter((x) => x.level === 'fail').map((x) => x.message)
  return { ok: c.ok || 0, total: (c.ok || 0) + (c.warn || 0) + (c.fail || 0), warn: c.warn || 0, failed }
}
function readJsonText(s) { try { return JSON.parse(String(s || '')) } catch { return null } }

function verify() {
  let d = doctor()
  if (!d) return null
  let repaired = false
  if (d.failed.length) {
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
  const r = spawnSync(NODE, [tool('run-tests.mjs')], { cwd: REPO, encoding: 'utf8', timeout: 240000, windowsHide: true })
  const text = String(r.stdout || '') + String(r.stderr || '')
  const num = (k) => { const m = new RegExp(`(?:ℹ|#)\\s*${k}\\s+(\\d+)`).exec(text); return m ? Number(m[1]) : null }
  // A skipped test is one that could not run here (no browser, say), not one that failed; the
  // line counts passes against the tests that ran, so 215/215 rather than a false 215/216.
  const res = { head, at: Date.now(), total: num('tests') ?? 0, pass: num('pass') ?? 0, fail: num('fail') ?? (r.status === 0 ? 0 : 1), skipped: num('skipped') ?? 0, timedOut: Boolean(r.error) }
  writeJson(cache, res)
  return res
}

// ── 4. the line ──────────────────────────────────────────────────────────────
function compose(ver, u, v, t) {
  const bad = (v && v.failed.length) || (t && (t.fail > 0 || t.timedOut)) || u.status === 'failed'
  const parts = [`CGC v${ver} ${bad ? 'DEGRADED' : 'enabled'}`]
  if (v) parts.push(`${v.ok}/${v.total} checks${v.failed.length ? ` (${v.failed.length} failed: ${v.failed[0]})` : ''}${v.repaired ? ' · repaired' : ''}`)
  else parts.push('checks unavailable')
  if (t) parts.push(t.timedOut ? 'tests timed out' : `${t.pass}/${Math.max(0, t.total - (t.skipped || 0))} tests${t.fail ? ` (${t.fail} failed)` : ''}${t.skipped ? ` (${t.skipped} skipped)` : ''}`)
  const upd = {
    'no-git': 'not a git clone — cannot auto-update',
    skipped: `at ${short(u.head)}`,
    branch: `on ${u.branch}, ${u.main} not followed`,
    offline: `offline, at ${short(u.head)}`,
    current: `up to date (${short(u.head)})`,
    ahead: `ahead of origin (${short(u.head)})`,
    diverged: 'update blocked: diverged from origin',
    dirty: 'update blocked: local changes',
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
    case 'diverged': return `This clone has local commits that are not on ${u.main}. Rebase them: git -C ${q(REPO)} rebase origin/${u.main}`
    case 'dirty': return `Update ${short(u.head)} → ${short(u.remote)} is waiting on local changes in ${REPO}. Commit or discard them, then: git -C ${q(REPO)} pull --ff-only origin ${u.main}`
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
  const always = source === 'startup' || source === 'resume'

  let u
  try { u = update(always) } catch (e) { u = { status: 'failed', error: e.message } }
  let v = null
  try { v = verify() } catch { v = null }
  let t = null
  try { t = selfTest(u.head || out(git(['rev-parse', 'HEAD']))) } catch { t = null }

  const ver = version()
  const line = compose(ver, u, v, t)
  const extra = details(u)
  const fix = v && v.failed.length ? `\nStill failing after repair: ${v.failed.join('; ')} — run node ${tool('doctor.mjs')} and fix what it names.` : ''
  const tests = t && t.fail ? `\n${t.fail} of the package's tests fail on this machine — run npm test in ${REPO}.` : ''
  const say = always
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
