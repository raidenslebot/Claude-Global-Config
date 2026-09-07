// The react-doctor hook's gates. This is the hook that held 16.3 GB in sixteen concurrent scans
// of a repository with no React in it, and whose first fix "worked" by never scanning any
// top-level project at all — it took dirname() of the project root and began the walk one level
// above the project. Every gate here is asserted from the outside, by what the hook DOES, with
// CGC_HOOK_DEBUG naming the gate that exited so a wrong skip is never a silent one.
//
// The scanner itself is faked: a `react-doctor` shim on PATH that writes a marker file. What is
// under test is the decision to run it, never react-doctor.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, openSync, writeSync, closeSync, utimesSync } from 'node:fs'
import { tmpdir, platform } from 'node:os'
import { join, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'
import { discard } from './_teardown.mjs'

const HOOK = join(REPO, 'config', 'hooks', 'react-doctor.mjs')
const WIN = platform() === 'win32'

function world(t) {
  const root = mkdtempSync(join(tmpdir(), 'cgc-rd-'))
  t.after(() => discard(root))
  const bin = join(root, 'bin')
  mkdirSync(bin, { recursive: true })
  const marker = join(root, 'marker.txt')
  // The shim: any invocation writes the marker and exits 0.
  if (WIN) writeFileSync(join(bin, 'react-doctor.cmd'), `@echo scanned>>"${marker}"\r\n@exit /b 0\r\n`, 'utf8')
  else { writeFileSync(join(bin, 'react-doctor'), `#!/bin/sh\necho scanned >> "${marker}"\n`, 'utf8'); spawnSync('chmod', ['+x', join(bin, 'react-doctor')]) }
  const write = (rel, text) => {
    const p = join(root, ...rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, text, 'utf8')
    return p
  }
  return { root, bin, marker, write }
}

/** Fire the hook for a written file; return whether the scanner ran and the gate that exited. */
function fire(w, file, extraEnv = {}) {
  try { rmSync(w.marker, { force: true }) } catch {}
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: file } }),
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, CGC_HOOK_DEBUG: '1', PATH: `${w.bin}${WIN ? ';' : ':'}${process.env.PATH}`, ...extraEnv },
  })
  assert.equal(r.status, 0, `the hook must never fail the agent loop: ${r.stderr}`)
  const why = (r.stderr.match(/react-doctor: (.*)/) || [, ''])[1].trim()
  return { scanned: existsSync(w.marker), why }
}

test('a project that uses React is scanned; the fix must not be "never scan"', (t) => {
  const w = world(t)
  w.write(['proj', 'package.json'], JSON.stringify({ dependencies: { react: '18' } }))
  const f = w.write(['proj', 'src', 'App.jsx'], 'x')
  const t0 = Date.now()
  const r = fire(w, f)
  assert.equal(r.scanned, true, `react in the project's own package.json must scan (gate: ${r.why})`)
  // A shim that exits at once must not cost the full timeout: the first tree-kill blocked the
  // event loop and every scan ran 45 s regardless of how fast the scanner finished.
  assert.ok(Date.now() - t0 < 10000, `a fast scanner must return fast, took ${Date.now() - t0} ms`)
})

test('a monorepo keeps react at the workspace root — the walk reads every package.json up the tree', (t) => {
  const w = world(t)
  w.write(['mono', 'package.json'], JSON.stringify({ workspaces: ['packages/*'], devDependencies: { react: '18' } }))
  w.write(['mono', 'packages', 'web', 'package.json'], JSON.stringify({ name: 'web' }))
  const f = w.write(['mono', 'packages', 'web', 'src', 'App.jsx'], 'x')
  const r = fire(w, f)
  assert.equal(r.scanned, true, `react at the workspace root must scan (gate: ${r.why})`)
})

