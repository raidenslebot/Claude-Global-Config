// The PostToolUse hook that catches a test which cannot fail.
//
// The negative cases are the important half. A tautology detector that also fires on
// `notEqual(key('/w/a', s), key('/w/b', s))` is worse than no detector: it trains the reader to
// skip the finding, and that is exactly what the first version did — it compared LITERAL-STRIPPED
// source, where those two arguments are the same text, and reported three real assertions in this
// repository's own suite as tautologies.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { discard } from './_teardown.mjs'

const require = createRequire(import.meta.url)
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const HOOK = join(REPO, 'config', 'hooks', 'post-tool-behaviour.js')
const { findings } = require(HOOK)

const ids = (src) => findings(src).map((f) => f.id)

test('a tautology is caught in both assert and expect dialects', () => {
  assert.deepEqual(ids('import assert from "node:assert"\ntest("t", () => { assert.equal(head(w.friend), head(w.friend)) })'), ['tautology'])
  assert.deepEqual(ids('test("t", () => { expect(store.getCount()).toBe(store.getCount()) })'), ['tautology'])
  assert.deepEqual(ids('import assert from "node:assert"\ntest("t", () => { assert.deepStrictEqual(build(cfg), build(cfg)) })'), ['tautology'])
})

test('the tautology is reported at the line it is on', () => {
  const src = 'import assert from "node:assert"\n\n\ntest("t", () => {\n  assert.equal(f(x), f(x))\n})'
  const [f] = findings(src)
  assert.equal(f.id, 'tautology')
  assert.equal(f.line, 5)
  // The detail quotes the real expression, not a blanked one.
  assert.match(f.detail, /f\(x\)/)
})

test('arguments that differ ONLY inside a string literal are not a tautology', () => {
  // The regression that mattered: stripLiterals blanks string CONTENTS, so these two calls are
  // identical in stripped source and completely different in fact.
  const src = 'import assert from "node:assert"\ntest("t", () => { assert.notEqual(key("/w/a", s), key("/w/b", s)) })'
  assert.deepEqual(ids(src), [])
  // ... and the same call really compared with itself still is one.
  const same = 'import assert from "node:assert"\ntest("t", () => { assert.equal(key("/w/a", s), key("/w/a", s)) })'
  assert.deepEqual(ids(same), ['tautology'])
})

test('a tautology written inside a string or a comment is not code', () => {
  assert.deepEqual(ids('import assert from "node:assert"\n// assert.equal(a, a) is what we must never write\ntest("t", () => { assert.equal(sum(2, 2), 4) })'), [])
  assert.deepEqual(ids('import assert from "node:assert"\ntest("t", () => { assert.equal(msg, "assert.equal(a, a)") })'), [])
})

test('a real assertion against a value captured beforehand is clean', () => {
  const src = 'import assert from "node:assert"\nconst before = head(w.friend)\ntest("t", () => { update(w); assert.equal(head(w.friend), before) })'
  assert.deepEqual(ids(src), [])
})

test('a test file with no assertion at all is reported, and nothing else is', () => {
  const found = findings('test("t", () => { doTheThing() })')
  assert.deepEqual(found.map((f) => f.id), ['no-assertion'])
})

test('existence-only fires when every claim is presence, and not when one is real', () => {
  assert.deepEqual(ids('import assert from "node:assert"\ntest("t", () => { assert.ok(existsSync(p)) })'), ['existence-only'])
  assert.deepEqual(ids('test("t", () => { expect(cfg).toBeDefined() })'), ['existence-only'])
  assert.deepEqual(ids('import assert from "node:assert"\ntest("t", () => { assert.notEqual(cfg, null) })'), ['existence-only'])
  // One assertion that says what the value IS redeems the file.
  assert.deepEqual(ids('import assert from "node:assert"\ntest("t", () => { assert.ok(cfg); assert.equal(cfg.port, 8080) })'), [])
  // notEqual against a real value is a claim, not a presence check.
  assert.deepEqual(ids('import assert from "node:assert"\ntest("t", () => { assert.notEqual(cfg.port, 80) })'), [])
})

