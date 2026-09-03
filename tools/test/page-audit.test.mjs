// page-audit measures the rendered page against the questions a machine can answer. A page
// with every planted defect must have each named; a page that made the right decisions must
// pass with no failure. Both fixtures use generic font families so the tests need no network
// and no particular fonts installed. They skip, not pass, when no browser is available.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
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
  // Lowest ratio first, and the ground is now taken from the painted pixels rather than
  // from the computed-style chain — the two agree exactly on an ordinary page like this one.
  const contrast = r.results[0].findings.filter((x) => x.rule === 'contrast' && x.level === 'fail')
  assert.match(contrast[0].msg, /^2\.3\d:1 — #aaaaaa on #ffffff/)
  assert.ok(contrast.some((x) => /^2\.8\d:1 — #999999 on #ffffff on its PAINTED ground, at 16px; needs 4\.5:1/.test(x.msg)), contrast.map((x) => x.msg).join('\n'))
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

// ── Contrast is measured from the painted pixels ─────────────────────────────────────────────
// The computed-style chain answers "what did the author declare". Five separate false passes
// came from that: a background-image anywhere turned the whole check off, a scrim painted over
// the text was invisible to it, a blend mode measured the declared colour, a decorative layer
// with pointer-events:none composited the wrong ground, and a gradient could only ever inform.
// Every one of them ended in "no failures".

const CLI = join(REPO, 'tools', 'page-audit.mjs')
const runCli = (args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 180000 })
  let json = null
  try { json = JSON.parse(r.stdout) } catch { json = null }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json }
}
const painted = (t, body) => {
  const dir = scratch(t)
  const file = join(dir, 'page.html')
  writeFileSync(file, body, 'utf8')
  return runCli([file, '--json'])
}
const failures = (r) => (r.json?.results?.[0]?.findings || []).filter((f) => f.level === 'fail')

test('a background image does not switch the contrast check off', { skip }, (t) => {
  // A 1×1 transparent GIF changes no pixel, and used to disable contrast for the entire page.
  const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  const r = painted(t, `<!doctype html><style>body{background:#fff;background-image:url("${gif}");margin:0;padding:2rem}`
    + 'h1{color:#f4f4f4;font-size:40px}p{color:#f6f6f6;font-size:18px}</style>'
    + '<h1>Invisible heading</h1><p>Invisible paragraph text a reader cannot see.</p>')
  const bad = failures(r).filter((f) => f.rule === 'contrast')
  assert.ok(bad.length >= 2, `both runs must fail, got ${JSON.stringify(failures(r).map((f) => f.msg))}`)
  assert.match(bad[0].msg, /PAINTED ground/)
})

test('a scrim painted over the text is caught, and says the declaration passes', { skip }, (t) => {
  const r = painted(t, '<!doctype html><style>body{margin:0;background:#fff}.wrap{position:relative;padding:2rem}'
    + '.ink{color:#444;font-size:40px}.veil{position:absolute;inset:0;background:rgba(255,255,255,0.93);z-index:5}</style>'
    + '<div class="wrap"><div class="ink">Under a veil</div><div class="veil"></div></div>')
  const f = failures(r).find((x) => x.rule === 'contrast')
  assert.ok(f, 'text under a veil is unreadable however it was declared')
  assert.match(f.msg, /declared .* but painted /)
  assert.match(f.msg, /something is drawn over this text/)
})

test('text that changes nothing in the render is invisible, not unmeasurable', { skip }, (t) => {
  const r = painted(t, '<!doctype html><style>body{margin:0;background:#fff;padding:2rem}'
    + 'h1{color:#000;mix-blend-mode:difference;font-size:40px}</style><h1>White on white really</h1>')
  const f = failures(r).find((x) => x.rule === 'contrast')
  assert.ok(f, 'a blend that renders white on white is a failure, not an unknown')
  assert.match(f.msg, /invisible where it sits/)
})

