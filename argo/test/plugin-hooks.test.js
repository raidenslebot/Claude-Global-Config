import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sessionNotes, gather } from '../plugin/hooks/session-start-graph.js'
// Imported, not hardcoded: the hook has to read the directory the toolkit
// actually writes to, and this is the only thing that notices when it stops.
import { storeDir } from '../src/drift/snapshot.js'

/**
 * The SessionStart hook is only worth having if it stays quiet. Every test here
 * is really the same test: does this fact justify interrupting a session.
 */
describe('sessionNotes', () => {
  test('an empty repo says nothing at all', () => {
    assert.deepEqual(sessionNotes({}), [])
    assert.deepEqual(sessionNotes({ fanout: null, topology: null, selfreport: null }), [])
    assert.deepEqual(sessionNotes(), [])
  })

  test('a fresh plan reports its frozen count and no staleness warning', () => {
    const lines = sessionNotes({ fanout: { ageDays: 2, frozen: 5 } })
    assert.equal(lines.length, 1)
    assert.match(lines[0], /5 frozen file\(s\)/)
    assert.match(lines[0], /2 day\(s\) old/)
    assert.doesNotMatch(lines[0], /re-run/)
  })

  test('a plan older than a week earns a second line telling you to re-run', () => {
    const lines = sessionNotes({ fanout: { ageDays: 30, frozen: 1 } })
    assert.equal(lines.length, 2)
    assert.match(lines[1], /30 days old/)
    assert.match(lines[1], /argo graph \./)
  })

  test('the staleness boundary is exclusive — exactly 7 days is not yet stale', () => {
    assert.equal(sessionNotes({ fanout: { ageDays: 7, frozen: 1 } }).length, 1)
    assert.equal(sessionNotes({ fanout: { ageDays: 7.5, frozen: 1 } }).length, 2)
  })

  test('a clean topology is one calm line', () => {
    const lines = sessionNotes({
      topology: { agents: 6, edges: 10, errors: 0, warnings: 0, linted: true },
    })
    assert.equal(lines.length, 1)
    assert.match(lines[0], /6 agent\(s\), 10 edge\(s\), lints clean/)
  })

  test('lint errors carry the consequence, not just the count', () => {
    const [line] = sessionNotes({
      topology: { agents: 4, edges: 4, errors: 2, warnings: 1, linted: true },
    })
    assert.match(line, /2 lint error\(s\) and 1 warning\(s\)/)
    assert.match(line, /before dispatching/)
  })

  test('warnings alone do not claim the graph is broken', () => {
    const [line] = sessionNotes({
      topology: { agents: 4, edges: 4, errors: 0, warnings: 3, linted: true },
    })
    assert.match(line, /lints with 3 warning\(s\)/)
    assert.doesNotMatch(line, /broken/)
  })

  test('a declaration that does not parse is said out loud, not skipped', () => {
    const lines = sessionNotes({ topology: { broken: true } })
    assert.equal(lines.length, 1)
    assert.match(lines[0], /does not parse/)
    assert.match(lines[0], /before dispatching/)
    assert.doesNotMatch(lines[0], /agent\(s\)/)
  })

  test('a plan whose frozen list could not be read never claims zero frozen files', () => {
    const [line] = sessionNotes({ fanout: { ageDays: 1, frozen: null } })
    assert.match(line, /frozen list unreadable/)
    assert.doesNotMatch(line, /0 frozen file\(s\)/)
  })

  test('an unlinted graph says so instead of claiming it is clean', () => {
    const [line] = sessionNotes({
      topology: { agents: 2, edges: 1, errors: 0, warnings: 0, linted: false },
    })
    assert.match(line, /not linted here/)
    assert.doesNotMatch(line, /clean/)
  })

  test('self-report gates that match the stored record are not news', () => {
    assert.deepEqual(
      sessionNotes({ selfreport: { added: [], removed: [], storedAt: '2026-08-01' } }),
      []
    )
  })

  test('a gate that appeared since the stored report is reported with its date', () => {
    const [line] = sessionNotes({
      selfreport: { added: ['Never use workflows unless the user requested it'], removed: [], storedAt: '2026-08-01' },
    })
    assert.match(line, /2026-08-01/)
    assert.match(line, /1 added, 0 removed/)
    assert.match(line, /selfprobe/)
  })

  test('a gate that disappeared is equally worth saying', () => {
    const lines = sessionNotes({
      selfreport: { added: [], removed: ['Do not call the AgentTool unless the user requested it'], storedAt: '2026-01-02' },
    })
    assert.equal(lines.length, 1)
    assert.match(lines[0], /0 added, 1 removed/)
  })

  test('every applicable fact contributes exactly one block', () => {
    const lines = sessionNotes({
      fanout: { ageDays: 12, frozen: 3 },
      topology: { agents: 6, edges: 10, errors: 0, warnings: 0, linted: true },
      selfreport: { added: ['x'], removed: [], storedAt: '2026-08-01' },
    })
    assert.equal(lines.length, 4, 'plan + staleness + topology + gate drift')
  })
})

