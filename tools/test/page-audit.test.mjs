// page-audit measures the rendered page against the questions a machine can answer. A page
// with every planted defect must have each named; a page that made the right decisions must
// pass with no failure. Both fixtures use generic font families so the tests need no network
// and no particular fonts installed. They skip, not pass, when no browser is available.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { audit } from '../page-audit.mjs'
import { findPlaywright } from '../print-render.mjs'
import { REPO } from '../paths.mjs'

const BROWSER = Boolean(findPlaywright())
const skip = BROWSER ? false : 'no browser available (install the Playwright MCP server)'

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'page-audit-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
const rules = (r, level) => r.results.flatMap((v) => v.findings.filter((f) => !level || f.level === level).map((f) => f.rule))

// Every defect the audit knows, planted once. The heading is monospace at a fixed width so the
// widow is deterministic: "aaaa bbbb cccc dddd" fits 20ch and "eeee" falls alone.
const BAD = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  body { margin: 0; font-family: "No Such Face Anywhere", serif; background: #fff; color: #999; width: 2000px; }
  h1 { font-family: monospace; font-size: 20px; width: 20ch; line-height: 1.2; color: #111; }
  p { font-size: 16px; line-height: 1.1; }
  .tiny { font-size: 9px; color: #111; }
  a.btn { display: inline-block; width: 20px; height: 20px; outline: none; color: #111; }
  .spin { animation: spin 2s linear infinite; color: #111; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .slide { animation: slide 2s linear both; color: #111; }
  @keyframes slide { from { transform: translateX(-40px); } to { transform: none; } }
  .grow { animation: grow 1s ease both; color: #111; }
  @keyframes grow { from { width: 10px; } to { width: 200px; } }
  .s { width: 200px; height: 200px; display: inline-block; }
</style></head><body>
<h1>aaaa bbbb cccc dddd eeee</h1>
<p>${'The quick brown fox jumps over the lazy dog and keeps running across the wide open field. '.repeat(6)}</p>
<span class="tiny">tiny text here</span>
<div><a class="btn" href="#">x</a></div>
<img src="nothing.png">
<div class="spin">spinning</div><div class="slide">sliding in at constant speed</div><div class="grow">growing by width</div>
<div class="s" style="background:#ff2020"></div><div class="s" style="background:#20c020"></div><div class="s" style="background:#2040ff"></div><div class="s" style="background:#e020e0"></div>
<div style="color:#888">grey one, a label set in a dead grey with no hue in it at all</div><div style="color:#666">grey two, another dead grey, one step darker than the first</div><div style="color:#aaa">grey three, the lightest of the dead greys on this page</div>
</body></html>`

// The decisions made: contrast that passes, generic faces, a measure, readable sizes, a
// button a thumb can hit with a focus ring the browser draws, alt text, no animation, two
// neutrals with a hue and one signal.
const GOOD = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  body { margin: 0; padding: 24px; font-family: serif; background: rgb(247 244 238); color: rgb(38 34 30); font-size: 18px; line-height: 1.55; }
  h1 { font-size: 40px; line-height: 1.05; margin: 0 0 16px; text-wrap: balance; }
  p { max-width: 60ch; margin: 0 0 16px; }
  button { display: inline-block; min-width: 48px; min-height: 48px; padding: 12px 20px; font: inherit; background: rgb(150 40 30); color: rgb(247 244 238); border: 0; }
  button:focus-visible { outline: 3px solid rgb(38 34 30); outline-offset: 2px; }
</style></head><body>
<h1>A standard nobody checks is a preference</h1>
<p>Thirty-four checks, nineteen hooks and two hundred and six tests, run at every session start and reported in one line. Every mandate has a test behind it.</p>
<button type="button">Install</button>
<img src="nothing.png" alt="" width="10" height="10">
</body></html>`

// The cases an adversarial review found the first version getting wrong: the ground is what is
// painted under the text (a hero's dark block, not the white body); opacity dims the ink; a
// smaller inline run shares its line; a nav's <li><a> is a control; a CSS animation's easing
// lives on its keyframes; keyframe property names are camelCase.
const EDGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  body { margin: 0; font-family: serif; background: #fff; color: #111; font-size: 18px; }
  .hero { position: relative; padding: 40px; }
  .hero .bg { position: absolute; inset: 0; background: rgb(38 34 30); }
  .hero h2 { position: relative; margin: 0; color: rgb(247 244 238); font-size: 32px; }
  .faint { opacity: 0.3; }
  h3 { font-size: 40px; margin: 0; } h3 small { font-size: 16px; }
  nav a { font-size: 12px; line-height: 1; display: inline-block; }
  .eased { animation: slide 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  @keyframes slide { from { transform: translateX(-40px); } to { transform: none; } }
  .fs { animation: grow 0.5s ease both; }
  @keyframes grow { from { font-size: 10px; } to { font-size: 20px; } }
</style></head><body>
<section class="hero"><div class="bg"></div><h2>Over a dark block behind the text</h2></section>
<p class="faint">Faint text at thirty percent opacity that renders far below the minimum.</p>
<h3>Harbor Swim <small>club</small></h3>
<nav><ul><li><a href="#">Home</a></li></ul></nav>
<p>See the <a href="#">docs</a> for the rest of it.</p>
<div class="eased">eased entrance</div><div class="fs">font-size animated</div>
</body></html>`

test('the ground is what is painted, opacity dims the ink, inline runs share a line, nav links are controls, keyframe easing counts', { skip }, async (t) => {
  const d = scratch(t)
  const f = join(d, 'edge.html'); writeFileSync(f, EDGE)
  const r = await audit(f, { mobile: true })
  const fails = r.results[0].findings.filter((x) => x.level === 'fail')
  const warns = rules(r, 'warn')
  assert.ok(!fails.some((x) => x.rule === 'contrast' && /Over a dark block/.test(x.sample)), `cream on a dark positioned block is not cream on white: ${JSON.stringify(fails)}`)
  assert.ok(fails.some((x) => x.rule === 'contrast' && /Faint/.test(x.sample)), `black at 30% opacity on white fails: ${JSON.stringify(fails)}`)
  assert.ok(!warns.includes('widow'), 'a smaller inline run on the same line is not a widow')
  const tap = r.results[1].findings.find((x) => x.rule === 'tap-target')
  assert.ok(tap && tap.level === 'fail' && /Home/.test(tap.sample), `a 12px nav link is a control, not running text: ${JSON.stringify(tap)}`)
  assert.ok(!warns.includes('motion-linear'), 'a cubic-bezier CSS animation is not linear')
  assert.ok(warns.includes('motion-layout'), 'fontSize keyframes are a layout animation')
})

test('every planted defect is named at its level', { skip }, async (t) => {
  const d = scratch(t)
  const f = join(d, 'bad.html'); writeFileSync(f, BAD)
  const r = await audit(f, { mobile: true })
  assert.equal(r.ok, false)
  const fails = rules(r, 'fail'), warns = rules(r, 'warn')
  for (const id of ['contrast', 'font', 'small-text', 'overflow', 'tap-target']) assert.ok(fails.includes(id), `expected FAIL ${id} in ${fails}`)
  for (const id of ['measure', 'leading', 'widow', 'alt', 'focus', 'reduced-motion', 'palette', 'motion-linear', 'motion-layout', 'motion-long']) assert.ok(warns.includes(id), `expected warn ${id} in ${warns}`)
  const motion = r.results[0].findings.find((x) => x.rule === 'motion')
  assert.match(motion.msg, /3 animation\(s\): 2 finite, 1 infinite/)
  assert.ok(!warns.includes('motion-noise'), 'one spinner is not garnish')
  // Lowest ratio first: #aaa on white (2.32:1) outranks the #999 paragraph (2.85:1); both are named.
  const contrast = r.results[0].findings.filter((x) => x.rule === 'contrast' && x.level === 'fail')
  assert.match(contrast[0].msg, /^2\.3\d:1 — #aaaaaa on #ffffff/)
  assert.ok(contrast.some((x) => /^2\.8\d:1 — #999999 on #ffffff at 16px; needs 4\.5:1/.test(x.msg)), contrast.map((x) => x.msg).join('\n'))
  const widow = r.results[0].findings.find((x) => x.rule === 'widow')
  assert.match(widow.msg, /"eeee"/)
  const pal = r.results[0].findings.filter((x) => x.rule === 'palette' && x.level === 'warn').map((x) => x.msg).join(' ')
  assert.match(pal, /4 saturated hues/)
  assert.match(pal, /pure greys/)
})

test('a page that made the right decisions passes with no failure, and the palette reads as one signal', { skip }, async (t) => {
  const d = scratch(t)
  const f = join(d, 'good.html'); writeFileSync(f, GOOD)
  const r = await audit(f, { mobile: true })
  assert.deepEqual(rules(r, 'fail'), [], JSON.stringify(r.results, null, 1))
  assert.equal(r.ok, true)
  for (const id of ['widow', 'measure', 'focus', 'alt', 'reduced-motion', 'tap-target', 'motion-linear', 'motion-layout', 'motion-long', 'motion-uniform']) assert.ok(!rules(r, 'warn').includes(id), `unexpected warn ${id}: ${JSON.stringify(r.results, null, 1)}`)
  const info = r.results[0].findings.filter((x) => x.rule === 'palette').map((x) => x.msg).join(' ')
  assert.match(info, /1 saturated hue/)
})

test('the CLI exits 1 on a failing page, 0 on a passing one, and --json carries every viewport', { skip }, (t) => {
  const d = scratch(t)
  writeFileSync(join(d, 'bad.html'), BAD); writeFileSync(join(d, 'good.html'), GOOD)
  const cli = join(REPO, 'tools', 'page-audit.mjs')
  const bad = spawnSync(process.execPath, [cli, join(d, 'bad.html'), '--mobile'], { encoding: 'utf8', timeout: 120000 })
  assert.equal(bad.status, 1, bad.stdout + bad.stderr)
  assert.match(bad.stdout, /390x844/)
  assert.match(bad.stdout, /not finished/)
  const good = spawnSync(process.execPath, [cli, join(d, 'good.html'), '--json'], { encoding: 'utf8', timeout: 120000 })
  assert.equal(good.status, 0, good.stdout + good.stderr)
  const j = JSON.parse(good.stdout)
  assert.equal(j.ok, true)
  assert.equal(j.results.length, 1)
  assert.equal(j.results[0].viewport, '1440x900')
})

test('no browser: exit 2 with the install hint, never a stack trace', { skip: BROWSER ? 'a browser is available' : false }, () => {
  const r = spawnSync(process.execPath, [join(REPO, 'tools', 'page-audit.mjs'), join(REPO, 'README.md')], { encoding: 'utf8', timeout: 60000 })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /playwright-core not found/)
})
