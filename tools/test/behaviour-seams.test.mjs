// The seam check. Its whole value is the negative half: any detector that fires on every import
// edge in a tree is a warning nobody reads, and this package has shipped one of those before. So
// every planted defect below is paired with the same tree made clean, and the clean tree must be
// silent — not quieter, silent.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { buildContext } from '../behaviour.mjs'
import { run } from '../behaviour/seams.mjs'
import { discard } from './_teardown.mjs'

/** Write a fixture tree from { 'rel/path': 'contents' } and return its root. */
function tree(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'cgc-seams-'))
  t.after(() => discard(root))
  for (const [rel, src] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, src, 'utf8')
  }
  return root
}

const seams = (root) => run(buildContext([root]))
const pair = (r, a, b) => r.findings.some((f) => f.file === a && f.evidence.includes(b))

// Six real edges over five modules — the shape of the instance that named this class. The store
// knows who owns the stack; the rename handler writes it under the old owner; each has its own
// test and neither test has ever seen the other module.
const SRC = {
  'src/util.mjs': 'export const clamp = (n) => Math.max(0, n)\n',
  'src/store.mjs': "import { clamp } from './util.mjs'\nexport const ownerOf = (id) => clamp(id)\n",
  'src/rename.mjs': "import { ownerOf } from './store.mjs'\nimport { clamp } from './util.mjs'\nexport const rename = (a, b) => ownerOf(a) + clamp(b)\n",
  'src/inventory.mjs': "import { ownerOf } from './store.mjs'\nimport { clamp } from './util.mjs'\nexport const stacks = () => ownerOf(1) + clamp(2)\n",
  'src/clears.mjs': "import { clamp } from './util.mjs'\nexport const clears = () => clamp(3)\n",
}
const UNIT = {
  'test/util.test.mjs': "import { clamp } from '../src/util.mjs'\n",
  'test/store.test.mjs': "import { ownerOf } from '../src/store.mjs'\n",
  'test/rename.test.mjs': "import { rename } from '../src/rename.mjs'\n",
  'test/inventory.test.mjs': "import { stacks } from '../src/inventory.mjs'\n",
  'test/clears.test.mjs': "import { clears } from '../src/clears.mjs'\n",
}

test('two modules that each pass their own tests, with nothing standing the pair up', (t) => {
  const r = seams(tree(t, { ...SRC, ...UNIT }))
  assert.ok(pair(r, 'src/rename.mjs', 'src/store.mjs'), `the planted seam is named, got ${JSON.stringify(r.findings.map((f) => f.file))}`)
  const f = r.findings.find((x) => x.file === 'src/rename.mjs' && x.evidence.includes('src/store.mjs'))
  assert.equal(f.line, 1, 'the line is where the import is, not the top of the file')
  assert.match(f.evidence, /1 test\(s\) drive src\/rename\.mjs, 1 drive src\/store\.mjs, none drives both/)
  assert.equal(r.scanned, 6, 'all six edges were examined')
  assert.match(r.note, /5\/5 tests \(100%\)/, 'the suite is all unit tests and the note says so with the number')
  assert.match(r.note, /cannot detect a seam defect by construction/)
})

test('one test that stands both modules up closes the seam, and the tree goes silent', (t) => {
  const r = seams(tree(t, {
    ...SRC,
    ...UNIT,
    'test/flow.test.mjs': [
      "import { rename } from '../src/rename.mjs'",
      "import { ownerOf } from '../src/store.mjs'",
      "import { stacks } from '../src/inventory.mjs'",
      "import { clears } from '../src/clears.mjs'",
      "import { clamp } from '../src/util.mjs'",
    ].join('\n'),
  }))
  assert.deepEqual(r.findings, [], `one integration test covers every pair, got ${JSON.stringify(r.findings.map((f) => f.evidence))}`)
  assert.equal(r.scanned, 6, 'the edges were still examined — this is silence, not a skip')
})

