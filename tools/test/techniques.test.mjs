// The ambition measure. It answers the question the slop lint cannot: not "what is wrong with
// this piece" but "what did it never try" — measured against the piece's OWN medium, and
// reported as the expressive dimension it never entered rather than as a feature checklist.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MEDIA, DIMS, DIMENSIONS, TECHNIQUES, measure, registry } from '../techniques.mjs'

const TOOL = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'techniques.mjs')

const ASSEMBLED = `
.wrap { display: flex; gap: 24px; padding: 48px; background: #f5f5f5; }
.card { border-radius: 12px; background: #fff; box-shadow: 0 4px 20px rgba(0,0,0,.08); padding: 24px; }
.card h3 { font-size: 20px; font-weight: 600; color: #111; margin-bottom: 8px; }
.card p { font-size: 15px; line-height: 1.6; color: #555; }
.btn { background: #2563eb; color: #fff; border-radius: 8px; padding: 12px 20px; transition: background 200ms ease; }
`

const AMBITIOUS = `
@property --angle { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
:root { --ink: oklch(0.22 0.02 260); --edge: color-mix(in oklab, var(--ink) 14%, transparent);
        --tint: oklch(from var(--ink) 0.96 0.02 h); color-scheme: light dark; }
.host { container-type: inline-size; }
@container (min-width: 34rem) { .card { grid-template-columns: 12rem 1fr } }
.row { display: grid } .card { grid-template-rows: subgrid }
.figure { grid-column: 1 / 8; grid-row: 1 } .panel { grid-column: 6 / 13; grid-row: 1; z-index: 1 }
h1 { font-size: clamp(3rem, 1.6rem + 7vw, 8rem); font-variation-settings: 'opsz' 144, 'GRAD' 40;
     font-optical-sizing: auto; text-wrap: balance; -webkit-text-stroke: 1px var(--ink); }
.fade { mask-image: linear-gradient(to bottom, #000 60%, transparent); }
.head { mix-blend-mode: difference; }
.grain::after { filter: url(#grain); }
.hero-img { view-transition-name: hero; }
.reveal { animation: rise linear both; animation-timeline: view(); }
.item { animation-delay: calc(var(--i) * 45ms); }
@media (prefers-reduced-motion: reduce) { .reveal { animation: none } }
:focus-visible { outline: 2px solid var(--ink); }
`

test('the registry is well formed, and every medium can be reached', () => {
  const ids = MEDIA.map((m) => m.id)
  assert.equal(new Set(ids).size, ids.length, 'medium ids are unique')
  for (const m of MEDIA) {
    assert.ok(m.detect instanceof RegExp && !m.detect.test(''), `${m.id} detects something, and not everything`)
    assert.ok(m.techniques.length >= 8, `${m.id} carries a real vocabulary`)
    const tids = m.techniques.map((t) => t.id)
    assert.equal(new Set(tids).size, tids.length, `${m.id} technique ids are unique`)
    for (const t of m.techniques) {
      assert.ok(DIMS.includes(t.dim), `${m.id}/${t.id} names a real dimension`)
      assert.ok(t.re instanceof RegExp && !t.re.test(''), `${m.id}/${t.id} does not match every file`)
      assert.ok(t.what.length > 40, `${m.id}/${t.id} says what it unlocks, not just its name`)
      assert.ok([1, 2, 3].includes(t.lift))
    }
  }
  for (const d of DIMS) {
    assert.ok(TECHNIQUES.some((t) => t.dim === d), `${d} is expressible somewhere`)
    assert.ok(/[.?]$/.test(DIMENSIONS[d].ask), `${d} asks a question of the piece`)
  }
})

test('a bare bracket or a common word never makes a medium match', () => {
  // The terminal detector once began with an escaped bracket, which matched every file on earth.
  const innocent = 'const a = [1, 2, 3]; const s = "hello"; function draw() { return a.map(x => x) }'
  for (const m of MEDIA) {
    assert.ok(!m.detect.test(innocent), `${m.id} must not claim an ordinary JS file`)
  }
})