test('shadow DOM, SVG text, body text and one-character runs are all measured', { skip }, (t) => {
  const cases = {
    'shadow DOM': '<!doctype html><body style="margin:0;background:#fff"><div id="h"></div><script>'
      + 'document.getElementById("h").attachShadow({mode:"open"}).innerHTML='
      + '\'<p style="color:#f2f2f2;font-size:20px">a shadow dom paragraph nobody can read at all</p>\';</script></body>',
    'SVG text': '<!doctype html><body style="margin:0;background:#fff"><svg width="900" height="80">'
      + '<text x="10" y="40" fill="#f2f2f2" font-size="20">an svg run nobody can read at all</text></svg></body>',
    'body text': '<!doctype html><body style="margin:0;background:#fff;color:#f2f2f2;font-size:20px">'
      + 'text sitting directly inside body with no wrapping element at all</body>',
    'one character': '<!doctype html><body style="margin:0;background:#fff;padding:2rem">'
      + '<span style="color:#f4f4f4;font-size:30px">3</span></body>',
  }
  for (const [what, body] of Object.entries(cases)) {
    const r = painted(t, body)
    assert.ok(failures(r).some((f) => f.rule === 'contrast'), `${what} must be measured, not skipped`)
  }
})

test('decorative text hidden from assistive technology is not a contrast failure', { skip }, (t) => {
  // A submerged gauge numeral is MEANT to be illegible; the data it stands for is elsewhere.
  const r = painted(t, '<!doctype html><style>body{margin:0;background:#fff;padding:2rem}'
    + '.buried{color:#fdfdfd;font-size:20px}p{color:#111;font-size:18px}</style>'
    + '<div aria-hidden="true"><span class="buried">6</span></div><p>The reading, in text anyone can see.</p>')
  assert.deepEqual(failures(r).filter((f) => f.rule === 'contrast'), [])
})

test('an error page is not audited as though it were the page you meant', { skip }, (t) => {
  const r = runCli([join(scratch(t), 'does-not-exist.html'), '--json'])
  assert.notEqual(r.status, 0, 'a page that never loaded has not been audited')
})