describe('gather', () => {
  test('a directory with no .argo produces no facts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'argo-hook-'))
    assert.deepEqual(sessionNotes(await gather(dir)), [])
  })

  test('a malformed topology.json reports itself broken, never thrown and never silent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'argo-hook-'))
    mkdirSync(join(dir, '.argo'), { recursive: true })
    writeFileSync(join(dir, '.argo', 'topology.json'), '{ not json', 'utf8')
    const facts = await gather(dir)
    assert.deepEqual(facts.topology, { broken: true })
    assert.match(sessionNotes(facts)[0], /does not parse/)
  })

  test('a fanout.md that is not a brief reports no frozen count rather than zero', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'argo-hook-'))
    mkdirSync(join(dir, '.argo'), { recursive: true })
    writeFileSync(join(dir, '.argo', 'fanout.md'), '# my own notes\n\nfreeze the config please\n', 'utf8')
    assert.equal((await gather(dir)).fanout.frozen, null)
  })

  test('frozen files and plan age are read off a real brief', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'argo-hook-'))
    mkdirSync(join(dir, '.argo'), { recursive: true })
    const plan = join(dir, '.argo', 'fanout.md')
    // Shaped like what `argo graph . --brief` writes: header, FROZEN entries
    // with a ref count, then owned files without one.
    writeFileSync(plan, [
      '# Fan-out plan',
      '',
      '## FROZEN — read-only for all 5 workers',
      '',
      '- `src/cli.js` — 9 refs, reached from partitions 0, 3',
      '- `src/graph/index.js` — 14 refs, reached from partitions 1',
      '',
      '## worker-1 — 2 owned files',
      '',
      '- `src/watch/cmd.js`',
      '',
    ].join('\n'), 'utf8')
    const old = new Date(Date.now() - 10 * 86_400_000)
    utimesSync(plan, old, old)

    const facts = await gather(dir)
    assert.equal(facts.fanout.frozen, 2)
    assert.ok(facts.fanout.ageDays > 9 && facts.fanout.ageDays < 11, `age was ${facts.fanout.ageDays}`)
  })

  const A = 'Do not call the AgentTool unless the user requested it'
  const B = 'Never use workflows unless the user requested it'
  const C = 'Do not fan out to more than four workers unless the user asks'
  const MENTION = 'Subagents run in parallel and report back to you'

  test('gate drift is computed against the newest stored report only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'argo-hook-'))
    const store = join(storeDir(dir), 'selfreports')
    mkdirSync(store, { recursive: true })
    writeFileSync(join(dir, '.argo', 'selfprobe.txt'), `GATE: ${B}\nGATE: ${C}\n`, 'utf8')
    writeFileSync(join(store, '2026-01-01T00-00-00-000Z-1111.json'),
      JSON.stringify({ capturedAt: '2026-01-01T00:00:00.000Z', gates: [{ text: A }] }), 'utf8')
    writeFileSync(join(store, '2026-08-01T00-00-00-000Z-2222.json'),
      JSON.stringify({ capturedAt: '2026-08-01T00:00:00.000Z', gates: [{ text: A }, { text: B }] }), 'utf8')

    const facts = await gather(dir)
    assert.deepEqual(facts.selfreport.added, [C])
    assert.deepEqual(facts.selfreport.removed, [A])
    assert.equal(facts.selfreport.storedAt, '2026-08-01')
  })

  test('a mention is not a gate — the probe is classified the same way the store was', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'argo-hook-'))
    const store = join(storeDir(dir), 'selfreports')
    mkdirSync(store, { recursive: true })
    writeFileSync(join(dir, '.argo', 'selfprobe.txt'), `GATE: ${B}\nGATE: ${MENTION}\n`, 'utf8')
    writeFileSync(join(store, '2026-08-01T00-00-00-000Z-2222.json'),
      JSON.stringify({ capturedAt: '2026-08-01T00:00:00.000Z', gates: [{ text: B }] }), 'utf8')

    const facts = await gather(dir)
    assert.deepEqual(facts.selfreport, { added: [], removed: [], storedAt: '2026-08-01' })
    assert.deepEqual(sessionNotes(facts), [], 'an unchanged gate set is not news')
  })

  test('a self-probe with no stored report to compare against is silent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'argo-hook-'))
    mkdirSync(join(dir, '.argo'), { recursive: true })
    writeFileSync(join(dir, '.argo', 'selfprobe.txt'), `GATE: ${B}\n`, 'utf8')
    assert.equal((await gather(dir)).selfreport, null)
  })
})
