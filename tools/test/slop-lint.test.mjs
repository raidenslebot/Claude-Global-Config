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
  // The two most copied gradients on the web, and an hsl-written purple with a deg unit.
  assert.ok(ids(lintText('<style>.h{background:linear-gradient(135deg, #667eea 0%, #764ba2 100%)}</style>')).includes('gradient-purple'))
  assert.ok(ids(lintText('<style>.h{background:linear-gradient(to right, #6a11cb, #2575fc)}</style>')).includes('gradient-purple'))
  assert.ok(ids(lintText('<style>.h{background:linear-gradient(hsl(280deg 80% 50%), hsl(320deg 80% 60%))}</style>')).includes('gradient-purple'))
  assert.ok(!ids(lintText('<style>.h{background:linear-gradient(#1a3a6b,#0b3d91)}</style>')).includes('gradient-purple'), 'two navies are not purple')
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
  const typography = '<footer>© 2026 Acme Ltd® · Acme™</footer><a>Docs ↗</a><a>Blog ↗</a><p>✔ done</p>'
  assert.ok(!ids(lintText(typography)).includes('emoji-icons'), 'copyright, trademark, arrows and ticks are typography, not icons')
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

test('a design token hides nothing: the face, the gradient and the ground are read through var()', () => {
  // Every one of these is the fingerprint written the way a real project writes it.
  const tokens = `<style>:root{--font-body:system-ui;--from:#667eea;--to:#764ba2;--ink:#0a0a0a;--acid:#39ff14}
    body{font-family:var(--font-body);background:var(--ink)}
    .hero{background:linear-gradient(135deg,var(--from),var(--to))}
    a{color:var(--acid)}</style><p>x</p>`
  const r = ids(lintText(tokens, 'tokens.html'))
  assert.ok(r.includes('type-default'), 'a default face named through a token is still the default face')
  assert.ok(r.includes('gradient-purple'))
  assert.ok(r.includes('acid-on-black'))
})

test('a page that documents a technique is not using it — code samples are read as prose', () => {
  const doc = `<!doctype html><style>body{font-family:"Archivo Expanded",serif}</style>
    <h1>Why the glass card fails</h1>
    <pre><code>.card { backdrop-filter: blur(12px); background: rgba(255,255,255,0.6); }</code></pre>
    <p>Do not do that.</p>`
  assert.ok(!ids(lintText(doc, 'article.html')).includes('glass'), 'quoting a class is not shipping it')
  // The same declaration outside a code sample still counts.
  const used = doc.replace('<pre><code>', '<style>').replace('</code></pre>', '</style>')
  assert.ok(ids(lintText(used, 'used.html')).includes('glass'))
})

test('a translucent bar is navigation, not a glass card; a state colour is not the acid accent', () => {
  const bar = `<style>body{font-family:"Archivo Expanded",serif}
    header{position:sticky;top:0;backdrop-filter:blur(10px);background:rgba(255,255,255,0.7)}</style><header>nav</header>`
  assert.ok(!ids(lintText(bar, 'bar.html')).includes('glass'))

  // A dark dashboard whose green means "running", beside a red and an amber that mean something else.
  const dash = `<style>body{background:#0b0b0c;font-family:"Archivo Expanded",serif}
    .ok{color:#22c55e}.bad{color:#ef4444}.warn{color:#f59e0b}.link{color:#3b82f6}</style>
    <p class="ok">running</p><p class="bad">failed</p>`
  assert.ok(!ids(lintText(dash, 'dash.html')).includes('acid-on-black'), 'four hues is a palette, not the dev-tool default')

  // One saturated hue carrying the whole design still is.
  const acid = `<style>body{background:#0a0a0a;color:#e5e5e5;font-family:"Archivo Expanded",serif}
    a{color:#39ff14}</style><a href="#">go</a>`
  assert.ok(ids(lintText(acid, 'acid.html')).includes('acid-on-black'))
})

test('a ramp built at one hue answers the grey charge; four dead greys still do not', () => {
  const ramp = `<style>:root{--g1:#f7f6f4;--g2:#e6e4e0;--g3:#c9c6c0;--g4:#8b8781;--g5:#4a4742;--g6:#26241f}
    body{font-family:"Archivo Expanded",serif;background:var(--g1)}
    .a{color:#888}.b{color:#ccc}.c{color:#333}.d{color:#666}</style><p class="a">x</p>`
  assert.ok(!ids(lintText(ramp, 'ramp.html')).includes('grey-neutrals'))

  const dead = `<style>body{font-family:"Archivo Expanded",serif;background:#fff}
    .a{color:#888}.b{border-color:#ccc}.c{color:#333}.d{background:#666}</style><p class="a">x</p>`
  assert.ok(ids(lintText(dead, 'dead.html')).includes('grey-neutrals'))
})
