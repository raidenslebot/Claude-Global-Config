/**
 * the contract a pipeline reads: exit codes, and what a live invocation is
 * allowed to do to the machine it runs on.
 *
 * the numbers ARE the interface: 0 clean, 1 the thing you were measuring is
 * out of bounds, 2 the run never produced a measurement. everything else in
 * these commands was tested as pure functions, which left the one part a
 * pipeline actually reads — the exit code — asserted nowhere.
 *
 * every case here drives run() directly with --dry-run, or with a binary that
 * cannot exist, so nothing spawns a model and no tokens are spent. the one
 * exception is the injection proof at the bottom, which spawns this very node
 * binary with a hostile argument and checks the disk afterwards.
 */

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { run as diverge } from '../src/divergence/cmd.js'
import { run as baseline } from '../src/baseline/cmd.js'
import { askClaude } from '../src/divergence/claude.js'

const ROOT = mkdtempSync(join(tmpdir(), 'argo-exit-'))
after(() => rmSync(ROOT, { recursive: true, force: true }))

let n = 0
/** A throwaway working directory, so artifacts from one case cannot reach another. */
function sandbox(files = {}) {
  const dir = join(ROOT, `case-${++n}`)
  mkdirSync(dir, { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body), 'utf8')
  }
  return dir
}

/**
 * Run a command with stdout and stderr captured. Both are collected because
 * these commands deliberately split the report from the progress noise, and a
 * test that only watched one would miss half the contract.
 */
async function capture(fn) {
  const [log, err] = [console.log, console.error]
  const lines = []
  console.log = (...a) => lines.push(a.join(' '))
  console.error = (...a) => lines.push(a.join(' '))
  try {
    const code = await fn()
    return { code, out: lines.join('\n') }
  } finally {
    console.log = log
    console.error = err
  }
}

/* ------------------------------------------------------------------ *
 * argo diverge
 * ------------------------------------------------------------------ */

const AGENTS = [{ name: 'agent-a' }, { name: 'agent-b' }]
/** One probe with a single answer and no alternatives: every agent agrees. */
const AGREE = [{ id: 'p1', question: 'Which file is the hub?', graphAnswer: 'src/graph/build.js' }]
/** Two answers apiece, so the seeded synthetic fleet actually splits. */
const SPLIT = [
  { id: 'p1', question: 'Which file is the hub?', graphAnswer: 'src/graph/build.js', alternatives: ['src/cli.js'] },
  { id: 'p2', question: 'How many source files?', graphAnswer: '31', alternatives: ['12'] },
]

test('diverge --help exits 0 and prints the help, not a report', async () => {
  const { code, out } = await capture(() => diverge({ _: [], help: true }))
  assert.equal(code, 0)
  assert.match(out, /argo diverge \[path\]/)
})

test('diverge exits 0 on a fleet that agrees', async () => {
  const dir = sandbox({ 'agents.json': AGENTS, 'probes.json': AGREE })
  const { code, out } = await capture(() =>
    diverge({ _: [dir], 'dry-run': true, agents: join(dir, 'agents.json'), probes: join(dir, 'probes.json') }))
  assert.equal(code, 0, out)
  assert.doesNotMatch(out, /\[breach\]/)
})

test('diverge exits 1 on a breached pair', async () => {
  const dir = sandbox({ 'agents.json': AGENTS, 'probes.json': SPLIT })
  const { code, out } = await capture(() =>
    diverge({ _: [dir], 'dry-run': true, threshold: 0, agents: join(dir, 'agents.json'), probes: join(dir, 'probes.json') }))
  assert.equal(code, 1, out)
  assert.match(out, /breach/)
})

test('diverge exits 2 when the agents file is unreadable', async () => {
  const dir = sandbox({ 'probes.json': AGREE })
  const { code, out } = await capture(() =>
    diverge({ _: [dir], 'dry-run': true, agents: join(dir, 'no-such-agents.json'), probes: join(dir, 'probes.json') }))
  assert.equal(code, 2)
  assert.match(out, /argo diverge:/)
})

test('diverge exits 2 on fewer than two agents — one agent has no pair to score', async () => {
  const dir = sandbox({ 'agents.json': [{ name: 'solo' }], 'probes.json': AGREE })
  const { code, out } = await capture(() =>
    diverge({ _: [dir], 'dry-run': true, agents: join(dir, 'agents.json'), probes: join(dir, 'probes.json') }))
  assert.equal(code, 2)
  assert.match(out, /at least two agent/)
})

test('diverge exits 2 on an empty probes file, and blames the probes file', async () => {
  const dir = sandbox({ 'agents.json': AGENTS, 'probes.json': [] })
  const { code, out } = await capture(() =>
    diverge({ _: [dir], 'dry-run': true, agents: join(dir, 'agents.json'), probes: join(dir, 'probes.json') }))
  assert.equal(code, 2)
  assert.match(out, /empty array/)
})

test('diverge exits 2 on a probes file that is not JSON', async () => {
  const dir = sandbox({ 'agents.json': AGENTS, 'probes.json': '{not json' })
  const { code } = await capture(() =>
    diverge({ _: [dir], 'dry-run': true, agents: join(dir, 'agents.json'), probes: join(dir, 'probes.json') }))
  assert.equal(code, 2)
})