test('pinned text is measured where the reader meets it, not only at the top', { skip }, async () => {
  const para = '<p>A paragraph long enough that the page scrolls well past the hero and the fixed bar '
    + 'comes to rest over paper-white text rather than over its own dark field.</p>'
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>Pinned</title><style>
    body{margin:0;font-family:Georgia,serif;color:#1a1a1a;background:#fdfdfb}
    header{position:fixed;top:0;left:0;right:0;padding:14px 20px;color:#f2f2f2;font-size:15px}
    .hero{height:420px;background:#12202c}
    main{padding:40px 20px;font-size:17px;line-height:1.6;max-width:34em}
    </style></head><body><header>Northbank Review</header><div class="hero"></div>
    <main>${para.repeat(8)}</main></body></html>`
  const d = scratch({ after: () => {} })
  const p = join(d, 'pinned.html')
  writeFileSync(p, page)
  const r = await audit(p, { mobile: true })
  const pinned = r.results.flatMap((v) => v.findings).filter((f) => /once the page is scrolled/.test(f.msg))
  assert.ok(pinned.length, 'a header legible over its own hero and illegible over the article has to fail')
  assert.equal(pinned[0].level, 'fail')
  rmSync(d, { recursive: true, force: true })
})

test('motion no CSS API reports is still reported, and a still page is left alone', { skip }, async () => {
  const d = mkdtempSync(join(tmpdir(), 'page-audit-raf-'))
  const raf = `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>rAF</title><style>
    body{margin:0;font-family:Georgia,serif;color:#1a1a1a;background:#fdfdfb;padding:40px;font-size:17px;line-height:1.5}
    .dot{width:60px;height:60px;background:#12202c;border-radius:50%}</style></head><body>
    <h1>A loop that nothing declares</h1><p>The circle is moved by a script writing style on every frame.</p>
    <div class="dot" id="d"></div><script>
    const d=document.getElementById('d');let t0=null
    function step(ts){if(t0===null)t0=ts;d.style.transform='translateX('+(120*(1+Math.sin((ts-t0)/600))).toFixed(2)+'px)';requestAnimationFrame(step)}
    requestAnimationFrame(step)<\/script></body></html>`
  writeFileSync(join(d, 'raf.html'), raf)
  const moving = await audit(join(d, 'raf.html'), { mobile: false })
  const msgs = moving.results.flatMap((v) => v.findings).map((f) => f.msg)
  assert.ok(msgs.some((m) => /animates from JavaScript/.test(m)), 'a rAF loop must not read as "nothing moves"')
  assert.ok(msgs.some((m) => /still changing a second apart under prefers-reduced-motion/.test(m)))

  const still = `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>Still</title><style>
    body{margin:0;font-family:Georgia,serif;color:#1a1a1a;background:#fdfdfb;padding:32px;font-size:17px;line-height:1.55;max-width:34em}
    </style></head><body><h1>Nothing moves here at all</h1><p>No script, no animation, no transition.</p></body></html>`
  writeFileSync(join(d, 'still.html'), still)
  const r2 = await audit(join(d, 'still.html'), { mobile: false })
  assert.equal(r2.results.flatMap((v) => v.findings).filter((f) => /motion/.test(f.rule)).length, 0)
  rmSync(d, { recursive: true, force: true })
})

test('a tap target is exempt only inside a sentence, not beside any word at all', { skip }, async () => {
  const d = mkdtempSync(join(tmpdir(), 'page-audit-tap-'))
  writeFileSync(join(d, 'tap.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>Tap</title><style>
    body{margin:0;font-family:Georgia,serif;color:#1a1a1a;background:#fdfdfb;padding:24px;font-size:17px;line-height:1.55}
    .close{width:20px;height:20px;font-size:13px;border:0;background:#eee;color:#1a1a1a}</style></head><body>
    <div>Menu <button class="close">×</button></div>
    <p>A paragraph of running text long enough to be a sentence, with a <a href="#">link inside it</a>
    that a reader meets mid-line and taps without a second thought.</p></body></html>`)
  const r = await audit(join(d, 'tap.html'), { mobile: true })
  const tap = r.results.flatMap((v) => v.findings).filter((f) => f.rule === 'tap-target')
  assert.equal(tap.length, 1, 'the close button fails; the link in the sentence does not')
  assert.match(tap[0].msg, /1 control\(s\) under 24/)
  rmSync(d, { recursive: true, force: true })
})

test('contrast is measured on the page at rest, not on whichever frame the shutter caught', { skip }, async (t) => {
  // An animation on `width` reflows the document, so the two shots came back at different
  // heights and any run past the shorter one was measured against cleared canvas — read as
  // black, reported at 1.11:1, on a page with nothing black on it at all.
  const d = scratch(t)
  const f = join(d, 'reflow.html')
  writeFileSync(f, `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>Reflow</title><style>
    body{margin:0;padding:24px;background:#fff;color:#222;font-family:serif;font-size:18px;line-height:1.5}
    .grow{animation:grow 4s linear both;background:#eee;height:400px}
    @keyframes grow{from{width:10px}to{width:1400px}}
    .after{color:#777}
    </style></head><body>
    <p>A paragraph before the growing block, long enough to be measured properly.</p>
    <div class="grow"></div>
    <p class="after">${'A paragraph after it, which is where the page got taller as the block grew. '.repeat(6)}</p>
    </body></html>`)
  for (let i = 0; i < 3; i++) {
    const r = await audit(f, { mobile: false })
    const contrast = r.results.flatMap((v) => v.findings).filter((x) => x.rule === 'contrast')
    assert.equal(contrast.filter((x) => /#000000/.test(x.msg)).length, 0,
      'nothing on this page is black; a black ground means the pixels came from cleared canvas')
    for (const c of contrast) assert.doesNotMatch(c.msg, /could not be measured/)
  }
})

test('a directory, an empty file and a binary are refused; an SVG is sent where it belongs', { skip }, async (t) => {
  // Chromium renders a directory as a file listing and a binary as mojibake, and every tool here
  // then reported success over it: "no failures" about a folder index. And a raw SVG threw a
  // stack trace — createElement in an XML document makes a namespace-less element with no
  // .style, and there is no <body> to hang a probe on.
  const d = scratch(t)
  mkdirSync(join(d, 'adir'))
  writeFileSync(join(d, 'empty.html'), '')
  writeFileSync(join(d, 'bin.html'), Buffer.from([0x00, 0x01, 0xff, 0xfe]))
  writeFileSync(join(d, 'mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#eee"/></svg>')
  const run = (f) => spawnSync(process.execPath, [join(REPO, 'tools', 'page-audit.mjs'), join(d, f)], { encoding: 'utf8', timeout: 120000 })
  for (const [f, says] of [['adir', /is a directory/], ['empty.html', /is empty/], ['bin.html', /not a text file/], ['mark.svg', /questions about a page/]]) {
    const r = run(f)
    assert.equal(r.status, 1, `${f} should be refused, got ${r.status}: ${r.stdout}`)
    assert.match(r.stderr, says)
    assert.doesNotMatch(r.stderr + r.stdout, /\n\s+at [A-Za-z_$]/, `${f} printed a stack trace`)
  }
  // The SVG refusal names somewhere to go, because not answering is not the same as no answer.
  assert.match(run('mark.svg').stderr, /cgc icons|cgc print-lint/)
})
