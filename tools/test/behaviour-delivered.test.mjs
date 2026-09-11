// delivered — a value is computed and the person never receives it, in both directions: a
// property read that nothing supplies (a guaranteed undefined), and a field written to a local
// record that nothing reads back. The important half of every case below is the CLEAN twin: this
// class of check earns its keep by staying silent when the producer and consumer actually agree,
// because the whole failure mode of a producer/consumer gate is firing on every object in the tree.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'
import { buildContext } from '../behaviour.mjs'
import { run } from '../behaviour/delivered.mjs'
import { discard } from './_teardown.mjs'

const TOOL = join(REPO, 'tools', 'behaviour.mjs')

/** Write a { relPath: source } map into a fresh temp tree and hand back its root. */
function tree(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'cgc-delivered-'))
  t.after(() => discard(dir))
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, body, 'utf8')
  }
  return dir
}

const scan = (dir) => run(buildContext([dir]))
const reads = (r) => r.findings.filter((f) => /is read that nothing/.test(f.what)).map((f) => f.evidence)
const writes = (r) => r.findings.filter((f) => /never read back/.test(f.what)).map((f) => f.evidence)

// ── direction (a): read, never written ────────────────────────────────────────────────────────

test('a field read off a locally-built record that nothing supplies is found', (t) => {
  const dir = tree(t, {
    'header.js': `export function build(owner) {
  const mirror = { ownerName: owner, itemCount: 0 };
  mirror.itemCount = count(owner);
  return render(mirror.ownerName, mirror.itemCount, mirror.diskHealthPct);
}`,
  })
  const r = scan(dir)
  assert.ok(reads(r).some((e) => /diskHealthPct/.test(e)), `expected diskHealthPct, got ${JSON.stringify(r.findings)}`)
})

test('the same record with the field supplied fires nothing', (t) => {
  const dir = tree(t, {
    'header.js': `export function build(owner) {
  const mirror = { ownerName: owner, itemCount: 0, diskHealthPct: 100 };
  mirror.itemCount = count(owner);
  return render(mirror.ownerName, mirror.itemCount, mirror.diskHealthPct);
}`,
  })
  assert.deepEqual(scan(dir).findings, [], 'a supplied field is not a defect')
})

test('a field read off an object the tree never CONSTRUCTS is left alone', (t) => {
  // `res` is a Node response — the tree sets properties on it but never made it, so a read of a
  // real API field it does not happen to name is not this tree's bug.
  const dir = tree(t, {
    'srv.js': `export function handler(res) {
  res.statusText = 'ok';
  if (!res.headersSentAlready) res.writeHead(200);
  res.end();
}`,
  })
  assert.deepEqual(reads(scan(dir)), [], 'a property of an unconstructed object is out of scope')
})

test('a field supplied in ANOTHER file keeps the read quiet', (t) => {
  const dir = tree(t, {
    'a.js': `export function build(o) { const m = { ownerName: o, spinRate: 0 }; return show(m.ownerName, m.spinRate); }`,
    'b.js': `export function make() { const rec = { label: 'x', spinRate: 9 }; return rec.label + rec.spinRate; }`,
  })
  assert.deepEqual(reads(scan(dir)), [], 'spinRate is supplied somewhere, so nothing is guaranteed-undefined')
})

test('a caller-supplied options bag defaulted with {} is not a constructed record', (t) => {
  // `function f(options = {})` then `options.onPoll` — the empty-literal default does NOT make
  // this file the constructor of `options`; its fields come from whatever the caller passed. An
  // earlier version counted `= {}` as construction and reported every option field as unwritten.
  const dir = tree(t, {
    'flow.js': `export function run(provider, options = {}) {
  if (options.onWaiting) options.onWaiting();
  return poll(provider, options.pollIntervalMs);
}`,
  })
  assert.deepEqual(reads(scan(dir)), [], 'an option bag defaulted with {} is the caller\'s, not ours')
})

// ── direction (b): written, never read ────────────────────────────────────────────────────────

test('a field set on a contained local record and never read back is found', (t) => {
  const dir = tree(t, {
    'sum.js': `export function summarize(rows) {
  const acc = { totalRows: 0, failureCount: 0, retryBudgetLeft: 3 };
  acc.totalRows = rows.length;
  acc.failureCount = rows.filter((r) => r.bad).length;
  return acc.totalRows + acc.failureCount;
}`,
  })
  assert.ok(writes(scan(dir)).some((e) => /retryBudgetLeft/.test(e)), `expected retryBudgetLeft, got ${JSON.stringify(scan(dir).findings)}`)
})

