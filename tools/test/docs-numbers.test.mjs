// Documented numbers must match measured reality.
//
// Three figures in this repo's prose were wrong at once — "12 Tier-2 skills" (13), "11 skill
// repos" (12), and a resident cost quoted as both ~1,350 and ~2,100 (measured ~1,508) — because
// a commit added a skill and touched no documentation. A number in prose is a claim, and an
// unchecked claim rots silently.
//
// So the numbers are MEASURED here and asserted against what the docs say. Change the library
// and this fails, naming the file to update. That converts a documentation convention into a
// gate, which is the only kind of standard that actually binds.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, buildVars } from '../paths.mjs'

const LIBRARY_ROOT = buildVars().LIBRARY_ROOT
const sources = JSON.parse(readFileSync(join(REPO, 'library', 'sources.json'), 'utf8'))

/** The cost a skill imposes on EVERY session: its name + description frontmatter, chars/4.
 *  Identical to doctor.mjs's method — two different measurements of "the same" number is how
 *  the contradictory figures appeared in the first place. */
function frontmatterCost(file) {
  const m = readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return 0
  let chars = 0, inKey = false
  for (const line of m[1].split(/\r?\n/)) {
    if (/^(name|description):/.test(line)) { chars += line.length; inKey = true }
    else if (/^[A-Za-z_-]+:/.test(line)) inKey = false
    else if (inKey) chars += line.length
  }
  return chars
}

/** Every number a doc states, so a claim can be checked against measurement. */
function numbersIn(relPath) {
  const p = join(REPO, relPath)
  if (!existsSync(p)) return { text: '', nums: [] }
  const text = readFileSync(p, 'utf8')
  const nums = [...text.matchAll(/~?([\d,]+)/g)]
    .map((m) => Number(m[1].replace(/,/g, '')))
    .filter((n) => Number.isFinite(n))
  return { text, nums }
}

const DOCS = ['README.md', 'config/CLAUDE.md', 'config/ui-design-stack.md', 'docs/architecture.md', 'docs/troubleshooting.md']

test('the tier-2 count stated in prose matches sources.json', () => {
  const actual = sources.tier2.length
  for (const d of DOCS) {
    const { text } = numbersIn(d)
    // Only check documents that actually make the claim.
    const claim = text.match(/(\d+)\s+(?:Tier-2|tier-2)\s+skills/)
    if (!claim) continue
    assert.equal(Number(claim[1]), actual,
      `${d} says ${claim[1]} tier-2 skills; sources.json declares ${actual}`)
  }
})

test('the repo count stated in prose matches sources.json', () => {
  const clonable = sources.repos.filter((r) => !r.rejected).length
  for (const d of DOCS) {
    const { text } = numbersIn(d)
    const claim = text.match(/(\d+)\s+(?:skill repos|repos cloned|cloned repos)/)
    if (!claim) continue
    assert.equal(Number(claim[1]), clonable,
      `${d} says ${claim[1]} repos; sources.json has ${clonable} clonable`)
  }
})

test('every tier-2 path resolves, so the resident cost is measurable at all', (t) => {
  if (!existsSync(LIBRARY_ROOT)) return t.skip('library not cloned on this machine')
  const missing = sources.tier2
    .filter((s) => !existsSync(join(LIBRARY_ROOT, ...s.path.split('/'), 'SKILL.md')))
    .map((s) => s.name)
  assert.deepEqual(missing, [], `tier-2 skills declared but not on disk: ${missing.join(', ')}`)
})

test('the quoted resident token cost is within 15% of measured', (t) => {
  if (!existsSync(LIBRARY_ROOT)) return t.skip('library not cloned on this machine')
  let chars = 0
  for (const s of sources.tier2) {
    const f = join(LIBRARY_ROOT, ...s.path.split('/'), 'SKILL.md')
    if (existsSync(f)) chars += frontmatterCost(f)
  }
  const measured = Math.round(chars / 4)

  for (const d of DOCS) {
    const { text } = numbersIn(d)
    // Claims about the RESIDENT set only. "per session" is deliberately NOT accepted as a
    // marker: the all-installed figure is also quoted per session, so matching on it made
    // this test flag a correct sentence. A check with false positives gets switched off,
    // which is worse than not having it — so the marker must be the word "resident" itself.
    const claim = text.match(/~([\d,]+)\s+tokens?\)?[^.\n]{0,30}\bresident\b/i)
      || text.match(/\bresident\b[^.\n]{0,30}~([\d,]+)\s+tokens/i)
      || text.match(/\|\s*~([\d,]+)\s+tokens\s*\|/)
    if (!claim) continue
    const stated = Number(claim[1].replace(/,/g, ''))
    const drift = Math.abs(stated - measured) / measured
    assert.ok(drift <= 0.15,
      `${d} claims ~${stated} resident tokens; measured ${measured} (${Math.round(drift * 100)}% off). Re-measure and update the prose.`)
  }
})

test('no doc claims a library total smaller than the tier-2 set it contains', () => {
  // A weak but load-bearing sanity check: the "if everything were installed" figure must
  // exceed the resident figure, or the argument the docs make is inverted.
  for (const d of DOCS) {
    const { text } = numbersIn(d)
    const all = text.match(/~([\d,]+)\s+tokens\s+(?:every session|per session)/i)
    const resident = text.match(/~([\d,]+)\s+tokens?\)?[^.\n]{0,40}resident/i)
    if (!all || !resident) continue
    assert.ok(Number(all[1].replace(/,/g, '')) > Number(resident[1].replace(/,/g, '')),
      `${d} states an all-installed cost no larger than the resident cost`)
  }
})

test('sources.json and the built index agree on how many repos exist', (t) => {
  const indexPath = join(REPO, 'library', 'INDEX.md')
  if (!existsSync(indexPath)) return t.skip('index not built on this machine')
  const head = readFileSync(indexPath, 'utf8').slice(0, 600)
  const m = head.match(/(\d+)\s+skills\s+across\s+(\d+)\s+repos/)
  if (!m) return t.skip('index header format changed')
  const declared = sources.repos.filter((r) => !r.rejected).length
  // The index counts directories present on disk, which can legitimately exceed the
  // clonable list if someone cloned something by hand — but it must never be FEWER,
  // because that means a declared repo failed to clone and nobody noticed.
  assert.ok(Number(m[2]) >= declared,
    `index reports ${m[2]} repos on disk but sources.json declares ${declared} clonable — a clone failed silently`)
})
