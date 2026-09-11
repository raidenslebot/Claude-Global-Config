// proxies — verification that stops before the actual failure point.
//
// A successful calculation, a matching source string, a settled screenshot and an installed
// overlay are four different things. None of them, on its own, establishes that the person got
// the right answer in time. A test that asserts one of those stand-ins is not weaker by a
// little: it is green for a reason unrelated to the thing it names, so it goes on being green
// straight through the regression it was written to catch.
//
// The five shapes below are the ones that can be READ off a test body without running it.
// Ranked by how confidently the stand-in can be named:
//
//   tautology      assert.equal(f(x), f(x)) — both sides computed after the operation. This is
//                  not a hypothetical: this repo shipped two, and they were guarding its worst
//                  regression. Equality against a value you just produced is a mirror.
//   no assertion   the body passes by not throwing, which is the weakest statement available.
//   existence      the only claims are "it is there" / "it is truthy". A file existing is not a
//                  file being right.
//   source text    the assertion reads the SOURCE of the module under test and matches a string
//                  in it. That the code SAYS something is not that it DOES it.
//   snapshot       the only claim is "the same as last time", which is a claim about last time.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not judge whether an assertion is strong enough
// in general — that is taste and it would fire on everything. It reports only the five shapes
// where the stand-in is identifiable from the text, and each one is gated hard:
//   · `assert.ok(out.includes('x'))` is a real predicate wrapped in ok, and is never existence.
//   · a test reading a .md file, a rendered output, or a fixture it wrote itself is never a
//     source-text proxy — only reading a module the test itself imports counts.
//   · skipped and todo tests are not reported; they are not pretending.
//   · a test whose assertions live in a helper defined in the same file is not assertion-free.
// Non-JS test files are counted and left alone; the parse here is JavaScript/TypeScript.

export const id = 'proxies'
export const title = 'Proxies — the test measures a stand-in'
export const why = 'A test that asserts existence, a source string, a snapshot or nothing at all stays green through the failure it names.'

const JS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts'])

const KEYWORD = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'await', 'function', 'new', 'do', 'else', 'try', 'super', 'import', 'require', 'delete', 'void', 'yield'])
const REGEX_OK_AFTER = new Set(['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'yield', 'await', 'new', 'delete', 'void', 'instanceof'])

// ── text mechanics ───────────────────────────────────────────────────────────────────────────

/** stripLiterals leaves regex bodies alone, and this suite is full of regexes carrying lone
 *  brackets — `/\(/` would throw off every brace scan below. Blank them, same length. */
function blankRegex(code) {
  const out = code.split('')
  let i = 0
  while (i < code.length) {
    if (code[i] !== '/') { i++; continue }
    let k = i - 1
    while (k >= 0 && /\s/.test(code[k])) k--
    if (k >= 0 && /[\w$)\]]/.test(code[k])) {
      const w = /[A-Za-z$_]+$/.exec(code.slice(Math.max(0, k - 11), k + 1))
      if (!w || !REGEX_OK_AFTER.has(w[0])) { i++; continue } // division, not a regex
    }
    let j = i + 1
    let cls = false
    let closed = false
    for (; j < code.length; j++) {
      const c = code[j]
      if (c === '\\') { j++; continue }
      if (c === '\n') break
      if (cls) { if (c === ']') cls = false; continue }
      if (c === '[') { cls = true; continue }
      if (c === '/') { closed = true; break }
    }
    if (!closed) { i++; continue }
    for (let m = i + 1; m < j; m++) out[m] = ' '
    i = j + 1
  }
  return out.join('')
}

/** Index of the bracket matching the one at `i`, or -1. */
function matchAt(code, i) {
  const open = code[i]
  const close = open === '(' ? ')' : open === '{' ? '}' : open === '[' ? ']' : null
  if (!close) return -1
  let d = 0
  for (let j = i; j < code.length; j++) {
    if (code[j] === open) d++
    else if (code[j] === close) { d--; if (d === 0) return j }
  }
  return -1
}

/** Split a call's argument region at top-level commas. Offsets are absolute. */
function args(code, from, to) {
  const out = []
  let d = 0
  let start = from
  for (let j = from; j < to; j++) {
    const c = code[j]
    if (c === '(' || c === '[' || c === '{') d++
    else if (c === ')' || c === ']' || c === '}') d--
    else if (c === ',' && d === 0) { out.push([start, j]); start = j + 1 }
  }
  out.push([start, to])
  return out
}

