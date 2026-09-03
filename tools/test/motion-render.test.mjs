// The curve reader, against curves whose answer is known by construction. These are the
// judgements the tool makes from pixels alone, so they are tested from numbers alone: a
// straight line is linear, a front-loaded curve is an ease-out, a single spike is a jump cut,
// and a flat run of frames at either end is dead air.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readCurve, sheetHtml, CLOCK } from '../motion-render.mjs'

// Build the shape the browser hands back: per-frame change, the cumulative fraction, the total.
function curve(change) {
  const total = change.reduce((a, b) => a + b, 0)
  const cum = []
  let run = 0
  for (const c of change) { run += c; cum.push(total ? run / total : 0) }
  return { change, cum, total, peak: Math.max(...change) }
}
const ids = (r) => r.findings.map((f) => f.id)
const from = (fn, n = 12) => curve([0, ...Array.from({ length: n - 1 }, (_, i) => fn((i + 1) / (n - 1)) - fn(i / (n - 1)))])

test('a straight line is linear, and it fails', () => {
  const r = readCurve(from((p) => p), { duration: 600, frames: 12 })
  assert.equal(r.easing, 'linear')
  assert.ok(ids(r).includes('linear'))
  assert.equal(r.findings.find((f) => f.id === 'linear').level, 'fail')
})

test('a decelerating curve is an ease-out and passes clean', () => {
  const r = readCurve(from((p) => 1 - (1 - p) ** 3), { duration: 400, frames: 12 })
  assert.equal(r.easing, 'ease-out')
  assert.deepEqual(ids(r), [], 'a well-eased 400ms move has nothing wrong with it')
})

test('an accelerating curve is an ease-in', () => {
  assert.equal(readCurve(from((p) => p ** 3), { duration: 400, frames: 12 }).easing, 'ease-in')
})

test('an S-curve is ease-in-out', () => {
  const s = (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2)
  assert.equal(readCurve(from(s), { duration: 400, frames: 12 }).easing, 'ease-in-out')
})

test('no change at all is the dead verdict, and nothing else is guessed from it', () => {
  const r = readCurve(curve(new Array(12).fill(0)), { duration: 500, frames: 12 })
  assert.equal(r.moved, false)
  assert.deepEqual(ids(r), ['dead'])
  assert.equal(r.easing, 'none')
  assert.match(r.findings[0].note, /never ran/)
})

test('one frame carrying the change is a jump cut', () => {
  const r = readCurve(curve([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]), { duration: 300, frames: 12 })
  assert.ok(ids(r).includes('jump-cut'))
  assert.match(r.findings.find((f) => f.id === 'jump-cut').note, /snaps/)
})

test('dead air is a still frame, not an early settle', () => {
  // A strong ease-out reaches 95% of its change in the first half BY DESIGN. That is the ease
  // working, not padding, and calling it padding would punish the very thing being asked for.
  const eased = readCurve(from((p) => 1 - (1 - p) ** 5), { duration: 500, frames: 12 })
  assert.ok(!ids(eased).includes('dead-tail'), 'a steep ease-out is not dead air')
  // Frozen frames are. Half the timeline with literally nothing happening is padding.
  const padded = readCurve(curve([0, 0.3, 0.3, 0.2, 0.2, 0, 0, 0, 0, 0, 0, 0]), { duration: 2000, frames: 12 })
  assert.ok(ids(padded).includes('dead-tail'))
  const delayed = readCurve(curve([0, 0, 0, 0, 0, 0.25, 0.25, 0.25, 0.25, 0, 0, 0]), { duration: 2000, frames: 12 })
  assert.ok(ids(delayed).includes('dead-head'))
})

test('duration is judged against the eye, at both ends', () => {
  const fast = readCurve(from((p) => 1 - (1 - p) ** 3), { duration: 60, frames: 12 })
  assert.ok(ids(fast).includes('too-fast'))
  const slow = readCurve(from((p) => p ** 1.4), { duration: 3000, frames: 12 })
  assert.ok(ids(slow).includes('too-slow'))
})

test('the clock replaces every source of time before the page reads one', () => {
  for (const needle of ['performance.now', 'Date.now', 'requestAnimationFrame', 'cancelAnimationFrame', '__cgcScrub', 'getAnimations']) {
    assert.ok(CLOCK.includes(needle), `the init script must take over ${needle}`)
  }
  assert.match(CLOCK, /a\.pause\(\)/, 'declarative animations are scrubbed, not left running')
})

test('the sheet carries every frame, its time, and the line to judge the curve against', () => {
  const html = sheetHtml([
    { t: 0, url: 'data:image/png;base64,AAA' },
    { t: 250, url: 'data:image/png;base64,BBB' },
  ], { title: 'x.html', trigger: '0–250 ms', viewport: '1440×900' })
  assert.match(html, /data:image\/png;base64,AAA/)
  assert.match(html, /250 ms/)
  assert.match(html, /stroke-dasharray/, 'the straight line is drawn behind the measured curve')
  assert.match(html, /willReadFrequently/, 'the frames are decoded and diffed in the page')
  assert.doesNotMatch(html, /file:\/\//, 'a file:// image would taint the canvas it is measured in')
})

// ── The reduced-motion verdict, against a real browser ───────────────────────────────────────
// This logic was wrong twice: first comparing a two-frame capture against a twelve-frame sum,
// then comparing endpoints, which cannot tell a smooth move from a jump. Both mistakes failed
// pages that had done the right thing, which is the worst kind of gate. These three cases are
// the whole contract, so they are checked against the browser rather than against a model.
import { findPlaywright } from '../print-render.mjs'
import { mkdtempSync as mkdtemp2, writeFileSync as write2, rmSync as rmSync2 } from 'node:fs'
import { tmpdir as tmp2 } from 'node:os'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'
import { spawnSync as spawn2 } from 'node:child_process'

const BROWSER = Boolean(findPlaywright())
const needsBrowser = BROWSER ? false : 'no browser available (install the Playwright MCP server)'
const MOTION = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'motion-render.mjs')

