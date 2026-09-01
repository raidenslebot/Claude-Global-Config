/**
 * Pure-function tests for `argo diverge`. No network, no model calls, no spawning.
 * Everything here is deterministic by construction — a divergence report that
 * changed between runs would be worthless as a CI gate.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  normalise, tokens, exactMatch, jaccard, cosine, extractPaths, pathOverlap,
  extractNumbers, numericAgreement, divergence, representative, selfDivergence,
  pairMatrix, consensusTrap, containment,
} from '../src/divergence/score.js'

import {
  defaultProbes, entrypointCandidates, topDirs, topLangs, buildPrompt,
  syntheticAnswer, normaliseProbes, hash32,
} from '../src/divergence/probes.js'

import {
  quoteArg, buildArgv, extractResult, envelopeError, runPool, resolveClaudeBin,
  looksLikeFailureText, spawnPlan, KNOWN_BIN,
} from '../src/divergence/claude.js'
import { buildReport, verdict, renderText, renderMarkdown } from '../src/divergence/report.js'

/* ------------------------------------------------------------------ *
 * normalise / tokens
 * ------------------------------------------------------------------ */

test('normalise strips markdown fences, case and sentence punctuation', () => {
  assert.equal(normalise('```js\nsrc/cli.js\n```'), 'src/cli.js')
  assert.equal(normalise('**The answer is `src/cli.js`.**'), 'the answer is src/cli.js')
  assert.equal(normalise('   Multiple   spaces\n\tand tabs  '), 'multiple spaces and tabs')
})

test('normalise keeps digits together across thousands separators', () => {
  assert.equal(normalise('1,234 files'), '1234 files')
})

test('normalise collapses a leading ./ so the same path reads the same', () => {
  assert.equal(normalise('./src/cli.js'), normalise('src/cli.js'))
})

test('normalise does not eat the dot in a filename', () => {
  assert.ok(normalise('see src/cli.js for details').includes('src/cli.js'))
})

test('tokens of empty input is an empty array, not [""]', () => {
  assert.deepEqual(tokens(''), [])
  assert.deepEqual(tokens('   '), [])
  assert.deepEqual(tokens(null), [])
})

test('exactMatch ignores formatting differences only', () => {
  assert.equal(exactMatch('src/cli.js', '`src/cli.js`'), true)
  assert.equal(exactMatch('src/cli.js', 'src/graph/cmd.js'), false)
})

/* ------------------------------------------------------------------ *
 * jaccard / cosine
 * ------------------------------------------------------------------ */

test('jaccard is 1 for identical and 0 for disjoint token sets', () => {
  assert.equal(jaccard('alpha beta', 'beta alpha'), 1)
  assert.equal(jaccard('alpha beta', 'gamma delta'), 0)
  assert.equal(jaccard('alpha beta', 'alpha gamma'), 1 / 3)
})

test('jaccard treats two empties as agreement', () => {
  assert.equal(jaccard('', ''), 1)
})

test('cosine notices repetition where jaccard does not', () => {
  const a = 'hub hub hub other'
  const b = 'hub other other other'
  assert.equal(jaccard(a, b), 1)
  assert.ok(cosine(a, b) < 1)
})

test('cosine is 0 when one side is empty', () => {
  assert.equal(cosine('anything', ''), 0)
  assert.equal(cosine('', ''), 1)
})

/* ------------------------------------------------------------------ *
 * paths
 * ------------------------------------------------------------------ */

test('extractPaths finds slashed and extensioned tokens, ignoring prose', () => {
  assert.deepEqual(
    extractPaths('The entrypoint is src/cli.js and it loads build.js'),
    ['build.js', 'src/cli.js']
  )
})

test('extractPaths normalises ./ and trailing punctuation to the same path', () => {
  assert.deepEqual(extractPaths('./src/cli.js.'), ['src/cli.js'])
  assert.deepEqual(extractPaths('src/cli.js'), extractPaths('`./src/cli.js`'))
})

test('pathOverlap reports absence so callers do not weight a layer that fired on nothing', () => {
  const none = pathOverlap('yes it does', 'no it does not')
  assert.equal(none.present, false)
  assert.equal(none.similarity, 1)

  const some = pathOverlap('src/cli.js', 'src/graph/cmd.js')
  assert.equal(some.present, true)
  assert.equal(some.similarity, 0)
})

test('pathOverlap sees through the prose wrapped around the same path', () => {
  const r = pathOverlap('src/cli.js', 'I believe the answer here is src/cli.js')
  assert.equal(r.similarity, 1)
})

