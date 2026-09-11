// The proxies check — a test that measures a stand-in for the thing.
//
// The negative half of every case below is the one that matters. A detector for weak tests can
// be made to fire on any suite at all, and one that does is decoration: it gets muted and then
// the real tautology ships underneath it. So each planted defect here is paired with the clean
// version of the SAME tree, and the clean version must come back silent.
//
// The sharpest of those pairs is `assert.equal(norm('./a/b'), norm('a/b'))`. With string bodies
// blanked — which is how source is searched here — its two arguments are character-for-character
// identical, and reading argument text out of the stripped copy reported it as a tautology. It
// is not one. That is the false positive this check must never produce.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { buildContext } from '../behaviour.mjs'
import { run } from '../behaviour/proxies.mjs'
import { discard } from './_teardown.mjs'

const DRIVER = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'behaviour.mjs')

/** A scratch tree. `files` is a map of relative path -> contents. */
function tree(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'cgc-proxies-'))
  t.after(() => discard(dir))
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, body)
  }
  return dir
}

const check = (dir) => run(buildContext([dir]))
const LIB = "export const head = (s) => s.split('/')[0]\nexport const norm = (s) => s.replace(/^\\.\\//, '')\n"
const HEAD = "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { head, norm } from '../lib.mjs'\n\n"

// ── a. tautology — mandatory, and it must never miss ─────────────────────────────────────────

test('an equality assertion whose two arguments are the same expression is named', (t) => {
  const dir = tree(t, {
    'lib.mjs': LIB,
    'test/w.test.mjs': HEAD + "test('rename keeps the owner', () => {\n  const w = { friend: 'ann/cat' }\n  assert.equal(head(w.friend), head(w.friend))\n})\n",
  })
  const r = check(dir)
  assert.equal(r.findings.length, 1, `exactly the planted one, got ${JSON.stringify(r.findings)}`)
  assert.match(r.findings[0].what, /asserts a value against itself/)
  assert.equal(r.findings[0].line, 5, 'the line is the test declaration, not the assertion inside it')
  assert.match(r.findings[0].evidence, /both arguments read head\(w\.friend\)/, 'the evidence carries the expression, not a restatement')
  assert.match(r.findings[0].fix, /capture the value BEFORE/)
})

test('the same test comparing against a value captured first is clean', (t) => {
  const dir = tree(t, {
    'lib.mjs': LIB,
    'test/w.test.mjs': HEAD + "test('rename keeps the owner', () => {\n  const w = { friend: 'ann/cat' }\n  const before = head(w.friend)\n  rename(w)\n  assert.equal(head(w.friend), before)\n})\n",
  })
  assert.deepEqual(check(dir).findings, [], 'comparing against a value captured before the operation is the fix, not the defect')
})

test('two different string arguments are not a tautology, however they look once literals are blanked', (t) => {
  // With string bodies blanked both arguments read `norm(' ')`. Reading them there instead of
  // out of the real source reported this as a tautology, and it is the opposite — it is the
  // assertion that proves ./a and a normalise to the same thing.
  const dir = tree(t, {
    'lib.mjs': LIB,
    'test/n.test.mjs': HEAD + "test('a leading ./ is collapsed', () => {\n  assert.equal(norm('./a/b'), norm('a/b'))\n})\n",
  })
  assert.deepEqual(check(dir).findings, [], 'different strings are different arguments')
})

test('a jest-style expect(x).toEqual(x) is a tautology too, and expect(x).toEqual(y) is not', (t) => {
  const dir = tree(t, {
    'lib.mjs': LIB,
    'test/a.test.mjs': "import { it, expect } from 'vitest'\nit('is deterministic', () => {\n  expect(scaffold('u', 'p')).toEqual(scaffold('u', 'p'))\n})\n",
    'test/b.test.mjs': "import { it, expect } from 'vitest'\nit('reads the owner', () => {\n  expect(scaffold('u', 'p')).toEqual(scaffold('v', 'p'))\n})\n",
  })
  const r = check(dir)
  assert.equal(r.findings.length, 1)
  assert.equal(r.findings[0].file, 'test/a.test.mjs')
  assert.match(r.findings[0].evidence, /expect\(…\)\.toEqual/)
})

// ── b. no assertion at all ───────────────────────────────────────────────────────────────────

