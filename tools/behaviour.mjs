#!/usr/bin/env node
// behaviour.mjs — the five ways working code still fails the person using it.
//
//   cgc behaviour [path…]        every check, over this tree
//   cgc behaviour --only=claims  one of them
//   cgc behaviour --json         machine-readable
//   cgc behaviour --strict       exit 1 if anything is found
//
// WHY THIS EXISTS, AND WHY IT IS NOT ANOTHER LINTER.
//
// Every gate in this package until now measured an ARTEFACT — is this page generic, does this
// palette repeat, does this animation actually move. They all share an assumption: that the
// thing under test is the thing the user receives. These five checks are the ones that fire when
// that assumption is false — when the code is individually correct and the person still does not
// get the answer. They were named from a real review of real work, and each one is a class, not
// an instance:
//
//   delivered  A calculation exists and the user never receives it. The value is computed, the
//              plan is published to a window nobody showed, the header reads a field the mirror
//              never supplies. Nothing is broken; nothing arrives.
//   seams      Every module behaves correctly and the whole flow fails. The store knows who owns
//              the inventory, the rename handler writes it under the wrong owner anyway. Unit
//              tests cannot see this by construction: the defect lives between the units.
//   decision   The UI exposes the machinery instead of delivering the decision. Fifteen panels
//              across six groups where the design called for four surfaces and one instruction.
//   claims     An explanation is stronger than its evidence. A comment describes a guarantee the
//              code stopped providing three commits ago; a handoff says "lint clean" and it does
//              not reproduce. The prose outlives the fact.
//   proxies    Verification stops before the actual failure point. A successful calculation, a
//              matching source string, a settled screenshot and an installed overlay are four
//              different things, and none of them is "the user saw the right answer in time".
//
// Each check lives in its own module under tools/behaviour/ and exports { id, title, why, run }.
// run(ctx) gets the tree already read and literal-stripped, and returns findings. A check that
// cannot say anything useful about a tree returns no findings and says why in `note` — silence
// and "nothing to say" are different answers and this report distinguishes them.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { askedForHelp } from './paths.mjs'

if (askedForHelp(import.meta.url)) process.exit(0)

const argv = process.argv.slice(2)
const flag = (name) => (argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=')
const JSON_OUT = argv.includes('--json')
const STRICT = argv.includes('--strict')
const ONLY = new Set(flag('only').split(',').filter(Boolean))
const SKIP = new Set(flag('skip').split(',').filter(Boolean))
const paths = argv.filter((a) => !a.startsWith('--'))

// ── what counts as a file worth reading ──────────────────────────────────────────────────────
// Anything generated, vendored or installed is somebody else's code: a finding there is noise,
// and the volume of it would bury every real one.
const SKIP_DIR = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'vendor', '.next', '.nuxt',
  '.svelte-kit', '.venv', 'venv', '__pycache__', '.cache', 'target', 'bin', 'obj', '.turbo',
  'site-packages', '.pytest_cache', '.mypy_cache', 'bower_components', 'third_party',
])
const CODE = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.py', '.rb', '.go', '.rs', '.java', '.cs', '.php', '.swift', '.kt', '.lua', '.svelte', '.vue'])
const PROSE = new Set(['.md', '.mdx', '.txt', '.rst'])
const MARKUP = new Set(['.html', '.htm', '.svelte', '.vue', '.jsx', '.tsx'])
const MAX_BYTES = 400 * 1024

/** A file is a test if its path says so. Every ecosystem spells this differently; all of them
 *  spell it in the path rather than the contents, which is why this is not a content sniff. */
export const isTestPath = (rel) => /(^|[\\/])(tests?|__tests__|spec|e2e)[\\/]/i.test(rel)
  || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(rel)
  || /(^|[\\/])test_[^\\/]+\.py$/i.test(rel)
  || /_test\.(py|go|rb)$/i.test(rel)

/**
 * Blank out string literals, template literals, comments and regex bodies, PRESERVING LENGTH and
 * line structure. Every offset in the result indexes the original, so a check can find a pattern
 * in `code` and read the real text at the same position — which is the only way to search source
 * without matching the word "fixed" inside a sentence about fixing something.
 */
