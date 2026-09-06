#!/usr/bin/env node
// mutate.mjs — break the guards on purpose, and check the tests notice.
//
//   node tools/mutate.mjs             every mutation
//   node tools/mutate.mjs claim       only mutations whose name contains "claim"
//   node tools/mutate.mjs --list      what it would try, without running anything
//   node tools/mutate.mjs --help      this text, and nothing else
//
// WHY THIS EXISTS. Six rounds of adversarial review of the updater found, between them, three
// assertions that could not fail: two comparing a value against itself, one scoped to a state no
// fixture produced. Each was written as the regression test for a real defect, each was believed
// to be holding that line, and none of them was. A green suite says every test passed; it does
// not say any test would have failed.
//
// So this asks the only question that settles it. Take a guard the package depends on, remove it,
// run the tests that claim to cover it, and require that they go red. A mutation that SURVIVES is
// a guard nothing is holding: the code may be right today, but nothing will notice when it stops
// being. That is exactly the state the updater was in for six releases.
//
// The mutations are deliberate rather than generated. A random character swap mostly produces
// code that does not parse, and a survivor then says nothing; each entry here is a guard somebody
// had to think of, expressed as its own removal — which is the shape every real regression in
// this file's history has actually taken.
//
// It is not part of `npm test`: it runs the suite once per mutation, so it costs minutes rather
// than seconds. It is a release gate — run it before tagging, and treat a survivor as a missing
// test rather than a passing one.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO, askedForHelp } from './paths.mjs'

if (askedForHelp(import.meta.url)) process.exit(0)

const HOOKS = join(REPO, 'config', 'hooks')
const TESTS = join(REPO, 'tools', 'test')

/** The suites that between them claim to cover the updater and the doctor. */
const UPDATER_TESTS = [join(TESTS, 'auto-update.test.mjs'), join(TESTS, 'update-invariants.test.mjs')]
const DOCTOR_TESTS = [join(TESTS, 'doctor.test.mjs')]
const PRUNE_TESTS = [join(TESTS, 'hook-prune.test.mjs')]
const FUZZ_TESTS = [join(TESTS, 'hook-fuzz.test.mjs')]
const GATE_TESTS = [join(TESTS, 'workflow-gate.test.mjs')]

/**
 * Each mutation names a guard, the file it lives in, the exact text that IS the guard, what it
 * becomes when removed, and the suites that ought to object. `from` must appear exactly once:
 * an anchor that has drifted is reported rather than silently skipped, because a guard whose
 * text has changed is a guard whose test may no longer be about it.
 *
 * `expect` names the test that SHOULD be the one to object — and it is not decoration. The first
 * run of this gate killed every mutation, but three unrelated guards were all caught by one
 * detached-checkout test that has nothing to do with any of them: removing a guard broke that
 * scenario incidentally, so the suite went red for the wrong reason. A guard held by accident is
 * a guard that loses its net the day that unrelated test changes, and nobody will connect the
 * two. So a kill by some other test is reported separately from a kill by the right one.
 */
