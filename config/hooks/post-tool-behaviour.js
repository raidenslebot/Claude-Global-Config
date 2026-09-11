// PostToolUse hook: a test that cannot fail, caught in the second it is written.
//
// WHY THIS ONE IS SEPARATE FROM THE WHOLE-TREE GATE.
// `cgc behaviour` measures five classes of "the code is correct and the person still does not
// get the answer". Four of them need the whole tree — an import graph, a git history, a census
// of surfaces — and belong in a command you run. ONE of them is local to a single file and is
// worth catching at the moment of writing rather than at the end of a day: an assertion that
// measures a proxy for the thing instead of the thing.
//
// WHY IT IS NARROWER THAN THE GATE, DELIBERATELY.
// This file is copied to ~/.claude/hooks on machines where this repository does not exist, so it
// imports nothing and shells out to nothing. It therefore implements the SUBSET of the `proxies`
// check that needs only the one file in front of it, and names `cgc behaviour` for the rest. A
// subset cannot drift into disagreement with the gate the way a second full implementation would.
//
// THE ONE IT MUST NEVER MISS IS THE TAUTOLOGY.
// assert.equal(head(w.friend), head(w.friend)) passes for ever, says nothing, and reads exactly
// like a real test. This package shipped two of them, and they were guarding its worst
// regression — a claim that stood for a day because the test that would have refuted it was
// comparing a value with itself. Every other finding here is advisory; this one is a defect.
//
// It reports; it never vetoes. Silent on files that are not tests, and silent on clean ones.
// Exit 0 always.

// A reader that hangs up raises EPIPE asynchronously on the socket, where a try/catch around
// main() cannot reach it. This hook exits 0 always, and that has to survive a closed pipe.
process.stdout.on('error', () => {})

const fs = require('node:fs')
const path = require('node:path')

const TEST_PATH = /(^|[\\/])(tests?|__tests__|spec|e2e)[\\/]|\.(test|spec)\.[cm]?[jt]sx?$|(^|[\\/])test_[^\\/]+\.py$|_test\.(py|go|rb)$/i
const EXTS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts'])

/**
 * Blank strings, template literals, comments and regex bodies, PRESERVING LENGTH AND LINES, so a
 * match found here indexes the original text. Without this, the word `assert` inside a comment
 * counts as an assertion and a test that asserts nothing reads as covered.
 */
function stripLiterals(src) {
  const out = src.split('')
  const blank = (i, j) => { for (let k = i; k < j && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ' }
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; blank(i, j); i = j; continue }
    if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; blank(i, j); i = j; continue }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < n) { if (src[j] === '\\') { j += 2; continue } if (src[j] === c) break; j++ }
      j = Math.min(j + 1, n)
      blank(i + 1, j - 1)
      i = j
      continue
    }
    i++
  }
  return out.join('')
}

/** The text between the parenthesis at `open` and its match, or null if it never closes. */
function balanced(code, open) {
  let depth = 0
  for (let i = open; i < code.length; i++) {
    const c = code[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return { text: code.slice(open + 1, i), open, end: i } }
  }
  return null
}

/**
 * Argument SPANS, as offsets into the text given. Spans rather than substrings because the
 * splitting must happen on stripped code — so a comma inside a string cannot split an argument —
 * while the COMPARISON must happen on the original text. Stripping blanks string contents, which
 * made projectKey('/w/a', s) and projectKey('/w/b', s) identical and reported three real
 * assertions in this repo's own suite as tautologies.
 */
function topLevelSpans(text, base = 0) {
  const spans = []
  let depth = 0
  let start = 0
  const push = (s, e) => {
    while (s < e && /\s/.test(text[s])) s++
    while (e > s && /\s/.test(text[e - 1])) e--
    if (e > s) spans.push({ s: base + s, e: base + e })
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ',' && depth === 0) { push(start, i); start = i + 1 }
  }
  push(start, text.length)
  return spans
}

/** Substrings, for the checks that only need to know the shape of an argument. */
const topLevelArgs = (text) => topLevelSpans(text).map(({ s, e }) => text.slice(s, e))