test('diverge exits 2 when every call failed — a green run on zero data is the bug', async () => {
  // No --dry-run, and a binary that cannot exist: every call fails, so the
  // report would be built out of nothing. Exiting 0 there is precisely the
  // silent pass this command exists to catch, one level up. Its sibling —
  // some calls landed but no PAIR shares a probe, verdict "no-data" — needs a
  // binary that half works, so it is asserted at the verdict level instead
  // (see divergence.test.js) rather than faked with a platform-specific shim.
  const dir = sandbox({ 'agents.json': AGENTS, 'probes.json': AGREE })
  const before = process.env.ARGO_CLAUDE_BIN
  process.env.ARGO_CLAUDE_BIN = join(dir, 'definitely-not-a-real-claude.exe')
  try {
    const { code, out } = await capture(() =>
      diverge({ _: [dir], agents: join(dir, 'agents.json'), probes: join(dir, 'probes.json'), timeout: 5 }))
    assert.equal(code, 2, out)
    assert.match(out, /every call failed/)
  } finally {
    if (before === undefined) delete process.env.ARGO_CLAUDE_BIN
    else process.env.ARGO_CLAUDE_BIN = before
  }
})

/* ------------------------------------------------------------------ *
 * argo baseline
 * ------------------------------------------------------------------ */

const TASKS = [
  { id: 't1', prompt: 'Say hello', check: { type: 'contains', value: 'hello' } },
  { id: 't2', prompt: 'Say goodbye', check: { type: 'contains', value: 'goodbye' } },
]

test('baseline --help exits 0', async () => {
  const { code, out } = await capture(() => baseline({ _: [], help: true }))
  assert.equal(code, 0)
  assert.match(out, /argo baseline --tasks FILE/)
})

test('baseline exits 2 without --tasks', async () => {
  const { code, out } = await capture(() => baseline({ _: [] }))
  assert.equal(code, 2)
  assert.match(out, /--tasks FILE is required/)
})

test('baseline exits 2 when the tasks file is unreadable', async () => {
  const dir = sandbox()
  const { code, out } = await capture(() => baseline({ _: [], tasks: join(dir, 'nope.json'), cwd: dir, 'dry-run': true }))
  assert.equal(code, 2)
  assert.match(out, /argo baseline:/)
})

test('baseline exits 2 when no task in the file is usable', async () => {
  const dir = sandbox({ 'tasks.json': [{ id: 'no-prompt' }] })
  const { code, out } = await capture(() =>
    baseline({ _: [], tasks: join(dir, 'tasks.json'), cwd: dir, 'dry-run': true }))
  assert.equal(code, 2)
  assert.match(out, /no usable tasks/)
})

test('baseline --dry-run exits 0 and spawns nothing', async () => {
  const dir = sandbox({ 'tasks.json': TASKS })
  const { code, out } = await capture(() =>
    baseline({ _: [], tasks: join(dir, 'tasks.json'), cwd: dir, 'dry-run': true, label: 'exitcode' }))
  assert.equal(code, 0, out)
  assert.match(out, /DRY RUN/)
})

/** Seeds swept once against the simulator; stable because the simulator is. */
const SUBTRACTS_SEED = 1
const PAYS_SEED = 6

test('baseline --strict exits 1 only when the crew subtracts', async () => {
  const dir = sandbox({ 'tasks.json': TASKS })
  const call = (seed, strict) => capture(() =>
    baseline({ _: [], tasks: join(dir, 'tasks.json'), cwd: dir, 'dry-run': true, seed, strict, label: `s${seed}` }))

  const breached = await call(SUBTRACTS_SEED, true)
  assert.equal(breached.code, 1, breached.out)
  assert.match(breached.out, /crew-subtracts/)

  // Same verdict, no --strict: the gate is opt-in.
  const lenient = await call(SUBTRACTS_SEED, undefined)
  assert.equal(lenient.code, 0, lenient.out)

  // --strict set but the crew earned its calls: the flag alone is not the gate.
  const clean = await call(PAYS_SEED, true)
  assert.equal(clean.code, 0, clean.out)
})

/* ------------------------------------------------------------------ *
 * no shell — an agents file is user input, not a command line
 * ------------------------------------------------------------------ */

/**
 * What a hostile --agents file would put in systemPrompt / appendPrompt.
 * The separator is `&` rather than `&&` on purpose: `&&` only fires if the
 * first command succeeded, and a probe that reaches a non-CLI binary does not.
 */
const PAYLOADS = {
  systemPrompt: 'be terse" & echo pwned > pwned-1.txt & rem "',
  appendPrompt: 'also&echo pwned>pwned-2.txt',
}

test('a hostile agents file cannot append a command to a real executable', async () => {
  // process.execPath is a genuine .exe, so this takes the same branch a real
  // claude.exe takes. Node quotes each argv entry; nothing re-parses them.
  // Under the old `shell: true` this redirect wrote a file.
  const dir = sandbox()
  const res = await askClaude({ bin: process.execPath, prompt: 'hi', cwd: dir, timeout: 20_000, ...PAYLOADS })
  assert.equal(res.ok, false, 'node is not the claude CLI, so the probe must fail')
  assert.deepEqual(readdirSync(dir), [], `something was written: ${readdirSync(dir).join(', ')}`)
})

test('a hostile agents file is refused outright on the .cmd shim route', async () => {
  // A .cmd cannot run without an interpreter, and cmd.exe re-parses whatever
  // node quoted — so this route refuses the payload instead of escaping it and
  // hoping. Nothing spawns: the refusal happens before the fork.
  const dir = sandbox()
  const res = await askClaude({ bin: join(dir, 'claude.cmd'), prompt: 'hi', cwd: dir, ...PAYLOADS })
  assert.equal(res.ok, false)
  assert.match(res.error, /refusing to launch through cmd\.exe/)
  assert.match(res.error, /ARGO_CLAUDE_BIN/)
  assert.deepEqual(readdirSync(dir), [])
})