/* ------------------------------------------------------------------ *
 * numbers
 * ------------------------------------------------------------------ */

test('extractNumbers takes quantities but not identifiers or path segments', () => {
  assert.deepEqual(extractNumbers('there are 12 files'), [12])
  assert.deepEqual(extractNumbers('p90 fan-in'), [])
  assert.deepEqual(extractNumbers('src/v2/api.js'), [])
  assert.deepEqual(extractNumbers('threshold 0.35'), [0.35])
})

test('numericAgreement separates "no numbers" from "different numbers"', () => {
  assert.equal(numericAgreement('a path', 'another path').present, false)
  assert.equal(numericAgreement('12', '12').agreement, 1)
  assert.equal(numericAgreement('12', '7').agreement, 0)
  assert.equal(numericAgreement('12', 'no idea').agreement, 0)
})

/* ------------------------------------------------------------------ *
 * divergence
 * ------------------------------------------------------------------ */

test('divergence is 0 for identical answers and for formatting-only differences', () => {
  assert.equal(divergence('src/cli.js', 'src/cli.js'), 0)
  assert.equal(divergence('src/cli.js', '`SRC/CLI.JS`'), 0)
})

test('divergence is 1 when one side answered nothing', () => {
  assert.equal(divergence('src/cli.js', ''), 1)
  assert.equal(divergence('', ''), 0)
})

test('divergence is symmetric and bounded', () => {
  const pairs = [
    ['src/cli.js', 'src/graph/build.js'],
    ['12 files', 'about 40 files'],
    ['yes, there is a cycle', 'no cycles here'],
    ['', 'something'],
  ]
  for (const [a, b] of pairs) {
    const d = divergence(a, b)
    assert.equal(d, divergence(b, a), `asymmetric on ${a} / ${b}`)
    assert.ok(d >= 0 && d <= 1, `out of range on ${a} / ${b}: ${d}`)
  }
})

test('a numeric contradiction outweighs identical wording around it', () => {
  const sameWords = divergence('the repo contains 12 source files', 'the repo contains 12 source files')
  const differentNumber = divergence('the repo contains 12 source files', 'the repo contains 40 source files')
  assert.equal(sameWords, 0)
  assert.ok(differentNumber >= 0.4, `expected a strong signal, got ${differentNumber}`)
})

test('a path contradiction outweighs identical wording around it', () => {
  const d = divergence('The entrypoint is src/cli.js', 'The entrypoint is src/graph/cmd.js')
  assert.ok(d >= 0.35, `expected a strong signal, got ${d}`)
})

test('wording noise and real disagreement sit on opposite sides of the default gate', () => {
  // The whole gate depends on this separation. If a future weight change lets
  // padding cross 0.35, every CI run starts crying wolf.
  const wording = [
    ['src/cli.js', 'The answer is src/cli.js.'],
    ['34', 'Based on the repository structure, 34 is the one.'],
    ['src/cli.js', 'The entrypoint is src/cli.js, which the bin field points at.'],
    // no path and no number: the lexical layer stands alone here, which is the
    // branch the weight tuning above does not reach.
    ['javascript', 'The primary language is javascript.'],
  ]
  const real = [
    ['The entrypoint is src/cli.js', 'The entrypoint is src/graph/cmd.js'],
    ['the repo contains 12 source files', 'the repo contains 40 source files'],
    ['src/cli.js', 'I could not determine that'],
    ['yes there is a circular dependency', 'no there is no circular dependency'],
  ]
  for (const [a, b] of wording) {
    assert.ok(divergence(a, b) < 0.35, `wording pair scored ${divergence(a, b)}: ${a} / ${b}`)
  }
  for (const [a, b] of real) {
    assert.ok(divergence(a, b) > 0.35, `real disagreement scored ${divergence(a, b)}: ${a} / ${b}`)
  }
})

test('containment fires only on a strict subset, never on a partial overlap', () => {
  assert.equal(containment('javascript', 'The primary language is javascript.'), true)
  assert.equal(containment('src', 'The answer is src.'), true)
  assert.equal(containment('a b', 'a b'), true)
  // The pair that must NOT be treated as padding: heavy word overlap, opposite claim.
  assert.equal(
    containment('yes there is a circular dependency', 'no there is no circular dependency'),
    false
  )
  assert.equal(containment('src/cli.js', 'src/graph/cmd.js'), false)
  assert.equal(containment('', 'anything'), false)
})