test('the same record with the field read back fires nothing', (t) => {
  const dir = tree(t, {
    'sum.js': `export function summarize(rows) {
  const acc = { totalRows: 0, failureCount: 0, retryBudgetLeft: 3 };
  acc.totalRows = rows.length;
  acc.failureCount = rows.filter((r) => r.bad).length;
  return acc.totalRows + acc.failureCount + acc.retryBudgetLeft;
}`,
  })
  assert.deepEqual(scan(dir).findings, [], 'a field read back off the record is not a defect')
})

test('a record that ESCAPES its scope is never a write-side finding', (t) => {
  // Spread and return both hand the whole object to a consumer this scan cannot follow, so a field
  // it does not dot locally may well be received wholesale. This is the guard that stopped the
  // check firing on every serialized payload and typed result in a real tree.
  const spread = tree(t, {
    'p.js': `export function probe(size, extra) {
  const base = { okFlag: true, sizeBytes: size, sizeLabel: 'x' };
  return { ...base, kindName: extra };
}`,
  })
  assert.deepEqual(writes(scan(spread)).filter((e) => /sizeBytes|sizeLabel/.test(e)), [], 'a spread record escapes')

  const returned = tree(t, {
    'q.js': `export function probe(size) {
  const base = { okFlag: true, sizeBytes: size, sizeLabel: 'x' };
  return base;
}`,
  })
  assert.deepEqual(writes(scan(returned)), [], 'a returned record escapes')

  // Neither fixture above reaches the escape guard: both bags are dotted fewer than twice, so the
  // "at least two siblings read back" rule rejects them first and the escape rule is never asked.
  // Deleting `b.escaped ||` left both of them passing. This is the shape that needs it — two
  // siblings read off the bag, and only THEN is the whole bag handed on, where the field this
  // scan never sees dotted may well be the one the consumer wants.
  const passedOn = tree(t, {
    'r.js': `export function probe(size) {
  const base = { okFlag: true, sizeBytes: size, sizeLabel: 'x' };
  record(base.okFlag);
  record(base.sizeBytes);
  send(base);
}`,
  })
  assert.deepEqual(writes(scan(passedOn)), [],
    'a bag read twice and then handed to a consumer still escapes — the guard, not the sibling count, is what says so')

  // An exported record is the widest escape of all: its reader may be in another module here, or
  // in a package this tree does not contain. Found on a real design-token file, where the finding
  // said "CLIP never leaves this scope" with `export` on the same line as the declaration.
  const exported = tree(t, {
    'tokens.js': `export const CLIP = {
  panelShape: 'var(--clip-panel)',
  cardShape: 'var(--clip-card)',
  cardAltShape: 'var(--clip-card-alt)',
};
export const panel = () => CLIP.panelShape;
export const card = () => CLIP.cardShape;`,
  })
  assert.deepEqual(writes(scan(exported)), [],
    'an exported record is this module\'s public surface, not a contained one')
})

// ── scope and noise ─────────────────────────────────────────────────────────────────────────

test('a name spoken in a comment is not reported', (t) => {
  const dir = tree(t, {
    'sum.js': `export function summarize(rows) {
  // retryBudgetLeft is intentionally reserved for a later change
  const acc = { totalRows: 0, failureCount: 0, retryBudgetLeft: 3 };
  acc.totalRows = rows.length;
  acc.failureCount = rows.length;
  return acc.totalRows + acc.failureCount;
}`,
  })
  assert.deepEqual(writes(scan(dir)), [], 'a field explained in prose has a life the scan cannot follow')
})

test('single-word field names are out of scope', (t) => {
  const dir = tree(t, {
    'h.js': `export function build(o) { const rec = { alpha: o, count: 0 }; rec.count = 1; return render(rec.alpha, rec.count, rec.health); }`,
  })
  assert.deepEqual(reads(scan(dir)), [], 'single-word "health" is not considered even off a valid receiver')
})

test('a non-brace tree returns zero findings and says why', (t) => {
  const dir = tree(t, {
    'calc.py': `def score(drv):
    weight = 0.0
    if drv.present:
        weight = 0.55  # a plain local that x=y makes indistinguishable from a write
    total = weight * 2
    return total`,
  })
  const r = scan(dir)
  assert.deepEqual(r.findings, [], 'Python is out of scope by design')
  assert.match(r.note, /non-brace|other languages/i, 'the note explains the silence')
})

