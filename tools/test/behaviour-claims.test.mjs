// The `claims` behaviour check: an explanation that is stronger than its evidence.
//
// The positive half of this file is cheap — plant a guarantee over code that moved, plant a
// "all tests pass" in a README, assert both are named. The half that matters is the negative
// one. A detector that fires on every comment containing the word "never" would pass every
// positive case here and be deleted by its first real user, so each clean fixture below is a
// specific thing this check was tuned to walk past: design prose that argues rather than
// promises, a comment revised in the same commit as its code, a claim inside a fence, inside
// frontmatter, under a dated heading, in a CHANGELOG, or phrased as a requirement.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildContext } from '../behaviour.mjs'
import { run, id, title, why } from '../behaviour/claims.mjs'
import { REPO } from '../paths.mjs'
import { discard } from './_teardown.mjs'

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cgc-claims-'))
  t.after(() => discard(dir))
  return dir
}

const put = (root, rel, body) => {
  const abs = join(root, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, body)
  return abs
}

const git = (dir, ...args) => {
  // A trailing plain object is environment for this one call — how a fixture dates a commit.
  const env = args.length && args[args.length - 1] && typeof args[args.length - 1] === 'object' ? args.pop() : null
  return spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true, env: env ? { ...process.env, ...env } : process.env })
}

function repo(t) {
  const dir = scratch(t)
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'gate@example.invalid')
  git(dir, 'config', 'user.name', 'Gate')
  git(dir, 'config', 'commit.gpgsign', 'false')
  return dir
}

let DAY = 0
const commit = (dir, msg) => {
  git(dir, 'add', '-A')
  // Each commit lands on its own day. The check treats same-day edits as one session, so a fixture
  // that makes three commits in the same second would be asserting a case that cannot occur.
  const when = `2026-0${1 + Math.floor(DAY / 28)}-${String((DAY % 28) + 1).padStart(2, '0')}T12:00:00`
  DAY++
  git(dir, 'commit', '-q', '-m', msg, { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when })
}

const check = (dir) => run(buildContext([dir]))
const at = (r, file) => r.findings.filter((f) => f.file === file)

// ── the module's own contract ────────────────────────────────────────────────────────────────

test('exports the shape behaviour.mjs imports', () => {
  assert.equal(id, 'claims')
  assert.ok(title && typeof title === 'string')
  assert.ok(why && why.length < 160, 'why is one line')
})

// ── 1. a guarantee left behind by its code ───────────────────────────────────────────────────

// The claim is on line 8, so it is not the file banner, and the code under it is a block.
const GATE = (body) => `import { readFileSync } from 'node:fs'

export const LIMIT = 10

export function head(q) {
  return q[0]
}

// Drains the queue before the worker exits, so a task can never be left half-written.
export function drain(q) {
${body}
}
`

test('a guarantee whose code was rewritten twice since is named, with both commits', (t) => {
  const dir = repo(t)
  put(dir, 'src/gate.mjs', GATE('  while (q.length) q.pop()\n  return true'))
  commit(dir, 'one')
  put(dir, 'src/gate.mjs', GATE('  for (const x of q) x.close()\n  return true'))
  commit(dir, 'two')
  put(dir, 'src/gate.mjs', GATE('  q.length = 0\n  return q'))
  commit(dir, 'three')

  const hits = at(check(dir), 'src/gate.mjs')
  assert.equal(hits.length, 1, `expected exactly one finding, got ${JSON.stringify(hits, null, 2)}`)
  const f = hits[0]
  assert.equal(f.line, 9, 'the finding points at the comment, not the code')
  assert.match(f.what, /rewritten 2 commits since/)
  // Evidence is extracted, not asserted: two real abbreviated hashes, two real dates.
  const shas = [...f.evidence.matchAll(/\b[0-9a-f]{8}\b/g)].map((m) => m[0])
  assert.equal(shas.length, 2, `expected two commit hashes in the evidence, got "${f.evidence}"`)
  assert.notEqual(shas[0], shas[1], 'the comment and the code were dated to the same commit')
  const log = git(dir, 'log', '--format=%H').stdout
  for (const sha of shas) assert.ok(log.includes(sha), `${sha} is not a commit in this repo`)
  assert.match(f.evidence, /\d{4}-\d{2}-\d{2}.*\d{4}-\d{2}-\d{2}/s, 'both dates are reported')
  assert.match(f.evidence, /can never be left half-written/, 'the claim itself is quoted')
  assert.match(f.fix, /^re-read lines \d+-\d+/)
})

