// The curve reader, against curves whose answer is known by construction. These are the
// judgements the tool makes from pixels alone, so they are tested from numbers alone: a
// straight line is linear, a front-loaded curve is an ease-out, a single spike is a jump cut,
// and a flat run of frames at either end is dead air.

import { test } from 'node:test'
import assert from 'node:assert/strict'
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