test('each medium is measured against its own vocabulary, not against CSS', () => {
  const cases = [
    ['void main(){ gl_FragColor = vec4(fbm(p),0.,0.,1.); }', '.frag', 'shader'],
    ['using UnityEngine; public class P : MonoBehaviour { void Update(){} }', '.cs', 'game'],
    ['import SwiftUI\nstruct V: View { var body: some View { Text("hi") } }', '.swift', 'native'],
    ['import * as d3 from "d3"; d3.scaleLog();', '.js', 'dataviz'],
    ['<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>', '.svg', 'svg'],
    ['const ctx = c.getContext("2d"); ctx.fillRect(0,0,1,1)', '.js', 'canvas'],
    ['@page { size: 3.5in 2in } .a { color: pantone 185 }', '.css', 'print'],
  ]
  for (const [src, ext, expect] of cases) {
    const m = measure(src, { ext })
    assert.ok(m.media.some((x) => x.id === expect), `${ext} should be measured as ${expect}, got ${m.media.map((x) => x.id).join('+')}`)
  }
})

test('a page built from defaults is assembled, and every dimension is named as unentered', () => {
  const m = measure(ASSEMBLED, { ext: '.css' })
  assert.equal(m.verdict, 'assembled')
  assert.ok(m.count <= 1, `expected 0–1, got ${m.count}: ${[...m.usedIds].join(',')}`)
  assert.equal(m.untouched.length, DIMS.length, 'it entered none of them')
  assert.equal(m.count, 0, `a single rgba shadow is not a layered one: ${[...m.usedIds].join(',')}`)
  assert.ok(m.missing.length > 30)
})

test('a page that reaches is ambitious, and the detections are the real ones', () => {
  const m = measure(AMBITIOUS, { ext: '.css' })
  assert.equal(m.verdict, 'ambitious')
  for (const id of ['typed-property', 'oklch', 'color-mix', 'relative-color', 'container-query',
    'subgrid', 'grid-overlap', 'fluid-type', 'variable-axes', 'optical-sizing', 'text-stroke',
    'mask', 'blend', 'svg-filter', 'view-transition', 'scroll-driven', 'stagger',
    'reduced-motion', 'focus-visible', 'theme-variation']) {
    assert.ok(m.usedIds.has(id), `should detect ${id}`)
  }
  assert.ok(m.untouched.length <= 1, `should have entered nearly every dimension, missed ${m.untouched.join(',')}`)
})

test('breaking the box counts however it is written, and hiding is not breaking', () => {
  const shared = measure('.a { grid-row: 1 } .b { grid-row: 1; z-index: 1 }', { ext: '.css' })
  assert.ok(shared.usedIds.has('grid-overlap'), 'two children sharing a grid row')
  const bleed = measure('.datum { position: absolute; left: 0; right: -8%; bottom: 40% }', { ext: '.css' })
  assert.ok(bleed.usedIds.has('grid-overlap'), 'an absolutely positioned child breaking its container')
  const hidden = measure('.sr-only { position: absolute; left: -9999px; top: auto }', { ext: '.css' })
  assert.ok(!hidden.usedIds.has('grid-overlap'), 'the screen-reader hiding trick is not a composition')
})

test('detection does not fire on words that merely look similar', () => {
  const decoys = `
    /* a comment about masking data and blending teams */
    .x { color: #123456; background: linear-gradient(#fff, #000); }
    const hasAccess = user.has_access;
    function scroll() {}
    const spring = new Date();
  `
  const m = measure(decoys, { ext: '.css' })
  for (const id of ['mask', 'blend', 'scroll-driven', 'oklch', 'has']) {
    assert.ok(!m.usedIds.has(id), `${id} must not fire on a lookalike`)
  }
})

