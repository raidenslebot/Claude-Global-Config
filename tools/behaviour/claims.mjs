// claims — an explanation is stronger than its evidence.
//
// Two shapes of the same failure, and neither is a bug in the code:
//
//   1. A comment that GUARANTEES something — "fixes", "no longer", "so that X can never" — sitting
//      on top of code that has been rewritten since the comment was last touched. The explanation
//      is describing a version of the block that is no longer there. Nothing errors; the next
//      reader is simply told something that stopped being true.
//
//   2. A document that ASSERTS a state of this repo right now — "lint clean", "all tests pass",
//      "no warnings", "12 of 12 passing". Those are claims whose evidence is a command, and the
//      command is not in the document. The instance that named this class was a handoff whose
//      "lint clean" did not reproduce on the next machine.
//
// WHY THIS IS TUNED THE WAY IT IS. The first version of detector 1 matched the words a claim is
// made of — fixed, never, cannot, always, must not — and found 880 comments in this repo, which is
// one in eight of every comment in it. Almost all of them were DESIGN PROSE: "a gate that fires on
// everything gets ignored", "this must never be the thing that fails a test". Those are arguments,
// not claims about the four lines underneath. So bare absolutes are gone, and what is left are the
// constructions that only make sense as a statement about the adjacent code. The same reason the
// date comparison is in commits and not in days: this repo is seven days old and 116 commits deep,
// so "a month stale" would find nothing here and "a day stale" would find half the file.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const id = 'claims'
export const title = 'Claims that outlived their evidence'
export const why = 'A comment guarantees what the code under it stopped doing; a doc asserts a state nobody re-measured.'

// ── 1. comments that make a checkable claim ──────────────────────────────────────────────────

/** Comment ranges, found by the same walk stripLiterals uses — so "//" inside a string is not a
 *  comment, and ctx.commentsOnly's string contents (which it keeps) cannot leak in here. */
function commentRanges(src) {
  const out = []
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; out.push([i, j]); i = j; continue }
    if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; out.push([i, j]); i = j; continue }
    if (c === '#' && /[\r\n]/.test(src[i - 1] || '\n')) { let j = src.indexOf('\n', i); if (j < 0) j = n; out.push([i, j]); i = j; continue }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < n) { if (src[j] === '\\') { j += 2; continue } if (src[j] === c) break; j++ }
      i = Math.min(j + 1, n)
      continue
    }
    i++
  }
  return out
}

/** Constructions that only parse as a claim about the code beside them. A bare "never" is prose;
 *  "so that it can never" is a guarantee, and a guarantee is checkable. */
