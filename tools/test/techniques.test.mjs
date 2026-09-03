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

test('a word in a comment, a variable name or a CSS function is not a technique', () => {
  // Each of these flipped a whole DIMENSION on the headline output from one incidental match.
  const cases = [
    ['const RE = /[A-Z]{2,}/g\nrequire("chalk").red("x")\nprocess.stdout.write("\x1b[38;2;1;2;3m")', '.js', 'frame-loop'],
    ['.hero { background: linear-gradient(#fff, #000) }', '.css', 'gradient-text'],
    ['$(".card").attr("data-id")', '.js', 'data-driven-style'],
    ['// velocity of the camera\nconst ctx = c.getContext("2d")', '.js', 'physics-sim'],
    ['import * as d3 from "d3"; const brush = 5; d3.scaleLog()', '.js', 'interaction-detail'],
    ['import * as THREE from "three"; const s = Math.random()', '.js', 'seeded-scene'],
    ['.c { box-shadow: 0 4px 20px rgba(0,0,0,.08) }', '.css', 'layered-shadow'],
  ]
  for (const [src, ext, id] of cases) {
    assert.ok(!measure(src, { ext }).usedIds.has(id), `${id} must not fire on: ${src.slice(0, 46)}`)
  }
  // And the real thing still does.
  assert.ok(measure('.c { box-shadow: 0 1px 2px rgba(0,0,0,.1), 0 8px 24px rgba(0,0,0,.12) }', { ext: '.css' })
    .usedIds.has('layered-shadow'), 'two stacked shadows ARE a layered shadow')
})

test('a runaway pattern in an extension file is refused, not run', async () => {
  const { safeRe } = await import('../techniques.mjs')
  assert.throws(() => safeRe('(a+)+$'), /nested quantifier/, 'a regex has no timeout, so it cannot be allowed to run')
  assert.throws(() => safeRe('([a-z]*)*x'), /nested quantifier/)
  assert.throws(() => safeRe('x'.repeat(500)), /over 400 characters/)
  assert.ok(safeRe('gl_FragColor|@fragment\b') instanceof RegExp, 'an ordinary pattern is fine')
})

test('one bad medium in an extension file does not take the others with it', async () => {
  const { mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'tech-bad-'))
  mkdirSync(join(dir, '.cgc'), { recursive: true })
  writeFileSync(join(dir, '.cgc', 'techniques.json'), JSON.stringify({
    media: [
      { id: 'good1', label: 'Good one', detect: 'aaa', techniques: [{ id: 't1', dim: 'material', lift: 2, re: 'aaa', what: 'the first one, defined before the bad medium.' }] },
      { id: 'bad', label: 'Bad', detect: '([a-z]+', techniques: [{ id: 't2', dim: 'material', lift: 2, re: 'bbb', what: 'a medium whose detect pattern will not compile at all.' }] },
      { id: 'good2', label: 'Good two', detect: 'ccc', techniques: [{ id: 't3', dim: 'material', lift: 2, re: 'ccc', what: 'the second one, defined after the bad medium.' }] },
    ],
  }), 'utf8')
  const ids = registry(dir).map((m) => m.id)
  assert.ok(ids.includes('good1'), 'the medium before the broken one survives')
  assert.ok(ids.includes('good2'), 'and so does the one after it — a file must not be half applied in silence')
  assert.ok(!ids.includes('bad'), 'the broken one is skipped')
})

test('a directory that contains a loop is walked, not declared missing', async () => {
  const { mkdtempSync, writeFileSync, symlinkSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { spawnSync } = await import('node:child_process')
  const dir = mkdtempSync(join(tmpdir(), 'tech-loop-'))
  writeFileSync(join(dir, 'a.css'), ':root { --x: oklch(0.2 0 0) }', 'utf8')
  try { symlinkSync(dir, join(dir, 'self'), 'junction') } catch { return }  // no privilege: nothing to test
  const r = spawnSync(process.execPath, [TOOL, dir, '--json'], { encoding: 'utf8', timeout: 60000 })
  assert.equal(r.status, 0, `a self-junction must not abort the run: ${r.stderr}`)
  const j = JSON.parse(r.stdout)
  assert.equal(j.files, 1, 'the real file beside the junction is still measured')
})

test('--min wants a number, and says so', () => {
  const bad = spawnSync(process.execPath, [TOOL, TOOL, '--min', 'abc'], { encoding: 'utf8', timeout: 30000 })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /--min wants a number/)
})

