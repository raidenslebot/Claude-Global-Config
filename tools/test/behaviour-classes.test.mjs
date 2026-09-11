// The five classes, each demonstrated by the instance that named it.
//
// Every other test in this family checks one module against fixtures its own author chose, which
// is the weaker question — a detector tuned against its own examples always passes. This one asks
// the question that matters: given the five failures as they were actually reported, does the gate
// find them? The fixtures below are those five, transcribed, with nothing added to make them
// easier to catch:
//
//   1. "the header reads a storage-health field that the background-store mirror never supplies"
//   2. "the inventory store recognizes account ownership, but the username handler can persist
//       the old account under the new name" — both modules pass their own tests
//   3. "15 panels across six groups, while the design document describes four coordinated
//       surfaces"
//   4. "comments describe fixes and guarantees that have since changed"; a handoff's "lint clean"
//       claim "does not reproduce here"
//   5. "a successful calculation, a matching source string, a settled screenshot, and an installed
//       overlay are different things"
//
// A check that goes quiet on its own founding instance has been tuned into decoration, and this
// test is what says so.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { discard } from './_teardown.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const GATE = join(REPO, 'tools', 'behaviour.mjs')

function tree(files, t) {
  const root = mkdtempSync(join(tmpdir(), 'cgc-classes-'))
  t.after(() => discard(root))
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, ...rel.split('/'))
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, body, 'utf8')
  }
  return root
}

/** Run the real command, the way a person would, and read its JSON. */
function gate(root, only) {
  const r = spawnSync(process.execPath, [GATE, root, `--only=${only}`, '--json'], { encoding: 'utf8', timeout: 120000 })
  assert.equal(r.status, 0, r.stderr)
  const report = JSON.parse(r.stdout)
  const check = report.checks.find((c) => c.id === only)
  assert.ok(check, `the driver did not run ${only}`)
  assert.equal(check.error, undefined, `${only} threw instead of measuring: ${check.error}`)
  return check
}

test('1. a field the header reads that no producer supplies', (t) => {
  const root = tree({
    'src/background-store.mjs':
      '// The mirror the header reads from.\n'
      + 'export function mirror() {\n'
      + '  return { itemCount: 0, lastSyncedAt: 0 }\n'
      + '}\n',
    'src/header.mjs':
      'const summary = { itemCount: 0, lastSyncedAt: 0 }\n'
      + 'export function headerLine() {\n'
      + '  return `${summary.itemCount} items · ${summary.storageHealth}`\n'
      + '}\n',
  }, t)
  const c = gate(root, 'delivered')
  assert.equal(c.findings.length, 1, JSON.stringify(c.findings, null, 2))
  assert.match(c.findings[0].evidence, /storageHealth/)
  assert.equal(c.findings[0].file, 'src/header.mjs')
})

test('2. two modules that each pass their own tests, with nothing standing the pair up', (t) => {
  const root = tree({
    'src/inventory-store.mjs': 'export function ownerOf(item) { return item.accountId }\nexport function setOwner(item, id) { return { ...item, accountId: id } }\n',
    'src/username-handler.mjs': "import { setOwner } from './inventory-store.mjs'\nexport function rename(item, name) { return setOwner({ ...item, name }, item.accountId) }\n",
    'test/inventory-store.test.mjs': "import { ownerOf } from '../src/inventory-store.mjs'\ntest('owner', () => { assert.equal(ownerOf({ accountId: 7 }), 7) })\n",
    'test/username-handler.test.mjs': "import { rename } from '../src/username-handler.mjs'\ntest('rename', () => { assert.equal(rename({ accountId: 7, name: 'a' }, 'b').name, 'b') })\n",
  }, t)
  const c = gate(root, 'seams')
  const seam = c.findings.find((f) => /username-handler/.test(f.file) || /username-handler/.test(f.evidence))
  assert.ok(seam, `the untested seam was not reported: ${JSON.stringify(c.findings, null, 2)}`)
  assert.match(seam.evidence, /inventory-store/,
    'the finding must name BOTH ends of the seam — that pairing is the whole content of it')
})

