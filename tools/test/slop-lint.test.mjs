// slop-lint is the gate against the centroid: a page that looks like every AI-made page is
// named as such before it is shown. Each case plants one fingerprint and asserts it is named
// with its line — and that a page that made decisions passes, because a gate with false
// positives is the first hook a user deletes.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { lintText, lint, hsl, FAMILIES, MAX_SCORE } from '../slop-lint.mjs'
import { REPO } from '../paths.mjs'

const ids = (r) => r.findings.map((f) => f.id)
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'slop-lint-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

// The template, as Tailwind writes it. Every fingerprint the lint knows, in one page.
const SLOP = `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600" rel="stylesheet">
<style>body{font-family:Inter,system-ui,sans-serif;color:#333}.muted{color:#888}.rule{border-color:#ccc}.card{background:#eee}</style></head>
<body class="bg-gray-900 text-gray-400">
<div class="absolute -top-40 left-1/2 h-96 w-96 rounded-full bg-purple-500 opacity-30 blur-3xl"></div>
<section class="text-center py-24">
  <h1 class="text-5xl font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">Supercharge your workflow</h1>
  <p class="mx-auto max-w-2xl">Lightning-fast, seamless collaboration for modern teams. Trusted by thousands.</p>
  <a class="rounded-full px-6 py-3 shadow-lg hover:scale-105 transition-all">Get started for free</a>
  <button class="rounded-full px-6 py-3 shadow-lg hover:scale-105 transition-all">Book a demo</button>
</section>
<section class="grid grid-cols-3 gap-6">
  <div class="card rounded-2xl shadow-xl backdrop-blur-lg bg-white/10 border border-gray-800 transition-all"><h3>🚀 Fast</h3></div>
  <div class="card rounded-2xl shadow-xl backdrop-blur-lg bg-white/10 border border-gray-800"><h3>✨ Simple</h3></div>
  <div class="card rounded-2xl shadow-xl backdrop-blur-lg bg-white/10 border border-gray-800"><h3>🎯 Focused</h3></div>
  <div class="rounded-xl"></div><div class="rounded-xl"></div><div class="rounded-3xl"></div>
</section>
<p>Lorem ipsum dolor sit amet.</p>
</body></html>`

// A page that made decisions: a chosen display face, neutrals with a hue, a left edge, one
// colour used once, copy in its own voice. It has a card class and a transition — those are
// not sins on their own.
const DESIGNED = `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,300&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>
:root { --paper: oklch(0.97 0.012 80); --ink: oklch(0.22 0.02 60); --signal: oklch(0.55 0.17 25); }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: "JetBrains Mono", ui-monospace, monospace; }
h1 { font-family: Fraunces, Georgia, serif; font-style: italic; font-weight: 300; font-size: clamp(3rem, 10vw, 11rem); line-height: 0.9; letter-spacing: -0.02em; margin: 0; text-wrap: balance; }
.ledger { max-width: 68ch; }
.ledger div { display: flex; align-items: baseline; border-bottom: 0.5px solid oklch(0.22 0.02 60 / 0.25); }
.ledger .l { flex: 1; border-bottom: 1px dotted currentColor; margin: 0 0.6em; transform: translateY(-0.3em); }
.card { transition: border-color 160ms ease-out; }
.mark { color: var(--signal); }
</style></head>
<body>
<h1>A standard nobody checks is a <s>preference</s> <span class="mark">gate</span>.</h1>
<div class="ledger">
  <div><span>Prerequisites</span><span class="l"></span><span>3 ok</span></div>
  <div><span>Hooks</span><span class="l"></span><span>19 ok</span></div>
  <div class="card"><span>Context cost</span><span class="l"></span><span>3,412 of 4,000</span></div>
</div>
<p>Thirty-four checks. Zero warnings. It says so on every start, or it says what broke.</p>
</body></html>`

test('the template scores as the centroid and every fingerprint in it is named with a line', () => {
  const r = lintText(SLOP, 'slop.html')
  assert.equal(r.verdict, 'centroid', JSON.stringify(r.findings, null, 1))
  for (const id of ['type-default', 'gradient-purple', 'glass', 'three-grid', 'hero-centroid', 'pill-and-shadow', 'emoji-icons',
    'hover-scale', 'blob-blur', 'stock-copy', 'uniform-motion', 'dark-saas', 'grey-neutrals', 'placeholder']) {
    assert.ok(ids(r).includes(id), `expected ${id} in ${ids(r)}`)
  }
  for (const f of r.findings) assert.ok(f.line >= 1 && f.sample.length > 0 && f.why.length > 20, JSON.stringify(f))
  assert.equal(r.findings.find((f) => f.id === 'gradient-purple').line, 6)
  assert.equal(r.findings.find((f) => f.id === 'placeholder').line, 17)
})

test('a page that made decisions is clean — a card class and a transition are not fingerprints', () => {
  const r = lintText(DESIGNED, 'designed.html')
  assert.deepEqual(ids(r), [], JSON.stringify(r.findings, null, 1))
  assert.equal(r.verdict, 'clean')
})