test('an unentered dimension is only reported when the medium can express it', () => {
  // Print cannot be asked about frame feedback, and is not asked about it.
  const m = measure('@page { size: 3.5in 2in } .a { color: pantone 185; }', { ext: '.css' })
  const expressible = new Set(m.missing.concat(m.used).map((t) => t.dim))
  for (const d of m.untouched) assert.ok(expressible.has(d), `${d} was reported but nothing here can express it`)
})

test('the suggestions widen the dimensions the piece has touched least', () => {
  const typeOnly = `h1 { font-variation-settings: 'opsz' 32; font-variant-numeric: tabular-nums;
    font-size: clamp(2rem, 5vw, 4rem); text-wrap: balance; -webkit-text-stroke: 1px #000; }`
  const m = measure(typeOnly, { ext: '.css' })
  assert.ok(m.byDim.type >= 4)
  const firstFive = m.missing.slice(0, 5).map((t) => t.dim)
  assert.ok(!firstFive.includes('type'), `should not suggest more type first, got ${firstFive.join(',')}`)
})

test('the registry is extended by JSON, without touching the tool', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-ext-'))
  mkdirSync(join(dir, '.cgc'), { recursive: true })
  writeFileSync(join(dir, '.cgc', 'techniques.json'), JSON.stringify({
    media: [
      { id: 'loom', label: 'weaving', detect: 'warp|weft', techniques: [
        { id: 'double-cloth', dim: 'depth', lift: 3, re: 'double ?cloth', what: 'two interlinked layers woven at once, so the reverse is a second design.' },
      ] },
      // And an addition to a medium that already ships.
      { id: 'web', label: 'web / CSS', detect: '<style', techniques: [
        { id: 'house-rule', dim: 'material', lift: 2, re: '--house-', what: 'the house token set that every page in this project is built from.' },
      ] },
    ],
  }), 'utf8')
  const reg = registry(dir)
  assert.ok(reg.some((m) => m.id === 'loom'), 'a brand new medium is registered')
  const web = reg.find((m) => m.id === 'web')
  assert.ok(web.techniques.some((t) => t.id === 'house-rule'), 'an addition merges into a shipped medium')
  assert.ok(web.techniques.some((t) => t.id === 'oklch'), 'and does not replace what shipped')
  const m = measure('warp and weft, in double cloth', { cwd: dir })
  assert.ok(m.usedIds.has('double-cloth'), 'the new medium is measured with its own vocabulary')
})

test('a broken extension file is ignored rather than fatal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-bad-'))
  mkdirSync(join(dir, '.cgc'), { recursive: true })
  writeFileSync(join(dir, '.cgc', 'techniques.json'), '{ this is not json', 'utf8')
  assert.equal(registry(dir).length, MEDIA.length)
})

function run(args, body, ext = '.css') {
  const dir = mkdtempSync(join(tmpdir(), 'tech-'))
  if (body !== undefined) writeFileSync(join(dir, 'page' + ext), body, 'utf8')
  const argv = args.map((a) => (a === '@' ? join(dir, 'page' + ext) : a))
  return spawnSync(process.execPath, [TOOL, ...argv], { encoding: 'utf8', timeout: 20000 })
}

