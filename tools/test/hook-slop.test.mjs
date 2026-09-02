// The slop hook: the fingerprint lint, run on every screen file as it is written. The silent
// cases matter most — a hook that nagged on a designed page, a print file or a README would
// be removed within a day.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'

const HOOK = join(REPO, 'config', 'hooks', 'post-tool-slop.js')

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hook-slop-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
function fire(file, tool = 'Write') {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: tool, tool_input: { file_path: file } }), encoding: 'utf8', timeout: 30000 })
  assert.equal(r.status, 0, `hook must always exit 0: ${r.stderr}`)
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : null
}

const SLOP = `<body class="bg-gray-900 text-gray-400 border-gray-800"><div class="absolute rounded-full blur-3xl bg-purple-500"></div>
<section class="text-center"><h1 class="bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">Supercharge</h1><p>Seamless and effortless.</p>
<a class="btn">Start</a><a class="btn">Demo</a></section></body>`
const ONE_TELL = '<style>h1{font-family:"Instrument Serif",serif}.h{background:linear-gradient(135deg,#7c3aed,#ec4899)}</style><h1>x</h1>'
const DESIGNED = '<style>h1{font-family:Fraunces,serif;font-style:italic}body{background:oklch(0.97 0.01 80);color:oklch(0.22 0.02 60)}</style><h1>A standard nobody checks is a preference.</h1>'
const PRINT = '<style>@page{size:3.75in 2.25in;margin:0}h1{font-family:Inter}.g{background:linear-gradient(#7c3aed,#ec4899)}</style>'

test('the template is reported with its fingerprints, the verdict, and the review-loop instruction', (t) => {
  const f = join(scratch(t), 'index.html'); writeFileSync(f, SLOP)
  const ctx = fire(f)
  assert.ok(ctx, 'expected the hook to speak')
  assert.match(ctx, /SLOP FINGERPRINT in index\.html/)
  assert.match(ctx, /centroid/)
  assert.match(ctx, /gradient-purple/)
  assert.match(ctx, /hero-centroid/)
  assert.match(ctx, /Do not decorate it/)
  assert.match(ctx, /screen-render/)
})

test('one strong tell is enough to report, worded as a default to replace', (t) => {
  const f = join(scratch(t), 'Hero.tsx'); writeFileSync(f, ONE_TELL)
  const ctx = fire(f, 'Edit')
  assert.match(ctx || '', /fingerprints/)
  assert.match(ctx || '', /gradient-purple/)
  assert.match(ctx || '', /default, not a decision/)
})

test('silent on a designed page, a physical design, a non-design file, and a read', (t) => {
  const d = scratch(t)
  const a = join(d, 'good.html'); writeFileSync(a, DESIGNED)
  const b = join(d, 'card.html'); writeFileSync(b, PRINT)
  const c = join(d, 'README.md'); writeFileSync(c, SLOP)
  assert.equal(fire(a), null, 'a designed page is not reported')
  assert.equal(fire(b), null, 'print-lint owns physical designs')
  assert.equal(fire(c), null, 'only design files are inspected')
  const s = join(d, 'index.html'); writeFileSync(s, SLOP)
  assert.equal(fire(s, 'Read'), null, 'a read is not a write')
})

test('never crashes on a missing file, bad JSON, or an empty payload', () => {
  for (const input of ['', '{', JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(tmpdir(), 'nope-does-not-exist.html') } })]) {
    const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', timeout: 30000 })
    assert.equal(r.status, 0)
    assert.equal(r.stdout.trim(), '')
  }
})
