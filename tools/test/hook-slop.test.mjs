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
  assert.match(ctx, /cgc render/)
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

test('a shader, a Unity script and a SwiftUI view are judged in their own medium', (t) => {
  // The report was web-only, so most of what this package claims to cover — shaders, engines,
  // native UI, terminals — got no word at all when it was written.
  const dir = scratch(t)
  const pad = (s) => s + '\n' + '// a line of the file, so it is substantial enough to judge\n'.repeat(30)

  const frag = join(dir, 'flat.frag')
  writeFileSync(frag, pad('precision highp float;\nvarying vec2 vUv;\nvoid main(){ gl_FragColor = vec4(vUv.y); }'), 'utf8')
  const shader = fire(frag)
  assert.ok(shader, 'a thin shader is not silently approved')
  assert.match(shader, /AMBITION in flat\.frag \(shader \/ GPU\)/, 'judged as a shader, not as a web page')
  assert.match(shader, /assembled/)
  assert.doesNotMatch(shader, /SLOP FINGERPRINT/, 'the fingerprint tells are web tells and do not apply')
  assert.doesNotMatch(shader, /oklch|container quer/i, 'it must not be handed CSS advice')

  const cs = join(dir, 'Flat.cs')
  writeFileSync(cs, pad('using UnityEngine;\npublic class Flat : MonoBehaviour { void Update() { transform.position += Vector3.up; } }'), 'utf8')
  const game = fire(cs)
  assert.ok(game, 'a thin engine script is not silently approved')
  assert.match(game, /game \/ engine/)

  const swift = join(dir, 'Flat.swift')
  writeFileSync(swift, pad('import SwiftUI\nstruct Flat: View { var body: some View { Text("hello") } }'), 'utf8')
  assert.match(fire(swift) || '', /native \/ mobile UI/)
})

test('a file in no recognised medium is left alone', (t) => {
  // A build script is not a design, and advice about masks and blend modes would be noise.
  const dir = scratch(t)
  const build = join(dir, 'build.mjs')
  writeFileSync(build, 'import { readFileSync } from "node:fs"\n' + 'const x = readFileSync("a.json")\n'.repeat(60), 'utf8')
  assert.equal(fire(build), null)
})

test('a clean but conventional page is reported for what it never tried', (t) => {
  // No purple, no glass, no centred hero, no stock copy — and nothing beyond 2015 CSS either.
  // The fingerprint lint has nothing to say about this page, and it is still the ceiling.
  const dir = scratch(t)
  const file = join(dir, 'ledger.html')
  writeFileSync(file, [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Ledger</title><style>',
    'body{margin:0;font-family:Georgia,serif;background:#f2efe9;color:#1c1a17}',
    '.wrap{max-width:960px;margin:0 auto;padding:64px 32px}',
    'h1{font-size:44px;line-height:1.1;margin:0 0 16px;font-weight:400}',
    'p{font-size:17px;line-height:1.6;max-width:62ch;color:#3a3630}',
    '.row{display:flex;gap:28px;margin-top:48px;flex-wrap:wrap}',
    '.item{flex:1 1 220px;border-top:1px solid #cdc7bb;padding-top:16px}',
    '.item h2{font-size:15px;letter-spacing:.1em;text-transform:uppercase;margin:0 0 8px;font-weight:400}',
    'a{color:#7a3b1d;text-decoration:underline;text-underline-offset:3px}',
    '.note{margin-top:64px;font-size:14px;color:#6b665d;border-left:2px solid #cdc7bb;padding-left:16px}',
    '</style></head><body><div class="wrap"><h1>Quarterly ledger</h1>',
    '<p>Figures for the three months to March, with the prior year alongside for comparison.</p>',
    '<div class="row"><div class="item"><h2>Receipts</h2><p>Up on the year by a little over a tenth.</p></div>',
    '<div class="item"><h2>Outgoings</h2><p>Flat, once the one-off legal fee is set aside.</p></div>',
    '<div class="item"><h2>Reserve</h2><p>Eleven months of cover at the current rate.</p></div></div>',
    '<p class="note">Prepared from the bank export; the workings are in the appendix.</p>',
    '</div></body></html>',
  ].join('\n'), 'utf8')

  const ctx = fire(file)
  assert.ok(ctx, 'a conventional page is not silently approved')
  assert.doesNotMatch(ctx, /SLOP FINGERPRINT/, 'there is nothing templated about it')
  assert.match(ctx, /AMBITION/)
  assert.match(ctx, /cgc techniques/)
  assert.match(ctx, /advanced-techniques\.md/)
})

test('a short fragment is not asked to be ambitious', (t) => {
  const dir = scratch(t)
  const file = join(dir, 'button.css')
  writeFileSync(file, '.btn { color: #333; padding: 8px 12px; border-radius: 4px }', 'utf8')
  assert.equal(fire(file), null)
})