test('a helper between the test and the module does not hide what the test drives', (t) => {
  const r = seams(tree(t, {
    ...SRC,
    ...UNIT,
    'test/helpers/harness.mjs': "export * from '../../src/rename.mjs'\nexport * from '../../src/store.mjs'\n",
    'test/flow.test.mjs': "import { rename, ownerOf } from './helpers/harness.mjs'\n",
  }))
  assert.ok(!pair(r, 'src/rename.mjs', 'src/store.mjs'), 'the pair reached through a test helper is still a pair')
})

test('a test that runs the module as a child process exercises everything under it', (t) => {
  const r = seams(tree(t, {
    ...SRC,
    ...UNIT,
    'test/cli.test.mjs': [
      "import { spawnSync } from 'node:child_process'",
      "const out = spawnSync(process.execPath, [join(here, 'src', 'rename.mjs'), '--check'])",
    ].join('\n'),
  }))
  assert.ok(!pair(r, 'src/rename.mjs', 'src/store.mjs'), 'a spawned process has no mocks in it; the real store ran')
  assert.ok(!pair(r, 'src/store.mjs', 'src/util.mjs'), 'and so did everything under the store')
  assert.ok(pair(r, 'src/clears.mjs', 'src/util.mjs'), 'a module the spawn never reaches keeps its seam')
  assert.match(r.note, /1 test\(s\) run an own module as a child process/)
})

test('a path literal alone is not a spawn — the test has to run something', (t) => {
  const r = seams(tree(t, {
    ...SRC,
    ...UNIT,
    'test/fixture.test.mjs': "const paths = ['src/rename.mjs', 'src/store.mjs']\n",
  }))
  assert.ok(pair(r, 'src/rename.mjs', 'src/store.mjs'), 'naming two files in an array exercises nothing')
})

test('an erased import and a barrel re-export are not seams', (t) => {
  const ts = {
    'src/util.ts': 'export const clamp = (n: number) => Math.max(0, n)\n',
    'src/types.ts': 'export type Id = string\nexport interface Cfg { id: Id }\nexport const NONE = 0\n',
    'src/store.ts': "import { clamp } from './util.js'\nexport const ownerOf = (id: string) => clamp(id.length)\n",
    'src/rename.ts': "import type { Cfg } from './types.js'\nimport { ownerOf } from './store.js'\nimport { clamp } from './util.js'\nexport const rename = (c: Cfg) => ownerOf(c.id) + clamp(1)\n",
    'src/inventory.ts': "import { type Cfg, type Id } from './types.js'\nimport { ownerOf } from './store.js'\nimport { clamp } from './util.js'\nexport const stacks = (c: Cfg) => ownerOf(c.id) + clamp(2)\n",
    'src/clears.ts': "import { clamp } from './util.js'\nexport const clears = () => clamp(3)\n",
    'src/index.ts': "export * from './store.js'\nexport * from './types.js'\n",
    'test/util.test.ts': "import { clamp } from '../src/util.js'\n",
    'test/types.test.ts': "import { NONE } from '../src/types.js'\n",
    'test/store.test.ts': "import { ownerOf } from '../src/store.js'\n",
    'test/rename.test.ts': "import { rename } from '../src/rename.js'\n",
    'test/inventory.test.ts': "import { stacks } from '../src/inventory.js'\n",
    'test/clears.test.ts': "import { clears } from '../src/clears.js'\n",
    'test/index.test.ts': "import { ownerOf } from '../src/index.js'\n",
  }
  const r = seams(tree(t, ts))
  assert.equal(r.scanned, 6, `only the six imports that run are seam candidates, got ${r.scanned}`)
  assert.ok(!r.findings.some((f) => f.evidence.includes('src/types.ts')), 'a type erased at compile time cannot disagree with anything')
  assert.ok(!r.findings.some((f) => f.file === 'src/index.ts'), 'a barrel re-exports a name, it never calls through it')
  assert.ok(pair(r, 'src/rename.ts', 'src/store.ts'), 'the real import in the same file is still a seam')
})