test('a test body with no assertion is named, and one that asserts through a helper is not', (t) => {
  // Named so it does NOT begin with assert/expect/verify. That naming convention is a separate,
  // weaker rule, for a helper IMPORTED from another file whose body cannot be read here; letting
  // it carry this case would mean the body scan — the rule this test is for — proved nothing.
  const helper = "function settled(page) {\n  assert.equal(page.state, 'settled')\n}\n\n"
  const dir = tree(t, {
    'lib.mjs': LIB,
    'test/silent.test.mjs': HEAD + "test('the overlay installs', () => {\n  const page = render('/board')\n  install(page)\n})\n",
    'test/helped.test.mjs': HEAD + helper + "test('the overlay installs', () => {\n  const page = render('/board')\n  install(page)\n  settled(page)\n})\n",
  })
  const r = check(dir)
  assert.equal(r.findings.length, 1, `only the silent one, got ${r.findings.map((f) => f.file).join(', ')}`)
  assert.equal(r.findings[0].file, 'test/silent.test.mjs')
  assert.match(r.findings[0].what, /no assertion/)
  assert.match(r.findings[0].evidence, /0 assert\/expect calls/)
  assert.match(r.findings[0].evidence, /it calls render\(…\)/, 'the evidence names the call that went unchecked')
})

test('a skipped or todo test is not reported — it is not pretending to check anything', (t) => {
  const dir = tree(t, {
    'lib.mjs': LIB,
    'test/skipped.test.mjs': HEAD + "test.skip('the overlay installs', () => {\n  install(render('/board'))\n})\n\ntest.todo('the overlay survives a reload')\n",
  })
  const r = check(dir)
  assert.deepEqual(r.findings, [])
  assert.equal(r.scanned, 0, 'a skipped test is not examined either')
})

// ── c. existence only ────────────────────────────────────────────────────────────────────────

test('a test whose only claim is that a thing is there is named; ok() around a predicate is not', (t) => {
  const dir = tree(t, {
    'lib.mjs': LIB,
    'test/exists.test.mjs': HEAD + "import { existsSync } from 'node:fs'\ntest('the report is written', () => {\n  const p = build()\n  assert.ok(existsSync(p))\n})\n",
    'test/reads.test.mjs': HEAD + "import { readFileSync } from 'node:fs'\ntest('the report names the failing row', () => {\n  const p = build()\n  assert.ok(readFileSync(p, 'utf8').includes('row 42'))\n})\n",
  })
  const r = check(dir)
  assert.equal(r.findings.length, 1, `only the existence-only one, got ${r.findings.map((f) => f.file).join(', ')}`)
  assert.equal(r.findings[0].file, 'test/exists.test.mjs')
  assert.match(r.findings[0].what, /only that a value is there/)
  assert.match(r.findings[0].evidence, /assert\.ok\(existsSync\(p\)\)/)
})

test('toBeDefined alone is existence; toBeTruthy around a predicate is a real claim', (t) => {
  const dir = tree(t, {
    'lib.mjs': LIB,
    'test/def.test.mjs': "import { it, expect } from 'vitest'\nit('passes an abort signal', () => {\n  expect(init(1).signal).toBeDefined()\n})\n",
    'test/pred.test.mjs': "import { it, expect } from 'vitest'\nit('passes an abort signal', () => {\n  expect(init(1).headers.includes('x-abort')).toBeTruthy()\n})\n",
  })
  const r = check(dir)
  assert.equal(r.findings.length, 1)
  assert.equal(r.findings[0].file, 'test/def.test.mjs')
})

test('an existence assertion alongside a real one is not an existence-only test', (t) => {
  const dir = tree(t, {
    'lib.mjs': LIB,
    'test/both.test.mjs': HEAD + "import { existsSync, readFileSync } from 'node:fs'\ntest('the report is written and names the row', () => {\n  const p = build()\n  assert.ok(existsSync(p))\n  assert.match(readFileSync(p, 'utf8'), /row 42/)\n})\n",
  })
  assert.deepEqual(check(dir).findings, [])
})

// ── d. source-text proxy ─────────────────────────────────────────────────────────────────────

test('matching a string in the source of a module the test imports is named', (t) => {
  const dir = tree(t, {
    'lib.mjs': LIB,
    'test/lib.test.mjs': HEAD + "import { readFileSync } from 'node:fs'\ntest('the lock reader is pinned to \"1\"', () => {\n  const src = readFileSync(new URL('../lib.mjs', import.meta.url), 'utf8')\n  assert.match(src, /=== '1'/)\n})\n",
  })
  const r = check(dir)
  assert.equal(r.findings.length, 1, JSON.stringify(r.findings))
  assert.match(r.findings[0].what, /source SAYS, not what it does/)
  assert.match(r.findings[0].evidence, /lib\.mjs/)
  assert.match(r.findings[0].fix, /assert the behaviour/)
})

test('reading prose, or an output the test produced, is not a source-text proxy', (t) => {
  const dir = tree(t, {
    'lib.mjs': LIB,
    'README.md': '# a doc that says `--strict`\n',
    'test/docs.test.mjs': HEAD + "import { readFileSync } from 'node:fs'\ntest('the README documents every flag', () => {\n  const doc = readFileSync(new URL('../README.md', import.meta.url), 'utf8')\n  assert.match(doc, /--strict/)\n})\n",
    'test/out.test.mjs': HEAD + "import { readFileSync } from 'node:fs'\ntest('the renderer writes the caption under the frame', () => {\n  const out = render(join(scratch, 'sheet.html'))\n  assert.match(readFileSync(out, 'utf8'), /frame 3/)\n})\n",
  })
  assert.deepEqual(check(dir).findings, [], 'the subject there is the text, or the output — neither is the module under test')
})

