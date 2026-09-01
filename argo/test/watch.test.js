/**
 * Pins the caveats half of `argo watch`: the sidecar-vs-registry comparison
 * that answers a caveats document's own instruction, "regenerate the version
 * rows — they rot".
 *
 * Everything runs against fixture registry documents. A test that needed the
 * network would be the first thing switched off in CI, and a switched-off rot
 * detector is how the rows rotted in the first place.
 */

import test, { describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { versionParts, compareCaveat, checkCaveats, fetchSource } from '../src/watch/sources.js'
import { run as watch } from '../src/watch/cmd.js'

/** A registry response as get() returns it, reduced to what the check reads. */
const doc = (latest, tags = {}) => ({ ok: true, status: 200, body: { 'dist-tags': { latest, ...tags } } })
const row = (documents, extra = {}) => ({ skill: 'some-skill', package: 'some-pkg', documents, ...extra })

/* ------------------------------------------------------------------ *
 * versionParts
 * ------------------------------------------------------------------ */

describe('versionParts', () => {
  test('reads the leading major and minor out of versions and ranges', () => {
    assert.deepEqual(versionParts('^8.18.8'), [8, 18])
    assert.deepEqual(versionParts('~0.172.0'), [0, 172])
    assert.deepEqual(versionParts('3.0.0-beta.6'), [3, 0])
    assert.deepEqual(versionParts('3.12'), [3, 12])
  })

  test('a major with no minor, or a wildcard minor, has minor null', () => {
    assert.deepEqual(versionParts('7.x'), [7, null])
    assert.deepEqual(versionParts('v3'), [3, null])
    assert.deepEqual(versionParts('11'), [11, null])
  })

  test('a dist-tag or nothing at all is null, not a guess', () => {
    assert.equal(versionParts('next'), null)
    assert.equal(versionParts(''), null)
    assert.equal(versionParts(undefined), null)
  })

  test('prose that merely contains digits is not a version', () => {
    // "React 18 / R3F 8" used to read as [18, null] and produce a confident "ahead".
    assert.equal(versionParts('React 18 / R3F 8'), null)
    assert.equal(versionParts('v4 API'), null)
    assert.equal(versionParts('since 2018'), null)
    assert.deepEqual(versionParts('>=1.2.0'), [1, 2], 'a range operator is still a version')
    assert.deepEqual(versionParts('1.x.x'), [1, null])
  })
})

/* ------------------------------------------------------------------ *
 * compareCaveat — pure, one row against one response
 * ------------------------------------------------------------------ */

describe('compareCaveat', () => {
  test('a newer live major is MAJOR-BEHIND, with the live version reported', () => {
    const r = compareCaveat(row('^8.18.8'), doc('9.7.0'))
    assert.equal(r.status, 'MAJOR-BEHIND')
    assert.equal(r.live, '9.7.0')
  })

  test('two majors stale is still MAJOR-BEHIND', () => {
    assert.equal(compareCaveat(row('7.x'), doc('9.23.0')).status, 'MAJOR-BEHIND')
  })

  test('the same major with a newer minor is minor-behind', () => {
    assert.equal(compareCaveat(row('3.12'), doc('3.15.0')).status, 'minor-behind')
  })

  test('a 0.x line compares like any other: minor movement is minor-behind', () => {
    // Deliberately coarse. semver treats 0.x minors as breaking, but this check
    // is asking whether the document's version text is stale, not whether an
    // upgrade is safe.
    assert.equal(compareCaveat(row('^0.172.0'), doc('0.185.1')).status, 'minor-behind')
  })

  test('current when the live version satisfies what is documented', () => {
    assert.equal(compareCaveat(row('^8.18.8'), doc('8.18.8')).status, 'current')
    assert.equal(compareCaveat(row('7.x'), doc('7.54.2')).status, 'current', 'wildcard minor')
    assert.equal(compareCaveat(row('11'), doc('11.18.2')).status, 'current', 'major-only claim')
    assert.equal(compareCaveat(row('v4'), doc('4.0.1')).status, 'current', 'v-prefixed major')
  })

  test('patch drift is ignored', () => {
    assert.equal(compareCaveat(row('^8.18.8'), doc('8.18.9')).status, 'current')
  })

  test('a dist-tag in documents resolves through the registry before comparing', () => {
    const r = compareCaveat(row('next'), doc('2.3.4', { next: '3.0.0-beta.6' }))
    assert.equal(r.resolved, '3.0.0-beta.6')
    assert.equal(r.live, '2.3.4')
    assert.equal(r.status, 'ahead', 'a pre-release tag newer than latest is ahead, not behind')
  })

  test('a tag the registry does not have is unknown, but the live version is still reported', () => {
    const r = compareCaveat(row('next'), doc('2.3.4'))
    assert.equal(r.status, 'unknown')
    assert.equal(r.live, '2.3.4')
    assert.match(r.reason, /"next"/)
  })

  test('a registry document with no dist-tags is unknown', () => {
    const r = compareCaveat(row('^1.0.0'), { ok: true, status: 200, body: {} })
    assert.equal(r.status, 'unknown')
    assert.equal(r.live, null)
    assert.match(r.reason, /no latest/)
  })

  test('offline degrades to "could not check", never to current', () => {
    const r = compareCaveat(row('^8.18.8', { recorded: '9.7.0' }), { ok: false, status: 0, error: 'timeout' })
    assert.equal(r.status, 'unknown')
    assert.equal(r.live, null)
    assert.equal(r.stale, false, 'cannot call a row stale without a live version')
    assert.equal(r.reason, 'could not check: timeout')
  })

  test('no response at all does not throw', () => {
    assert.equal(compareCaveat(row('^8.18.8'), undefined).status, 'unknown')
    assert.equal(compareCaveat(row('^8.18.8'), null).status, 'unknown')
  })

  test('stale means the registry moved past the recorded version', () => {
    assert.equal(compareCaveat(row('^8.18.8', { recorded: '9.7.0' }), doc('9.8.0')).stale, true)
    assert.equal(compareCaveat(row('^8.18.8', { recorded: '9.7.0' }), doc('9.7.0')).stale, false)
    assert.equal(compareCaveat(row('^8.18.8'), doc('9.7.0')).stale, false, 'nothing recorded, nothing to be stale against')
  })

  test('stale is still computed when the documented version cannot be parsed', () => {
    // The recorded number rotting is the finding; a bad documents field is a
    // separate defect and must not hide it.
    const r = compareCaveat(row('banana', { recorded: '9.7.0' }), doc('9.8.0'))
    assert.equal(r.status, 'unknown')
    assert.equal(r.stale, true)
    const prose = compareCaveat(row('React 18 / R3F 8'), doc('9.7.0'))
    assert.equal(prose.status, 'unknown', 'digits inside prose are not a claim')
    assert.match(prose.reason, /neither a version nor a dist-tag/)
  })

  test('a 404 is not "could not check": the package is not on the registry, and the row says so', () => {
    const r = compareCaveat(row('^1.0.0', { recorded: '1.2.3' }), { ok: false, status: 404, error: 'HTTP 404' })
    assert.equal(r.status, 'not-found')
    assert.equal(r.live, null)
    assert.equal(r.stale, false)
    assert.match(r.reason, /not on the registry/)
  })

  test('the row\'s own fields come through, so the report needs no join', () => {
    const r = compareCaveat(row('v3', { note: 'named exports only' }), doc('4.5.0'))
    assert.equal(r.skill, 'some-skill')
    assert.equal(r.package, 'some-pkg')
    assert.equal(r.note, 'named exports only')
  })
})

/* ------------------------------------------------------------------ *
 * checkCaveats — many rows, injected fetcher
 * ------------------------------------------------------------------ */

describe('checkCaveats', () => {
  const REGISTRY = { gsap: doc('3.15.0'), three: doc('0.185.1') }

  test('fetches each distinct package once and keeps sidecar order', async () => {
    const asked = []
    const rows = [
      { skill: 'gsap-web', package: 'gsap', documents: '3.12' },
      { skill: 'svg-animation', package: 'gsap', documents: '3.12' },
      { skill: 'react-three-fiber', package: 'three', documents: '^0.172.0' },
    ]
    const out = await checkCaveats(rows, async (pkg) => { asked.push(pkg); return REGISTRY[pkg] })
    assert.deepEqual(asked, ['gsap', 'three'])
    assert.deepEqual(out.map((r) => [r.skill, r.status]), [
      ['gsap-web', 'minor-behind'],
      ['svg-animation', 'minor-behind'],
      ['react-three-fiber', 'minor-behind'],
    ])
  })

  test('a fetcher that throws marks its rows unknown instead of rejecting', async () => {
    const rows = [
      { skill: 'a', package: 'gsap', documents: '3.12' },
      { skill: 'b', package: 'broken', documents: '1' },
    ]
    const out = await checkCaveats(rows, (pkg) => {
      if (pkg === 'broken') throw new Error('ECONNRESET')
      return REGISTRY[pkg]
    })
    assert.equal(out[0].status, 'minor-behind')
    assert.equal(out[1].status, 'unknown')
    assert.match(out[1].reason, /ECONNRESET/)
  })

  test('a fetcher that rejects is handled the same way', async () => {
    const out = await checkCaveats([{ skill: 'b', package: 'x', documents: '1' }], async () => { throw new Error('DNS') })
    assert.equal(out[0].status, 'unknown')
    assert.match(out[0].reason, /DNS/)
  })

  test('no rows, no fetches', async () => {
    let calls = 0
    assert.deepEqual(await checkCaveats([], async () => { calls++ }), [])
    assert.equal(calls, 0)
  })
})

/* ------------------------------------------------------------------ *
 * fetchSource — the caveats source type shares the npm path
 * ------------------------------------------------------------------ */

/**
 * Replace global fetch with a fixture registry. Returns the URLs asked for,
 * so a test can prove two source types went through the same door.
 */
function stubFetch(bodies, { fail = false, down = [] } = {}) {
  const real = globalThis.fetch
  const urls = []
  globalThis.fetch = async (url) => {
    urls.push(String(url))
    if (fail) throw new TypeError('fetch failed')
    const pkg = decodeURIComponent(String(url).replace('https://registry.npmjs.org/', ''))
    // `down` is a package whose fetch fails at the network; a package absent from
    // `bodies` is one the registry answers 404 for. The two are different findings.
    if (down.includes(pkg)) throw new TypeError('fetch failed')
    const body = bodies[pkg]
    return body
      ? { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
      : { ok: false, status: 404, json: async () => ({}), text: async () => '' }
  }
  return { urls, restore: () => { globalThis.fetch = real } }
}

const FIBER = {
  'dist-tags': { latest: '9.7.0' },
  time: { created: '2019-01-01T00:00:00Z', modified: '2026-08-01T00:00:00Z', '9.7.0': '2026-08-01T00:00:00Z', '9.6.0': '2026-06-01T00:00:00Z' },
}

describe('fetchSource caveats', () => {
  test('the caveats and npm source types hit the same registry URL for the same package', async () => {
    const stub = stubFetch({ '@react-three/fiber': FIBER })
    try {
      const rows = [{ skill: 'react-three-fiber', package: '@react-three/fiber', documents: '^8.18.8' }]
      const c = await fetchSource({ type: 'caveats', rows })
      const n = await fetchSource({ type: 'npm', package: '@react-three/fiber', limit: 5 })
      assert.equal(c.ok, true)
      assert.equal(c.items[0].status, 'MAJOR-BEHIND')
      assert.equal(n.ok, true)
      assert.equal(n.items[0].id, '@react-three/fiber@9.7.0')
      assert.equal(stub.urls.length, 2)
      assert.equal(stub.urls[0], stub.urls[1])
      assert.equal(stub.urls[0], 'https://registry.npmjs.org/%40react-three%2Ffiber')
    } finally {
      stub.restore()
    }
  })

  test('a caveats source without usable rows is a config error, not a silent pass', async () => {
    const stub = stubFetch({})
    try {
      for (const src of [{ type: 'caveats' }, { type: 'caveats', rows: [] }, { type: 'caveats', rows: { oops: 1 } }]) {
        const r = await fetchSource(src)
        assert.equal(r.ok, false, JSON.stringify(src))
        assert.match(r.error, /needs a non-empty "rows" array/)
        assert.deepEqual(r.items, [])
      }
      // A row that would crash the printer is refused at this door with the same words as --caveats.
      const bad = await fetchSource({ type: 'caveats', rows: [{ documents: '1.0.0' }] })
      assert.equal(bad.ok, false)
      assert.match(bad.error, /row 0 needs string skill, package and documents/)
      assert.equal(stub.urls.length, 0, 'nothing was fetched for any of them')
    } finally {
      stub.restore()
    }
  })

  test('network down: every row says could not check, and the source itself does not fail', async () => {
    const stub = stubFetch({}, { fail: true })
    try {
      const rows = [
        { skill: 'a', package: 'gsap', documents: '3.12', recorded: '3.15.0' },
        { skill: 'b', package: 'three', documents: '^0.172.0', recorded: '0.185.1' },
      ]
      const r = await fetchSource({ type: 'caveats', rows })
      assert.equal(r.ok, true)
      assert.deepEqual(r.items.map((it) => it.status), ['unknown', 'unknown'])
      assert.ok(r.items.every((it) => it.reason.startsWith('could not check:')))
      assert.ok(r.items.every((it) => it.stale === false))
    } finally {
      stub.restore()
    }
  })
})

/* ------------------------------------------------------------------ *
 * argo watch --caveats — the exit-code contract
 * ------------------------------------------------------------------ */

const ROOT = mkdtempSync(join(tmpdir(), 'argo-watch-'))
after(() => rmSync(ROOT, { recursive: true, force: true }))

let n = 0
function sandbox(files = {}) {
  const dir = join(ROOT, `case-${++n}`)
  mkdirSync(dir, { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body), 'utf8')
  }
  return dir
}

async function capture(fn) {
  const [log, err] = [console.log, console.error]
  const lines = []
  console.log = (...a) => lines.push(a.join(' '))
  console.error = (...a) => lines.push(a.join(' '))
  try {
    const code = await fn()
    return { code, out: lines.join('\n') }
  } finally {
    console.log = log
    console.error = err
  }
}

const REGISTRY = {
  '@react-three/fiber': FIBER,
  gsap: { 'dist-tags': { latest: '3.15.0' } },
  aos: { 'dist-tags': { latest: '2.3.4', next: '3.0.0-beta.6' } },
}

const FRESH = [
  { skill: 'react-three-fiber', package: '@react-three/fiber', documents: '^8.18.8', recorded: '9.7.0' },
  { skill: 'gsap-web', package: 'gsap', documents: '3.12', recorded: '3.15.0' },
  { skill: 'scroll-reveal-libraries', package: 'aos', documents: 'next', recorded: '2.3.4' },
]

describe('argo watch --caveats', () => {
  test('--caveats without a path exits 2 and says so', async () => {
    const { code, out } = await capture(() => watch({ caveats: true }))
    assert.equal(code, 2)
    assert.match(out, /needs the path/)
  })

  test('a missing sidecar exits 2 and names the path', async () => {
    const dir = sandbox()
    const { code, out } = await capture(() => watch({ caveats: join(dir, 'nope.json') }))
    assert.equal(code, 2)
    assert.match(out, /nope\.json/)
  })

  test('a sidecar that is not an array, or has a row missing a field, exits 2', async () => {
    const dir = sandbox({ 'obj.json': { skill: 'x' }, 'row.json': [{ skill: 'x', package: 'y' }] })
    assert.equal((await capture(() => watch({ caveats: join(dir, 'obj.json') }))).code, 2)
    const bad = await capture(() => watch({ caveats: join(dir, 'row.json') }))
    assert.equal(bad.code, 2)
    assert.match(bad.out, /row 0/)
  })

  test('exits 0 when every recorded version still matches the registry', async () => {
    const stub = stubFetch(REGISTRY)
    try {
      const dir = sandbox({ 'c.json': FRESH })
      const { code, out } = await capture(() => watch({ caveats: join(dir, 'c.json') }))
      assert.equal(code, 0)
      assert.match(out, /MAJOR-BEHIND\s+@react-three\/fiber/)
      assert.match(out, /minor-behind\s+gsap/)
      assert.match(out, /ahead\s+aos.*next \(3\.0\.0-beta\.6\)/)
      assert.match(out, /0 stale/)
      assert.doesNotMatch(out, /regenerate/)
    } finally {
      stub.restore()
    }
  })

  test('exits 1 when a recorded version has moved, and says which', async () => {
    const stub = stubFetch({ ...REGISTRY, gsap: { 'dist-tags': { latest: '3.16.0' } } })
    try {
      const dir = sandbox({ 'c.json': FRESH })
      const { code, out } = await capture(() => watch({ caveats: join(dir, 'c.json') }))
      assert.equal(code, 1)
      assert.match(out, /gsap.*3\.16\.0.*recorded 3\.15\.0/)
      assert.match(out, /1 stale/)
      assert.match(out, /regenerate the version rows/)
    } finally {
      stub.restore()
    }
  })

  test('a new major is caught by the same rule', async () => {
    const stub = stubFetch({ ...REGISTRY, gsap: { 'dist-tags': { latest: '4.0.0' } } })
    try {
      const dir = sandbox({ 'c.json': FRESH })
      const { code, out } = await capture(() => watch({ caveats: join(dir, 'c.json') }))
      assert.equal(code, 1)
      assert.match(out, /MAJOR-BEHIND\s+gsap/)
    } finally {
      stub.restore()
    }
  })

  test('exits 2 when the registry is unreachable — every row says could not check, none says current', async () => {
    const stub = stubFetch({}, { fail: true })
    try {
      const dir = sandbox({ 'c.json': FRESH })
      const { code, out } = await capture(() => watch({ caveats: join(dir, 'c.json') }))
      assert.equal(code, 2)
      assert.equal((out.match(/could not check/g) ?? []).length, FRESH.length)
      assert.doesNotMatch(out, /\bcurrent\b/)
    } finally {
      stub.restore()
    }
  })

  test('one unreachable package does not sink the run', async () => {
    const stub = stubFetch(REGISTRY, { down: ['gsap'] })
    try {
      const dir = sandbox({ 'c.json': FRESH })
      const { code, out } = await capture(() => watch({ caveats: join(dir, 'c.json') }))
      assert.equal(code, 0)
      assert.match(out, /unknown\s+gsap.*could not check: fetch failed/)
      assert.match(out, /1 unknown/)
    } finally {
      stub.restore()
    }
  })

  test('a package the registry does not have is not-found and exits 1 — a typo must not pass forever', async () => {
    // This used to be "unknown", exit 0, as long as one other row parsed: a CI gate
    // on the exit code would have stayed green for a sidecar that checks nothing.
    const { gsap: _omit, ...withoutGsap } = REGISTRY
    const stub = stubFetch(withoutGsap)
    try {
      const dir = sandbox({ 'c.json': FRESH })
      const { code, out } = await capture(() => watch({ caveats: join(dir, 'c.json') }))
      assert.equal(code, 1)
      assert.match(out, /not-found\s+gsap.*not on the registry/)
      assert.match(out, /1 package is not on the registry — fix the sidecar: gsap/)
      const json = await capture(() => watch({ caveats: join(dir, 'c.json'), json: true }))
      assert.equal(json.code, 1)
      assert.equal(JSON.parse(json.out).notFound, 1)
    } finally {
      stub.restore()
    }
  })

  test('a row with a live version but no status still prints its reason', async () => {
    const stub = stubFetch(REGISTRY)
    try {
      const dir = sandbox({ 'c.json': [{ skill: 'x', package: 'aos', documents: 'nope-tag', recorded: '2.3.4' }] })
      const { code, out } = await capture(() => watch({ caveats: join(dir, 'c.json') }))
      assert.equal(code, 2, 'the only row could not be compared')
      assert.match(out, /unknown\s+aos.*2\.3\.4 — could not compare: "nope-tag"/)
    } finally {
      stub.restore()
    }
  })

  test('a recorded value that is not a string exits 2 — a number can never equal the registry string', async () => {
    const dir = sandbox({ 'c.json': [{ skill: 'x', package: 'gsap', documents: '3.12', recorded: 3.15 }] })
    const { code, out } = await capture(() => watch({ caveats: join(dir, 'c.json') }))
    assert.equal(code, 2)
    assert.match(out, /row 0: recorded must be/)
  })

  test('radar mode reports a malformed caveats source instead of dropping it or crashing', async () => {
    const dir = sandbox({
      'w.json': { keywords: [], sources: [{ type: 'caveats', rows: { oops: 1 } }] },
      'r.json': { keywords: [], sources: [{ type: 'caveats', rows: [{ documents: '1.0.0' }] }] },
    })
    const shape = await capture(() =>
      watch({ config: join(dir, 'w.json'), state: join(dir, 's.json'), 'no-save': true }))
    assert.equal(shape.code, 0, 'radar mode is informational')
    assert.match(shape.out, /! caveats: a caveats source needs a non-empty "rows" array/)
    // This row used to reach the printer and throw on `undefined.padEnd`.
    const row = await capture(() =>
      watch({ config: join(dir, 'r.json'), state: join(dir, 's.json'), 'no-save': true }))
    assert.equal(row.code, 0)
    assert.match(row.out, /! caveats: a caveats source row 0 needs string skill, package and documents/)
  })

  test('a stale row outranks "nothing measured": unparseable documents plus a moved recorded version exits 1', async () => {
    // A row can only be stale once the registry answered, so this IS a measurement —
    // and a CI gate reading exit 2 as "could not check" would miss the rot.
    const stub = stubFetch({ ...REGISTRY, gsap: { 'dist-tags': { latest: '4.0.0' } } })
    try {
      const dir = sandbox({ 'c.json': [{ skill: 'x', package: 'gsap', documents: 'React 18 / R3F 8', recorded: '3.15.0' }] })
      const { code, out } = await capture(() => watch({ caveats: join(dir, 'c.json') }))
      assert.equal(code, 1)
      assert.match(out, /1 unknown · 1 stale/)
      assert.match(out, /recorded 3\.15\.0 — could not compare/)
    } finally {
      stub.restore()
    }
  })

  test('--json emits the rows with their statuses and counts', async () => {
    const stub = stubFetch({ ...REGISTRY, gsap: { 'dist-tags': { latest: '3.16.0' } } })
    try {
      const dir = sandbox({ 'c.json': FRESH })
      const { code, out } = await capture(() => watch({ caveats: join(dir, 'c.json'), json: true }))
      assert.equal(code, 1)
      const parsed = JSON.parse(out)
      assert.equal(parsed.stale, 1)
      assert.equal(parsed.unknown, 0)
      assert.deepEqual(parsed.rows.map((r) => r.status), ['MAJOR-BEHIND', 'minor-behind', 'ahead'])
      assert.equal(parsed.rows[1].live, '3.16.0')
    } finally {
      stub.restore()
    }
  })

  test('a rot check never writes a radar config or state into the working directory', async () => {
    const stub = stubFetch(REGISTRY)
    const dir = sandbox({ 'c.json': FRESH })
    const before = process.cwd()
    process.chdir(dir)
    try {
      await capture(() => watch({ caveats: 'c.json' }))
      assert.equal(existsSync(join(dir, '.argo')), false)
    } finally {
      process.chdir(before)
      stub.restore()
    }
  })
})
