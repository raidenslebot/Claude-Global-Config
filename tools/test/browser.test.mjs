// playwright-core ships NO BROWSER of its own. The doctor checked that the module resolved and
// called that healthy, so a fresh install reported every check green while every render, audit,
// motion capture and print proof failed — which is most of what this package is for. The check
// is now the one every gate performs: launch one.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'

const DOCTOR = join(REPO, 'tools', 'doctor.mjs')

test('the doctor fails when no browser can be launched, and says how to fix it', () => {
  // An empty browsers directory is exactly the state a machine with a fresh install is in.
  const empty = mkdtempSync(join(tmpdir(), 'no-browsers-'))
  const r = spawnSync(process.execPath, [DOCTOR], {
    encoding: 'utf8', timeout: 300000,
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: empty },
  })
  assert.match(r.stdout, /NO BROWSER LAUNCHES/, 'the module resolving is not a browser existing')
  assert.match(r.stdout, /--only=mcp/, 'and the fix is named')
  assert.notEqual(r.status, 0, 'a toolchain that cannot draw anything is not a healthy install')
})

test('the doctor passes when a browser does launch', () => {
  const r = spawnSync(process.execPath, [DOCTOR], { encoding: 'utf8', timeout: 300000 })
  assert.match(r.stdout, /browser launches for render, audit and motion/)
})

test('install.mjs refuses to be imported, because importing it would install', () => {
  // It has no exports and acts the moment it loads, so an accidental import — from a test, or
  // from a tool reaching for one of its helpers — used to silently run a full install.
  const dir = mkdtempSync(join(tmpdir(), 'import-install-'))
  const probe = join(dir, 'probe.mjs')
  const target = pathToFileURL(join(REPO, 'tools', 'install.mjs')).href
  writeFileSync(probe, [
    `import(${JSON.stringify(target)})`,
    '  .then(() => console.log("RAN"))',
    '  .catch((e) => console.log("REFUSED: " + e.message))',
  ].join('\n'), 'utf8')
  const r = spawnSync(process.execPath, [probe], { encoding: 'utf8', timeout: 120000 })
  assert.match(r.stdout, /REFUSED: .*command, not a module/,
    `importing it must not install: ${(r.stdout + r.stderr).slice(0, 200)}`)
})