test('a bare answer wrapped in a sentence is padding, not a breach', () => {
  // Regression. The default probe set asks for bare answers ("Answer with one
  // word", "the directory name only"), so the two answers below carry no path
  // and no number and land on the lexical layer alone. Before the containment
  // floor they scored 0.60-0.77 and the tool reported BREACH on two agents that
  // had given the identical answer — the gate crying wolf on its own probes.
  const padded = [
    ['javascript', 'The primary language is javascript.'],
    ['javascript', 'Based on the repository structure, javascript is the one.'],
    ['src', 'The directory with the most source files is src.'],
    ['src', 'The answer is src.'],
    ['yes', 'The answer is yes.'],
  ]
  for (const [a, b] of padded) {
    const d = divergence(a, b)
    assert.ok(d < 0.35, `padded restatement scored ${d}: ${a} / ${b}`)
  }
  // and it still separates: a genuinely different one-word answer stays maximal
  assert.equal(divergence('javascript', 'python'), 1)
  assert.equal(divergence('src', 'test'), 1)
})

test('the same path in prose scores far lower than a different path', () => {
  const wording = divergence('src/cli.js', 'It is src/cli.js, the CLI entrypoint.')
  const contradiction = divergence('src/cli.js', 'It is src/graph/cmd.js, the CLI entrypoint.')
  assert.ok(wording < contradiction, `${wording} should be below ${contradiction}`)
  assert.ok(wording < 0.35, `prose noise should not trip the default gate, got ${wording}`)
})

/* ------------------------------------------------------------------ *
 * repeats
 * ------------------------------------------------------------------ */

test('representative picks the medoid, not the first sample', () => {
  const samples = ['src/graph/build.js', 'src/cli.js', 'src/cli.js', 'src/cli.js']
  assert.equal(representative(samples), 'src/cli.js')
  assert.equal(representative([]), null)
  assert.equal(representative(['only']), 'only')
})

test('selfDivergence needs two samples and rises with disagreement', () => {
  assert.equal(selfDivergence(['a']), null)
  assert.equal(selfDivergence(['src/cli.js', 'src/cli.js']), 0)
  assert.ok(selfDivergence(['src/cli.js', 'src/graph/build.js']) > 0.3)
})

/* ------------------------------------------------------------------ *
 * pairMatrix
 * ------------------------------------------------------------------ */

test('pairMatrix scores every pair and finds the worst one', () => {
  const m = pairMatrix({
    a: ['src/cli.js', '12'],
    b: ['src/cli.js', '12'],
    c: ['src/graph/build.js', '40'],
  })
  assert.deepEqual(m.agents, ['a', 'b', 'c'])
  assert.equal(m.pairs.length, 3)
  assert.equal(m.questionCount, 2)

  const ab = m.pairs.find((p) => p.a === 'a' && p.b === 'b')
  assert.equal(ab.meanDivergence, 0)
  assert.ok(m.worstPair.a === 'a' || m.worstPair.a === 'b')
  assert.equal(m.worstPair.b, 'c')
  assert.ok(m.worstPair.meanDivergence > 0.5)
})

test('the fleet mean is the number that hides a contradicting pair', () => {
  // Nine agents agree; one contradicts all of them. The worst pair is severe,
  // the fleet mean is mild — that gap is exactly the failure mode.
  const answers = {}
  for (let i = 0; i < 9; i++) answers[`ok-${i}`] = ['src/cli.js']
  answers.odd = ['src/graph/build.js']

  const m = pairMatrix(answers)
  assert.ok(m.worstPair.meanDivergence > 0.6, `worst pair ${m.worstPair.meanDivergence}`)
  assert.ok(m.fleetMean < 0.25, `fleet mean ${m.fleetMean} should look harmless`)
  assert.ok(m.fleetMean < m.worstPair.meanDivergence / 2)
})

test('pairMatrix collapses repeats and reports self divergence', () => {
  const m = pairMatrix({
    a: [['src/cli.js', 'src/cli.js']],
    b: [['src/cli.js', 'src/graph/build.js']],
  })
  assert.equal(m.selfDivergence.a, 0)
  assert.ok(m.selfDivergence.b > 0.3)
  assert.equal(m.answers.a[0], 'src/cli.js')
})

test('a failed call is skipped, not scored as a disagreement', () => {
  const m = pairMatrix({
    a: ['src/cli.js', null],
    b: ['src/cli.js', 'src/cli.js'],
  })
  const ab = m.pairs[0]
  assert.equal(ab.perQuestion[1].divergence, null)
  assert.equal(ab.scoredQuestions, 1)
  assert.equal(ab.meanDivergence, 0)
})