test('a comment revised in the same commit as its code is not stale', (t) => {
  const dir = repo(t)
  put(dir, 'src/gate.mjs', GATE('  while (q.length) q.pop()\n  return true'))
  commit(dir, 'one')
  // The rewrite and the restatement land together — which is the behaviour this check wants.
  put(dir, 'src/gate.mjs', GATE('  q.length = 0\n  return q').replace('can never be left half-written', 'can never outlive the worker'))
  commit(dir, 'two')
  put(dir, 'src/gate.mjs', GATE('  q.splice(0)\n  return q').replace('can never be left half-written', 'can never outlive the process'))
  commit(dir, 'three')

  assert.deepEqual(at(check(dir), 'src/gate.mjs'), [], 'a comment kept in step with its code is not a finding')
})

test('design prose about a rejected alternative is an argument, not a claim', (t) => {
  const dir = repo(t)
  // Every absolute in here is doing the job comments are for: explaining why the code is shaped
  // the way it is. None of them promises anything about the four lines underneath. The first
  // version of this check found 880 of these in one repository.
  const prose = (body) => `import { readFileSync } from 'node:fs'

export const LIMIT = 10

export function head(q) {
  return q[0]
}

// A counter here would never be enough on its own, and the silent stall this exists to prevent
// is exactly what a counter cannot see. There is no guarantee either way; always measuring is
// the only thing that could never be wrong, so the cheap check must not be the only one.
export function drain(q) {
${body}
}
`
  put(dir, 'src/prose.mjs', prose('  while (q.length) q.pop()\n  return true'))
  commit(dir, 'one')
  put(dir, 'src/prose.mjs', prose('  for (const x of q) x.close()\n  return true'))
  commit(dir, 'two')
  put(dir, 'src/prose.mjs', prose('  q.length = 0\n  return q'))
  commit(dir, 'three')

  assert.deepEqual(at(check(dir), 'src/prose.mjs'), [], 'bare absolutes in rationale are not claims')
})

test('one further commit is the same piece of work continuing, and is left alone', (t) => {
  const dir = repo(t)
  put(dir, 'src/gate.mjs', GATE('  while (q.length) q.pop()\n  return true'))
  commit(dir, 'one')
  put(dir, 'src/gate.mjs', GATE('  q.length = 0\n  return q'))
  commit(dir, 'two')

  assert.deepEqual(at(check(dir), 'src/gate.mjs'), [], 'distance 1 is below the threshold')
})

test('without git the stale-comment half says so instead of reporting nothing', (t) => {
  const dir = scratch(t)
  put(dir, 'src/gate.mjs', GATE('  q.length = 0\n  return q'))
  const r = check(dir)
  assert.equal(r.findings.length, 0)
  assert.match(r.note, /not a git checkout/i, `silence and "nothing to say" must read differently: ${r.note}`)
})

// ── 2. a document asserting a state nobody re-measured ───────────────────────────────────────

test('a README that says the suite is green is named, and the fix is the repo\'s own command', (t) => {
  const dir = scratch(t)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node run.mjs' } }))
  put(dir, 'README.md', '# Thing\n\n## Status\n\nAll 14 tests pass and the lint is clean.\n')
  const hits = at(check(dir), 'README.md')
  assert.equal(hits.length, 1, `expected one finding, got ${JSON.stringify(hits)}`)
  assert.equal(hits[0].line, 5)
  assert.equal(hits[0].evidence, 'All 14 tests pass and the lint is clean.')
  assert.match(hits[0].fix, /npm test/, 'the fix names the script package.json actually defines')
})

test('a claim wrapped across two lines is reported whole', (t) => {
  const dir = scratch(t)
  put(dir, 'HANDOFF.md', '# Handoff\n\nMeasured just now: **53 tests,\n0 failures, 5.1s**. Ready to merge.\n')
  const hits = at(check(dir), 'HANDOFF.md')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].evidence, 'Measured just now: **53 tests, 0 failures, 5.1s**.',
    'a fragment of a wrapped sentence is not evidence a reader can judge')
})