test('no framework anywhere: skipped, for that reason, in well under a second', (t) => {
  // This repository is that case. Every write to it was paying an npm resolution and a
  // full-project scan to be told "No supported framework or library detected".
  const w = world(t)
  w.write(['plain', 'package.json'], JSON.stringify({ name: 'plain', dependencies: { lodash: '4' } }))
  const f = w.write(['plain', 'src', 'a.js'], 'x')
  const t0 = Date.now()
  const r = fire(w, f)
  assert.equal(r.scanned, false)
  assert.match(r.why, /no framework/, `must skip on the framework gate, not an earlier one: ${r.why}`)
  assert.ok(Date.now() - t0 < 5000, 'the decision is one file read, not a scan')
})

test('the same file spelled with mixed separators or an 8.3 short path decides the same way', (t) => {
  // Claude Code on Windows hands hooks whatever the user's cwd yields, and a shell can hand it a
  // short path with backslashes followed by forward slashes. That must not change the answer.
  if (!WIN) return t.skip('Windows path forms')
  const w = world(t)
  w.write(['proj', 'package.json'], JSON.stringify({ dependencies: { react: '18' } }))
  const f = w.write(['proj', 'src', 'App.jsx'], 'x')
  const mixed = f.replace(/\\/g, (m, i) => (i > f.indexOf(sep, 3) ? '/' : m))
  const r = fire(w, mixed)
  assert.equal(r.scanned, true, `mixed separators must still find the project (gate: ${r.why})`)
})

test('one scan at a time: a live slot means skip, a dead slot is taken over', (t) => {
  const w = world(t)
  w.write(['proj', 'package.json'], JSON.stringify({ dependencies: { react: '18' } }))
  const f = w.write(['proj', 'src', 'App.jsx'], 'x')
  const lock = join(tmpdir(), 'cgc-react-doctor.lock')
  t.after(() => { try { rmSync(lock, { force: true }) } catch {} })
  // Held by a live scan: skip, and say so.
  const fd = openSync(lock, 'w'); writeSync(fd, '999999'); closeSync(fd)
  const held = fire(w, f)
  assert.equal(held.scanned, false)
  assert.match(held.why, /slot/, held.why)
  // Left behind by a scan that died: older than the stale window, so it is taken over.
  const old = new Date(Date.now() - 10 * 60 * 1000)
  utimesSync(lock, old, old)
  const taken = fire(w, f)
  assert.equal(taken.scanned, true, `a stale slot must be taken over (gate: ${taken.why})`)
  assert.equal(existsSync(lock), false, 'and released afterwards')
})

test('a framework name matches whole: exponential-backoff is not expo, astronomia is not astro', (t) => {
  // The gate was a bare prefix, so a backend with exponential-backoff, astronomia, remixicon or
  // nextcloud-node-client as a dependency paid the forty-second scan it exists to skip — the
  // exact cost the change measured and set out to remove.
  const w = world(t)
  w.write(['api', 'package.json'], JSON.stringify({ dependencies: { 'exponential-backoff': '3', astronomia: '4', remixicon: '4', 'nextcloud-node-client': '1', 'vue-template-compiler-not': '0' } }))
  const f = w.write(['api', 'src', 'server.js'], 'x')
  const r = fire(w, f)
  assert.equal(r.scanned, false, `a look-alike name must not scan (gate: ${r.why})`)
  assert.match(r.why, /no framework/)
  // Scoped prefixes still count: a project on TanStack's React bindings is a React project.
  w.write(['app', 'package.json'], JSON.stringify({ dependencies: { '@tanstack/react-query': '5', react: '18' } }))
  const g = w.write(['app', 'src', 'App.tsx'], 'x')
  assert.equal(fire(w, g).scanned, true)
  // And a scoped framework alone.
  w.write(['native', 'package.json'], JSON.stringify({ dependencies: { '@react-native/metro-config': '0.7' } }))
  const n = w.write(['native', 'App.js'], 'x')
  assert.equal(fire(w, n).scanned, true, 'a @react-native/* dependency is a React Native project')
})
