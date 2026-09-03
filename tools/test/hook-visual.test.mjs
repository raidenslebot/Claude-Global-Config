// The visual prompt hook must fire on visual work and stay silent on the ordinary sentences
// about code that share its words — a hook that fires on "between the two functions" gets
// deleted, and then it fires on nothing. Each silent case here was a real false positive found
// by review; each firing case is a prompt the design skills exist for.

import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'

const HOOK = join(REPO, 'skills', 'visual-design-mastery', 'hooks', 'user-prompt-visual.js')

function fire(prompt) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ prompt }), encoding: 'utf8', timeout: 20000 })
  assert.equal(r.status, 0, `hook must always exit 0: ${r.stderr}`)
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : null
}

test('ordinary sentences about code do not fire, whatever words they share with design', () => {
  for (const p of [
    'Refactor the code between the two functions and increase the timeout.',
    'Add a GraphQL resolver and discard the stale cache entries.',
    'Open the Visual Studio Code settings and withdraw the pull request.',
    'Estimate the story points for this user story.',
    'Slide the window over the array and plot the results into a CSV.',
    'Pipe the build output through tee into a log file.',
    'Fix the npm packaging so the invitation email endpoint returns 200.',
    'Generate the chart of accounts from the ledger export.',
    'Button up the API contract before the release.',
    'Feel free to refactor the auth module however you like.',
    'Fix the database transition in the state machine before the migration runs.',
    'Spin up a new worker process and ease the load on the queue.',
    'The build feels slow because the spring boot context reloads on every test.',
    'Map the user ids to their roles and render the JSON response.',
    'Use a regex pattern to match the transition state names.',
    'Write a unit test for the story service.',
  ]) assert.equal(fire(p), null, `fired on: ${p}`)
})

test('visual work fires, and is routed to paper, fabric or the field it belongs to', () => {
  const page = fire('Design a landing page for the swim club with a hero and a pricing section.')
  assert.match(page || '', /VISUAL WORK DETECTED/)
  assert.doesNotMatch(page, /PHYSICAL MEDIA|FIELD DETECTED/)

  const poster = fire('Make a poster for the night market, 18 by 24, two colours.')
  assert.match(poster || '', /PHYSICAL MEDIA DETECTED/)
  assert.match(poster, /`print-design`/)

  const tee = fire('Design a tee for the club — one colour, screen printed, left chest.')
  assert.match(tee || '', /PHYSICAL MEDIA DETECTED/)
  assert.match(tee, /`apparel-design`/)

  for (const p of [
    'Make an Instagram story announcing the launch.',
    'Build a slide deck for the annual meeting.',
    'Draw a logo for a harbour swim club.',
    'Design an icon set for the app in the brand style.',
    'Lay out the packaging for the tea tins — the brand needs a box and a label.',
  ]) assert.match(fire(p) || '', /FIELD DETECTED/, p)

  assert.match(fire('Animate the button hover so it feels physical.') || '', /VISUAL WORK DETECTED/)
  assert.match(fire('Make a bar chart of sales by month for the dashboard.') || '', /VISUAL WORK DETECTED/)
  assert.match(fire('Write a fragment shader for a heat-haze effect.') || '', /VISUAL WORK DETECTED/)
})

test('never crashes on an empty, null or malformed payload', () => {
  for (const input of ['', 'null', '{', JSON.stringify({})]) {
    const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', timeout: 20000 })
    assert.equal(r.status, 0, `input ${JSON.stringify(input)}: ${r.stderr}`)
    assert.equal(r.stdout.trim(), '')
  }
})

test('a prompt about how something MOVES fires, and is routed to the motion tool', () => {
  // Each of these is a real animation request that names no design noun at all. Before the
  // motion terms were added, every one of them was silent — so the taste layer never loaded
  // for the one field the user said was worst.
  for (const p of [
    'make this transition feel better',
    'the buttons feel sluggish',
    'the loading spinner needs work',
    'make the page transition smoother',
    'why does this animation look janky',
    'add a hover effect to the cards',
    'the modal should fade in',
    'build a scroll-driven hero',
  ]) {
    const ctx = fire(p)
    assert.ok(ctx, `should fire: ${p}`)
    assert.match(ctx, /MOTION DETECTED/, `should route to motion: ${p}`)
    assert.match(ctx, /cgc motion/, `should name the tool that watches it: ${p}`)
  }
})

test('the motion route insists on watching, not on reading', () => {
  const ctx = fire('animate the menu opening')
  assert.match(ctx, /LOOK AT THE SHEET/)
  assert.match(ctx, /--trigger/)
  assert.match(ctx, /prefers-reduced-motion/)
  assert.match(ctx, /motion-and-animation\.md/, 'the craft, with its numbers, is named')
})