test('the carve-outs: fences, frontmatter, dated sections, changelogs and requirements', (t) => {
  const dir = scratch(t)
  put(dir, 'CHANGELOG.md', '# Changelog\n\n## 2.0.0\n\nAll tests pass, 0 failures.\n')
  put(dir, 'docs/policy.md', [
    '---',
    'description: "Use when about to say all tests pass or lint clean."',
    '---',
    '',
    '# Policy',
    '',
    'Every pull request must show no failures and no warnings before it merges.',
    '',
    'Sample output:',
    '',
    '```',
    '94 tests, 0 failures, 5.7s',
    '```',
    '',
    '## 1.4.0 — 2026-08-01',
    '',
    'All 94 tests pass, no warnings.',
    '',
  ].join('\n'))
  const r = check(dir)
  assert.deepEqual(r.findings, [],
    `nothing here is this repo asserting its state right now: ${JSON.stringify(r.findings, null, 2)}`)
  assert.ok(r.note.includes('prose files'), 'the note says what was examined')
  // policy.md was read and judged; CHANGELOG.md was not counted because it was never judged —
  // "a changelog is out of scope" and "a changelog came back clean" are different answers.
  assert.equal(r.scanned, 1, `expected policy.md read and the changelog skipped, got scanned=${r.scanned}`)
  assert.match(r.note, /changelogs/, 'the note names the carve-out')
})

test('a requirement is a standard to meet, not a result somebody read off a run', (t) => {
  // The carve-out fixture above carries "## 1.4.0 — 2026-08-01" inside its first fifteen lines,
  // which the anchor rule alone is enough to silence — so deleting the requirement carve-out left
  // it passing. This file has no date, no commit and no fence: the only thing standing between
  // "must show no failures" and a finding is the word "must".
  const dir = scratch(t)
  put(dir, 'docs/standard.md', '# Standard\n\nEvery pull request must show no failures and no warnings before it merges.\n')
  put(dir, 'docs/report.md', '# Report\n\nThe run came back with no failures and no warnings.\n')
  const r = check(dir)
  assert.deepEqual(r.findings.map((f) => f.file), ['docs/report.md'],
    `a standard is not an assertion; a result is: ${JSON.stringify(r.findings, null, 1)}`)
})

test('a document that reports no state at all is clean, and says how much was read', (t) => {
  const dir = scratch(t)
  put(dir, 'README.md', '# Thing\n\nIt reads a queue and writes a file. Run it with node.\n')
  const r = check(dir)
  assert.deepEqual(r.findings, [])
  assert.match(r.note, /prose files/)
})

// ── 3. the anti-flood invariant, measured on this repository ─────────────────────────────────

test('over CGC itself the check stays a list somebody will read', (t) => {
  const ctx = buildContext([REPO])
  const r = run(ctx)
  // Not a pin on the exact count — that would fail on every commit. This is the rule the check
  // exists under: a gate that fires on a large fraction of the tree is decoration.
  assert.ok(r.findings.length <= 25,
    `${r.findings.length} findings over ${ctx.files.length} files is a flood, not a report:\n` +
    r.findings.map((f) => `  ${f.file}:${f.line} ${f.what}`).join('\n'))
  // The shape invariants below run over a PLANTED finding as well as whatever CGC happens to
  // yield. CGC came back clean the day this was written, and a for-loop over an empty list
  // asserts nothing — the test would have stayed green with every field of every finding blank.
  const seeded = scratch(t)
  put(seeded, 'STATUS.md', '# Status\n\nMeasured just now: **53 tests, 0 failures**.\n')
  const planted = check(seeded).findings
  assert.equal(planted.length, 1, 'the seed must produce a finding, or the invariants below run over nothing')
  for (const f of [...r.findings, ...planted]) {
    assert.ok(f.file && f.what && f.evidence && f.fix, `incomplete finding: ${JSON.stringify(f)}`)
    assert.ok(!/^the /i.test(f.evidence) || f.evidence.length > 10)
    assert.notEqual(f.evidence, f.what, 'evidence must be extracted, not a restatement of what')
  }
})