test('pairMatrix returns nulls rather than NaN when nothing scored', () => {
  const m = pairMatrix({ a: [null], b: [null] })
  assert.equal(m.pairs[0].meanDivergence, null)
  assert.equal(m.fleetMean, null)
  assert.equal(m.worstPair, null)
})

test('worstQuestion points at the probe the fleet split on', () => {
  const m = pairMatrix({
    a: ['same', 'src/cli.js'],
    b: ['same', 'src/graph/build.js'],
  })
  assert.equal(m.worstQuestion.index, 1)
})

test('pairMatrix accepts a Map as well as an object', () => {
  const m = pairMatrix(new Map([['a', ['x']], ['b', ['x']]]))
  assert.equal(m.pairs.length, 1)
  assert.equal(m.pairs[0].meanDivergence, 0)
})

/* ------------------------------------------------------------------ *
 * consensusTrap
 * ------------------------------------------------------------------ */

test('consensusTrap flags three agreeing agents and one dissenter', () => {
  const r = consensusTrap({ a: 'src/cli.js', b: 'src/cli.js', c: 'src/cli.js', d: 'src/graph/build.js' })
  assert.equal(r.level, 'dissent')
  assert.equal(r.trapped, true)
  assert.deepEqual(r.majority, ['a', 'b', 'c'])
  assert.deepEqual(r.dissenters, ['d'])
})

test('consensusTrap reports unanimity as its own signal, not as low divergence', () => {
  const r = consensusTrap({ a: 'src/cli.js', b: '`src/cli.js`', c: 'SRC/CLI.JS' })
  assert.equal(r.level, 'unanimous')
  assert.equal(r.trapped, true)
  assert.equal(r.dissenters.length, 0)
  assert.match(r.note, /copied error|common cause/i)
})

test('consensusTrap stays quiet below three agreeing agents', () => {
  const r = consensusTrap({ a: 'x', b: 'x', c: 'y' })
  assert.equal(r.level, 'none')
  assert.equal(r.trapped, false)
})

test('consensusTrap accepts an array of { agent, text }', () => {
  const r = consensusTrap([
    { agent: 'a', text: 'x' }, { agent: 'b', text: 'x' },
    { agent: 'c', text: 'x' }, { agent: 'd', text: 'z' },
  ])
  assert.equal(r.level, 'dissent')
  assert.deepEqual(r.dissenters, ['d'])
})

/* ------------------------------------------------------------------ *
 * probes
 * ------------------------------------------------------------------ */

const RANKED = [
  { file: 'src/cli.js', fanIn: 0, fanOut: 4, lines: 120, lang: 'js' },
  { file: 'src/graph/build.js', fanIn: 5, fanOut: 1, lines: 200, lang: 'js' },
  { file: 'src/graph/scan.js', fanIn: 3, fanOut: 0, lines: 400, lang: 'js' },
  { file: 'src/graph/report.js', fanIn: 1, fanOut: 3, lines: 300, lang: 'js' },
  { file: 'tools/gen.py', fanIn: 0, fanOut: 1, lines: 50, lang: 'python' },
]

const PLAN = {
  stats: { files: 5 },
  sharedSurface: [{ file: 'src/graph/build.js' }, { file: 'src/graph/scan.js' }],
}

test('defaultProbes generates factual, graph-answerable questions', () => {
  const probes = defaultProbes({ plan: PLAN, ranked: RANKED })
  assert.ok(probes.length > 0 && probes.length <= 8)
  for (const p of probes) {
    assert.equal(typeof p.id, 'string')
    assert.ok(p.question.trim().length > 10)
    assert.ok(['path', 'number', 'prose'].includes(p.kind))
    assert.notEqual(p.graphAnswer, '')
  }
  const byId = Object.fromEntries(probes.map((p) => [p.id, p]))
  assert.equal(byId['top-hub'].graphAnswer, 'src/graph/build.js')
  assert.equal(byId['file-count'].graphAnswer, '5')
  assert.equal(byId['top-importer'].graphAnswer, 'src/cli.js')
  assert.equal(byId['largest-file'].graphAnswer, 'src/graph/scan.js')
})

test('defaultProbes is deterministic and respects --limit', () => {
  const a = defaultProbes({ plan: PLAN, ranked: RANKED })
  const b = defaultProbes({ plan: PLAN, ranked: [...RANKED].reverse() })
  assert.deepEqual(a, b)
  assert.equal(defaultProbes({ plan: PLAN, ranked: RANKED }, { limit: 3 }).length, 3)
})

test('defaultProbes returns nothing rather than nonsense for an empty repo', () => {
  assert.deepEqual(defaultProbes({ plan: PLAN, ranked: [] }), [])
})