const squash = (s) => s.replace(/\s+/g, '')
const clip = (s, n = 90) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }

// ── assertions ───────────────────────────────────────────────────────────────────────────────

const NODE_EQ = new Set(['equal', 'strictEqual', 'deepEqual', 'deepStrictEqual', 'notDeepEqual'])
const NULLISH = new Set(['null', 'undefined'])
const SNAPSHOT = /\.\s*toMatch(?:Inline|File)?Snapshot\s*\(/
const TEXT_MATCH = /\.\s*(?:match|doesNotMatch)\s*\(|\.\s*(?:toMatch|toContain)\s*\(|\.\s*includes\s*\(/
// Anything that makes a test file's helper an asserting helper.
const ANY_ASSERT = /(?:^|[^\w$.])(?:assert|expect|should|chai)\s*[.(]|\.\s*should\b|\bt\s*\.\s*assert\b|\.\s*to(?:Be|Equal|Match|Throw|Have|Contain)\w*\s*\(/

/** An `ok(X)` argument is "existence-shaped" when X makes no claim beyond X being there: a bare
 *  reference, a member path, or a call whose name is about a thing existing. A predicate — a
 *  comparison, a negation, includes/match/test/has, a length — is a real claim and never this. */
function existenceShaped(text) {
  const t = text.trim()
  if (!t) return false
  if (/[!<>=&|?+\-*%^~]|\bin\b|\binstanceof\b/.test(t)) return false
  if (/\.\s*(?:includes|match|test|some|every|startsWith|endsWith|has|length|size|filter|find)\b/.test(t)) return false
  if (/^[A-Za-z_$][\w$]*(?:\s*\.\s*[\w$]+|\s*\[\s*['"`\d][^\]]*\])*$/.test(t)) return true // a path
  const call = /^([A-Za-z_$][\w$.]*)\s*\(/.exec(t)
  return !!call && /exist|statSync|lstatSync|accessSync/i.test(call[1])
}

/**
 * Every assertion inside [from, to), classified. Argument text is read out of `src`, never out
 * of `code`: code has string bodies blanked, so comparing arguments there makes
 * assert.equal(f('./a'), f('a')) look identical — a false tautology, which is the one thing
 * this check must not produce.
 */
function assertionsIn(code, src, from, to) {
  const found = []
  const region = code.slice(from, to)
  const push = (o) => found.push(o)

  // node:assert — assert(…), assert.method(…), t.assert.method(…)
  const NODE = /(?:^|[^\w$.])(?:(assert)|t\s*\.\s*assert)\s*(?:\.\s*([A-Za-z_$][\w$]*)\s*)?\(/g
  for (let m; (m = NODE.exec(region));) {
    const paren = from + m.index + m[0].length - 1
    const end = matchAt(code, paren)
    if (end < 0) continue
    const a = args(code, paren + 1, end)
    const method = m[2] || ''
    const txt = (i) => (a[i] ? src.slice(a[i][0], a[i][1]).trim() : '')
    if (!method || method === 'ok') {
      push({ at: from + m.index, kind: existenceShaped(txt(0)) ? 'existence' : 'other', text: clip(src.slice(from + m.index, end + 1)) })
    } else if (NODE_EQ.has(method) && a.length >= 2) {
      const both = squash(txt(0))
      push({
        at: from + m.index,
        kind: both && both === squash(txt(1)) ? 'tautology' : 'other',
        expr: txt(0),
        method: `assert.${method}`,
        text: clip(src.slice(from + m.index, end + 1)),
      })
    } else if ((method === 'notEqual' || method === 'notStrictEqual') && a.length >= 2 && NULLISH.has(txt(1))) {
      push({ at: from + m.index, kind: 'existence', text: clip(src.slice(from + m.index, end + 1)) })
    } else {
      push({ at: from + m.index, kind: 'other', text: '' })
    }
  }

  // expect(…).matcher(…) — jest / vitest / chai. `expect.poll(fn)` and `expect.soft(v)` are
  // Playwright's retrying and non-fatal forms of the same thing; they were invisible here because
  // the paren does not follow `expect` directly, and on one real suite that alone produced 22 of
  // 42 findings — every one of them a test that asserts perfectly well.
  const EXP = /(?:^|[^\w$.])expect\s*(?:\.\s*(?:poll|soft)\s*)?\(/g
  for (let m; (m = EXP.exec(region));) {
    const at = from + m.index
    const paren = from + m.index + m[0].length - 1
    const subjEnd = matchAt(code, paren)
    if (subjEnd < 0) continue
    const subject = src.slice(paren + 1, subjEnd).trim()
    const props = []
    let j = subjEnd + 1
    for (;;) {
      const p = /^\s*\.\s*([A-Za-z_$][\w$]*)/.exec(code.slice(j, j + 80))
      if (!p) break
      props.push(p[1])
      j += p[0].length
      while (/\s/.test(code[j])) j++
      if (code[j] === '(') break
    }
    const matcher = props[props.length - 1] || ''
    const negated = props.some((p) => p === 'not')
    if (code[j] !== '(' || !matcher) { push({ at, kind: 'other', text: '' }); continue }
    const end = matchAt(code, j)
    const full = clip(src.slice(at, (end < 0 ? j : end) + 1))
    if (/^toMatch(Inline|File)?Snapshot$/.test(matcher)) { push({ at, kind: 'snapshot', text: full }); continue }
    // toBeDefined/toExist claim presence whatever the subject is. toBeTruthy does not:
    // expect(out.includes(x)).toBeTruthy() is the predicate, not an existence check.
    if (!negated && /^(toBeDefined|toExist)$/.test(matcher)) { push({ at, kind: 'existence', text: full }); continue }
    if (!negated && matcher === 'toBeTruthy') { push({ at, kind: existenceShaped(subject) ? 'existence' : 'other', text: full }); continue }
    if (!negated && /^(toBe|toEqual|toStrictEqual|equal|equals|eql)$/.test(matcher) && end > 0) {
      const a = args(code, j + 1, end)
      const other = a[0] ? src.slice(a[0][0], a[0][1]).trim() : ''
      const tauto = squash(subject) && squash(subject) === squash(other)
      push({ at, kind: tauto ? 'tautology' : 'other', expr: subject, method: `expect(…).${matcher}`, text: full })
      continue
    }
    push({ at, kind: 'other', text: '' })
  }

  // chai `should` — value.should.equal(…) / should(value)
  const SH = /\.\s*should\b|(?:^|[^\w$.])should\s*\(/g
  for (let m; (m = SH.exec(region));) push({ at: from + m.index, kind: 'other', text: '' })

  // a bare snapshot on something other than expect()
  for (let m, R = new RegExp(SNAPSHOT.source, 'g'); (m = R.exec(region));) {
    if (!found.some((f) => Math.abs(f.at - (from + m.index)) < 60)) push({ at: from + m.index, kind: 'snapshot', text: clip(src.slice(from + m.index, from + m.index + 60)) })
  }

  found.sort((a, b) => a.at - b.at)
  return found
}

// ── the file ─────────────────────────────────────────────────────────────────────────────────

/** Names of functions defined in this file whose body asserts — directly or via another such
 *  helper. A test that calls one of these is not assertion-free. */
function assertingHelpers(code) {
  const bodies = []
  const DEF = /(?:^|[^\w$.])function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\()/g
  for (let m; (m = DEF.exec(code));) {
    const name = m[1] || m[2]
    const brace = code.indexOf('{', m.index + m[0].length - 1)
    if (brace < 0) continue
    const end = matchAt(code, brace)
    if (end < 0) continue
    bodies.push({ name, body: code.slice(brace, end) })
  }
  const asserting = new Set()
  for (let pass = 0; pass < 2; pass++) {
    for (const b of bodies) {
      if (asserting.has(b.name)) continue
      if (ANY_ASSERT.test(b.body)) { asserting.add(b.name); continue }
      for (const n of asserting) if (new RegExp(`(?:^|[^\\w$.])${n}\\s*\\(`).test(b.body)) { asserting.add(b.name); break }
    }
  }
  return asserting
}

/** Local modules this test file imports — the candidates for "the module under test", each as a
 *  pattern that matches a FILENAME. A bare substring will not do: a test called out.test.mjs
 *  would then see its own subject in `readFileSync(out, 'utf8')`, where `out` is a variable. */
const fileToken = (name) => new RegExp(
  `(?:^|[^\\w.$-])${name.replace(/\./g, '\\.')}`
  + `${/\.[cm]?[jt]sx?$/.test(name) ? '' : '\\.[cm]?[jt]sx?'}(?![\\w.])`,
)

function importedModules(src, rel) {
  const names = new Map()
  const IMP = /(?:from\s*|require\s*\(\s*|import\s*\(\s*)['"](\.[^'"]+)['"]/g
  for (let m; (m = IMP.exec(src));) {
    const base = m[1].split('/').pop()
    if (base && /\.[cm]?[jt]sx?$/.test(base)) names.set(base, 'this test imports')
  }
  const stem = rel.split('/').pop().replace(/\.(test|spec)\.[cm]?[jt]sx?$/i, '')
  if (stem && !names.has(stem)) names.set(stem, 'this test is named for')
  return names
}

/** Every test declaration in a file: name, line, body range. */
function testsIn(code, src) {
  const out = []
  const DECL = /(?:^|[^\w$.])(test|it)((?:\.[A-Za-z_$][\w$]*)*)\s*\(/g
  for (let m; (m = DECL.exec(code));) {
    const chain = m[2] || ''
    if (/\b(?:skip|todo|each|failing)\b/.test(chain)) continue
    const at = m.index + m[0].indexOf(m[1])
    const paren = m.index + m[0].length - 1
    const close = matchAt(code, paren)
    if (close < 0) continue
    // name: the first quoted argument, read out of the real text
    let name = ''
    const q = /['"`]/.exec(code.slice(paren + 1, Math.min(close, paren + 200)))
    if (q) {
      const s = paren + 1 + q.index
      const e = code.indexOf(q[0], s + 1)
      if (e > s && e < close) name = src.slice(s + 1, e).replace(/\s+/g, ' ').trim()
    }
    // body: the first arrow or function in the argument list
    const fn = /=>|(?:^|[^\w$.])function\b/.exec(code.slice(paren + 1, close))
    if (!fn) continue
    let k = paren + 1 + fn.index + fn[0].length
    if (!fn[0].includes('=>')) { const p = code.indexOf('(', k); const pe = p < 0 ? -1 : matchAt(code, p); if (pe < 0) continue; k = pe + 1 }
    while (k < close && /\s/.test(code[k])) k++
    let from
    let to
    if (code[k] === '{') { const e = matchAt(code, k); if (e < 0) continue; from = k + 1; to = e } else { from = k; to = close }
    out.push({ name, at, from, to, close })
  }
  // A test that contains another test is a container; the inner one is the real subject.
  return out.filter((t) => !out.some((o) => o !== t && o.at > t.from && o.at < t.to))
}

const RANK = { tautology: 0, none: 1, existence: 2, source: 3, snapshot: 4 }

export function run(ctx) {
  const files = ctx.tests.filter((f) => JS.has(f.ext))
  const skipped = ctx.tests.length - files.length
  const findings = []
  let scanned = 0

  for (const f of files) {
    const code = blankRegex(f.code)

    const helpers = assertingHelpers(code)
    const mods = importedModules(f.src, f.rel)
    const cases = testsIn(code, f.src)
    scanned += cases.length

    for (const t of cases) {
      const body = code.slice(t.from, t.to)
      const line = ctx.lineOf(f.src, t.at)
      const label = t.name ? `test "${clip(t.name, 60)}"` : `the test at line ${line}`
      const a = assertionsIn(code, f.src, t.from, t.to)

      const tauto = a.find((x) => x.kind === 'tautology')
      if (tauto) {
        // A test named for determinism means the mirror; it is still a mirror. Saying so is
        // what makes the finding actionable instead of contested.
        const determinism = /determin|stable|reproduc|idempotent|consistent|run to run/i.test(t.name)
        findings.push({
          file: f.rel, line, rank: RANK.tautology,
          what: `${label} asserts a value against itself`,
          evidence: `${tauto.method}: both arguments read ${clip(tauto.expr, 60)} — ${tauto.text}`,
          fix: determinism
            ? 'pin the expected value as a literal — a function agreeing with itself says nothing about what it returns'
            : 'capture the value BEFORE the operation and compare the result against that',
        })
        continue
      }

      if (!a.length) {
        if ([...helpers].some((n) => new RegExp(`(?:^|[^\\w$.])${n}\\s*\\(`).test(body))) continue
        // An asserting helper IMPORTED from another file cannot be read here, so the only thing
        // left to go on is its name. `assertHighlightBoxes(page, […])` says what it does in the
        // one word that matters; treating it as an assertion loses nothing, because a test that
        // calls something named assert/expect/verify and is still hollow is not readable as such
        // from this file either.
        if (/(?:^|[^\w$.])(?:assert|expect|verify)[A-Z_][\w$]*\s*\(/.test(body)) continue
        const call = /(?:^|[^\w$.])([A-Za-z_$][\w$]*(?:\s*\.\s*[\w$]+)*)\s*\(/g
        let first = ''
        for (let m; (m = call.exec(body));) { const n = squash(m[1]); if (!KEYWORD.has(n.split('.')[0])) { first = n; break } }
        findings.push({
          file: f.rel, line, rank: RANK.none,
          what: `${label} contains no assertion — it passes by not throwing`,
          evidence: `${body.trim().split('\n').length} lines, 0 assert/expect calls${first ? `; it calls ${clip(first, 40)}(…) and checks nothing` : ''}`,
          fix: 'assert the value the call produces, or assert.throws on the input that must fail',
        })
        continue
      }

      if (a.every((x) => x.kind === 'snapshot')) {
        findings.push({
          file: f.rel, line, rank: RANK.snapshot,
          what: `${label} claims only "same as last time"`,
          evidence: `the sole assertion is ${a[0].text || 'toMatchSnapshot()'}`,
          fix: 'assert the one property the output must have, beside the snapshot',
        })
        continue
      }

      if (a.every((x) => x.kind === 'existence')) {
        findings.push({
          file: f.rel, line, rank: RANK.existence,
          what: `${label} asserts only that a value is there, never what it is`,
          evidence: `${a.length} assertion${a.length > 1 ? 's' : ''}, all existence: ${a.map((x) => x.text).filter(Boolean).slice(0, 2).join(' · ')}`,
          fix: 'assert the value itself — the count, the content, the field the caller reads',
        })
        continue
      }

      // Source-text proxy: the body reads a file it also imports, and matches text in it.
      const read = /(?:^|[^\w$.])(?:fs\s*\.\s*)?readFileSync\s*\(/g
      let hit = null
      for (let m; (m = read.exec(body));) {
        const p = t.from + m.index + m[0].length - 1
        const e = matchAt(code, p)
        if (e < 0) continue
        const argText = f.src.slice(p + 1, e)
        const mod = [...mods.keys()].find((n) => fileToken(n).test(argText))
        if (mod) { hit = { mod, how: mods.get(mod), text: clip(f.src.slice(t.from + m.index, e + 1), 70) }; break }
      }
      if (hit && TEXT_MATCH.test(body)) {
        findings.push({
          file: f.rel, line, rank: RANK.source,
          what: `${label} asserts what a module's source SAYS, not what it does`,
          evidence: `matches text inside ${hit.mod}, which ${hit.how}: ${hit.text}`,
          fix: `call ${hit.mod.replace(/\.[cm]?[jt]sx?$/, '')} and assert the behaviour that source line exists to produce`,
        })
      }
    }
  }

  findings.sort((x, y) => x.rank - y.rank || x.file.localeCompare(y.file) || x.line - y.line)
  for (const f of findings) delete f.rank

  const note = !files.length
    ? (skipped ? `${skipped} test file(s) found, none in JavaScript or TypeScript — this check parses JS/TS only` : 'no test files in this tree')
    : [
      `${files.length} JS/TS test file(s)${skipped ? `, ${skipped} non-JS test file(s) not parsed` : ''}`,
      'skipped/todo tests, ok() wrapping a real predicate, and tests reading prose or their own output are deliberately not reported',
      'ok() around a CALL is left alone unless the call names existence (existsSync and friends) — `assert.ok(parse(x))` may be a real predicate and `assert.ok(build())` may be pure existence, and nothing in the text separates them, so the existence shape is only claimed for a bare reference or a member path',
    ].join('; ')

  return { findings, scanned, note }
}
