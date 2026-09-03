// library/caveats-versions.json must say what library/CAVEATS.md says, in both directions.
//
// CAVEATS.md tells its reader to regenerate the version rows because they rot. The sidecar is what
// `argo watch --caveats` reads to run that check against the registry, and it was written by hand
// from the prose. Two hand-written copies of one fact drift, so this test pins them together: every
// sidecar row must be anchored in the prose, and every version claim the prose makes in a
// machine-recognisable shape must have a sidecar row. No network — the registry comparison itself
// is tested in argo/test/watch.test.js against fixtures.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { REPO } from '../paths.mjs'

const caveats = readFileSync(join(REPO, 'library', 'CAVEATS.md'), 'utf8')
const rows = JSON.parse(readFileSync(join(REPO, 'library', 'caveats-versions.json'), 'utf8'))

const KEYS = ['skill', 'package', 'documents', 'recorded', 'note']
// npm's own name rule, minus the length cap.
const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

test('the sidecar is a non-empty array of well-formed rows', () => {
  assert.ok(Array.isArray(rows) && rows.length > 0, 'expected a non-empty array')
  rows.forEach((r, i) => {
    for (const k of ['skill', 'package', 'documents', 'recorded']) {
      assert.equal(typeof r[k], 'string', `row ${i}: ${k} must be a string`)
      assert.ok(r[k].trim(), `row ${i}: ${k} must not be blank`)
    }
    if ('note' in r) assert.equal(typeof r.note, 'string', `row ${i}: note must be a string`)
    const extra = Object.keys(r).filter((k) => !KEYS.includes(k))
    assert.deepEqual(extra, [], `row ${i}: unknown keys ${extra.join(', ')} (typo?)`)
    assert.match(r.package, NPM_NAME, `row ${i}: "${r.package}" is not an npm package name`)
    // `recorded` is compared to the registry's latest by string equality, so it must be the
    // exact version, not a range or a major.
    assert.match(r.recorded, /^\d+\.\d+\.\d+/, `row ${i}: recorded "${r.recorded}" must be the exact version CAVEATS.md printed`)
  })
})

test('no two rows make the same claim', () => {
  const seen = new Set()
  for (const r of rows) {
    const key = `${r.skill} ${r.package}`
    assert.ok(!seen.has(key), `duplicate row for ${r.skill} / ${r.package}`)
    seen.add(key)
  }
})

test('every sidecar row is anchored in CAVEATS.md', () => {
  for (const r of rows) {
    const who = `${r.skill} / ${r.package}`
    assert.ok(caveats.includes(r.skill), `${who}: skill is not named in CAVEATS.md`)
    assert.ok(caveats.includes(r.recorded),
      `${who}: recorded ${r.recorded} is not in CAVEATS.md — one side was regenerated without the other`)
    // The Tier-3 table names skills, not packages, so a row there is anchored by the version
    // text it documents instead.
    assert.ok(caveats.includes(r.package) || caveats.includes(r.documents),
      `${who}: neither the package nor the documented version "${r.documents}" appears in CAVEATS.md`)
  }
})

/** Inline claims: a backticked `pkg@1.2`, `pkg ^1.2`, `@scope/pkg ^1.2.3`. The version must follow
 *  an @ or whitespace, so `web3d-integration-patterns` does not read as web@3d. */
const INLINE = /`(@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?)(?:@|\s+)[\^~]?v?(\d[0-9A-Za-z.-]*)`/g

/** Tier-3 table rows: | `skill` | documents | **live** |. */
const TABLE = /^\|\s*`([^`]+)`\s*\|([^|]*)\|[^|*]*\*\*(\d[^*]*)\*\*/gm

test('every package CAVEATS.md names inline with a version has a sidecar row', () => {
  const named = [...new Set([...caveats.matchAll(INLINE)].map((m) => m[1]))]
  assert.ok(named.length > 0, 'CAVEATS.md no longer names any package with a version inline; update INLINE in this test')
  const packages = new Set(rows.map((r) => r.package))
  const missing = named.filter((p) => !packages.has(p))
  assert.deepEqual(missing, [], `named with a version in CAVEATS.md but absent from the sidecar: ${missing.join(', ')}`)
})

test('every Tier-3 table row that prints a live version has a sidecar row recording the same one', () => {
  // Any row whose Live cell prints a bold version is a claim about that version, whatever its
  // Documents cell says — `motion-framer` documents a relationship, not a number, and still
  // prints "both **13.1.1**". A row that prints no version ("lists FID as a Core Web Vital")
  // does not match TABLE and has nothing to check.
  const claims = [...caveats.matchAll(TABLE)]
    .map((m) => ({ skill: m[1], live: m[3].trim() }))
  assert.ok(claims.length > 0, 'the Tier-3 table format changed; update TABLE in this test')
  for (const c of claims) {
    const mine = rows.filter((r) => r.skill === c.skill)
    assert.ok(mine.length > 0, `table row ${c.skill} has no sidecar row`)
    for (const r of mine) {
      assert.equal(r.recorded, c.live, `${c.skill}: sidecar records ${r.recorded}, the table says ${c.live}`)
    }
  }
})

test('the index builder names what it could not index, instead of dropping it in silence', (t) => {
  // A SKILL.md with no front matter has no name and no description to grep for, so the builder
  // skipped it — silently. Grep found nothing, and nothing found reads as nothing there. Eight
  // real files were invisible to the only route anybody is told to use.
  const root = mkdtempSync(join(tmpdir(), 'cgc-index-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, '_index'), { recursive: true })
  mkdirSync(join(root, 'a-repo', 'good'), { recursive: true })
  mkdirSync(join(root, 'a-repo', 'headless'), { recursive: true })
  writeFileSync(join(root, 'a-repo', 'good', 'SKILL.md'), '---\nname: good-skill\ndescription: one that can be indexed\n---\nbody')
  writeFileSync(join(root, 'a-repo', 'headless', 'SKILL.md'), '# No front matter here\n\nstill a real file')

  const r = spawnSync(process.execPath, [join(REPO, 'library', 'build-index.mjs')],
    { encoding: 'utf8', timeout: 120000, env: { ...process.env, LIBRARY_ROOT: root } })
  assert.equal(r.status, 0, r.stderr)
  const index = readFileSync(join(root, '_index', 'INDEX.md'), 'utf8')
  assert.match(index, /good-skill/, 'the indexable one is indexed')
  assert.match(index, /## not indexed \(1\)/, 'and the one that could not be is counted')
  assert.ok(index.includes('headless') && index.includes('SKILL.md'), 'by path, so a grep for the topic still finds it')
  assert.match(r.stdout, /no readable front matter/, 'and the run says so out loud')
})