test('entrypointCandidates prefers a graph root with a conventional name', () => {
  const c = entrypointCandidates(RANKED)
  assert.equal(c[0].file, 'src/cli.js')
  assert.ok(c.every((r) => r.fanIn === 0))
})

test('topDirs and topLangs break ties by name so runs repeat', () => {
  assert.deepEqual(topDirs(RANKED)[0], { dir: 'src', count: 4 })
  assert.deepEqual(topLangs(RANKED)[0], { lang: 'js', count: 4 })
})

test('buildPrompt puts the repo path and the question in, and nothing per-agent', () => {
  const p = buildPrompt({ question: 'Which file?' }, { root: '/repo' })
  assert.ok(p.includes('/repo'))
  assert.ok(p.includes('Which file?'))
})

test('syntheticAnswer is stable across runs and still makes agents differ', () => {
  const probe = { id: 'top-hub', graphAnswer: 'src/graph/build.js', alternatives: ['src/cli.js', 'src/graph/scan.js'] }
  assert.equal(syntheticAnswer('a', probe, 0), syntheticAnswer('a', probe, 0))

  const answers = ['a', 'b', 'c', 'd', 'e'].map((n) => syntheticAnswer(n, probe, 0))
  assert.ok(new Set(answers).size > 1, 'a dry run that never disagrees teaches nothing')
})

test('syntheticAnswer degrades gracefully with no graph answer', () => {
  assert.match(syntheticAnswer('a', { id: 'x' }, 0), /no offline answer/)
})

test('hash32 is stable and unsigned', () => {
  assert.equal(hash32('abc'), hash32('abc'))
  assert.notEqual(hash32('abc'), hash32('abd'))
  assert.ok(hash32('abc') >= 0)
})

test('normaliseProbes accepts strings, expected as an alias, and rejects junk', () => {
  const p = normaliseProbes(['Which file?', { question: 'How many?', expected: '5', kind: 'number' }])
  assert.equal(p[0].id, 'probe-1')
  assert.equal(p[1].graphAnswer, '5')
  assert.equal(p[1].kind, 'number')
  assert.throws(() => normaliseProbes({}), /must be a JSON array/)
  assert.throws(() => normaliseProbes([{ kind: 'path' }]), /no question/)
})

/* ------------------------------------------------------------------ *
 * claude adapter (pure parts only — nothing spawns here)
 * ------------------------------------------------------------------ */

test('quoteArg wraps and escapes per platform (display only — nothing spawns through a shell)', () => {
  assert.equal(quoteArg('claude-opus-5', 'win32'), '"claude-opus-5"')
  assert.equal(quoteArg('say "hi"', 'win32'), '"say \\"hi\\""')
  assert.equal(quoteArg('C:\\bin\\claude.cmd', 'win32'), '"C:\\bin\\claude.cmd"')
  // a trailing backslash would otherwise escape the closing quote
  assert.equal(quoteArg('C:\\bin\\', 'win32'), '"C:\\bin\\\\"')
  assert.equal(quoteArg("it's", 'linux'), "'it'\\''s'")
})

test('buildArgv asks for json and keeps the prompt off argv by default', () => {
  const argv = buildArgv({ model: 'claude-opus-5', prompt: 'hello "world"' })
  assert.deepEqual(argv, ['-p', '--output-format', 'json', '--model', 'claude-opus-5'])
  assert.ok(!argv.join(' ').includes('hello'))
})

test('buildArgv puts the prompt on argv only when asked, and never pre-quotes it', () => {
  // argv entries go to the process directly now. Quoting them here would put
  // literal quote characters INSIDE the prompt the model receives.
  const argv = buildArgv({ prompt: 'a "b"', promptAsArg: true })
  assert.equal(argv[1], 'a "b"')
})

test('buildArgv passes both system prompt flavours through', () => {
  const argv = buildArgv({ systemPrompt: 'be terse', appendPrompt: 'also cite' }, 'linux')
  assert.ok(argv.includes('--system-prompt'))
  assert.ok(argv.includes('--append-system-prompt'))
})

test('extractResult prefers the result field of the json envelope', () => {
  assert.equal(extractResult('{"type":"result","result":"src/cli.js"}'), 'src/cli.js')
})

test('extractResult falls back to a content block array', () => {
  assert.equal(extractResult('{"type":"x","content":[{"text":"hello"},{"text":"there"}]}'), 'hello\nthere')
})

