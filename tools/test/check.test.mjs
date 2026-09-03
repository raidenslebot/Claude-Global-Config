// `cgc check` runs the loop in one command. The loop was four or five commands, which is
// exactly why it got run once and then remembered as having been run. What matters here is
// that it picks the right gates from the file itself, and that its exit code is usable.
//
// The browser gates (audit, motion) are skipped in most cases so the suite stays fast; gate
// SELECTION is asserted from the JSON, which is the part that can silently rot.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'

const TOOL = join(REPO, 'tools', 'check.mjs')

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cgc-check-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
function run(args, opts = {}) {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', timeout: 120000, ...opts })
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' }
}
function gates(file, extra = []) {
  const r = run([file, '--json', '--skip', 'audit,motion', ...extra])
  const j = JSON.parse(r.out)
  const map = {}
  for (const g of j.results[0].gates) map[g.gate] = g.level
  return { j, map, status: r.status }
}

const TEMPLATE = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Launch</title><style>',
  'body{background:#0b0f19;color:#94a3b8;font-family:Inter,sans-serif}',
  '.blob{position:absolute;border-radius:9999px;filter:blur(64px);background:#a855f7;width:24rem;height:24rem}',
  '.hero{text-align:center;padding:8rem 0}',
  '.hero h1{background:linear-gradient(90deg,#a855f7,#ec4899);-webkit-background-clip:text;color:transparent}',
  '.card{backdrop-filter:blur(12px);background:rgba(255,255,255,.1);border-radius:1rem;padding:1.5rem}',
  '.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1.5rem}',
  '</style></head><body><div class="blob"></div>',
  '<section class="hero"><h1>Supercharge your workflow</h1><p>Seamless, effortless, blazing fast.</p>',
  '<a class="btn">Get started</a><a class="btn">Book a demo</a></section>',
  '<div class="grid"><div class="card">🚀 Fast</div><div class="card">🔒 Secure</div><div class="card">⚡ Simple</div></div>',
  '</body></html>',
].join('\n')

test('--help lists the gates and exits 0; a path that does not exist is a failure', () => {
  const help = run(['--help'])
  assert.equal(help.status, 0)
  for (const gate of ['techniques', 'lint', 'audit', 'motion', 'print-lint']) {
    assert.match(help.out, new RegExp(gate), `--help names the ${gate} gate`)
  }
  assert.equal(run([join(tmpdir(), 'no-such-dir-41772')]).status, 1)
})

test('a template page fails the gates that apply to it, and --strict is usable as an exit code', (t) => {
  const dir = scratch(t)
  const file = join(dir, 'index.html')
  writeFileSync(file, TEMPLATE, 'utf8')

  const { map } = gates(file)
  assert.equal(map.lint, 'fail', 'the fingerprint gate must fail on the template')
  assert.ok(map.techniques === 'fail' || map.techniques === 'warn',
    'the ambition gate must not pass a page built from defaults, got ' + map.techniques)
  assert.ok(!('print-lint' in map), 'a screen page is not sent to the press gate')

  assert.equal(run([file, '--skip', 'audit,motion', '--strict']).status, 1)
  assert.equal(run([file, '--skip', 'audit,motion']).status, 0, 'without --strict it reports rather than fails')
})

test('a physical design goes to the press gate and not to the fingerprint gate', (t) => {
  const dir = scratch(t)
  const file = join(dir, 'card.html')
  writeFileSync(file, [
    '<style>@page{size:3.5in 2in;margin:0}',
    'body{font-family:Archivo,sans-serif}',
    '.name{font-size:11pt;letter-spacing:.02em}',
    '.rule{border-top:.5pt solid}',
    '</style><div class="name">Harbour Swim Club</div><div class="rule"></div>',
  ].join('\n'), 'utf8')
  const { map } = gates(file)
  assert.ok('print-lint' in map, 'physical units send it to the press gate')
  assert.ok(!('lint' in map), 'the screen fingerprints do not apply to paper')
})

test('a file in no recognised medium contributes no gates', (t) => {
  const dir = scratch(t)
  const file = join(dir, 'build.mjs')
  writeFileSync(file, 'import { readFileSync } from "node:fs"\n' + 'const x = readFileSync("a.json")\n'.repeat(40), 'utf8')
  const r = run([file, '--json', '--skip', 'audit,motion'])
  const j = JSON.parse(r.out)
  assert.equal(j.results[0].gates.length, 0, 'a build script is not a design')
  assert.equal(r.status, 0)
})

test('a directory is walked, and the summary covers every file in it', (t) => {
  const dir = scratch(t)
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'a.html'), TEMPLATE, 'utf8')
  writeFileSync(join(dir, 'src', 'b.css'), '.x{color:#333}', 'utf8')
  writeFileSync(join(dir, 'src', 'notes.txt'), 'not a design', 'utf8')
  const j = JSON.parse(run([dir, '--json', '--skip', 'audit,motion']).out)
  const names = j.results.map((r) => basename(r.file)).sort()
  assert.deepEqual(names, ['a.html', 'b.css'], 'design files only')
  assert.ok(j.failed > 0)
})

test('--skip removes a gate rather than failing it', (t) => {
  const dir = scratch(t)
  const file = join(dir, 'index.html')
  writeFileSync(file, TEMPLATE, 'utf8')
  const withLint = gates(file).map
  assert.ok('lint' in withLint)
  const without = gates(file, ['--skip', 'audit,motion,lint']).map
  assert.ok(!('lint' in without), '--skip drops the gate entirely')
})