const MUTATIONS = [
  {
    name: 'a spread into a literal is not a bound',
    expect: 'spread is not a bound',
    file: join(HOOKS, 'pre-tool-workflow-policy.js'),
    from: "if (/^\\s*\\[/.test(body) && !/\\.\\.\\./.test(body)) return true",
    to: "if (/^\\s*\\[/.test(body)) return true",
    tests: GATE_TESTS,
  },
  {
    name: 'a verdict computed from no survivors is refused',
    expect: 'collapse to the affirmative',
    file: join(HOOKS, 'pre-tool-workflow-policy.js'),
    from: "const failsOpen = /\\.length\\s*>\\s*0\\s*&&/.test(code)",
    to: 'const failsOpen = false',
    tests: GATE_TESTS,
  },
  {
    name: 'a workflow whose agents name no model is refused',
    expect: 'pinned session is not asked',
    file: join(HOOKS, 'pre-tool-workflow-policy.js'),
    from: 'if (routable && /\\bagent\\s*\\(/.test(code)) {',
    to: 'if (false) {',
    tests: GATE_TESTS,
  },
  {
    name: 'a declaration is read to the end of its own statement',
    expect: 'declaration is read to its own end',
    file: join(HOOKS, 'pre-tool-workflow-policy.js'),
    from: '        if (!opensWith && !endsWith) break',
    to: '        break',
    tests: GATE_TESTS,
  },
  {
    name: 'an acknowledgement excuses only the fault it names',
    expect: 'deliberate exception is recorded',
    file: join(HOOKS, 'pre-tool-workflow-policy.js'),
    from: 'const add = (code_, why, fix) => { if (!acked.has(code_)) faults.push({ code: code_, why, fix }) }',
    to: 'const add = (code_, why, fix) => { if (acked.size === 0) faults.push({ code: code_, why, fix }) }',
    tests: GATE_TESTS,
  },
  {
    name: 'the prompt hook refuses to announce an update to a session with no record',
    expect: "no record of its own",
    file: join(HOOKS, 'user-prompt-cgc-update.js'),
    from: 'return was > 0 && mtime(LAST_APPLIED) > was',
    to: 'return mtime(LAST_APPLIED) > was',
    tests: UPDATER_TESTS,
  },
  {
    name: 'an unreadable last-applied is not treated as a successful update',
    expect: "keeps every invariant",
    file: join(HOOKS, 'user-prompt-cgc-update.js'),
    from: '    if (!u) {',
    to: '    if (false) {',
    tests: UPDATER_TESTS,
  },
  {
    name: 'a record that says the re-apply failed is reported as failed',
    expect: "install that FAILED",
    file: join(HOOKS, 'user-prompt-cgc-update.js'),
    from: '    if (u && u.applied === false) {',
    to: '    if (false) {',
    tests: UPDATER_TESTS,
  },
  {
    name: 'the floor under how often an update may be attempted',
    expect: "retries at most once",
    file: join(HOOKS, 'user-prompt-cgc-update.js'),
    from: '  if (since > BG_FLOOR_MS && (stale || since > (blocking ? BG_RETRY_MS : BG_RUNNING_MS))) {',
    to: '  if (stale || since > (blocking ? BG_RETRY_MS : BG_RUNNING_MS)) {',
    tests: UPDATER_TESTS,
  },
  {
    name: 'the backoff before retrying a reason that still stands',
    expect: "different numbers",
    file: join(HOOKS, 'user-prompt-cgc-update.js'),
    from: '  if (since > BG_FLOOR_MS && (stale || since > (blocking ? BG_RETRY_MS : BG_RUNNING_MS))) {',
    to: '  if (since > BG_FLOOR_MS && (stale || since > BG_RUNNING_MS)) {',
    tests: UPDATER_TESTS,
  },
  {
    name: 'only one prompt may start an attempt',
    expect: "exactly one may start it",
    file: join(HOOKS, 'user-prompt-cgc-update.js'),
    from: '    if (mtime(BG_STAMP) !== askedAt) return false',
    to: '    if (false) return false',
    tests: UPDATER_TESTS,
  },
  {
    name: 'the background stamp is kept while an updater holds the lock',
    expect: "still holds the lock",
    file: join(HOOKS, 'user-prompt-cgc-update.js'),
    from: "    try { if (!fs.existsSync(path.join(STATE, 'update.lock'))) { fs.rmSync(BG_STAMP, { force: true }); fs.rmSync(BLOCKED_AT, { force: true }) } } catch { /* nothing to clear */ }",
    to: "    try { fs.rmSync(BG_STAMP, { force: true }); fs.rmSync(BLOCKED_AT, { force: true }) } catch { /* nothing to clear */ }",
    tests: UPDATER_TESTS,
  },
  {
    name: 'git that cannot answer is not read as a clean tree',
    expect: "not read as a clean tree",
    file: join(HOOKS, 'user-prompt-cgc-update.js'),
    from: '  if (aheadR.status !== 0 || dirtyR.status !== 0) {',
    to: '  if (false) {',
    tests: UPDATER_TESTS,
  },
  {
    name: 'the prompt hook follows the default branch, not whatever is checked out',
    expect: "follows the default branch only",
    file: join(HOOKS, 'user-prompt-cgc-update.js'),
    from: '  if (branch !== main) once(',
    to: '  if (false) once(',
    tests: UPDATER_TESTS,
  },
  {
    name: 'a detached checkout is never updated automatically',
    expect: "refuses a detached checkout",
    file: join(HOOKS, 'user-prompt-cgc-update.js'),
    from: "  if (branch === 'HEAD') once(",
    to: '  if (false) once(',
    tests: UPDATER_TESTS,
  },
  {
    name: 'the correction to the record requires a repair that actually ran',
    expect: "doctor saw nothing wrong",
    file: join(HOOKS, 'session-start-cgc.js'),
    from: "  if (u && u.status === 'updated' && !u.applied && v && v.repaired && v.repairable === false) {",
    to: "  if (u && u.status === 'updated' && !u.applied && v) {",
    tests: UPDATER_TESTS,
  },
  {
    name: 'the installer is told the lock is held only when it is',
    expect: "could not get the lock",
    file: join(HOOKS, 'session-start-cgc.js'),
    from: "CGC_UPDATE_LOCK_HELD: LOCK_HELD ? '1' : '0'",
    to: "CGC_UPDATE_LOCK_HELD: '1'",
    tests: UPDATER_TESTS,
  },
  {
    name: 'a session start never moves a clone that is dirty, ahead or on another branch',
    expect: "another branch is left alone",
    file: join(HOOKS, 'session-start-cgc.js'),
    from: "  if (branch !== main) return finish({ status: 'branch', branch, main, head })",
    to: '  if (false) return finish({})',
    tests: UPDATER_TESTS,
  },
  {
    name: 'the prune only removes hooks this package retired',
    expect: "RETIRED is pruned",
    file: join(REPO, 'tools', 'install.mjs'),
    from: '            if (!retired.has(b)) return true',
    to: '            if (false) return true',
    tests: PRUNE_TESTS,
  },
  {
    name: 'a standalone MCP server that is missing is a warning, not a repair loop',
    expect: "warning naming the install step",
    file: join(REPO, 'tools', 'doctor.mjs'),
    from: '            if (spec.bin && !resolveServerBin(spec.bin)) {',
    to: '            if (false) {',
    tests: DOCTOR_TESTS,
  },
  {
    name: 'every hook exits 0 on a malformed payload',
    expect: "survives every malformed payload",
    file: join(HOOKS, 'user-prompt-mandates.js'),
    from: 'process.stdout.write(',
    to: 'if (!process.env.CGC_NEVER) throw new Error("mutation"); process.stdout.write(',
    tests: FUZZ_TESTS,
  },
]