function capture(body, args = []) {
  const dir = mkdtemp2(join(tmp2(), 'motion-reduced-'))
  const file = join(dir, 'page.html')
  write2(file, body, 'utf8')
  const r = spawn2(process.execPath, [MOTION, file, '--json', ...args], { encoding: 'utf8', timeout: 180000 })
  return { status: r.status, json: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr }
}
const SLIDE = `<style>body{margin:0;background:#101318;height:100vh;display:grid;place-items:center}
.b{width:200px;height:200px;background:#e8dcc8;animation:slide 900ms cubic-bezier(.16,1,.3,1) both}
@keyframes slide{from{transform:translateX(-360px)}to{transform:translateX(360px)}}`

test('reduced motion: a fade instead of a move passes', { skip: needsBrowser }, () => {
  const { json } = capture(`${SLIDE}
@media (prefers-reduced-motion:reduce){.b{animation:fade 900ms cubic-bezier(.16,1,.3,1) both}
@keyframes fade{from{opacity:0}to{opacity:1}}}</style><div class="b"></div>`, ['--duration', '900', '--frames', '10'])
  assert.ok(json, 'the capture produced a result')
  assert.ok(!json.findings.some((f) => f.id === 'reduced-motion'),
    `an opacity fade is the remedy this finding recommends: ${JSON.stringify(json.findings)}`)
})

test('reduced motion: cutting the animation passes, because there is no path to travel', { skip: needsBrowser }, () => {
  const { json } = capture(`${SLIDE}
@media (prefers-reduced-motion:reduce){.b{animation:none;transform:translateX(360px)}}</style><div class="b"></div>`,
  ['--duration', '900', '--frames', '10'])
  assert.ok(!json.findings.some((f) => f.id === 'reduced-motion'),
    `the element simply arrives, which is the point: ${JSON.stringify(json.findings)}`)
})

test('reduced motion: no guard at all fails, and says how much still moves', { skip: needsBrowser }, () => {
  const { json } = capture(`${SLIDE}</style><div class="b"></div>`, ['--duration', '900', '--frames', '10'])
  const found = json.findings.find((f) => f.id === 'reduced-motion')
  assert.ok(found, 'an unguarded animation must fail')
  assert.equal(found.level, 'fail')
  assert.match(found.note, /still travels \d+% as far/)
  assert.equal(json.reducedMotionChange > 0, true)
})

test('a page that animates from a timer is not reported as dead', { skip: needsBrowser }, () => {
  // The virtual clock did not cover setTimeout, so this page advanced on real wall time and
  // the verdict depended on how fast the screenshots happened to run.
  const { json } = capture(`<style>body{margin:0;background:#101318;height:100vh;display:grid;place-items:center}
.b{width:180px;height:180px;background:#c4552a;transform:translateX(-300px);transition:transform 600ms cubic-bezier(.16,1,.3,1)}
.b.go{transform:translateX(300px)}
@media (prefers-reduced-motion:reduce){.b{transition:none}}</style><div class="b" id="b"></div>
<script>setTimeout(function(){document.getElementById('b').classList.add('go')},300)</script>`,
  ['--duration', '1000', '--frames', '12'])
  assert.ok(!json.findings.some((f) => f.id === 'dead'), 'the page animates; it must not be called dead')
  assert.notEqual(json.easing, 'none')
})

test('a window shorter than the motion is extended, or said out loud', (t) => {
  // A 3.2s move photographed for the default second reported "settles at 909 ms" — arithmetically
  // right about the wrong second. A wrong number stated as fact is worse than no number.
  const d = mkdtemp2(join(tmp2(), 'motion-slow-'))
  t.after(() => rmSync2(d, { recursive: true, force: true }))
  const f = join(d, 'slow.html')
  write2(f, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Slow</title><style>
    body{margin:0;background:#f4f1ea;color:#1d2530;font-family:Georgia,serif;padding:40px;font-size:18px}
    .b{width:120px;height:120px;background:#1d2530;animation:go 3200ms cubic-bezier(.2,.8,.2,1) both}
    @keyframes go{from{transform:translateX(0)}to{transform:translateX(600px)}}
    @media (prefers-reduced-motion:reduce){.b{animation:none}}
    </style></head><body><h1>A move that takes three seconds</h1><div class="b"></div></body></html>`)
  const run = (args) => spawnSync(process.execPath, [join(REPO, 'tools', 'motion-render.mjs'), f, '--out', join(d, 'm'), ...args],
    { encoding: 'utf8', timeout: 300000 })

  const auto = run([])
  assert.match(auto.stderr, /declares 3200 ms of motion; watching all of it/, auto.stderr)
  assert.match(auto.stdout, /3200 ms/, 'the sheet covers the whole move')
  assert.doesNotMatch(auto.stdout, /settles at 9\d\d ms/, 'and does not report the first second as the whole')

  // Asked for a window explicitly, it obeys — and says what the readings describe.
  const asked = run(['--duration', '1000'])
  assert.match(asked.stderr, /declares 3200 ms of motion and this is watching 1000 ms/)
  assert.match(asked.stdout, /1000 ms/)
})
