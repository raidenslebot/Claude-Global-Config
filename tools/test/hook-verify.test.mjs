// post-tool-verify reports problems in a file just written. The cases here are the ones a
// review found it getting wrong: a broken ES module in a .js file passed silently on Node 24; a
// VS Code settings file with a comment was "invalid JSON"; a shell path under $USER and a
// single-letter regex literal were "hardcoded machine paths". And it must never crash.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'

const HOOK = join(REPO, 'config', 'hooks', 'post-tool-verify.js')

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hook-verify-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
function fire(file) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: file } }), encoding: 'utf8', timeout: 30000 })
  assert.equal(r.status, 0, `hook must always exit 0: ${r.stderr}`)
  if (!r.stdout.trim()) return null
  const j = JSON.parse(r.stdout)
  return (j.hookSpecificOutput && j.hookSpecificOutput.additionalContext) || j.additionalContext || JSON.stringify(j)
}

test('a broken ES module in a .js file is reported, even where node --check would accept it', (t) => {
  const d = scratch(t)
  const f = join(d, 'esm-broken.js'); writeFileSync(f, "import { x } from './x.js'\nexport function broken( {\n  return x\n}\n")
  const ctx = fire(f)
  assert.ok(ctx, 'expected a syntax report')
  assert.match(ctx, /SyntaxError/)
  const ok = join(d, 'esm-ok.js'); writeFileSync(ok, "import { x } from './x.js'\nexport function fine() { return x }\n")
  assert.equal(fire(ok), null, 'a correct ES module in a .js file is not reported')
})

test('JSON with comments where comments are allowed is not reported; broken strict JSON is', (t) => {
  const d = scratch(t)
  mkdirSync(join(d, '.vscode'))
  const settings = join(d, '.vscode', 'settings.json')
  writeFileSync(settings, '{\n  "editor.fontSize": 14,\n  // the comment VS Code allows\n  "files.eol": "\\n",\n}\n')
  assert.equal(fire(settings), null, 'VS Code settings are JSONC')
  const rc = join(d, '.eslintrc.json'); writeFileSync(rc, '{ "root": true, // ok\n }')
  assert.equal(fire(rc), null)
  const bad = join(d, 'data.json'); writeFileSync(bad, '{ "a": 1, }')
  assert.match(fire(bad) || '', /JSON|Expected/)
})

test('a $USER path in a shell script and a single-letter regex literal are not machine paths', async (t) => {
  const d = scratch(t)
  const sh = join(d, 'backup.sh'); writeFileSync(sh, '#!/bin/sh\ncp -r "/home/$USER/backups/latest" /tmp/x\n')
  assert.equal(fire(sh), null, 'a path under $USER is derived at runtime')
  const ts = join(d, 'parse.ts'); writeFileSync(ts, 'export const version = /v:\\S+/.exec(input)\n')
  assert.equal(fire(ts), null, 'a regex literal is not a drive path')
  // The hook exempts anything under the home directory as machine-local config, and every
  // temp dir lives there — so the positive control is written beside the repo and removed.
  const outside = join(REPO, `.hook-verify-${process.pid}`)
  mkdirSync(outside, { recursive: true })
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  const real = join(outside, 'real.js'); writeFileSync(real, "const cfg = 'C:\\\\Users\\\\someone\\\\secret.env'\n")
  if (!real.toLowerCase().startsWith(homedir().toLowerCase())) {
    assert.match(fire(real) || '', /machine path|hardcoded/i, 'a literal drive path is still reported')
  }
})

test('never crashes on a null payload, bad JSON, or a missing file', () => {
  for (const input of ['null', '{', '', JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(tmpdir(), 'nope-' + process.pid + '.js') } })]) {
    const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', timeout: 30000 })
    assert.equal(r.status, 0, `input ${JSON.stringify(input)}: ${r.stderr}`)
  }
})