const args = process.argv.slice(2)
const filter = args.find((a) => !a.startsWith('-'))
const listOnly = args.includes('--list')
const chosen = MUTATIONS.filter((m) => !filter || m.name.toLowerCase().includes(filter.toLowerCase()))

if (!chosen.length) {
  console.error(filter ? `no mutation matching "${filter}"` : 'no mutations defined')
  process.exit(2)
}
if (listOnly) {
  for (const m of chosen) console.log(`  ${m.name}\n      ${m.file.replace(REPO, '.')}  ←  ${m.from.trim().slice(0, 70)}`)
  process.exit(0)
}

const say = (m) => console.log(m)
say(`\n\x1b[1mMutation gate — ${chosen.length} guard${chosen.length === 1 ? '' : 's'}, each removed and put back\x1b[0m`)
say('  A guard whose removal no test notices is a guard nothing is holding.\n')

const survivors = []
const missing = []
const accidental = []
let killed = 0

for (const m of chosen) {
  const original = readFileSync(m.file, 'utf8')
  const hits = original.split(m.from).length - 1
  if (hits !== 1) {
    missing.push(`${m.name} — its anchor appears ${hits} times in ${m.file.replace(REPO, '.')}`)
    say(`  \x1b[33mskip\x1b[0m  ${m.name} (anchor appears ${hits} times)`)
    continue
  }
  writeFileSync(m.file, original.replace(m.from, m.to), 'utf8')
  let red = false
  let why = ''
  let failing = []
  try {
    const r = spawnSync(process.execPath, ['--test', ...m.tests], { cwd: REPO, encoding: 'utf8', timeout: 900000 })
    red = r.status !== 0
    const text = (r.stdout || '') + (r.stderr || '')
    // EVERY failing test, not the first: whether the RIGHT one objected is the question.
    failing = [...text.matchAll(/^✖ (.+?)(?: \([\d.]+ms\))?$/gm)].map((x) => x[1].trim())
      .filter((x) => x !== 'failing tests:')
    why = failing[0] || ''
  } finally {
    writeFileSync(m.file, original, 'utf8')          // always, even if the run threw
  }
  if (!red) { survivors.push(m.name); say(`  \x1b[31mSURVIVED\x1b[0m  ${m.name}`); continue }
  killed++
  const byTheRightOne = !m.expect || failing.some((f) => f.toLowerCase().includes(m.expect.toLowerCase()))
  if (byTheRightOne) say(`  \x1b[32mkilled\x1b[0m  ${m.name}${why ? `\n            caught by: ${why.slice(0, 90)}` : ''}`)
  else {
    accidental.push({ name: m.name, expect: m.expect, actual: failing.slice(0, 3) })
    say(`  \x1b[33mkilled by accident\x1b[0m  ${m.name}`)
    say(`            expected: a test matching "${m.expect}"`)
    say(`            actually: ${failing.slice(0, 3).map((f) => f.slice(0, 60)).join(' · ') || '(nothing named)'}`)
  }
}

say(`\n  ${killed} killed (${accidental.length} by a test that was not about it) · ${survivors.length} survived · ${missing.length} skipped\n`)
if (missing.length) {
  say('  Anchors that no longer match — the guard moved, so its mutation is not being tried:')
  for (const s of missing) say(`    ${s}`)
  say('')
}
if (accidental.length) {
  say('  \x1b[33mHeld by accident\x1b[0m — the suite went red, but not because of the test written for it.')
  say('  The day that unrelated test changes, these guards lose their net and nobody will connect the two:')
  for (const a of accidental) say(`    ${a.name}\n      wanted "${a.expect}", got: ${a.actual.map((x) => x.slice(0, 50)).join(' · ')}`)
  say('')
}
if (survivors.length) {
  say('  \x1b[31mNothing holds these:\x1b[0m')
  for (const s of survivors) say(`    ${s}`)
  say('\n  Each is a guard the suite would not miss. Write the test that fails without it.\n')
}
process.exit(survivors.length || missing.length || accidental.length ? 1 : 0)