export function stripLiterals(src) {
  const out = src.split('')
  const blank = (i, j) => { for (let k = i; k < j && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ' }
  const n = src.length
  let i = 0
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; blank(i, j); i = j; continue }
    if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; blank(i, j); i = j; continue }
    if (c === '#' && /[\r\n]/.test(src[i - 1] || '\n')) { let j = src.indexOf('\n', i); if (j < 0) j = n; blank(i, j); i = j; continue }
    if (c === '"' || c === "'") { const j = endOfQuote(src, i); blank(i + 1, j); i = j + 1; continue }
    if (c === '\u0060') { i = stripTemplate(src, i, blank); continue }
    i++
  }
  return out.join('')
}

/** Index of the closing quote of the string opening at `i`, or the end of the source. */
function endOfQuote(src, i) {
  const q = src[i]
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue }
    if (src[j] === q) return j
  }
  return src.length
}

/**
 * Blank a template literal's TEXT while leaving its `${…}` holes alone, and return the index just
 * past its closing backtick. The holes are code — and they are where a display string reads its
 * values, so blanking them hid `${summary.storageHealth}` completely and the header case, the
 * founding instance of the `delivered` class, was never found by the check named after it.
 */
function stripTemplate(src, start, blank) {
  let from = start + 1
  let j = from
  while (j < src.length) {
    const c = src[j]
    if (c === '\\') { j += 2; continue }
    if (c === '\u0060') { blank(from, j); return j + 1 }
    if (c === '$' && src[j + 1] === '{') { blank(from, j); j = skipHole(src, j + 1, blank); from = j; continue }
    j++
  }
  blank(from, src.length)
  return src.length
}

/** `src[open]` is '{'. Returns the index just past its match, blanking any literal nested inside. */
function skipHole(src, open, blank) {
  let depth = 0
  let j = open
  while (j < src.length) {
    const c = src[j]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return j + 1 }
    else if (c === '"' || c === "'") { const e = endOfQuote(src, j); blank(j + 1, e); j = e + 1; continue }
    else if (c === '\u0060') { j = stripTemplate(src, j, blank); continue }
    j++
  }
  return src.length
}

/** Comments only — the inverse of stripLiterals, same length. What a check needs when the
 *  subject IS the prose: a claim lives in a comment, never in the expression beside it. */
export function commentsOnly(src) {
  const code = stripLiterals(src)
  let out = ''
  for (let i = 0; i < src.length; i++) out += (code[i] === src[i] && src[i] !== '\n') ? ' ' : src[i]
  return out
}

export const lineOf = (src, index) => src.slice(0, Math.max(0, index)).split('\n').length

function walk(root, into = [], depth = 0) {
  if (depth > 12) return into
  let names = []
  try { names = readdirSync(root, { withFileTypes: true }) } catch { return into }
  for (const e of names) {
    if (e.name.startsWith('.') && e.name !== '.claude') { if (e.isDirectory()) continue }
    const abs = join(root, e.name)
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(abs, into, depth + 1); continue }
    if (!e.isFile()) continue
    const ext = extname(e.name).toLowerCase()
    if (!CODE.has(ext) && !PROSE.has(ext) && !MARKUP.has(ext) && ext !== '.css') continue
    try { if (statSync(abs).size > MAX_BYTES) continue } catch { continue }
    into.push(abs)
  }
  return into
}

/** Everything the checks share, read once. */
export function buildContext(targets) {
  const roots = (targets.length ? targets : ['.']).map((p) => resolve(p))
  const root = roots[0]
  const abs = []
  for (const r of roots) {
    let st
    try { st = statSync(r) } catch { continue }
    if (st.isDirectory()) walk(r, abs)
    else abs.push(r)
  }
  const files = []
  for (const a of [...new Set(abs)]) {
    let src
    try { src = readFileSync(a, 'utf8') } catch { continue }
    if (src.includes('\u0000')) continue
    const rel = relative(root, a).split(sep).join('/') || a
    files.push({ abs: a, rel, ext: extname(a).toLowerCase(), src, get code() { return (this._c ??= stripLiterals(this.src)) } })
  }
  const git = (args) => {
    const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 20000, windowsHide: true })
    return r.status === 0 ? String(r.stdout || '') : null
  }
  const inGit = git(['rev-parse', '--is-inside-work-tree']) !== null
  return {
    root,
    files,
    git,
    inGit,
    isTestPath,
    stripLiterals,
    commentsOnly,
    lineOf,
    sources: files.filter((f) => CODE.has(f.ext) && !isTestPath(f.rel)),
    tests: files.filter((f) => isTestPath(f.rel)),
    prose: files.filter((f) => PROSE.has(f.ext)),
    markup: files.filter((f) => MARKUP.has(f.ext) || f.ext === '.html' || f.ext === '.htm'),
  }
}