test('a module nobody tests is missing coverage, which is a different and lesser thing', (t) => {
  const { 'test/rename.test.mjs': _drop, ...unit } = UNIT
  const r = seams(tree(t, { ...SRC, ...unit }))
  assert.ok(!r.findings.some((f) => f.file === 'src/rename.mjs'), 'an untested importer is not reported as a seam')
  assert.match(r.note, /2 uncovered edge\(s\) had an endpoint no test names/)
})

test('one hub does not get to say the same thing ten times', (t) => {
  const files = {
    'src/hub.mjs': 'export const hub = () => 1\n',
    'test/hub.test.mjs': "import { hub } from '../src/hub.mjs'\n",
  }
  for (let i = 0; i < 12; i++) {
    files[`src/leaf${i}.mjs`] = `import { hub } from './hub.mjs'\nexport const leaf${i} = () => hub()\n`
    files[`test/leaf${i}.test.mjs`] = `import { leaf${i} } from '../src/leaf${i}.mjs'\n`
  }
  const r = seams(tree(t, files))
  assert.equal(r.findings.length, 3, `twelve seams into one hub are three lines, got ${r.findings.length}`)
  assert.match(r.note, /9 more seam\(s\) not listed, at most three per imported module/)
})

test('a tree with no tests says that, instead of reporting every edge', (t) => {
  const r = seams(tree(t, SRC))
  assert.deepEqual(r.findings, [])
  assert.match(r.note, /no JavaScript or TypeScript tests in this tree/)
  assert.match(r.note, /6 import edges between 5 own modules/)
})

// The founding instance at its real size. This check shipped with a five-edge minimum and this
// tree has one edge, so the class it is named after was the one thing it could not see. Size is
// context in the note now, never a gate — and if a threshold ever comes back, this test is what
// says so before a user does.
test('the founding instance is two modules and one edge, and is still a seam', (t) => {
  const r = seams(tree(t, {
    'src/inventory-store.mjs': 'export function ownerOf(item) { return item.accountId }\nexport function setOwner(item, id) { return { ...item, accountId: id } }\n',
    'src/username-handler.mjs': "import { setOwner } from './inventory-store.mjs'\nexport function rename(item, name) { return setOwner({ ...item, name }, item.accountId) }\n",
    'test/inventory-store.test.mjs': "import { ownerOf } from '../src/inventory-store.mjs'\n",
    'test/username-handler.test.mjs': "import { rename } from '../src/username-handler.mjs'\n",
  }))
  assert.ok(pair(r, 'src/username-handler.mjs', 'src/inventory-store.mjs'),
    `the founding instance went unreported: ${JSON.stringify(r.findings, null, 2)}`)
  assert.equal(r.scanned, 1)
  assert.match(r.note, /a small sample, though not a gate/, 'the tree size is still stated, it just decides nothing')
})

// The other half of the same coin: one edge, and NOTHING to report, because only one end of it is
// driven by a test. Dropping the size gate must not turn a two-file tree into a warning.
test('a graph too small to have a seam problem says so', (t) => {
  const r = seams(tree(t, {
    'src/a.mjs': "import { b } from './b.mjs'\nexport const a = () => b()\n",
    'src/b.mjs': 'export const b = () => 1\n',
    'test/a.test.mjs': "import { a } from '../src/a.mjs'\n",
  }))
  assert.deepEqual(r.findings, [])
  assert.match(r.note, /only 1 import edge\(s\) between own modules/)
})

test('a package import is not a seam, and an alias is counted rather than guessed at', (t) => {
  const r = seams(tree(t, {
    ...SRC,
    ...UNIT,
    'src/edge.mjs': "import express from 'express'\nimport { x } from '@/nowhere'\nimport { y } from './gone.mjs'\nexport const edge = () => x + y + express\n",
    'test/edge.test.mjs': "import { edge } from '../src/edge.mjs'\n",
  }))
  assert.ok(!r.findings.some((f) => f.evidence.includes('express')), 'somebody else’s package is not an own module')
  assert.match(r.note, /2 specifier\(s\) unresolved/, 'the alias and the missing file are reported as invisible, not silently dropped')
})