const CLAIM = [
  [/\b(?:was|is|has been|have been|now|already|been) fixed\b/i, 'reports a past fix'],
  [/\bfix(?:es|ed) (?:this|that|it|the|a|an) /i, 'reports a past fix'],
  [/\bfixed (?:by|in|when|so|because|here|it)\b/i, 'reports a past fix'],
  [/\bno longer\b/i, 'asserts something stopped happening'],
  [/\b(?:was|is|were|are|has been|have been) resolved\b/i, 'reports a past fix'],
  [/\bresolved (?:by|in|when|here)\b/i, 'reports a past fix'],
  // Third person only, and that is the whole filter. "this guarantees the order" is a claim about
  // the code; "there is no guarantee", "the failure this exists to prevent", "ensuring the order"
  // are prose about the design. The bare infinitive was the single largest source of noise here.
  [/\bguarantees\b/i, 'states a guarantee'],
  [/\bensures\b/i, 'states a guarantee'],
  [/\bprevents\b/i, 'states a guarantee'],
  [/\bis (?:safe|clean|correct)\b/i, 'states a guarantee'],
  [/\bso (?:that|it)\b[^.]{0,70}\b(?:never|cannot|can't|always)\b/i, 'states an impossibility'],
  // Not "would never" / "could never": those describe the rejected alternative, which is exactly
  // what a comment explaining a choice is for.
  [/\b(?:can|will|shall) never\b/i, 'states an impossibility'],
  [/\b(?:is|are|it's) never\b/i, 'states an impossibility'],
  [/\bnever (?:throws|fails|returns|fires|runs|happens|null|undefined|empty|blocks|leaks)\b/i, 'states an impossibility'],
  [/\balways (?:returns|throws|runs|fires|wins|holds|succeeds|matches)\b/i, 'states an absolute'],
]

const claimIn = (text) => CLAIM.find(([re]) => re.test(text))

const indentOf = (s) => /^[ \t]*/.exec(s)[0].replace(/\t/g, '  ').length
const OPEN = /[{([]/g
const CLOSE = /[})\]]/g
const depthDelta = (s) => (s.match(OPEN) || []).length - (s.match(CLOSE) || []).length

/**
 * The code a comment is explaining: from the first line under it, down to the end of that
 * statement or block. A blank line or a fresh comment ends it once braces are balanced, and 20
 * lines is the cap. Truncating early is the safe error — a shorter window can only make this
 * check quieter.
 */
function codeWindow(codeLines, isComment, startIdx) {
  let i = startIdx
  while (i < codeLines.length && (!codeLines[i].trim() || isComment[i])) {
    if (isComment[i]) return null // the next thing is another comment, not code
    i++
  }
  if (i >= codeLines.length) return null
  const base = indentOf(codeLines[i])
  const lines = []
  let depth = 0
  for (let k = i; k < codeLines.length && lines.length < 20; k++) {
    const L = codeLines[k]
    if (k > i && depth <= 0) {
      if (!L.trim()) break
      if (isComment[k]) break
      if (indentOf(L) < base) break
    }
    lines.push(k + 1)
    depth += depthDelta(L)
  }
  return lines.length ? lines : null
}

const ZERO = '0000000000000000000000000000000000000000'

/** line -> commit sha, for one file, in one git call. */
function blame(ctx, rel) {
  const out = ctx.git(['blame', '--porcelain', '--', rel])
  if (!out) return null
  const byLine = new Map()
  const at = new Map()
  let cur = null
  for (const raw of out.split('\n')) {
    const h = /^([0-9a-f]{40}) \d+ (\d+)/.exec(raw)
    if (h) { cur = { sha: h[1], line: Number(h[2]) }; continue }
    if (!cur) continue
    if (raw.startsWith('author-time ')) { at.set(cur.sha, Number(raw.slice(12).trim())); continue }
    if (raw[0] === '\t') { byLine.set(cur.line, cur.sha); cur = null }
  }
  return { byLine, at }
}

/** sha -> position in THIS FILE's history, newest first. The unit that matters is "how many
 *  further edits to this file landed on top", not wall-clock days. */
function history(ctx, rel) {
  const out = ctx.git(['log', '--format=%H', '--', rel])
  if (!out) return null
  const ord = new Map()
  out.trim().split('\n').filter(Boolean).forEach((sha, i) => ord.set(sha.trim(), i))
  return ord
}

// A porcelain block reuses a commit's header fields after their first appearance, so a truncated
// or unusual blame can leave a sha with no author-time. That is a missing date, not a crash.
const day = (t) => (Number.isFinite(t) ? new Date(t * 1000).toISOString().slice(0, 10) : 'date unknown')

/** Most recent (lowest ordinal) commit among a set of lines. null if any line is uncommitted. */
function newest(lines, byLine, ord) {
  let best = null
  for (const n of lines) {
    const sha = byLine.get(n)
    if (!sha || sha === ZERO) return null
    const o = ord.get(sha)
    if (o === undefined) return null
    if (!best || o < best.ord) best = { sha, ord: o }
  }
  return best
}

// How many further commits to the same file must have landed on the code before a comment above
// it counts as left behind. 1 is usually the same piece of work continuing; 2 means the code was
// revisited at least twice with the explanation never reopened.
const STALE_COMMITS = 2
const GIT_BUDGET_MS = 20000

function staleComments(ctx, findings) {
  let examined = 0
  let sampled = false
  const started = Date.now()
  for (const f of ctx.sources) {
    // Own-line comments only. A trailing `foo() // why` is an annotation on a line of code, not a
    // block sitting above one — counting it as a comment LINE would truncate the window of the
    // real comment above it, and counting it as a block would date a claim against its own line.
    const ranges = commentRanges(f.src).filter(([s]) => !f.src.slice(f.src.lastIndexOf('\n', s - 1) + 1, s).trim())
    if (!ranges.length) continue
    const codeLines = f.code.split('\n')
    const isComment = new Array(codeLines.length).fill(false)
    for (const [s, e] of ranges) {
      for (let n = ctx.lineOf(f.src, s); n <= ctx.lineOf(f.src, e); n++) isComment[n - 1] = true
    }

    // Group adjacent comment ranges into the blocks a human would call one comment.
    const blocks = []
    for (const [s, e] of ranges) {
      const a = ctx.lineOf(f.src, s)
      const b = ctx.lineOf(f.src, e)
      const last = blocks[blocks.length - 1]
      if (last && a <= last.end + 1) { last.end = Math.max(last.end, b); last.text += '\n' + f.src.slice(s, e) }
      else blocks.push({ start: a, end: b, text: f.src.slice(s, e) })
    }

    const candidates = []
    for (const b of blocks) {
      // A block opening in the first three lines is the file's banner: it describes the module,
      // not the statement under it, and the statement under it is an import.
      if (b.start <= 3) continue
      const hit = claimIn(b.text)
      if (!hit) continue
      const code = codeWindow(codeLines, isComment, b.end)
      if (!code) continue
      candidates.push({ ...b, kind: hit[1], code })
    }
    if (!candidates.length) continue
    examined += candidates.length

    if (Date.now() - started > GIT_BUDGET_MS) { sampled = true; continue }
    const bl = blame(ctx, f.rel)
    const ord = bl && history(ctx, f.rel)
    if (!bl || !ord) continue

    for (const c of candidates) {
      const commentLines = []
      for (let n = c.start; n <= c.end; n++) commentLines.push(n)
      const cm = newest(commentLines, bl.byLine, ord)
      const cd = newest(c.code, bl.byLine, ord)
      if (!cm || !cd) continue
      const distance = cm.ord - cd.ord
      if (distance < STALE_COMMITS) continue
      // Two commits to one file on the SAME DAY is one working session, not prose that has
      // outlived its subject — and a commit count alone cannot tell those apart. Measured on
      // this repo the same-day cases were all false: a comment and the code under it touched
      // hours apart while both were being written. A stale explanation is a thing that happened
      // over TIME, so time is what the threshold has to be in.
      if (day(bl.at.get(cm.sha)) === day(bl.at.get(cd.sha))) continue
      const sentence = (c.text.replace(/^[\s/*#]+|[\s*/]+$/gm, ' ').replace(/\s+/g, ' ').trim()).slice(0, 120)
      findings.push({
        file: f.rel,
        line: c.start,
        what: `comment ${c.kind} about code that has been rewritten ${distance} commits since`,
        evidence: `comment last touched ${cm.sha.slice(0, 8)} (${day(bl.at.get(cm.sha))}), lines ${c.code[0]}-${c.code[c.code.length - 1]} last touched ${cd.sha.slice(0, 8)} (${day(bl.at.get(cd.sha))}) — "${sentence}"`,
        fix: `re-read lines ${c.code[0]}-${c.code[c.code.length - 1]} and either restate the comment or delete it`,
      })
    }
  }
  return { examined, sampled }
}

// ── 2. a document asserting a state of the repo ──────────────────────────────────────────────

const STATE = [
  [/\blint(?:ing|s)? (?:is |was |are |comes back )?clean\b/i, 'lint'],
  [/\bclean lint\b/i, 'lint'],
  [/\ball (?:\d+ )?(?:the )?(?:unit |integration |remaining )?tests? (?:pass|passed|passing|are green)\b/i, 'test'],
  [/\bthe (?:test )?suite (?:passes|passed|is green)\b/i, 'test'],
  [/\b\d+\s*(?:\/|of)\s*\d+\s*(?:tests?\s*)?(?:pass|passing|passed|green|clean)\b/i, 'test'],
  [/\ball checks? (?:pass|passed|passing)\b/i, null],
  // PLURAL ONLY, deliberately. "no warning" is the English for "without warning" and "no error"
  // is how a symptom gets described — both are everywhere in troubleshooting prose and neither is
  // a claim. "no failures, no warnings" is a result somebody read off a run.
  [/\b(?:no|zero|0) (?:errors|warnings|failures|findings|violations)\b/i, null],
  [/\bfully verified\b/i, null],
  [/\bverified clean\b/i, null],
  [/\b100% (?:coverage|passing|green)\b/i, null],
]

// A sentence carrying one of these is telling somebody what to do, or what would be true if —
// not reporting what is. "must show no failure" is a standard; "no failures, no warnings" is a
// claim. Losing the first is the entire reason this list exists.
const NOT_AN_ASSERTION = /\b(?:must|should|shall|until|ensure|ensures|ensuring|make sure|unless|if|when|whenever|before|after|so that|in order to|need(?:s|ed)? to|require[sd]?|expect(?:s|ed)? to|aim|goal|target|want|claim(?:s|ing|ed)?|say(?:s|ing)?|assert(?:s|ing)?|would|could|do not|don't|never)\b/i

const isHistoricalHeading = (h) => /\d{4}-\d{2}-\d{2}/.test(h) || /\(\s*\d{4}[-/]\d{2}[-/]\d{2}\s*\)/.test(h)
const CHANGELOG = /(^|\/)(changelog|history|releases?|news)\.(md|mdx|txt|rst)$/i

function scriptFor(root, want) {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const s = pkg.scripts || {}
    const key = Object.keys(s).find((k) => k === want || k.startsWith(`${want}:`))
    if (key) return key === 'test' ? 'npm test' : `npm run ${key}`
  } catch { /* no package.json, or not ours to read */ }
  return null
}

/**
 * Paragraphs, not lines. A wrapped sentence is one claim, and reading it a line at a time yields
 * evidence like `0 failures, 5.1s**.` — a fragment the reader cannot judge. Fenced blocks, YAML
 * frontmatter, headings and sections under a dated heading never make it out of here.
 */
function paragraphs(src) {
  const lines = src.split('\n')
  const out = []
  let fence = null
  let heading = ''
  let frontmatter = lines[0]?.trim() === '---'
  let cur = null
  const flush = () => { if (cur && cur.text.trim()) out.push(cur); cur = null }
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (frontmatter) { if (i > 0 && raw.trim() === '---') frontmatter = false; continue }
    const fm = /^\s*(```|~~~)/.exec(raw)
    if (fm) { flush(); if (fence && raw.trim().startsWith(fence)) fence = null; else if (!fence) fence = fm[1]; continue }
    if (fence) continue
    if (!raw.trim()) { flush(); continue }
    if (/^\s{0,3}#{1,6}\s/.test(raw)) { flush(); heading = raw; continue }
    // A list item, a table row or a blockquote starts its own paragraph; a plain line continues.
    if (cur && /^\s{0,3}(?:[-*+]\s|\d+[.)]\s|\||>)/.test(raw)) flush()
    if (isHistoricalHeading(heading)) continue
    if (!cur) cur = { line: i + 1, text: raw }
    else cur.text += '\n' + raw
  }
  flush()
  return out.filter((p) => !isHistoricalHeading(p.text))
}

/** [start, end) of the sentence containing `at`. A full stop only ends a sentence when the
 *  markdown that decorates it — **bold**, a close paren, a quote — is over too, which is why this
 *  is not indexOf('. '): "…390×844.**" ends a sentence and "5.1s**." ends one four characters later. */
const SENTENCE_END = /[.!?][*_`)\]"'”’]*(?=\s|$)/g
function sentenceAround(text, at) {
  let from = 0
  for (const m of text.slice(0, at).matchAll(SENTENCE_END)) from = m.index + m[0].length
  while (/\s/.test(text[from] || '')) from++
  SENTENCE_END.lastIndex = 0
  const rest = text.slice(at)
  const end = [...rest.matchAll(SENTENCE_END)][0]
  return [from, end ? at + end.index + end[0].length : text.length]
}

function stateClaims(ctx, findings) {
  let examined = 0
  const testCmd = scriptFor(ctx.root, 'test')
  const lintCmd = scriptFor(ctx.root, 'lint')
  for (const f of ctx.prose) {
    if (CHANGELOG.test(f.rel)) continue
    examined++
    // The first lines of a document are where it says what it was measured against.
    const head = f.src.split('\n').slice(0, 15).join('\n')
    for (const p of paragraphs(f.src)) {
      // Inline code is a command or quoted output, not an assertion the document is making — but
      // it is blanked to SPACES so every offset below still indexes the real text, and the
      // evidence is a slice of what the document actually says.
      const text = p.text.replace(/`[^`]*`/gs, (m) => ' '.repeat(m.length))
      const hit = STATE.find(([re]) => re.test(text))
      if (!hit) continue
      const at = text.search(hit[0])
      const [from, to] = sentenceAround(text, at)
      if (NOT_AN_ASSERTION.test(text.slice(from, to))) continue
      // The command that would settle it, best first: the one the document names immediately
      // before the claim, then a script this repo actually defines.
      let named = null
      for (const m of p.text.matchAll(/`([a-z][a-z0-9._-]*(?:[ \n][^`]{1,60})?)`/gs)) {
        if (m.index < at && /\s/.test(m[1])) named = m[1].replace(/\s+/g, ' ')
      }
      const cmd = named || (hit[1] === 'test' && testCmd) || (hit[1] === 'lint' && lintCmd)
        || (/\btests?\b/i.test(text) && testCmd) || null
      // ANCHORED: a claim tied to a revision is a record of what was true then, which is exactly
      // what an audit or a post-mortem is for. The anchor counts from the claim's own paragraph
      // OR from the document's opening lines, because a document that states its revision states
      // it once, at the top, for everything below.
      //
      // EXCEPT when the sentence asserts the PRESENT. "Measured just now", "currently", "as it
      // stands" claims today regardless of what the header says, and goes on claiming it for
      // ever. Both halves of this rule came from one file: this repo's enforcement audit names
      // its commit in line 12 and was wrongly reported for a claim at line 13 — and 350 lines
      // further down says "measured just now at 94 tests", which is now off by a factor of ten.
      const PRESENT = /\b(just now|right now|currently|at present|as it stands|as of today|today)\b/i
      const ANCHOR = /(?:commit|revision|rev|sha|as of)[^.\n]{0,40}[0-9a-f]{7,40}|\d{4}-\d{2}-\d{2}/i
      if (!PRESENT.test(p.text) && (ANCHOR.test(p.text) || ANCHOR.test(head))) continue
      findings.push({
        file: f.rel,
        line: p.line + (text.slice(0, at).match(/\n/g) || []).length,
        what: 'asserts a state of the repo that no command in the document reproduces',
        evidence: p.text.slice(from, to).replace(/\s+/g, ' ').trim().slice(0, 160),
        fix: cmd
          ? `re-run \`${cmd}\` and record the commit it passed on, or delete the claim`
          : 'name the command that produced this and the commit it ran against, or delete the claim',
      })
      break // one per document: a second instance of the same untested claim is the same finding
    }
  }
  return examined
}

// What this deliberately walks past, said out loud — because the reader needs to know which half
// of "clean" they got. Every entry here is a decision, not an omission.
const BLIND_SPOTS = 'not detected: bare absolutes in design prose, comments in tests, file banners, uncommitted lines, changelogs and dated sections, a state-claim anchored to a commit or an ISO date, a comment and its code touched on the same day, fenced or inline code'

export function run(ctx) {
  const findings = []
  const prose = stateClaims(ctx, findings)
  const notes = []
  let examined = 0

  if (!ctx.inGit) {
    notes.push(`not a git checkout — the stale-comment half needs blame and did not run; ${prose} prose files judged`)
  } else {
    const s = staleComments(ctx, findings)
    examined = s.examined
    notes.push(`${examined} claim-making comments in ${ctx.sources.length} source files, ${prose} prose files`)
    notes.push(`stale = the code under the comment moved ${STALE_COMMITS}+ further commits of that file`)
    if (s.sampled) notes.push(`git budget of ${GIT_BUDGET_MS / 1000}s ran out — later files were not dated`)
  }
  notes.push(BLIND_SPOTS)
  return { findings, scanned: examined + prose, note: notes.join('; ') }
}