// ── e. snapshot only ─────────────────────────────────────────────────────────────────────────

test('a lone snapshot is a claim about last time; a snapshot plus a real assertion is not', (t) => {
  const dir = tree(t, {
    'lib.mjs': LIB,
    'test/snap.test.mjs': "import { it, expect } from 'vitest'\nit('renders the card', () => {\n  expect(render('/card')).toMatchSnapshot()\n})\n",
    'test/snap2.test.mjs': "import { it, expect } from 'vitest'\nit('renders the card', () => {\n  const out = render('/card')\n  expect(out.title).toBe('Harbor')\n  expect(out).toMatchSnapshot()\n})\n",
  })
  const r = check(dir)
  assert.equal(r.findings.length, 1)
  assert.equal(r.findings[0].file, 'test/snap.test.mjs')
  assert.match(r.findings[0].what, /same as last time/)
})

// ── the guards above, pinned one at a time ───────────────────────────────────────────────────
// Each of the three below was a line in the check that nothing objected to when it was deleted.
// The cases that were SUPPOSED to cover them came back clean for a different reason — a second
// guard, or a shape that never reached the line — so the test passed and the line was free.

test('ok() around a length or a size is a predicate, not an existence check', (t) => {
  // `assert.ok(rows)` is existence. `assert.ok(rows.length)` says the list is not empty, which is
  // a claim about the value. The only thing separating them is the member-name filter, and every
  // other clean case in this file happens to be a CALL, which a later rule rejects anyway.
  const dir = tree(t, {
    'lib.mjs': LIB,
    'test/len.test.mjs': HEAD + "test('the split yields parts', () => {\n  const parts = head('a/b').split('')\n  assert.ok(parts.length)\n})\n",
    'test/bare.test.mjs': HEAD + "test('the split yields parts', () => {\n  const parts = head('a/b').split('')\n  assert.ok(parts)\n})\n",
  })
  const r = check(dir)
  assert.deepEqual(r.findings.map((f) => f.file), ['test/bare.test.mjs'],
    `only the bare reference is existence-only, got ${JSON.stringify(r.findings, null, 1)}`)
})

test('reading the module under test is only a proxy when the assertion matches its TEXT', (t) => {
  // Reading a module's source and asserting something about the FILE — its length, its size — is
  // not this failure class, and the finding's own evidence ("matches text inside lib.mjs") would
  // be false. The text-match requirement is what keeps that evidence honest.
  const dir = tree(t, {
    'lib.mjs': LIB,
    'test/says.test.mjs': HEAD + "import { readFileSync } from 'node:fs'\ntest('the module normalises a leading dot-slash', () => {\n  assert.match(readFileSync(new URL('../lib.mjs', import.meta.url), 'utf8'), /replace/)\n})\n",
    'test/shape.test.mjs': HEAD + "import { readFileSync } from 'node:fs'\ntest('the module stays two exports long', () => {\n  const src = readFileSync(new URL('../lib.mjs', import.meta.url), 'utf8')\n  assert.equal(src.trim().split('\\n').length, 2)\n})\n",
  })
  const r = check(dir)
  assert.deepEqual(r.findings.map((f) => f.file), ['test/says.test.mjs'],
    `only the one matching source text is a source proxy, got ${JSON.stringify(r.findings, null, 1)}`)
  assert.match(r.findings[0].evidence, /matches text inside lib\.mjs/)
})

test('expect.poll and an imported assertXxx helper are assertions, not silence', (t) => {
  // Both were measured on a real Playwright/VS Code suite: 22 of 42 findings there were
  // `expect.poll(…).toBe(…)`, which the paren-after-expect scan could not see, and 9 more called
  // an asserting helper imported from a neighbouring file, where the body is not readable here.
  const dir = tree(t, {
    'lib.mjs': LIB,
    'helpers.mjs': "import assert from 'node:assert/strict'\nexport const assertHeadIs = (s, want) => assert.equal(s.split('/')[0], want)\n",
    'test/poll.spec.mjs': "import { test, expect } from '@playwright/test'\ntest('the bridge settles on the text', async () => {\n  await expect.poll(() => 'ann', { timeout: 20000 }).toBe('ann')\n})\n",
    'test/helper.spec.mjs': "import test from 'node:test'\nimport { assertHeadIs } from '../helpers.mjs'\ntest('the owner survives a rename', () => {\n  assertHeadIs('ann/cat', 'ann')\n})\n",
    'test/hollow.spec.mjs': "import test from 'node:test'\nimport { head } from '../lib.mjs'\ntest('it runs', () => {\n  head('ann/cat')\n})\n",
  })
  const r = check(dir)
  assert.deepEqual(r.findings.map((f) => f.file), ['test/hollow.spec.mjs'],
    `only the genuinely hollow test, got ${JSON.stringify(r.findings, null, 1)}`)
})