const norm = (s) => s.replace(/\s+/g, '')
const lineOf = (text, index) => text.slice(0, Math.max(0, index)).split('\n').length

// Comparison assertions: both sides are expressions, so both sides can be the same expression.
const COMPARE = /\bassert\s*\.\s*(?:equal|strictEqual|deepEqual|deepStrictEqual|notEqual|notStrictEqual|deepInclude|include)\s*\(/g
// expect(X).toBe(Y) and friends.
const EXPECT = /\bexpect\s*\(/g
const EXPECT_MATCHER = /^\s*\.\s*(toBe|toEqual|toStrictEqual|toBeCloseTo|toContain)\s*\(/
// Anything at all that claims something. Used only to answer "does this file assert?", so it
// must match a CALL and not a binding: `import assert from 'node:assert'` is not an assertion,
// and counting it as one made every existence-only file read as adequately covered.
const ANY_ASSERTION = /\bassert\s*[.(]|\bexpect\s*\(|\.\s*should\b|\bchai\s*\./
// Assertions that say a thing exists or is not falsy. True of almost everything that is wrong.
const WEAK_ASSERT = /\bassert\s*\.\s*(?:ok|ifError|notEqual|notStrictEqual)\s*\(|\bassert\s*\(/g
const WEAK_MATCHER = /^\s*\.\s*(?:toBeDefined|toBeTruthy|toBeNull|toBeUndefined)\s*\(|^\s*\.\s*not\s*\.\s*toBe(?:Null|Undefined)\s*\(/

/**
 * The source with every existence-or-truthiness assertion blanked out, WHOLE — arguments and
 * matcher included. Blanking only the method name left `expect(cfg)` behind, which still reads
 * as an assertion, so a file whose every claim was `toBeDefined` reported as adequately covered.
 */
function withoutWeakAssertions(code) {
  const spans = []
  WEAK_ASSERT.lastIndex = 0
  for (let m; (m = WEAK_ASSERT.exec(code));) {
    const b = balanced(code, WEAK_ASSERT.lastIndex - 1)
    if (!b) continue
    // notEqual/notStrictEqual are weak ONLY against null or undefined; against a real value they
    // are a genuine claim.
    if (/notEqual|notStrictEqual/.test(m[0])) {
      const args = topLevelArgs(b.text)
      if (!(args.length >= 2 && /^(?:null|undefined)$/.test(norm(args[1])))) continue
    }
    spans.push([m.index, b.end + 1])
  }
  EXPECT.lastIndex = 0
  for (let m; (m = EXPECT.exec(code));) {
    const b = balanced(code, EXPECT.lastIndex - 1)
    if (!b) continue
    const after = code.slice(b.end + 1, b.end + 60)
    const mm = WEAK_MATCHER.exec(after)
    if (!mm) continue
    const open = b.end + 1 + after.indexOf('(', mm[0].length - 1)
    const arg = balanced(code, open)
    spans.push([m.index, arg ? arg.end + 1 : b.end + 1 + mm[0].length])
  }
  if (!spans.length) return { code, first: -1 }
  const out = code.split('')
  for (const [i, j] of spans) for (let k = i; k < j && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '
  return { code: out.join(''), first: Math.min(...spans.map((s) => s[0])) }
}

function findings(src) {
  const code = stripLiterals(src)
  const out = []

  // ── tautologies ───────────────────────────────────────────────────────────────────────────
  // Both sides are read from `src`, never from `code`: see topLevelSpans.
  const sameExpression = (a, b) => {
    const [x, y] = [norm(src.slice(a.s, a.e)), norm(src.slice(b.s, b.e))]
    // A literal compared with itself is a typo, not a tautology worth a report; an EXPRESSION
    // compared with itself is the one that looks like a test and is not.
    return x === y && x.length > 3 && /[A-Za-z_$]/.test(x) && !/^(?:true|false|null|undefined|-?\d+)$/.test(x)
  }
  COMPARE.lastIndex = 0
  for (let m; (m = COMPARE.exec(code));) {
    const b = balanced(code, COMPARE.lastIndex - 1)
    if (!b) continue
    const args = topLevelSpans(b.text, b.open + 1)
    if (args.length < 2 || !sameExpression(args[0], args[1])) continue
    out.push({ id: 'tautology', line: lineOf(src, m.index), detail: `${src.slice(args[0].s, args[0].e).slice(0, 60)} is compared with itself` })
  }
  EXPECT.lastIndex = 0
  for (let m; (m = EXPECT.exec(code));) {
    const b = balanced(code, EXPECT.lastIndex - 1)
    if (!b) continue
    const after = code.slice(b.end + 1, b.end + 40)
    const mm = EXPECT_MATCHER.exec(after)
    if (!mm) continue
    const open = b.end + 1 + after.indexOf('(', mm[0].length - 1)
    const arg = balanced(code, open)
    if (!arg) continue
    const subject = { s: b.open + 1, e: b.end }
    const expected = { s: arg.open + 1, e: arg.end }
    if (!sameExpression(subject, expected)) continue
    out.push({ id: 'tautology', line: lineOf(src, m.index), detail: `${src.slice(subject.s, subject.e).slice(0, 60)} is compared with itself` })
  }

  // ── a test file that asserts nothing ──────────────────────────────────────────────────────
  if (!ANY_ASSERTION.test(code)) {
    out.push({ id: 'no-assertion', line: 1, detail: 'this test file contains no assertion at all — it passes by not throwing' })
    return out
  }

  // ── everything it claims is that something exists ─────────────────────────────────────────
  const weak = withoutWeakAssertions(code)
  if (weak.first >= 0 && !ANY_ASSERTION.test(weak.code)) {
    out.push({ id: 'existence-only', line: lineOf(src, weak.first), detail: 'every assertion here says a value exists or is not falsy — a file existing is not a file being right' })
  }

  return out
}

const NOTE = {
  tautology: 'A tautology passes for ever and guards nothing. Capture the value BEFORE the operation and compare the result against that captured value.',
  'no-assertion': 'Assert the behaviour the code under test is supposed to produce, not merely that calling it did not throw.',
  'existence-only': 'Assert the value, not its presence. A successful call, a file on disk and a matching source string are three different things, and none of them is the right answer reaching the user.',
}

function main() {
  let payload
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}') } catch { return }
  if (!/^(Write|Edit|MultiEdit)$/.test(String(payload.tool_name || ''))) return
  const file = String((payload.tool_input && payload.tool_input.file_path) || '')
  if (!file || !EXTS.has(path.extname(file).toLowerCase()) || !TEST_PATH.test(file)) return
  let src
  try { src = fs.readFileSync(file, 'utf8') } catch { return }

  const found = findings(src)
  if (!found.length) return

  const name = path.basename(file)
  const worst = found.some((f) => f.id === 'tautology')
  const list = found.slice(0, 6).map((f) => `${f.id} (L${f.line}) — ${f.detail}`).join(' · ')
  const context = `${worst ? 'A TEST HERE CANNOT FAIL' : 'WEAK VERIFICATION'} in ${name}: ${list}. `
    + [...new Set(found.map((f) => NOTE[f.id]))].join(' ')
    + ' Verification that stops before the failure point is the defect this reports: a successful'
    + ' calculation, a matching source string and a settled screenshot are different things, and'
    + ' none alone establishes that the person got the right answer. Fix these before claiming the'
    + ' suite covers anything, and run `cgc behaviour <dir>` for the four classes that need the'
    + ' whole tree — a value computed and never delivered, an untested seam between two correct'
    + ' modules, a screen that shows machinery instead of a decision, and an explanation that has'
    + ' outlived its evidence.'
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context },
  }) + '\n')
}

// A hook is a COMMAND, not a module. main() reads stdin, so running it at load time
// means importing this file — from a test, or from a sibling hook that wants one of its
// helpers — blocks for ever on a pipe that never closes. The guard is what makes the
// exports below usable.
if (require.main === module) try { main() } catch { /* a reporting hook never blocks a write */ }
module.exports = { findings, stripLiterals, TEST_PATH }
