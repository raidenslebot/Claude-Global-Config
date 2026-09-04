// The self-similarity measure. Every other gate here judges a design against a fixed list, and
// a list converges: avoid a blacklist and you land where everyone else who avoided it landed;
// score against a menu and the menu becomes the target. This measures something no list can —
// whether a piece looks like the other work beside it — so what it must never do is invent a
// preference. It has no opinion about cream, or about orange. It only says: you did this before.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'
import { signature, compare, judge } from '../distinct.mjs'

const TOOL = join(REPO, 'tools', 'distinct.mjs')

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cgc-distinct-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** A page in one palette, one face, one grammar. */
const page = ({ ground, accent, face, centred = false }) => `<!doctype html><html><head><style>
  body { background: ${ground}; color: #111; font-family: "${face}", serif }
  .accent { color: ${accent} }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr) }
  ${centred ? '.hero { text-align: center }' : '.hero { position: absolute; left: 4rem }'}
</style></head><body><div class="hero"><h1 class="accent">A page</h1></div></body></html>`

test('the ground is read where it is painted, not where it is mentioned most', () => {
  // A ground is declared once and covers everything; an accent repeated in nine rules covers
  // almost nothing. Counting occurrences got this exactly backwards.
  const s = signature(`<style>
    body { background: #efe9dc }
    .a { color: #ff5a1f } .b { border-color: #ff5a1f } .c { fill: #ff5a1f }
    .d { outline-color: #ff5a1f } .e { background: #ff5a1f }
  </style>`)
  assert.ok(s.ground, 'a ground was identified')
  assert.notEqual(s.ground, s.accent, 'the ground is not the accent')
  assert.match(s.accent, /:sat$/, 'the saturated colour is the accent even when the ground is rarer, identified by hue')
})

test('a face named through a token is still the face on the page', () => {
  const s = signature(`<style>:root{--display:Archivo}h1{font-family:var(--display),sans-serif}</style>`)
  assert.deepEqual(s.faces, ['archivo'])
})

test('two pieces in one palette and one face are named as repeats, axis by axis', () => {
  const a = signature(page({ ground: '#efe9dc', accent: '#ff5a1f', face: 'Archivo' }))
  const b = signature(page({ ground: '#f4f1ea', accent: '#e2521a', face: 'Archivo' }))
  const { axes, score } = compare(a, b)
  const named = axes.map((x) => x.axis)
  assert.ok(named.includes('ground'), 'two hand-picked creams are one cream')
  assert.ok(named.includes('accent'), 'two hand-picked oranges are one orange')
  assert.ok(named.includes('type'), 'the shared face is named')
  assert.ok(score >= 3, `three axes is a habit, got ${score}`)
})

test('a genuinely different piece shares nothing worth naming', () => {
  const a = signature(page({ ground: '#efe9dc', accent: '#ff5a1f', face: 'Archivo' }))
  const b = signature(page({ ground: '#0b1e2d', accent: '#7cf5c4', face: 'Fraunces', centred: true }))
  assert.ok(compare(a, b).score <= 1, 'different ground, accent and face is not a repeat')
})

test('a series is a project, not a habit — the verdict looks across folders', (t) => {
  // Three posts in one campaign are SUPPOSED to look alike. Calling that a repeat would be
  // crying wolf at the one place consistency is the entire job.
  const d = scratch(t)
  const series = join(d, 'campaign')
  mkdirSync(series, { recursive: true })
  for (const n of ['post-1', 'post-2', 'post-3']) {
    writeFileSync(join(series, `${n}.html`), page({ ground: '#efe9dc', accent: '#ff5a1f', face: 'Archivo' }), 'utf8')
  }
  const other = join(d, 'other')
  mkdirSync(other, { recursive: true })
  writeFileSync(join(other, 'thing.html'), page({ ground: '#0b1e2d', accent: '#7cf5c4', face: 'Fraunces' }), 'utf8')

  const files = ['post-1', 'post-2', 'post-3'].map((n) => join(series, `${n}.html`)).concat(join(other, 'thing.html'))
  const [first] = judge([join(series, 'post-1.html')], files)
  assert.equal(first.verdict, 'distinct', 'its siblings do not count against it')
  assert.ok(first.sibling && first.sibling.score >= 3, 'but the sibling match is still recorded')
})

test('the same signature in a DIFFERENT project is the habit it exists to catch', (t) => {
  const d = scratch(t)
  const one = join(d, 'brand-one')
  const two = join(d, 'brand-two')
  mkdirSync(one, { recursive: true }); mkdirSync(two, { recursive: true })
  const look = page({ ground: '#efe9dc', accent: '#ff5a1f', face: 'Archivo' })
  writeFileSync(join(one, 'a.html'), look, 'utf8')
  writeFileSync(join(two, 'b.html'), look, 'utf8')
  const [r] = judge([join(one, 'a.html')], [join(one, 'a.html'), join(two, 'b.html')])
  assert.equal(r.verdict, 'repeat')
  assert.ok(r.nearest.axes.length >= 3, 'and it names which axes were repeated')
})

test('one piece and nothing to compare it with says so rather than passing', (t) => {
  // A corpus of one is not evidence of originality, and reporting "distinct" there would be
  // the same false comfort as every other unmeasured pass.
  const d = scratch(t)
  const only = join(d, 'solo')
  mkdirSync(only, { recursive: true })
  writeFileSync(join(only, 'a.html'), page({ ground: '#efe9dc', accent: '#ff5a1f', face: 'Archivo' }), 'utf8')
  const [r] = judge([join(only, 'a.html')], [join(only, 'a.html')])
  assert.equal(r.verdict, 'alone')
})

test('the CLI exits 1 on a repeat and 0 otherwise, and --json carries the axes', (t) => {
  const d = scratch(t)
  const one = join(d, 'one'); const two = join(d, 'two')
  mkdirSync(one, { recursive: true }); mkdirSync(two, { recursive: true })
  const look = page({ ground: '#efe9dc', accent: '#ff5a1f', face: 'Archivo' })
  writeFileSync(join(one, 'a.html'), look, 'utf8')
  writeFileSync(join(two, 'b.html'), look, 'utf8')
  const run = (args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', timeout: 120000 })

  const bad = run([join(one, 'a.html'), '--corpus', d])
  assert.equal(bad.status, 1, bad.stdout + bad.stderr)
  assert.match(bad.stdout, /repeat/)

  const j = JSON.parse(run([join(one, 'a.html'), '--corpus', d, '--json']).stdout)
  assert.equal(j[0].verdict, 'repeat')
  assert.ok(j[0].nearest.axes.some((a) => a.axis === 'ground'))

  // A path that does not exist is an error, not a silent pass.
  assert.equal(run([join(d, 'nope.html')]).status, 2)
})