test('3. a screen with many surfaces where the design document names four', (t) => {
  const panels = Array.from({ length: 15 }, (_, i) =>
    `    <section class="panel"><h3>Panel ${i + 1}</h3><p>value</p></section>`).join('\n')
  const root = tree({
    'design/directions.md':
      '# Direction\n\nThe screen is four coordinated surfaces: the answer, the evidence, the\n'
      + 'controls, and the history. One actionable instruction, with the explanation a click away.\n',
    'src/dashboard.html':
      `<main>\n  <div class="group">\n${panels}\n  </div>\n</main>\n`,
  }, t)
  const c = gate(root, 'decision')
  assert.ok(c.findings.length >= 1, `nothing reported: ${JSON.stringify(c, null, 2)}`)
  const all = JSON.stringify(c.findings)
  assert.match(all, /15|fifteen/, 'the finding must carry the implementation count it measured')
  assert.match(all, /four|4/, "and the design document's own number, or the comparison says nothing")
})

test('4. a handoff asserting a state of the repo that nothing re-runs', (t) => {
  const root = tree({
    'HANDOFF.md':
      '# Handoff\n\nThe overlay work is complete. Lint is clean and all tests pass on this branch.\n'
      + 'Pick up from the persistence layer.\n',
    'src/overlay.mjs': 'export const show = () => true\n',
  }, t)
  const c = gate(root, 'claims')
  assert.ok(c.findings.length >= 1, `the "lint clean / all tests pass" claim was not reported: ${JSON.stringify(c, null, 2)}`)
  const f = c.findings.find((x) => /HANDOFF/.test(x.file))
  assert.ok(f, 'the finding must point at the document making the claim')
  assert.match(f.evidence, /lint|tests? pass/i, 'the evidence must quote the sentence, not paraphrase it')
})

test('5. a test whose assertions are all stand-ins for the thing', (t) => {
  const root = tree({
    'src/plan.mjs': 'export const total = (rows) => rows.reduce((a, r) => a + r.n, 0)\n',
    'test/plan.test.mjs':
      "import assert from 'node:assert'\n"
      + "import { existsSync } from 'node:fs'\n"
      + "test('the calculation succeeds', () => {\n"
      + '  assert.ok(total([{ n: 1 }]))\n'
      + '})\n'
      + "test('the overlay is installed', () => {\n"
      + "  assert.ok(existsSync('./dist/overlay.js'))\n"
      + '})\n',
    'test/hash.test.mjs':
      "import assert from 'node:assert'\n"
      + "test('the digest is stable', () => {\n"
      + '  assert.equal(digest(payload), digest(payload))\n'
      + '})\n',
  }, t)
  const c = gate(root, 'proxies')
  const all = JSON.stringify(c.findings)
  assert.match(all, /hash\.test/, 'the tautology must be found — it is the one that must never be missed')
  assert.match(all, /plan\.test/, 'a file whose every claim is existence-or-truthiness must be reported')
})

test('the gate answers on an empty tree, a single file, and a tree with no git', (t) => {
  const empty = tree({}, t)
  const r1 = spawnSync(process.execPath, [GATE, empty, '--json'], { encoding: 'utf8', timeout: 120000 })
  assert.equal(r1.status, 0, r1.stderr)
  const rep = JSON.parse(r1.stdout)
  assert.equal(rep.total, 0)
  assert.deepEqual(rep.errored, [], 'no check may throw on an empty tree')
  // Every check must still have answered, with a note — a check that measured nothing and says
  // nothing is indistinguishable from a check that measured everything and found nothing.
  for (const c of rep.checks) assert.ok(c.note || c.scanned > 0, `${c.id} reported neither a count nor a note`)

  const one = tree({ 'src/a.mjs': 'export const x = 1\n' }, t)
  const r2 = spawnSync(process.execPath, [GATE, join(one, 'src', 'a.mjs'), '--json'], { encoding: 'utf8', timeout: 120000 })
  assert.equal(r2.status, 0, r2.stderr)
  assert.deepEqual(JSON.parse(r2.stdout).errored, [])
})

test('--strict is an exit code, and it is 0 only when nothing was found', (t) => {
  const dirty = tree({
    'test/x.test.mjs': "import assert from 'node:assert'\ntest('t', () => { assert.equal(f(1), f(1)) })\n",
  }, t)
  const bad = spawnSync(process.execPath, [GATE, dirty, '--only=proxies', '--strict'], { encoding: 'utf8', timeout: 120000 })
  assert.equal(bad.status, 1, 'a finding under --strict must exit non-zero, or no script can gate on it')

  const clean = tree({ 'test/x.test.mjs': "import assert from 'node:assert'\ntest('t', () => { assert.equal(f(1), 2) })\n" }, t)
  const ok = spawnSync(process.execPath, [GATE, clean, '--only=proxies', '--strict'], { encoding: 'utf8', timeout: 120000 })
  assert.equal(ok.status, 0, ok.stdout + ok.stderr)
})