test('extractResult skips envelope metadata when hunting for a string field', () => {
  assert.equal(extractResult('{"type":"result","session_id":"abc","model":"opus","answer":"src/cli.js"}'), 'src/cli.js')
})

test('extractResult returns raw text when the payload is not json', () => {
  assert.equal(extractResult('just a plain answer'), 'just a plain answer')
  assert.equal(extractResult(''), '')
  assert.equal(extractResult(null), '')
})

test('envelopeError catches a failure hiding inside a success-shaped envelope', () => {
  // Observed for real: exit status aside, the CLI answers a logged-out probe
  // with subtype "success" and is_error true. Treating that as an answer would
  // make every agent agree on an error string and report a consistent fleet.
  const loggedOut = '{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login"}'
  assert.match(envelopeError(loggedOut), /Not logged in/)
  assert.equal(extractResult(loggedOut), 'Not logged in · Please run /login')
})

test('envelopeError stays quiet on a clean envelope and on non-json output', () => {
  assert.equal(envelopeError('{"type":"result","subtype":"success","is_error":false,"result":"src/cli.js"}'), null)
  assert.equal(envelopeError('plain text answer'), null)
  assert.equal(envelopeError(''), null)
})

test('envelopeError flags an error subtype and a bare error field', () => {
  assert.match(envelopeError('{"subtype":"error_max_turns","result":"gave up"}'), /error_max_turns/)
  assert.match(envelopeError('{"error":"rate limited"}'), /rate limited/)
})

/* ------------------------------------------------------------------ *
 * looksLikeFailureText — the out-of-band twin of envelopeError
 * ------------------------------------------------------------------ */

test('looksLikeFailureText catches the plain-text failures that exit 0', () => {
  for (const s of [
    'Not logged in · Please run /login',
    'Invalid API key · Please run /login',
    'API Error: 401 {"type":"error","error":{"type":"authentication_error"}}',
    'Claude AI usage limit reached',
    'Rate limit exceeded. Please try again later.',
    'Your credit balance is too low to access the Anthropic API.',
    'API Error: 400 invalid_request_error',
    'Internal server error',
    'Connection error.',
    'Overloaded',
    'quota exceeded for this organization',
    'Unauthorized',
    'Permission denied',
    // A CLI quotes the command it wants you to run. Treating that backtick as
    // proof of code let these through as answers: two agents, identical error,
    // 0.000 divergence, "[consistent]", exit 0 — reproduced against a stub.
    'Not logged in. Please run `claude login`',
    'Invalid API key. Run `claude setup-token` for a headless token.',
  ]) {
    assert.equal(looksLikeFailureText(s), true, s)
  }
})

test('looksLikeFailureText leaves real answers alone, including answers ABOUT auth', () => {
  for (const s of [
    'src/auth/login.js',
    'the auth handler lives in src/auth/login.js',
    'The rate limit logic is in src/net/rate-limit.js, called from src/net/pool.js',
    '`connection error` is thrown by lib/transport.rb',
    'Handling for "not logged in" sits in src/session/state.ts',
    'javascript',
    '31',
    'src/graph/build.js',
  ]) {
    assert.equal(looksLikeFailureText(s), false, s)
  }
})

test('looksLikeFailureText only fires on short text — an essay is an answer, not a CLI line', () => {
  const essay = `The session layer reports when the user is not logged in. ${'It does this by checking the token store on every call. '.repeat(8)}`
  assert.ok(essay.length >= 400)
  assert.equal(looksLikeFailureText(essay), false)
  assert.equal(looksLikeFailureText(''), false)
  assert.equal(looksLikeFailureText(null), false)
})

test('an unguarded auth failure would score as a perfectly consistent fleet', () => {
  // This is the false green the predicate exists to prevent: every agent gets
  // the identical error string, so the scorer — correctly, on the input it was
  // given — reports zero divergence.
  const loggedOut = 'Not logged in · Please run /login'
  assert.equal(divergence(loggedOut, loggedOut), 0)
  assert.equal(looksLikeFailureText(loggedOut), true)
})

/* ------------------------------------------------------------------ *
 * spawnPlan — no shell, on either platform
 * ------------------------------------------------------------------ */

test('spawnPlan runs a real executable directly, with no interpreter in between', () => {
  const plan = spawnPlan('/usr/local/bin/claude', ['-p', '--system-prompt', 'say "hi" && echo pwned'])
  assert.equal(plan.file, '/usr/local/bin/claude')
  assert.deepEqual(plan.args, ['-p', '--system-prompt', 'say "hi" && echo pwned'])
  assert.equal(plan.viaCmd, false)
  // Node quotes argv for a direct spawn, so nothing here needs refusing.
  assert.equal(plan.unsafe, null)
})

