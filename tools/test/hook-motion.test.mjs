// The motion hook: it fires on files that move, stays quiet on files that do not, and names
// the defect rather than nagging. The gate that matters is the last one — every file that
// animates must be told to run cgc motion, because reading a duration is not watching it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOOK = resolve(HERE, '..', '..', 'config', 'hooks', 'post-tool-motion.js')

function run(name, body) {
  const dir = mkdtempSync(join(tmpdir(), 'hook-motion-'))
  const file = join(dir, name)
  writeFileSync(file, body, 'utf8')
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: file } }),
    encoding: 'utf8', timeout: 15000,
  })
  assert.equal(r.status, 0, 'a reporting hook always exits 0')
  if (!r.stdout.trim()) return ''
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext
}

test('a file that does not animate is left alone', () => {
  assert.equal(run('static.css', '.card { color: #222; padding: 24px; border: 1px solid #ddd }'), '')
  assert.equal(run('prose.html', '<!doctype html><h1>A page</h1><p>Words, and no movement at all.</p>'), '')
})

test('linear-gradient is not linear easing', () => {
  const ctx = run('grad.css', '.hero { background: linear-gradient(#fff, #000); transition: opacity 240ms cubic-bezier(.2,.8,.2,1) }\n@media (prefers-reduced-motion: reduce) { .hero { transition: none } }')
  assert.ok(ctx, 'the file animates, so the hook speaks')
  assert.doesNotMatch(ctx, /linear \(L/, 'a gradient is not an easing curve')
})

test('the flat curve, the unnamed property, and the default ease are each named', () => {
  const linear = run('a.css', '.x { transition: transform 300ms linear }\n@media (prefers-reduced-motion: reduce) { .x { transition: none } }')
  assert.match(linear, /linear \(L1\)/)
  assert.match(linear, /cubic-bezier/)
  const all = run('b.css', '.x { transition: all 300ms cubic-bezier(.2,.8,.2,1) }\n@media (prefers-reduced-motion: reduce) { .x { transition: none } }')
  assert.match(all, /transition-all/)
  const dflt = run('c.css', '.x { transition: opacity 300ms ease; }\n@media (prefers-reduced-motion: reduce) { .x { transition: none } }')
  assert.match(dflt, /default-ease/)
})

test('animating a layout property is reported, transform and opacity are not', () => {
  const bad = run('d.css', '.x { transition: height 300ms cubic-bezier(.2,.8,.2,1) }\n@media (prefers-reduced-motion: reduce) { .x { transition: none } }')
  assert.match(bad, /layout-animation/)
  assert.match(bad, /composited/)
  const good = run('e.css', '.x { transition: transform 300ms cubic-bezier(.2,.8,.2,1), opacity 300ms cubic-bezier(.2,.8,.2,1) }\n@media (prefers-reduced-motion: reduce) { .x { transition: none } }')
  assert.doesNotMatch(good, /layout-animation/)
})

test('a file that animates and never mentions reduced motion is reported', () => {
  const ctx = run('f.css', '@keyframes rise { from { transform: translateY(20px) } to { transform: none } }\n.x { animation: rise 400ms cubic-bezier(.2,.8,.2,1) }')
  assert.match(ctx, /no-reduced-motion/)
  assert.match(ctx, /vestibular/)
})

test('a scroll-driven animation is meant to be linear, and is not reported', () => {
  // Its easing comes from the scroll position; a curve on top of that double-eases it.
  const scrolled = run('sd.css', '.reveal { animation: rise linear both; animation-timeline: view(); animation-range: entry 10% cover 35% }\n@media (prefers-reduced-motion: reduce) { .reveal { animation: none } }')
  assert.ok(scrolled, 'the file animates, so the hook still speaks')
  assert.doesNotMatch(scrolled, /linear \(L/, 'scroll-driven animation is meant to be linear')
  // A plain timed animation with the same keyword still is.
  const timed = run('t.css', '.x { animation: rise 400ms linear both }\n@media (prefers-reduced-motion: reduce) { .x { animation: none } }')
  assert.match(timed, /linear \(L1\)/)
})

test('a long duration is reported, an infinite marquee is not', () => {
  const slow = run('g.css', '.x { transition: transform 2400ms cubic-bezier(.2,.8,.2,1) }\n@media (prefers-reduced-motion: reduce) { .x { transition: none } }')
  assert.match(slow, /slow \(L1\)/)
  const marquee = run('h.css', '.x { animation: run 45s linear infinite }\n@media (prefers-reduced-motion: reduce) { .x { animation: none } }')
  assert.doesNotMatch(marquee, /\bslow \(L/, 'a ticker is meant to be long')
})

test('every animating file is told to watch it, whatever the source says', () => {
  // A clean file still gets the instruction: the source cannot tell you how it looks moving.
  const clean = run('clean.css', '.x { transition: transform 240ms cubic-bezier(.2,.8,.2,1) }\n@media (prefers-reduced-motion: reduce) { .x { transition: none } }')
  assert.match(clean, /cgc motion/)
  assert.match(clean, /LOOK AT THE SHEET/)
  // And so does a JS-driven one, where there is no CSS to read in the first place.
  const js = run('anim.js', 'const el = document.querySelector(".x")\nfunction f(t) { el.style.transform = "translateX(" + t + "px)"; requestAnimationFrame(f) }\nrequestAnimationFrame(f)')
  assert.match(js, /cgc motion/)
  assert.match(js, /--trigger/)
})

test('a non-write tool and unreadable input never produce output', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'x.css' } }), encoding: 'utf8', timeout: 10000 })
  assert.equal(r.status, 0)
  assert.equal(r.stdout.trim(), '')
  const bad = spawnSync(process.execPath, [HOOK], { input: 'not json at all', encoding: 'utf8', timeout: 10000 })
  assert.equal(bad.status, 0)
  assert.equal(bad.stdout.trim(), '')
})

