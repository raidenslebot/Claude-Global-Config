// The registry search. Everything runs against a local stub through the documented env
// overrides — a test that reaches skills.sh would fail on a train, and a green suite that needs
// the network is a suite nobody trusts.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { worstRisk, search, fetchSkill, main, parseId } from '../skills-find.mjs'
import { REPO } from '../paths.mjs'

/** A stub registry, listening on loopback. Returns its base URL. */
async function registry(t, handler) {
  const server = createServer(handler)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  t.after(() => new Promise((r) => server.close(r)))
  return `http://127.0.0.1:${server.address().port}`
}

/** Point the tool at the stub for the duration of one test. */
function point(t, { search: s, download: d, audit: a, library: lib } = {}) {
  const saved = { ...process.env }
  if (s) process.env.CGC_SKILLS_SEARCH_URL = s
  if (d) process.env.CGC_SKILLS_DOWNLOAD_URL = d
  if (a) process.env.CGC_SKILLS_AUDIT_URL = a
  if (lib) process.env.LIBRARY_ROOT = lib
  t.after(() => { process.env = saved })
}

/** Run main() with stdout captured, so a CLI path can be asserted without a child process. */
async function capture(argv) {
  const out = []
  const err = []
  const [logWas, errWas] = [console.log, console.error]
  console.log = (...a) => out.push(a.join(' '))
  console.error = (...a) => err.push(a.join(' '))
  try { return { code: await main(argv), out: out.join('\n'), err: err.join('\n') } } finally {
    console.log = logWas
    console.error = errWas
  }
}

test('the worst scanner verdict is the one that gets shown', () => {
  // Four scanners, and the reassuring one must not be the one a reader sees.
  assert.equal(worstRisk({ a: { risk: 'safe' }, b: { risk: 'high' }, c: { risk: 'low' } }), 'high')
  assert.equal(worstRisk({ a: { risk: 'safe' }, b: { risk: 'safe' } }), 'safe')
  assert.equal(worstRisk({ a: { risk: 'critical' }, b: { risk: 'safe' } }), 'critical')
  // Nothing scanned it, which is not the same as safe and must not read as safe.
  assert.equal(worstRisk({}), null)
  assert.equal(worstRisk(null), null)
  assert.equal(worstRisk({ a: { noRisk: true } }), null)
})

test('a dead endpoint is reported, never shown as an empty result list', async (t) => {
  // These endpoints are undocumented and carry no stability guarantee, so the day one moves the
  // tool must say so. Printing "no skill matches" for a 404 is the failure that hides the failure.
  const base = await registry(t, (req, res) => {
    if (req.url.includes('gone')) { res.writeHead(404); res.end('nope'); return }
    if (req.url.includes('walled')) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{}'); return }
    res.writeHead(500); res.end('boom')
  })

  point(t, { search: `${base}/gone` })
  const dead = await capture(['python'])
  assert.equal(dead.code, 2, dead.out + dead.err)
  assert.match(dead.err, /HTTP 404/)
  assert.doesNotMatch(dead.out, /no skill matches/)

  // A 401 names the cause, because that is the auth-walled route and the fix is a different URL.
  point(t, { search: `${base}/walled` })
  const walled = await capture(['python'])
  assert.match(walled.err, /HTTP 401.*authenticated/s)
})

test('a search returns rows; a query too short to send is refused before any request', async (t) => {
  const base = await registry(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ skills: [{ id: 'o/r/s', skillId: 's', name: 's', installs: 5, source: 'o/r' }] }))
  })
  point(t, { search: base })
  assert.equal((await search('python')).length, 1)
  // The registry rejects anything under two characters; catching it here saves a round trip.
  await assert.rejects(() => search('a'), /two characters/)
})

test('a fetched skill lands in the library, and a path that climbs out is refused', async (t) => {
  const lib = mkdtempSync(join(tmpdir(), 'cgc-skills-'))
  t.after(() => rmSync(lib, { recursive: true, force: true }))

  const base = await registry(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    if (req.url.includes('/evil/')) {
      res.end(JSON.stringify({ files: [{ path: '../../../../pwned.md', contents: 'no' }] }))
    } else if (req.url.startsWith('/dl')) {
      res.end(JSON.stringify({ files: [{ path: 'SKILL.md', contents: '---\nname: x\n---\nbody' }] }))
    } else res.end('{}')
  })

  point(t, { download: `${base}/dl`, audit: `${base}/audit`, library: lib })
  const good = await capture(['--get', 'owner/repo/slug'])
  assert.equal(good.code, 0, good.out + good.err)
  const landed = join(lib, '_found', 'owner', 'repo', 'slug', 'SKILL.md')
  assert.ok(existsSync(landed), `expected ${landed}`)
  assert.match(readFileSync(landed, 'utf8'), /name: x/)

  // The registry supplies the path, so it is remote input and must not escape the destination.
  const bad = await capture(['--get', 'evil/repo/slug'])
  assert.equal(bad.code, 2)
  assert.match(bad.err, /climbs out/)
  assert.equal(existsSync(join(lib, '..', 'pwned.md')), false, 'nothing was written outside the library')

  // An id that is not owner/repo/slug is rejected rather than fetched from a mangled URL.
  await assert.rejects(() => fetchSkill('justaname'), /owner>\/<repo>\/<slug/)
})

test('it never installs into the resident skills directory, and never pings telemetry', () => {
  // Both are why this exists instead of `npx skills add`: ~/.claude/skills costs session context
  // in every session forever, and a name collision there shadows one of this package's skills.
  // Comments are stripped first — the file EXPLAINS both hazards, and matching the explanation
  // rather than the code is the kind of assertion that passes while the code does the opposite.
  const src = readFileSync(join(REPO, 'tools', 'skills-find.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  assert.doesNotMatch(src, /\.claude[\\/]+skills/, 'no code path writes into the resident skills dir')
  assert.doesNotMatch(src, /add-skill\.vercel\.sh\/t\b/, 'no code path calls the telemetry endpoint')
  assert.match(src, /_found/, 'it writes into the indexed library')
})

test('the CLI id itself cannot escape the library', () => {
  // The registry-supplied FILE paths were validated; the owner/repo/slug from the command line
  // were not, and `--get ../../../../escape/repo/slug` wrote a SKILL.md four levels above the
  // library. Every segment is now limited to what a GitHub owner, repo or slug can contain.
  for (const bad of ['../../../../escape/repo/slug', 'C:/x/repo/slug', 'owner/repo/slug?x=1', 'owner/repo/a/b', 'owner//slug', '.', '..']) {
    assert.throws(() => parseId(bad), /valid registry id segment|exactly <owner>/, bad)
  }
  assert.deepEqual(parseId('vercel-labs/agent-skills/web-design-guidelines'),
    { owner: 'vercel-labs', repo: 'agent-skills', slug: 'web-design-guidelines' })
})