test('spawnPlan routes a .cmd/.bat shim through cmd.exe as separate argv entries', () => {
  const plan = spawnPlan('C:\\npm\\claude.cmd', ['-p', '--model', 'claude-opus-5'])
  assert.equal(plan.viaCmd, true)
  assert.deepEqual(plan.args, ['/c', 'C:\\npm\\claude.cmd', '-p', '--model', 'claude-opus-5'])
  assert.match(plan.file, /cmd\.exe$/i)
  assert.equal(plan.unsafe, null)
  assert.equal(spawnPlan('C:\\npm\\claude.BAT', []).viaCmd, true)
})

test('spawnPlan refuses the shim route for arguments cmd.exe would reinterpret', () => {
  // Both reproduced against a real batch shim on node 24: the quote closes the
  // argument and `&&` starts a second command, and `>` is not quoted at all.
  const quoted = spawnPlan('C:\\npm\\claude.cmd', ['--system-prompt', 'x" && echo pwned && rem "'])
  assert.match(quoted.unsafe, /echo pwned/)
  assert.match(spawnPlan('C:\\npm\\claude.cmd', ['--system-prompt', 'a>out.txt']).unsafe, /out\.txt/)
  // ...and the same payloads are fine when there is no cmd.exe in the picture.
  assert.equal(spawnPlan('C:\\bin\\claude.exe', ['--system-prompt', 'x" && echo pwned']).unsafe, null)
})

test('runPool preserves input order under concurrency and never exceeds it', () => {
  return (async () => {
    let live = 0
    let peak = 0
    const items = Array.from({ length: 20 }, (_, i) => i)
    const out = await runPool(items, async (n) => {
      live++
      peak = Math.max(peak, live)
      await new Promise((r) => setTimeout(r, (n % 3) + 1))
      live--
      return n * 2
    }, 4)
    assert.deepEqual(out, items.map((n) => n * 2))
    assert.ok(peak <= 4, `peak concurrency ${peak}`)
    assert.ok(peak > 1, 'pool ran serially')
  })()
})

test('runPool tolerates an empty job list', async () => {
  assert.deepEqual(await runPool([], async () => 1, 4), [])
})

test('resolveClaudeBin honours ARGO_CLAUDE_BIN first and always returns something', () => {
  assert.deepEqual(
    resolveClaudeBin({ ARGO_CLAUDE_BIN: '/opt/claude' }),
    { bin: '/opt/claude', source: 'ARGO_CLAUDE_BIN' }
  )
  const fallback = resolveClaudeBin({})
  assert.equal(typeof fallback.bin, 'string')
  assert.ok(fallback.bin.length > 0)
})

test('resolveClaudeBin walks PATHEXT — a shell-less spawn cannot see the npm .cmd shim', (t) => {
  // Removing the shell removed cmd.exe's PATH search with it: node only appends
  // .com and .exe to a bare name, so `claude` stopped finding the claude.cmd
  // that npm installs on Windows — every probe died on ENOENT advising the user
  // to put `claude` on PATH, which is what they had already done.
  //
  // Proved against the filesystem, not a mock: this module's own file is a real
  // `claude.<ext>` sitting in a real directory.
  if (existsSync(KNOWN_BIN)) return t.skip('the known install path wins on this machine')
  const dir = fileURLToPath(new URL('../src/divergence', import.meta.url))
  const found = resolveClaudeBin({ PATH: dir, PATHEXT: '.JS' }, 'win32')
  assert.equal(found.source, 'PATH')
  // Case comes from PATHEXT, which Windows writes in upper case. Nothing cares:
  // spawnPlan's shim test is case-insensitive and so is CreateProcess.
  assert.match(found.bin, /claude\.js$/i)
  // POSIX needs none of this: the loader searches PATH itself, exec bit included.
  assert.equal(resolveClaudeBin({ PATH: dir, PATHEXT: '.JS' }, 'linux').bin, 'claude')
})

/* ------------------------------------------------------------------ *
 * report assembly
 * ------------------------------------------------------------------ */

const PROBES = [
  { id: 'top-hub', kind: 'path', question: 'Which file has the highest fan-in?', graphAnswer: 'src/graph/build.js' },
  { id: 'file-count', kind: 'number', question: 'How many source files?', graphAnswer: '5' },
]

function reportWith(samples, opts = {}) {
  return buildReport({
    root: '/repo',
    agents: Object.keys(samples).map((name) => ({ name })),
    probes: PROBES,
    samples,
    threshold: 0.35,
    repeats: 1,
    model: 'claude-opus-5',
    mode: 'live',
    errors: [],
    ...opts,
  })
}