// ── mechanics ────────────────────────────────────────────────────────────────────────────────

test('a regex carrying a lone bracket does not throw off the scan that follows it', (t) => {
  // stripLiterals blanks strings and comments but not regex bodies, so `/\(/` leaves a real
  // open paren in the searched copy — enough to lose every brace match after it.
  const dir = tree(t, {
    'lib.mjs': LIB,
    'test/rx.test.mjs': HEAD + "test('an unmatched bracket in a pattern', () => {\n  assert.match('a(b', /\\(/)\n  assert.ok(1 / 2 < 1)\n})\n\ntest('the owner survives', () => {\n  const w = { friend: 'ann/cat' }\n  assert.equal(head(w.friend), head(w.friend))\n})\n",
  })
  const r = check(dir)
  assert.equal(r.scanned, 2, 'both tests were parsed')
  assert.equal(r.findings.length, 1)
  assert.match(r.findings[0].what, /asserts a value against itself/)
})

test('tautologies are ranked ahead of the softer shapes', (t) => {
  const dir = tree(t, {
    'lib.mjs': LIB,
    'test/z-taut.test.mjs': HEAD + "test('the owner survives', () => {\n  const w = { friend: 'a/b' }\n  assert.equal(head(w.friend), head(w.friend))\n})\n",
    'test/a-none.test.mjs': HEAD + "test('the overlay installs', () => {\n  install(render('/board'))\n})\n",
    'test/a-exists.test.mjs': HEAD + "test('the report is written', () => {\n  const r = build()\n  assert.ok(r.path)\n})\n",
  })
  const order = check(dir).findings.map((f) => f.what.replace(/^.*?(asserts|contains|claims)/, '$1'))
  assert.equal(order.length, 3)
  assert.match(order[0], /against itself/, 'tautology first, even though its file sorts last')
  assert.match(order[1], /no assertion/)
  assert.match(order[2], /only that a value is there/)
})

test('a tree with nothing to say says why, and says nothing else', (t) => {
  const only = tree(t, { 'lib.mjs': LIB, 'README.md': '# nothing here\n' })
  const a = check(only)
  assert.deepEqual(a.findings, [])
  assert.equal(a.scanned, 0)
  assert.match(a.note, /no test files/, `"no tests" and "the tests are fine" are different answers, got: ${a.note}`)

  const py = tree(t, { 'lib.mjs': LIB, 'test/test_lib.py': 'def test_head():\n    pass\n' })
  const b = check(py)
  assert.deepEqual(b.findings, [])
  assert.match(b.note, /none in JavaScript or TypeScript/, `got: ${b.note}`)

  const clean = tree(t, {
    'lib.mjs': LIB,
    'test/ok.test.mjs': HEAD + "test('the first segment is the owner', () => {\n  assert.equal(head('ann/cat'), 'ann')\n})\n",
  })
  const c = check(clean)
  assert.deepEqual(c.findings, [])
  assert.equal(c.scanned, 1, 'a clean suite was examined, not skipped')
  assert.match(c.note, /1 JS\/TS test file/)
})

test('the driver reports it under --only=proxies, in text and in json', (t) => {
  const dir = tree(t, {
    'lib.mjs': LIB,
    'test/w.test.mjs': HEAD + "test('rename keeps the owner', () => {\n  const w = { friend: 'ann/cat' }\n  assert.equal(head(w.friend), head(w.friend))\n})\n",
  })
  const txt = spawnSync(process.execPath, [DRIVER, dir, '--only=proxies'], { encoding: 'utf8', timeout: 60000 })
  assert.equal(txt.status, 0)
  assert.match(txt.stdout, /asserts a value against itself/)

  const j = spawnSync(process.execPath, [DRIVER, dir, '--only=proxies', '--json', '--strict'], { encoding: 'utf8', timeout: 60000 })
  assert.equal(j.status, 1, '--strict exits non-zero when something was found')
  const report = JSON.parse(j.stdout)
  const c = report.checks.find((x) => x.id === 'proxies')
  assert.ok(c && !c.error, `the check ran: ${c && c.error}`)
  assert.equal(c.findings.length, 1)
  assert.deepEqual(Object.keys(c.findings[0]).sort(), ['evidence', 'file', 'fix', 'line', 'what'], 'the finding shape the driver prints')
  assert.equal(c.findings[0].file, 'test/w.test.mjs')
})