test('the default face fires only when no chosen face exists anywhere; a chosen display face clears it', () => {
  assert.ok(ids(lintText('<style>body{font-family:Inter,sans-serif}</style>')).includes('type-default'))
  assert.ok(ids(lintText('<div class="font-sans">x</div>')).includes('type-default'), 'the framework stack with nothing loaded')
  assert.ok(!ids(lintText('<style>h1{font-family:"Instrument Serif",serif}body{font-family:Inter,sans-serif}</style>')).includes('type-default'))
  assert.ok(!ids(lintText('<style>body{font-family:var(--font-body)}</style>')).includes('type-default'), 'a token is a decision made elsewhere')
})

test('the purple gradient is recognised in CSS colours, not only Tailwind names; an earthy gradient passes', () => {
  assert.ok(ids(lintText('<style>.h{background:linear-gradient(135deg,#6366f1,#ec4899)}</style>')).includes('gradient-purple'))
  assert.ok(ids(lintText('<style>.h{background:linear-gradient(90deg, rgb(139,92,246) 0%, rgb(217,70,239) 100%)}</style>')).includes('gradient-purple'))
  assert.ok(!ids(lintText('<style>.h{background:linear-gradient(#f4f1ea,#e8e2d4)}</style>')).includes('gradient-purple'))
  assert.ok(!ids(lintText('<style>.h{background:linear-gradient(180deg,#1a3a6b,#ff5a1f)}</style>')).includes('gradient-purple'), 'blue to orange is not the tell')
})

test('the centred hero needs all three parts; a left-aligned statement with one link is not it', () => {
  const hero = '<section class="text-center"><h1>Ship</h1><p>Now.</p><a class="btn">Start</a><a class="btn">Docs</a></section>'
  assert.ok(ids(lintText(hero)).includes('hero-centroid'))
  const left = '<header><h1>Ship</h1><p>Now.</p><a class="btn">Start</a></header>'
  assert.ok(!ids(lintText(left)).includes('hero-centroid'))
})

test('a single transition-all or a single acid colour is not reported; the acid accent needs the near-black ground', () => {
  assert.ok(!ids(lintText('<style>a{transition:all .2s}</style>')).includes('uniform-motion'))
  assert.ok(!ids(lintText('<div class="text-emerald-400">ok</div>')).includes('acid-on-black'))
  assert.ok(ids(lintText('<body class="bg-zinc-950"><span class="text-emerald-400">ok</span></body>')).includes('acid-on-black'))
  assert.ok(ids(lintText('<style>body{background:#0a0a0a}.x{color:#39ff14}</style>')).includes('acid-on-black'))
})

test('JSX className strings and a .css file are read the same way; comments and scripts do not count as copy or emoji', () => {
  const jsx = 'export default () => <div className="backdrop-blur-md bg-white/10 rounded-2xl">🚀🚀🚀</div>'
  const r = lintText(jsx, 'Hero.tsx')
  assert.ok(ids(r).includes('glass') && ids(r).includes('emoji-icons'))
  const css = '.a{color:#333}.b{color:#666}.c{color:#999}.d{color:#ccc}'
  assert.ok(ids(lintText(css, 'x.css')).includes('grey-neutrals'))
  const quiet = '<!-- 🚀 🚀 🚀 seamless effortless --><script>const s = "supercharge unleash"</script><p>Plain.</p>'
  const q = lintText(quiet)
  assert.ok(!ids(q).includes('emoji-icons') && !ids(q).includes('stock-copy'), JSON.stringify(q.findings))
})

test('hsl() reads hex, rgb, hsl and oklch; the bands are where the fingerprints live', () => {
  assert.ok(Math.abs(hsl('#8b5cf6').h - 258) < 4)
  assert.ok(hsl('rgb(236, 72, 153)').h > 320)
  assert.equal(hsl('hsl(280 80% 60%)').h, 280)
  assert.ok(hsl('oklch(0.7 0.2 300)').s > 0.5)
  assert.equal(hsl('nonsense'), null)
  assert.equal(FAMILIES.length, 16)
  assert.equal(MAX_SCORE, FAMILIES.reduce((a, f) => a + f.weight, 0))
})

test('the CLI lints a directory, exits 1 on a centroid, 0 on clean, and --json carries the findings', (t) => {
  const d = scratch(t)
  writeFileSync(join(d, 'slop.html'), SLOP)
  writeFileSync(join(d, 'designed.html'), DESIGNED)
  writeFileSync(join(d, 'notes.md'), SLOP)
  const cli = join(REPO, 'tools', 'slop-lint.mjs')
  const bad = spawnSync(process.execPath, [cli, d], { encoding: 'utf8', timeout: 60000 })
  assert.equal(bad.status, 1, bad.stdout)
  assert.match(bad.stdout, /slop\.html.*CENTROID/)
  assert.match(bad.stdout, /designed\.html.*CLEAN/)
  assert.ok(!/notes\.md/.test(bad.stdout), 'only design files are linted')
  const good = spawnSync(process.execPath, [cli, join(d, 'designed.html'), '--json'], { encoding: 'utf8', timeout: 60000 })
  assert.equal(good.status, 0, good.stdout)
  const j = JSON.parse(good.stdout)
  assert.equal(j.ok, true)
  assert.equal(j.files[0].verdict, 'clean')
  assert.equal(lint(join(d, 'slop.html')).verdict, 'centroid')
})

test('the shipped screen example passes its own gate', () => {
  const ex = join(REPO, 'skills', 'creative-divergence', 'examples', 'cgc-landing', 'index.html')
  const r = lint(ex)
  assert.equal(r.verdict, 'clean', JSON.stringify(r.findings, null, 1))
})