test('buildReport gates on a pair, not on the fleet mean', () => {
  const samples = {}
  for (let i = 0; i < 8; i++) samples[`ok-${i}`] = [['src/graph/build.js'], ['5']]
  samples.odd = [['src/cli.js'], ['40']]

  const r = reportWith(samples)
  assert.ok(r.matrix.fleetMean < 0.35, `fleet mean ${r.matrix.fleetMean} looks fine`)
  assert.ok(r.breaches.length > 0, 'but pairs involving the odd agent must breach')
  assert.equal(r.verdict.level, 'breach')
})

test('buildReport calls a self-consistent fleet consistent, and flags the trap', () => {
  const r = reportWith({
    a: [['src/graph/build.js'], ['5']],
    b: [['src/graph/build.js'], ['5']],
    c: [['src/graph/build.js'], ['5']],
  })
  assert.equal(r.breaches.length, 0)
  assert.equal(r.verdict.level, 'agree')
  assert.equal(r.consensus.filter((c) => c.trapped).length, 2)
})

test('buildReport measures distance from the graph answer as a side signal', () => {
  const r = reportWith({
    a: [['src/graph/build.js'], ['5']],
    b: [['src/cli.js'], ['40']],
  })
  assert.equal(r.groundTruth.a, 0)
  assert.ok(r.groundTruth.b > 0.5)
})

test('a green verdict says how many calls never landed', () => {
  // Both agents answered the first probe and neither answered the second. The
  // pair that scored is real; the confidence in "self-consistent" is not, and
  // the verdict line is the only line most people read.
  const r = reportWith(
    { a: [['src/graph/build.js'], []], b: [['src/graph/build.js'], []] },
    { errors: [{ error: 'timed out' }, { error: 'timed out' }] }
  )
  assert.equal(r.verdict.level, 'consistent')
  assert.match(r.verdict.message, /2 call\(s\) failed and were never measured/)
  // ...and a run where nothing failed does not grow a clause about failures.
  assert.doesNotMatch(reportWith({ a: [['x'], ['1']], b: [['x'], ['1']] }).verdict.message, /never measured/)
})

test('buildReport refuses to invent a verdict when every call failed', () => {
  const r = reportWith({ a: [[], []], b: [[], []] }, { errors: [{ error: 'boom' }] })
  assert.equal(r.verdict.level, 'no-data')
  assert.equal(r.breaches.length, 0)
})

test('verdict marks a single-agent run insufficient rather than perfect', () => {
  const m = pairMatrix({ solo: ['x'] })
  const v = verdict({ matrix: m, breaches: [], consensus: [], threshold: 0.35 })
  assert.equal(v.level, 'insufficient')
})

test('buildReport is deterministic for identical samples', () => {
  const samples = { a: [['x'], ['1']], b: [['y'], ['2']] }
  assert.deepEqual(reportWith(samples), reportWith(samples))
})

test('renderText prints the matrix, the gate and the fleet-mean warning', () => {
  const out = renderText(reportWith({
    a: [['src/graph/build.js'], ['5']],
    b: [['src/cli.js'], ['40']],
  }))
  assert.match(out, /MATRIX/)
  assert.match(out, /BREACH/)
  assert.match(out, /VERDICT/)
  assert.match(out, /hides the problem/)
  assert.ok(!out.includes('NaN'), out)
})

test('renderText survives an all-failed run without printing NaN', () => {
  const out = renderText(reportWith({ a: [[], []], b: [[], []] }, { errors: [{ error: 'boom' }] }))
  assert.match(out, /no-data/)
  assert.ok(!out.includes('NaN'), out)
})

test('renderMarkdown emits one section per probe plus the trap warning', () => {
  const md = renderMarkdown(reportWith({
    a: [['src/graph/build.js'], ['5']],
    b: [['src/graph/build.js'], ['5']],
    c: [['src/graph/build.js'], ['5']],
  }))
  assert.match(md, /# Divergence report/)
  assert.match(md, /### 1\./)
  assert.match(md, /### 2\./)
  assert.match(md, /Consensus traps/)
  assert.ok(!md.includes('NaN'), md)
})

test('a dry-run report labels itself so nobody quotes synthetic numbers', () => {
  const out = renderText(reportWith({ a: [['x'], ['1']], b: [['y'], ['2']] }, { mode: 'dry-run' }))
  assert.match(out, /DRY RUN/)
  assert.match(out, /illustrative, not measured/)
})