test('the command reports, and its exit code is usable as a gate', () => {
  const help = run(['--help'])
  assert.equal(help.status, 0, '--help exits 0')
  assert.match(help.stdout, /cgc techniques/)

  const media = run(['--media'])
  assert.equal(media.status, 0)
  for (const m of MEDIA) assert.ok(media.stdout.includes(m.label), `--media lists ${m.label}`)

  const missing = spawnSync(process.execPath, [TOOL, join(tmpdir(), 'definitely-not-here-9271')], { encoding: 'utf8', timeout: 20000 })
  assert.equal(missing.status, 1, 'a path that does not exist is a failure, not a pass')

  const plain = run(['@'], ASSEMBLED)
  assert.equal(plain.status, 0, 'with no floor set, reporting is not failing')
  assert.match(plain.stdout, /assembled/)
  assert.match(plain.stdout, /dimensions it never entered/)

  assert.equal(run(['@', '--min', '6'], ASSEMBLED).status, 1, '--min turns it into a gate')
  assert.equal(run(['@', '--min', '6'], AMBITIOUS).status, 0, 'a piece above the floor passes')

  const json = run(['@', '--json'], AMBITIOUS)
  assert.equal(json.status, 0)
  const out = JSON.parse(json.stdout)
  assert.equal(out.verdict, 'ambitious')
  assert.ok(out.count >= 9 && out.pool > out.count)
  assert.ok(out.missing.every((m) => m.what && m.dim))
  assert.ok(Array.isArray(out.untouched))
})

// Every technique must be detectable by code someone would actually write. Writing these
// fixtures found five dead patterns: a terminal detector that matched any "[", two escape
// sequences that only matched when written as one literal string, a fluid-type rule that
// missed the token form (which is the better practice), and a shadow rule that counted the
// commas inside rgba(). A vocabulary nobody can trigger is worse than no vocabulary, because
// it reports the piece as empty and the author believes it.
test('every technique in every medium is triggered by a realistic fixture', async () => {
  const { readdirSync, readFileSync, existsSync } = await import('node:fs')
  const { join, extname } = await import('node:path')
  const { REPO } = await import('../paths.mjs')
  const base = join(REPO, 'tools', 'test', 'fixtures', 'media')

  for (const medium of MEDIA) {
    const dir = join(base, medium.id)
    assert.ok(existsSync(dir), `${medium.id} has no fixture — a new medium ships with one, or nothing proves its patterns fire`)
    const files = readdirSync(dir)
    assert.ok(files.length, `${dir} is empty`)
    const text = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
    const ext = files.map((f) => extname(f)).join('\n')
    const m = measure(text, { ext })

    assert.ok(m.media.some((x) => x.id === medium.id),
      `the ${medium.id} fixture is not detected as ${medium.id} (got ${m.media.map((x) => x.id).join('+')})`)

    const missing = medium.techniques.filter((t) => !m.usedIds.has(t.id)).map((t) => t.id)
    assert.deepEqual(missing, [],
      `${medium.id}: no realistic code triggers ${missing.join(', ')} — either the pattern is dead or the fixture must grow`)
  }
})

test('a fixture directory belongs to a medium that exists', async () => {
  const { readdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { REPO } = await import('../paths.mjs')
  const ids = new Set(MEDIA.map((m) => m.id))
  for (const dir of readdirSync(join(REPO, 'tools', 'test', 'fixtures', 'media'))) {
    assert.ok(ids.has(dir), `fixtures/media/${dir} names no medium — rename it or remove it`)
  }
})

test('a file ABOUT design is not mistaken for a design', async () => {
  // This tool contains every marker it looks for, as regex source; so do linters, catalogues
  // and docs generators. A real piece spans two or three media, so the count is the tell.
  // The subject is the catalogue itself, which makes the test self-verifying.
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { REPO } = await import('../paths.mjs')
  const self = readFileSync(join(REPO, 'tools', 'techniques.mjs'), 'utf8')
  const m = measure(self, { ext: '.mjs' })
  assert.ok(m.media.length >= 5, `it does match many media, which is the point (got ${m.media.length})`)
  assert.equal(m.detected, false, 'and it must never be reported at anyone as a design')
})

test('a real piece spanning a few media is still detected', () => {
  // A page with inline SVG and a print stylesheet is three, and entirely normal.
  const page = '<style>@page{size:3.5in 2in}:root{--a:oklch(0.2 0 0)}</style><svg><path d="M0 0"/></svg>'
  const m = measure(page, { ext: '.html' })
  assert.ok(m.media.length >= 2 && m.media.length < 5)
  assert.equal(m.detected, true)
})