test('a leading-dot duration is read as what it is', () => {
  // `.3s` is the commonest way to write a short duration, and the pattern required a leading
  // digit — so it read 300ms as 3000ms and produced a confident wrong finding about the most
  // ordinary input there is.
  const guard = '\n@media (prefers-reduced-motion: reduce) { .x { transition: none } }'
  assert.doesNotMatch(run('a.css', '.x { transition: transform .3s ease-out }' + guard), /slow \(L/, '.3s is 300ms')
  assert.doesNotMatch(run('b.css', '.x { transition: opacity .5s ease-out }' + guard), /slow \(L/, '.5s is 500ms')
  assert.doesNotMatch(run('c.css', '.x { transition: transform 0.3s ease-out }' + guard), /slow \(L/)
  assert.match(run('d.css', '.x { transition: transform 2.4s ease-out }' + guard), /slow \(L1\) — 2400 ms/, 'a real 2.4s still reports')
})

test('a hyphenated paint property is not called a layout animation', () => {
  const guard = '\n@media (prefers-reduced-motion: reduce) { .x { transition: none } }'
  assert.doesNotMatch(run('e.css', '.x { transition: border-top-color .2s ease-out }' + guard), /layout-animation/,
    'border-top-color is paint only; \\b saw "top" as a word of its own')
  assert.doesNotMatch(run('f.css', '.x { transition: border-bottom-color .2s ease-out }' + guard), /layout-animation/)
  assert.match(run('g2.css', '.x { transition: height .2s ease-out }' + guard), /layout-animation/, 'height really is layout')
  assert.match(run('h2.css', '.x { transition: margin-top .2s ease-out }' + guard), /layout-animation/, 'and so is margin-top')
})

test('the duration scan stays linear on prose that mentions transitions', () => {
  // The pattern was quadratic — unbounded and unanchored, so every bare word "transition" was a
  // start position. A 355KB article took 2.3 seconds; a 5MB one never finished at all.
  const prose = '<style>.a{color:red}</style>\n' + 'the transition and the animation of a transition in an animation '.repeat(12000)
  const started = Date.now()
  run('prose.html', prose)
  const ms = Date.now() - started
  assert.ok(ms < 8000, `scanning 780KB of prose took ${ms}ms end to end — the pattern has gone quadratic again`)
})