test('a note about a technique is not the technique, and a script is a design only if it draws', () => {
  // The comment naming a technique used to count as using it — which put a deck in the print
  // medium because its stylesheet's header quoted the command line that exports it.
  const noted = measure('/* we should use mix-blend-mode: multiply here one day */\n.a{color:#333}', { ext: '.css' })
  assert.equal(noted.usedIds.has('blend'), false)
  assert.ok(measure('.a{mix-blend-mode:multiply}', { ext: '.css' }).usedIds.has('blend'))

  // A quoted sample is a quotation.
  const quoting = measure('<pre><code>.x{backdrop-filter:blur(12px)}</code></pre>', { ext: '.html' })
  assert.equal(quoting.usedIds.has('backdrop'), false)

  // A build script mentioning design words is not a design; one that draws is.
  assert.equal(measure("const msg = 'use a gradient here'\nexport function lint(){}", { ext: '.mjs' }).detected, false)
  assert.equal(measure("const ctx=c.getContext('2d');ctx.beginPath();ctx.arc(1,2,3,0,6.28)", { ext: '.mjs' }).detected, true)
})

test('the width axis counts however it is written, and decided line breaks are typography', () => {
  // font-stretch is the standards-preferred way to drive wdth, and how a real project writes it.
  assert.ok(measure('h1{font-stretch:75%}', { ext: '.css' }).usedIds.has('variable-axes'))
  assert.ok(measure("h1{font-variation-settings:'wdth' 92}", { ext: '.css' }).usedIds.has('variable-axes'))
  assert.ok(measure('h1{text-wrap:balance}p{text-wrap:pretty}', { ext: '.css' }).usedIds.has('wrap-quality'))
})

test('a protocol-relative URL is not a comment, and a comment still is', () => {
  // url(//cdn.example.com/a.css) begins with two slashes. Treating that as a line comment
  // blanked the rest of the line — on a minified stylesheet, the whole file, so a page using
  // half the vocabulary measured as using none of it.
  const oneLine = '@import url(//cdn.example.com/a.css);.x{mix-blend-mode:multiply;background:oklch(60% .2 250)}'
  const ids = measure(oneLine, { ext: '.css' }).usedIds
  assert.ok(ids.has('blend') && ids.has('oklch'), `lost to a URL: ${[...ids]}`)

  // And the thing the blanking is for still works, in both languages that use it.
  assert.equal(measure('float x = 1.0; // domain warping here\n', { ext: '.frag' }).usedIds.has('domain-warp'), false)
  assert.equal(measure('a\n// oklch would be nice one day\nb', { ext: '.css' }).usedIds.has('oklch'), false)
})

// The other direction: what does the measure CREDIT that is not there? An inflated score is
// worse than a low one — it tells a piece it reached further than it did, when the whole point
// is to name what was never tried.
test('a page that uses none of the vocabulary is credited with none of it', () => {
  const cases = [
    ['a page with none of the vocabulary', '.css',
      'body{margin:0;padding:40px;background:#f4f1ea;color:#1d2530;font-family:Georgia,serif}h1{font-size:44px}'],
    ['technique words as class names', '.css',
      '.gradient-free{color:#1d2530}.mask-off{display:block}.blend-in{padding:8px}.perspective-piece{margin:0}'],
    ['technique words in English prose', '.html',
      '<p>The blend of colours here is a gradient of meaning, not a mask over the perspective of the reader.</p>'],
    ['a data attribute that names one', '.html',
      '<div data-effect="conic-gradient" data-note="container-query">plain markup</div>'],
    ['an id and a filename', '.html',
      '<img src="subgrid-diagram.png" id="anchor-position-example" alt="a diagram"><p>About layout.</p>'],
    ['a URL containing the words', '.html',
      '<a href="https://example.com/docs/scroll-driven-animation">Read about scroll-driven animation</a>'],
  ]

  const credited = []
  for (const [name, ext, text] of cases) {
    const used = [...measure(text, { ext }).usedIds]
    if (used.length) credited.push(name + ' → ' + used.join(', '))
  }
  assert.deepEqual(credited, [], 'techniques credited to a page that does not use them')

  // The control, so this cannot pass by the measure having stopped working altogether.
  const real = '.x{mask-image:linear-gradient(#000,transparent);mix-blend-mode:multiply;'
    + 'background:conic-gradient(from 90deg,#b4451f,#e0a33c);container-type:inline-size}'
  const used = measure(real, { ext: '.css' }).usedIds
  for (const id of ['mask', 'blend', 'conic', 'container-query']) assert.ok(used.has(id), id + ' went missing')
})
