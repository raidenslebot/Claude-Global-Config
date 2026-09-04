#!/usr/bin/env node
// run-tests.mjs — discover test files and hand them to node's runner explicitly.
//
//   node tools/run-tests.mjs            all tests
//   node tools/run-tests.mjs paths      only files whose name contains "paths"
//   node tools/run-tests.mjs --help     this text, and nothing else
//
// Why this exists rather than `node --test tools/test/` in the npm script:
//
//   - `node --test <directory>` fails here, resolving the directory as a module
//     ("Cannot find module ...\tools\test"). It reproduces in argo/ too, so it is
//     environmental, not a property of these tests.
//   - `node --test "tools/test/**/*.test.mjs"` works on node 21+, which expands the
//     glob itself, but NOT on node 20 — and CI pins node 20.
//   - A shell glob in the npm script is not portable either: npm runs scripts through
//     sh on POSIX (expands) and cmd.exe on Windows (does not).
//
// Passing explicit absolute paths is the one form every supported version accepts.

import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { askedForHelp , concurrency} from './paths.mjs'

// A request for help is never a request to run the suite.
if (askedForHelp(import.meta.url)) process.exit(0)

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const TEST_DIR = join(HERE, 'test')
const filter = process.argv[2]

if (!existsSync(TEST_DIR)) {
  console.error(`no test directory at ${TEST_DIR}`)
  process.exit(1)
}

const files = readdirSync(TEST_DIR)
  .filter((f) => /\.test\.m?js$/.test(f))
  .filter((f) => !filter || f.includes(filter))
  .map((f) => resolve(TEST_DIR, f))
  .sort()

if (!files.length) {
  console.error(filter ? `no test files matching "${filter}"` : 'no test files found')
  process.exit(1)
}

// ── the suites this package SHIPS but does not own ───────────────────────────
//
// argo is installed by install.mjs, linked onto PATH, checked by the doctor and named in the
// mandates — and its 440 tests were run by nothing here. The count in the session line was a
// true statement about a set that quietly excluded a shipped component, and a red suite in it
// would have gone unnoticed indefinitely.
//
// A component qualifies by carrying its own runner: package.json with a `test` script. It is
// discovered rather than listed, because a list is the thing that goes stale.
/** A child suite must not inherit this process's test-runner context: a nested `node --test`
 *  that sees NODE_TEST_CONTEXT reports into the parent instead of printing its own summary —
 *  exit 0 with no counts, which reads exactly like a suite that has no tests in it. */
function cleanEnv() {
  const env = { ...process.env, CGC_TEST_CONCURRENCY: String(CONCURRENCY) }
  delete env.NODE_TEST_CONTEXT
  delete env.NODE_OPTIONS
  return env
}

function shippedSuites() {
  const out = []
  for (const name of readdirSync(REPO, { withFileTypes: true })) {
    if (!name.isDirectory() || name.name === 'node_modules' || name.name.startsWith('.')) continue
    const dir = join(REPO, name.name)
    let pkg
    try { pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) } catch { continue }
    const script = pkg?.scripts?.test
    if (!script || /^\s*(echo|exit)\b/.test(script)) continue
    out.push({ name: name.name, dir, script })
  }
  return out
}

/** The ℹ counts node's runner prints, from captured output. */
function counts(text) {
  const n = (k) => { const m = new RegExp(`(?:ℹ|#)\\s*${k}\\s+(\\d+)`).exec(text); return m ? Number(m[1]) : 0 }
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped') }
}

/** Node prints its ℹ counts at the end; only the combined block below may carry them. */
function stripSummary(text) {
  const SUMMARY = /^\s*(?:ℹ|#)\s*(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b/
  return text.split(/\r?\n/).filter((l) => !SUMMARY.test(l)).join('\n')
}

const CONCURRENCY = concurrency()

const suites = shippedSuites()
// This package's own tests, then every suite it ships. Both are captured so that exactly ONE
// summary block is printed at the end: the session hook reads the first ℹ counts it finds, and
// two blocks would have it report one suite as the whole.
const own = spawnSync(process.execPath, [`--test-concurrency=${CONCURRENCY}`, '--test', ...files], { encoding: 'utf8' })
const ownText = (own.stdout || '') + (own.stderr || '')
process.stdout.write(stripSummary(ownText))

let total = counts(ownText)
let failed = own.status !== 0

for (const s of suites) {
  // Run the script itself when it is a plain node invocation, which is what every suite here is.
  // Going through npm adds a shell, a package manager and an inherited npm_* environment — and
  // under a parent test run that combination produced exit 0 with no output at all, which reads
  // as a suite with no tests rather than as a suite that never ran.
  const direct = /^node\s+(.+)$/.exec(s.script.trim())
  const r = direct
    ? spawnSync(process.execPath, direct[1].split(/\s+/), { cwd: s.dir, encoding: 'utf8', timeout: 600000, env: cleanEnv() })
    : spawnSync('npm', ['test', '--silent'], { cwd: s.dir, encoding: 'utf8', shell: true, timeout: 600000, env: cleanEnv() })
  const text = (r.stdout || '') + (r.stderr || '')
  const c = counts(text)
  if (r.status !== 0) {
    failed = true
    process.stdout.write(`\n── ${s.name} ──\n`)
    process.stdout.write(stripSummary(text))
  }
  total = {
    tests: total.tests + c.tests, pass: total.pass + c.pass,
    fail: total.fail + c.fail, skipped: total.skipped + c.skipped,
  }
  console.log(`\n  ${s.name}: ${c.tests} tests · ${c.pass} pass · ${c.fail} fail${c.skipped ? ` · ${c.skipped} skipped` : ''}`
    + (r.status === 0 ? '' : '  ← its own runner exited non-zero'))
}

// One block, in node's own shape, so anything reading these counts reads the whole package.
console.log(`\nℹ tests ${total.tests}`)
console.log(`ℹ pass ${total.pass}`)
console.log(`ℹ fail ${total.fail}`)
console.log(`ℹ skipped ${total.skipped}`)
process.exit(failed || total.fail > 0 ? 1 : 0)