test('importing the assert module is not an assertion', () => {
  // `import assert from 'node:assert'` used to satisfy the "does this file assert?" test, so a
  // file whose every claim was toBeDefined read as adequately covered.
  const src = 'import assert from "node:assert"\ntest("t", () => { assert.ok(thing) })'
  assert.deepEqual(ids(src), ['existence-only'])
})

test('this repository\'s own test suite is clean under the hook', () => {
  // The noise measurement, as a standing assertion rather than a number in a commit message.
  // If a future change to the detector starts firing on real tests, this names every one.
  // BOTH suites. Scanning only tools/test read as clean while argo/test held six tautologies —
  // `assert.equal(hash32('argo'), hash32('argo'))` and five more — which the whole-tree gate
  // found the moment it was pointed at the repository root. A corpus that omits half the corpus
  // is its own instance of verification stopping before the failure point.
  const flagged = []
  for (const [dir, ext] of [[join(REPO, 'tools', 'test'), /\.test\.mjs$/], [join(REPO, 'argo', 'test'), /\.test\.m?js$/]]) {
    for (const f of readdirSync(dir)) {
      if (!ext.test(f)) continue
      const found = findings(readFileSync(join(dir, f), 'utf8'))
      if (found.length) flagged.push(`${f}: ${found.map((x) => `${x.id}@${x.line}`).join(', ')}`)
    }
  }
  assert.deepEqual(flagged, [], 'the hook fires on real tests in this repo')
})

test('the hook itself answers on stdin, is silent when clean, and speaks when not', async (t) => {
  const root = join(tmpdir(), `cgc-bhook-${process.pid}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(root, 'test'), { recursive: true })
  t.after(() => discard(root))

  const clean = join(root, 'test', 'clean.test.mjs')
  writeFileSync(clean, 'import assert from "node:assert"\ntest("t", () => { assert.equal(sum(2, 2), 4) })', 'utf8')
  const bad = join(root, 'test', 'bad.test.mjs')
  writeFileSync(bad, 'import assert from "node:assert"\ntest("t", () => { assert.equal(total(cart), total(cart)) })', 'utf8')

  const call = (file, tool = 'Write') => spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: tool, tool_input: { file_path: file } }),
    encoding: 'utf8', timeout: 30000,
  })

  const quiet = call(clean)
  assert.equal(quiet.status, 0)
  assert.equal(quiet.stdout.trim(), '', 'a clean test file must produce no output at all')

  const loud = call(bad)
  assert.equal(loud.status, 0)
  const out = JSON.parse(loud.stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse')
  assert.match(out.hookSpecificOutput.additionalContext, /CANNOT FAIL/)
  assert.match(out.hookSpecificOutput.additionalContext, /total\(cart\)/)

  // A file that is not a test is none of this hook's business, however weak it is.
  const src = join(root, 'total.mjs')
  writeFileSync(src, 'export const total = (c) => c.reduce((a, b) => a + b, 0)', 'utf8')
  assert.equal(call(src).stdout.trim(), '')

  // And a tool that did not write a file is not a write.
  assert.equal(call(bad, 'Read').stdout.trim(), '')
})

test('malformed input never makes the hook fail a write', () => {
  for (const input of ['', 'not json', '{}', 'null', '[]', '{"tool_name":"Write"}']) {
    const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', timeout: 30000 })
    assert.equal(r.status, 0, `exited ${r.status} on ${JSON.stringify(input)}`)
    assert.equal(r.stdout.trim(), '')
  }
})

test('the hook is registered in the manifest, or it never runs', () => {
  const manifest = JSON.parse(readFileSync(join(REPO, 'config', 'hooks.json'), 'utf8'))
  const commands = JSON.stringify(manifest.hooks.PostToolUse)
  assert.match(commands, /post-tool-behaviour\.js/, 'the hook exists but nothing dispatches it')
})
