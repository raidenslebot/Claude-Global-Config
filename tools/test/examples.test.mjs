// Every worked example ships "in exactly this form": directions written before the artwork, the
// artwork passing the gate for its medium, and the passes or the spec beside it. This holds all
// of them to that, so an example can never rot into the thing the skills warn against.

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { lint as slop } from '../slop-lint.mjs'
import { lint as print } from '../print-lint.mjs'
import { REPO } from '../paths.mjs'

const SKILLS = join(REPO, 'skills')
const examples = readdirSync(SKILLS)
  .map((s) => join(SKILLS, s, 'examples'))
  .filter((d) => existsSync(d))
  .flatMap((d) => readdirSync(d).map((e) => join(d, e)).filter((p) => statSync(p).isDirectory()))

test('there are worked examples, and every one has its directions and its record', () => {
  assert.ok(examples.length >= 6, `expected the six shipped examples, found ${examples.length}`)
  for (const ex of examples) {
    const files = readdirSync(ex)
    assert.ok(files.includes('directions.md'), `${ex} has no directions.md — the protocol must be on disk before the artwork`)
    const record = files.some((f) => /^(review\.md|spec-sheet\.txt|placement-sheet\.txt)$/.test(f))
    assert.ok(record, `${ex} has no review.md, spec sheet or placement sheet`)
    const directions = readFileSync(join(ex, 'directions.md'), 'utf8')
    assert.match(directions, /swap test/i, `${ex}/directions.md never runs the swap test`)
    assert.match(directions, /## Committed|\*\*Committed|Committed/i, `${ex}/directions.md never commits to a direction`)
  }
})

test('every screen example passes slop-lint clean — none is the template', () => {
  for (const ex of examples) {
    for (const f of readdirSync(ex).filter((f) => /\.(html|css)$/.test(f))) {
      const path = join(ex, f)
      const text = readFileSync(path, 'utf8')
      if (/@page\s*\{[^}]*\bsize\s*:\s*[\d.]+\s*(?:in|mm|cm|pt)\b/i.test(text)) continue // paper: print-lint below
      const r = slop(path)
      assert.equal(r.verdict, 'clean', `${path}: ${JSON.stringify(r.findings, null, 1)}`)
    }
  }
})

// The physical pieces, each with the size or method its own directions state.
const PHYSICAL = [
  ['print-design/examples/business-card/front.html', { size: 'business-card-us' }],
  ['print-design/examples/business-card/back.html', { size: 'business-card-us' }],
  ['print-design/examples/poster/poster.html', { size: 'poster-18x24' }],
  ['apparel-design/examples/harbor-swim-club/front-mark.svg', { method: 'screen' }],
  ['apparel-design/examples/harbor-swim-club/back-tide.svg', { method: 'screen' }],
  ['design-fields/examples/harbor-swim-club-identity/mark.svg', {}],
  ['design-fields/examples/harbor-swim-club-identity/mark-high-water.svg', {}],
  ['design-fields/examples/harbor-swim-club-identity/lockup-stacked.svg', { method: 'screen' }],
  ['design-fields/examples/harbor-swim-club-identity/lockup-stacked-reversed.svg', { method: 'screen' }],
]

test('every physical example passes print-lint for its stated method or size', () => {
  for (const [rel, opts] of PHYSICAL) {
    const path = join(SKILLS, ...rel.split('/'))
    assert.ok(existsSync(path), `${rel} is missing`)
    const r = print(path, opts)
    const fails = r.findings.filter((f) => f.level === 'fail')
    assert.deepEqual(fails, [], `${rel}: ${JSON.stringify(fails, null, 1)}`)
  }
})

test('the outlined artwork carries no live text, so it depends on no font', () => {
  for (const rel of ['apparel-design/examples/harbor-swim-club/front-mark.svg', 'design-fields/examples/harbor-swim-club-identity/wordmark.svg',
    'design-fields/examples/harbor-swim-club-identity/lockup-horizontal.svg', 'design-fields/examples/harbor-swim-club-identity/lockup-stacked.svg']) {
    const text = readFileSync(join(SKILLS, ...rel.split('/')), 'utf8')
    assert.ok(!/<text\b/.test(text), `${rel} still has a <text> element`)
    assert.match(text, /<path\b[^>]*\bd="M/, `${rel} has no outlined path`)
  }
})

test('an example that animates has been watched, and says so in its record', () => {
  // Reading a duration is not watching an animation. The tide board passed the slop lint and the
  // technique gate while its animation did not run at all; only the frames showed it. So any
  // example that moves must carry the evidence that someone looked.
  const MOVES = /@keyframes|animation\s*:|animation-timeline\s*:|transition\s*:\s*[a-z-]+\s+\d/i
  for (const ex of examples) {
    const files = readdirSync(ex).filter((f) => /\.(html|css)$/.test(f))
    const animates = files.some((f) => MOVES.test(readFileSync(join(ex, f), 'utf8')))
    if (!animates) continue
    const recordFile = join(ex, 'review.md')
    assert.ok(existsSync(recordFile), `${ex} animates but has no review.md to record the capture`)
    const record = readFileSync(recordFile, 'utf8')
    assert.match(record, /cgc motion/, `${ex} animates and its record never runs cgc motion`)
    assert.match(record, /ease-out|ease-in|ease-in-out|linear|settles at/i,
      `${ex}/review.md records no MEASURED result from the capture — the easing the frames actually showed`)
  }
})

test('an example that animates collapses under reduced motion', () => {
  for (const ex of examples) {
    for (const f of readdirSync(ex).filter((f) => /\.(html|css)$/.test(f))) {
      const text = readFileSync(join(ex, f), 'utf8')
      if (!/@keyframes|animation\s*:/i.test(text)) continue
      assert.match(text, /prefers-reduced-motion/,
        `${join(ex, f)} animates without a reduced-motion branch — for a viewer with a vestibular disorder that is symptoms, not a preference`)
    }
  }
})

test('an example that is generated matches its generator, so hand-edits cannot be lost silently', (t) => {
  // brand-sheet.html is written by generate.mjs. Editing the HTML directly looks like it worked
  // and is reverted the next time anyone runs the generator — the edit is gone and nothing said
  // so. Whatever is checked in has to be what the generator produces.
  const dir = join(REPO, 'skills', 'design-fields', 'examples', 'harbor-swim-club-identity')
  const gen = join(dir, 'generate.mjs')
  if (!existsSync(gen)) return
  const generated = ['brand-sheet.html', 'icon.html', 'wordmark.svg', 'mark-high-water.svg',
    'lockup-horizontal.svg', 'lockup-horizontal-reversed.svg', 'lockup-stacked.svg', 'lockup-stacked-reversed.svg']
  const before = new Map(generated.filter((f) => existsSync(join(dir, f))).map((f) => [f, readFileSync(join(dir, f), 'utf8')]))
  assert.ok(before.size >= 6, 'the generator claims to write these files and they are not there')

  const r = spawnSync(process.execPath, [gen], { cwd: dir, encoding: 'utf8', timeout: 180000 })
  assert.equal(r.status, 0, `the generator does not run: ${r.stderr}`)
  const drifted = []
  for (const [f, was] of before) {
    if (readFileSync(join(dir, f), 'utf8') !== was) drifted.push(f)
  }
  // Put back whatever the run changed, so a failing test does not also rewrite the repo.
  for (const [f, was] of before) writeFileSync(join(dir, f), was, 'utf8')
  assert.deepEqual(drifted, [], 'files edited by hand that generate.mjs would overwrite — make the change in the generator')
})