test('the driver runs it end to end and reports it as one check', () => {
  const r = spawnSync(process.execPath, [join(REPO, 'tools', 'behaviour.mjs'), REPO, '--only=claims', '--json'],
    { encoding: 'utf8', timeout: 120000, windowsHide: true })
  assert.equal(r.status, 0, r.stderr)
  const report = JSON.parse(r.stdout)
  assert.equal(report.checks.length, 1)
  assert.equal(report.checks[0].id, 'claims')
  assert.ok(!report.checks[0].error, `the check threw: ${report.checks[0].error}`)
  assert.ok(report.checks[0].note, 'a check always says what it looked at')
})

test('a comment and its code touched on the SAME DAY are one working session, not staleness', (t) => {
  // Two commits to one file is a weak signal on its own. Measured on this repository, every
  // same-day pair was a false positive: a comment and the lines under it written hours apart while
  // both were being drafted. A stale explanation is something that happens over time, so the
  // threshold has to be in time and not only in commit count.
  // The fixture is GATE, whose claim sits on line 8, and NOT a two-line file with the comment on
  // line 1. That distinction is the whole test: a comment on line 1 is the file banner and is
  // dropped before it is ever dated, so an earlier version of this fixture came back clean with
  // the same-day rule deleted — it was being carried by the banner rule and asserted nothing.
  const dir = repo(t)
  const day = '2026-03-01T09:00:00'
  const at = { GIT_AUTHOR_DATE: day, GIT_COMMITTER_DATE: day }
  put(dir, 'src/gate.mjs', GATE('  while (q.length) q.pop()\n  return true'))
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'one', at)
  put(dir, 'src/gate.mjs', GATE('  for (const x of q) x.close()\n  return true'))
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'two', at)
  put(dir, 'src/gate.mjs', GATE('  q.length = 0\n  return q'))
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'three', at)

  const stale = check(dir).findings.filter((f) => /comment/.test(f.what))
  assert.deepEqual(stale, [], 'same-day edits are one session and must not be reported as a stale comment')
})

test('the file banner describes the module, not the statement under it', (t) => {
  // A block opening in the first three lines is dropped whatever it says, because the thing under
  // it is an import. Nothing else in this file plants a claim there, so the rule was free: it
  // could be deleted and every test stayed green.
  const dir = repo(t)
  // The code under the banner has to MOVE, or the case proves nothing: a banner normally sits on
  // an import, the import never changes, and the distance is zero whatever the rule says.
  const banner = (body) => `// Drains the queue, so a task can never be left half-written.\nexport function drain(q) {\n${body}\n}\n`
  put(dir, 'src/b.mjs', banner('  while (q.length) q.pop()'))
  commit(dir, 'one')
  put(dir, 'src/b.mjs', banner('  for (const x of q) x.close()'))
  commit(dir, 'two')
  put(dir, 'src/b.mjs', banner('  q.length = 0'))
  commit(dir, 'three')

  assert.deepEqual(at(check(dir), 'src/b.mjs'), [],
    'a banner is about the module; dating it against the first statement is a finding about nothing')
})

test('a state-claim anchored to a commit or a date is a record, not a live assertion', (t) => {
  // An audit or a post-mortem is SUPPOSED to say what was true at a revision; that is its whole
  // job. What goes on being believed after it stops being true is the unanchored present tense.
  const dir = repo(t)
  put(dir, 'AUDIT.md', 'Measured at commit `17c6610`.\n\n`node tools/run-tests.mjs` gave **94 tests, 0 failures**.\n')
  put(dir, 'DATED.md', 'As of 2026-03-01 the suite was clean: 94 tests, 0 failures.\n')
  put(dir, 'LIVE.md', 'Measured just now: **53 tests, 0 failures**. Lint is clean.\n')
  commit(dir, 'docs')

  const got = check(dir).findings.filter((f) => /asserts a state/.test(f.what)).map((f) => f.file)
  assert.deepEqual(got, ['LIVE.md'],
    'only the claim with nothing to anchor it should be reported')
})