const CHECKS = ['delivered', 'seams', 'decision', 'claims', 'proxies']

async function main() {
  const ctx = buildContext(paths)
  const wanted = CHECKS.filter((id) => (!ONLY.size || ONLY.has(id)) && !SKIP.has(id))
  const report = { root: ctx.root, files: ctx.files.length, checks: [] }

  for (const id of wanted) {
    let mod
    try { mod = await import(`./behaviour/${id}.mjs`) } catch (e) {
      report.checks.push({ id, title: id, error: String(e.message), findings: [], scanned: 0 })
      continue
    }
    try {
      const r = await mod.run(ctx)
      report.checks.push({
        id, title: mod.title || id, why: mod.why || '',
        findings: r.findings || [], scanned: r.scanned ?? 0, note: r.note || '',
      })
    } catch (e) {
      // A check that threw has NOT passed, and must never be reported as clean.
      report.checks.push({ id, title: mod.title || id, error: String(e.message), findings: [], scanned: 0 })
    }
  }

  report.total = report.checks.reduce((a, c) => a + c.findings.length, 0)
  report.errored = report.checks.filter((c) => c.error).map((c) => c.id)

  if (JSON_OUT) console.log(JSON.stringify(report, null, 2))
  else print(report)
  return STRICT && (report.total > 0 || report.errored.length) ? 1 : 0
}

const B = (s) => `\x1b[1m${s}\x1b[0m`
const DIM = (s) => `\x1b[90m${s}\x1b[0m`
const RED = (s) => `\x1b[31m${s}\x1b[0m`
const YEL = (s) => `\x1b[33m${s}\x1b[0m`
const GRN = (s) => `\x1b[32m${s}\x1b[0m`

function print(r) {
  console.log(`\n${B('cgc behaviour')} ${DIM(r.root)}`)
  console.log(DIM(`  ${r.files} files read\n`))
  for (const c of r.checks) {
    const head = `── ${c.title} ${'─'.repeat(Math.max(0, 56 - c.title.length))}`
    console.log(B(head))
    if (c.why) console.log(DIM(`  ${c.why}`))
    if (c.error) { console.log(`  ${RED('ERROR')} the check itself failed — ${c.error}`); console.log(DIM('  This is not a pass. Nothing was measured.\n')); continue }
    if (!c.findings.length) {
      console.log(`  ${GRN('clean')} ${DIM(`${c.scanned} examined`)}${c.note ? DIM(` — ${c.note}`) : ''}\n`)
      continue
    }
    console.log(`  ${YEL(`${c.findings.length} found`)} ${DIM(`of ${c.scanned} examined`)}`)
    for (const f of c.findings.slice(0, 12)) {
      console.log(`  ${RED('·')} ${f.file}${f.line ? `:${f.line}` : ''} — ${f.what}`)
      if (f.evidence) console.log(DIM(`      ${f.evidence}`))
      if (f.fix) console.log(DIM(`      → ${f.fix}`))
    }
    if (c.findings.length > 12) console.log(DIM(`  … ${c.findings.length - 12} more (--json for all)`))
    if (c.note) console.log(DIM(`  ${c.note}`))
    console.log('')
  }
  const verdict = r.errored.length
    ? RED(`${r.errored.length} check(s) could not run: ${r.errored.join(', ')} — nothing was measured there`)
    : r.total === 0 ? GRN('nothing found') : YEL(`${r.total} findings across ${r.checks.filter((c) => c.findings.length).length} classes`)
  console.log(`${B('verdict')}  ${verdict}`)
  if (r.total) console.log(DIM('  Each one is a place where the code is fine and the person still does not get the answer.\n'))
  else console.log('')
}

if (process.argv[1] && /behaviour\.mjs$/.test(process.argv[1])) process.exit(await main())