test('read-never-written is ordered before written-never-read', (t) => {
  const dir = tree(t, {
    'both.js': `export function a(o) { const mir = { ownerName: o, itemCount: 0 }; mir.itemCount = 1; return show(mir.ownerName, mir.itemCount, mir.ghostField); }
export function b(rows) { const acc = { hitCount: 0, missCount: 0, deadWeight: 9 }; acc.hitCount = rows.length; acc.missCount = 0; return acc.hitCount + acc.missCount; }`,
  })
  const r = scan(dir)
  assert.ok(r.findings.length >= 2, `expected both directions, got ${JSON.stringify(r.findings)}`)
  assert.match(r.findings[0].what, /is read that nothing/, 'the guaranteed-undefined comes first')
  assert.match(r.findings.at(-1).what, /never read back/, 'the dropped computation comes last')
})

test('the CLI runs the check end to end and emits valid JSON', (t) => {
  const dir = tree(t, {
    'h.js': `export function build(o) { const rec = { ownerName: o, itemCount: 0 }; rec.itemCount = 1; return show(rec.ownerName, rec.itemCount, rec.diskHealthPct); }`,
  })
  const p = spawnSync(process.execPath, [TOOL, dir, '--only=delivered', '--json'], { encoding: 'utf8', timeout: 60000 })
  assert.equal(p.status, 0, p.stderr)
  const report = JSON.parse(p.stdout)
  const check = report.checks.find((c) => c.id === 'delivered')
  assert.ok(check && !check.error, 'the check ran')
  assert.ok(check.findings.some((f) => /diskHealthPct/.test(f.evidence)), 'the CLI surfaces the finding')
})

// ── the two regressions that actually happened ────────────────────────────────────────────────

test('every shorthand property is a producer, not every OTHER one', (t) => {
  // The regex that registered producers consumed its closing delimiter, so in
  // `{ root, files, git, inGit, isTestPath }` the comma that ended one name was no longer
  // available to open the next: root, git and isTestPath registered and files and inGit did not.
  // `ctx.inGit`, supplied three lines away in that very literal, was reported as a field nothing
  // in the tree ever writes — the first finding this check ever produced, and it was wrong.
  const dir = tree(t, {
    'ctx.js': 'const root = 1\nconst files = 2\nconst git = 3\nconst inGit = 4\nconst isTestPath = 5\n'
      + 'export const make = () => ({ root, files, git, inGit, isTestPath })\n',
    'use.js': 'const context = { root: 0, files: 0, git: 0, inGit: 0, isTestPath: 0 }\n'
      + 'export const go = () => [context.root, context.files, context.git, context.inGit, context.isTestPath]\n',
  })
  assert.deepEqual(reads(scan(dir)), [], 'all five names are supplied; none of them is an orphan read')
})

test('a value read through a ${…} hole is code, not string decoration', (t) => {
  // stripLiterals blanked template literals whole, interpolations included — so the header case
  // that NAMED this class, `${summary.storageHealth}`, was invisible to the check written for it.
  const dir = tree(t, {
    'header.js': 'const summary = { itemCount: 0, lastSyncedAt: 0 }\n'
      + 'export const line = () => `${summary.itemCount} items · ${summary.storageHealth}`\n',
  })
  assert.deepEqual(reads(scan(dir)).map((e) => e.split(' ')[0]), ['summary.storageHealth'])
  // …and the surrounding literal text is still not code: a word in the string cannot be a finding.
  const quiet = tree(t, {
    'header.js': 'const summary = { itemCount: 0 }\nexport const line = () => `${summary.itemCount} storageHealth items`\n',
  })
  assert.deepEqual(reads(scan(quiet)), [])
})

test('a one- or two-character receiver is skipped, and that is a decision with an author', (t) => {
  // `e.target`, `s.length`, `m.index` — a short binding is almost always a loop or callback
  // variable over data built somewhere this check cannot see. The SAME code under a real name IS
  // reported, which is what makes this a rule rather than a hole.
  const short = tree(t, { 'g.js': 'const s = { ownerName: "ada" }\nexport const go = () => s.ownerName + s.storageHealth\n' })
  assert.deepEqual(reads(scan(short)), [])
  const named = tree(t, { 'g.js': 'const store = { ownerName: "ada" }\nexport const go = () => store.ownerName + store.storageHealth\n' })
  assert.deepEqual(reads(scan(named)).map((e) => e.split(' ')[0]), ['store.storageHealth'])
})

test('the note states the read side\'s blind spot, or its silence reads as a clean bill of health', (t) => {
  const dir = tree(t, { 'f.js': 'export function render(store) {\n  return store.ownerName + store.storageHealth\n}\n' })
  const r = scan(dir)
  assert.deepEqual(reads(r), [], 'a parameter could be handed anything by a caller outside this tree')
  assert.match(r.note, /construct/i)
  assert.match(r.note, /parameter|provenance|receiver/i,
    'the note must say that a receiver this file did not build as a literal is not followed')
})
