// Some third-party names are deliberately absent from this repo, and absence is the kind of
// property that rots quietly: a regenerated index, a pasted example list, or a new integration
// puts the name back and nobody notices, because nothing was ever checked. This is the gate.
//
// The rule is not "the string is banned". Two files are expected to carry a name precisely
// because their job is to keep it out or to catch it: the index generator's EXCLUDE list, and
// the secret scanner's detection pattern. A scanner that cannot name what it found is useless,
// and a filter that cannot name what it filters does not filter. Everything else must be clean.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'

/** Vendors this repo does not reference. Add a name here and the tree must already be clean. */
const EXCLUDED = ['discord']

/** The two files whose purpose is to name the excluded thing. Anything else is a finding. */
const ALLOWED = new Set([
  'tools/scan-secrets.mjs',        // token detection patterns — naming the vendor IS the feature
  'library/build-index.mjs',       // the EXCLUDE list that keeps it out of the generated index
  'tools/test/excluded-vendors.test.mjs',
])

function tracked() {
  const r = spawnSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return r.status === 0 ? r.stdout.split('\0').filter(Boolean) : null
}

test('no tracked file references an excluded vendor, except the two that exist to exclude it', (t) => {
  const files = tracked()
  if (!files) return t.skip('git not available or not a checkout')
  const re = new RegExp(EXCLUDED.join('|'), 'i')
  const offenders = []
  for (const f of files) {
    if (ALLOWED.has(f) || f.startsWith('library/repos/')) continue
    const p = join(REPO, f)
    if (!existsSync(p) || statSync(p).size > 4_000_000) continue
    const text = readFileSync(p, 'latin1')
    if (text.includes('\0')) continue          // binary; nothing to read
    if (!re.test(text)) continue
    text.split(/\r?\n/).forEach((line, i) => {
      if (re.test(line)) offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 100)}`)
    })
  }
  assert.deepEqual(offenders, [],
    `an excluded vendor is back in the tree:\n  ${offenders.join('\n  ')}\n` +
    `If a regenerated file put it there, add the path fragment to EXCLUDE in library/build-index.mjs.`)
})

test('the two allowed files really do still exclude and detect', () => {
  // A gate whose exemptions are stale is worse than no gate: it would keep passing while the
  // filter and the detector had been deleted.
  const gen = readFileSync(join(REPO, 'library', 'build-index.mjs'), 'utf8')
  assert.match(gen, /const EXCLUDE = \[/, 'build-index.mjs no longer has an EXCLUDE list')
  for (const v of EXCLUDED) {
    assert.ok(new RegExp(v, 'i').test(gen), `build-index.mjs no longer excludes "${v}"`)
  }
  const scanner = readFileSync(join(REPO, 'tools', 'scan-secrets.mjs'), 'utf8')
  for (const v of EXCLUDED) {
    assert.ok(new RegExp(`'${v}-[a-z-]+',`, 'i').test(scanner),
      `scan-secrets.mjs no longer carries a "${v}" detection pattern`)
  }
})

test('the generated index is free of every excluded vendor', () => {
  // The index is rebuilt from a third-party library on any machine. This asserts the committed
  // copy is clean; the EXCLUDE list is what keeps it that way after a regeneration.
  const idx = join(REPO, 'library', 'INDEX.md')
  if (!existsSync(idx)) return
  const text = readFileSync(idx, 'utf8')
  for (const v of EXCLUDED) {
    assert.ok(!new RegExp(v, 'i').test(text),
      `library/INDEX.md names "${v}" — regenerate it with build-index.mjs, whose EXCLUDE list drops it`)
  }
})
