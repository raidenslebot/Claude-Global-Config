// PostToolUse hook: verify a file the moment it is written, and report real defects back
// into the transcript.
//
// WHY THIS EXISTS — do not delete it as "redundant with the linter".
//
// Hooks come in two kinds. An ADVISORY hook injects reminder text and hopes the model obeys
// it; it competes with everything else in the context window, and it loses often enough that
// defects still ship. A GATE inspects the artifact and reports a concrete defect with a
// location. Only the second kind actually holds. This file is the earliest gate available: it
// fires seconds after the write, while the model still has the file in working memory, rather
// than at commit time, at review time, at CI time, or never.
//
// It is not a linter. A linter runs when somebody remembers to run it, needs project config,
// and assumes a language and a toolchain. This runs unconditionally on every write, in every
// project, with no config and no dependencies, and it only knows how to find defects that are
// silent at runtime — the ones nobody notices until much later:
//   1. a syntax error in a script (a broken hook or tool is a no-op, with no error anywhere)
//   2. a config file that is no longer valid JSON
//   3. a SKILL.md whose `name` does not match its directory (it silently never dispatches)
//   4. an absolute machine path hardcoded in a source or config file (works here, breaks
//      on every other machine — including the same project cloned to a different user)
//   5. a Windows path written into a JS string literal, where the backslashes are read as
//      escapes at parse time and destroy the path before any runtime check can see it
//
// DESIGN RULES, in priority order:
//   1. Exit 0, always. This reports; it never vetoes. A veto on a false positive makes the
//      session unusable, and one unusable session gets the hook deleted.
//   2. Zero false positives. Every check below is deterministic or deliberately narrowed
//      until it is. A noisy gate gets switched off, which is strictly worse than no gate.
//   3. Silence when clean, so that output means something.
//   4. Fast. Budget is a fraction of a second; the only subprocess is a syntax check, and it
//      runs only for a file this interpreter can parse.
//   5. Self-contained and universal. Node built-ins only, no imports from any repo, no
//      assumption that the project is Node or has a manifest, and no hardcoded path,
//      username, drive, or tool location — this file is copied into a user's hooks directory
//      on machines it will never see. Everything it touches comes from the hook payload;
//      the one machine location it needs comes from os.homedir(). Unrecognised file type =
//      stay silent.

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const MAX_BYTES = 512 * 1024 // bigger than this is generated or vendored; not worth the time
const MAX_FINDINGS = 6

// Extension groups. Anything not listed here is unrecognised, and unrecognised means silent.
const EXT_JS_SYNTAX = new Set(['.js', '.mjs', '.cjs']) // check 1 — this interpreter can parse it
const EXT_JS_STRINGS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']) // check 5
// check 4 — text formats where an absolute path is a portability defect rather than prose.
// Markdown is deliberately absent: documentation quotes machine paths on purpose.
const EXT_PATH_SCAN = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.yml', '.yaml', '.toml', '.ini',
  '.cfg', '.conf', '.sh', '.bash', '.zsh', '.ps1', '.psm1', '.bat', '.cmd', '.py', '.rb',
  '.go', '.rs', '.java', '.kt', '.cs', '.php', '.lua', '.pl', '.c', '.h', '.cpp', '.hpp',
  '.sql', '.xml', '.gradle', '.tf', '.dockerfile',
])

// ---------------------------------------------------------------------------------------
// payload
// ---------------------------------------------------------------------------------------

function readPayload() {
  let raw = ''
  try {
    raw = fs.readFileSync(0, 'utf8')
  } catch {
    return null // no stdin (run by hand, or a harness that pipes nothing) — nothing to do
  }
  if (!raw.trim()) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// The payload shape is not guaranteed across versions, so every field is probed rather than
// assumed. Anything unexpected returns null and the hook exits silently.
function targetFile(payload) {
  if (!payload || typeof payload !== 'object') return null

  const tool = payload.tool_name || payload.toolName || payload.tool || ''
  if (typeof tool === 'string' && tool) {
    if (/notebook/i.test(tool)) return null // .ipynb is JSON-with-embedded-code; not ours
    if (!/write|edit/i.test(tool)) return null
  }

  const input = payload.tool_input || payload.toolInput || payload.input || {}
  const response = payload.tool_response || payload.toolResponse || {}
  const candidates = [
    input.file_path, input.filePath, input.path, input.file,
    response.filePath, response.file_path,
  ]
  const found = candidates.find((c) => typeof c === 'string' && c.trim())
  if (!found) return null

  const cwd = typeof payload.cwd === 'string' ? payload.cwd : process.cwd()
  return path.isAbsolute(found) ? found : path.resolve(cwd, found)
}

// Vendored, cloned, generated, or VCS-internal trees: not authored here, so not ours to judge.
// `repos` covers the usual name for a directory of third-party checkouts; a project that uses
// it for its own source loses a little recall, which is the safe direction to lose it in.
function inSkippedTree(file) {
  const norm = file.replace(/\\/g, '/').toLowerCase()
  return /(^|\/)(node_modules|\.git|vendor|third_party|bower_components|repos|site-packages)\//
    .test(norm)
}

// Files under a dot-directory in the user's home (or loose in it) are per-machine config by
// definition — an absolute path there is correct, not a defect. Used only by check 4.
function isMachineLocalConfig(file) {
  let home
  try {
    home = os.homedir()
  } catch {
    return false
  }
  if (!home) return false
  const rel = path.relative(home, file)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false
  const first = rel.split(/[\\/]/)[0]
  return rel === first || first.startsWith('.')
}

// A scratch file under the OS temp directory is never shipped and never installed, so a
// hardcoded path in one is not a defect — it is a throwaway. Reporting it is pure noise,
// and noise is what gets a gate switched off. Applies to EVERY check, so the skip rules
// stay consistent: previously some checks skipped temp files and others did not, which
// made the hook look arbitrary.
function isScratch(file) {
  try {
    const tmp = os.tmpdir()
    if (!tmp) return false
    const rel = path.relative(tmp, file)
    return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------------------
// check 1 — script syntax
// ---------------------------------------------------------------------------------------

// Returns stderr text on a real syntax failure, or null. Anything that is not clearly a
// syntax error (spawn failure, timeout, missing interpreter) returns null: this hook would
// rather miss a defect than invent one.
function nodeCheck(args, input) {
  try {
    execFileSync(process.execPath, args, {
      input: input == null ? undefined : input,
      stdio: [input == null ? 'ignore' : 'pipe', 'ignore', 'pipe'],
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    })
    return null
  } catch (e) {
    const err = String((e && e.stderr) || '')
    return /SyntaxError/.test(err) ? err : null
  }
}

function checkJsSyntax(file, src, out) {
  const cjs = nodeCheck(['--check', file], null)
  if (!cjs) return
  // Retry as an ES module. `node --check <file>` parses by extension, and older releases parse
  // every .js as CommonJS — an ES module in a .js file would be reported as broken when it is
  // fine. Only a file that fails BOTH grammars is a genuine syntax error.
  const esm = nodeCheck(['--check', '--input-type=module'], src)
  if (!esm) return

  const reported = /import|export|await/.test(cjs) && !/import|export|await/.test(esm) ? esm : cjs
  const header = /^(?:.*):(\d+)$/m.exec(reported)
  const message = (/^(SyntaxError:.*)$/m.exec(reported) || [null, 'SyntaxError'])[1]
  out.push({
    line: header ? Number(header[1]) : null,
    what: message.trim(),
    fix: 'Fix the syntax and write the file again. Nothing reports this at runtime — an '
      + 'unparseable script is loaded as a no-op, so it fails silently and looks like a '
      + 'script that simply had nothing to say.',
    src,
  })
}

// ---------------------------------------------------------------------------------------
// check 2 — JSON validity
// ---------------------------------------------------------------------------------------

// V8 only reports `at position N` for some parse errors, so the position is found here
// instead: parse growing prefixes. While a prefix is still valid-so-far it fails with an
// end-of-input error; the first prefix that fails any other way ends on the offending
// character. That predicate is monotonic, so a binary search finds it in ~log2(n) parses.
function firstBadOffset(text) {
  const bad = (n) => {
    try {
      JSON.parse(text.slice(0, n))
      return false
    } catch (e) {
      return !/end of (JSON )?input/i.test(String(e && e.message))
    }
  }
  if (!bad(text.length)) return -1
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (bad(mid)) hi = mid
    else lo = mid + 1
  }
  return lo - 1
}

function checkJson(file, src, out) {
  const base = path.basename(file).toLowerCase()
  // Formats that permit comments or are not a single document are not strict JSON.
  if (/^(ts|js)config(\..+)?\.json$/.test(base)) return
  if (/^\s*(\/\/|\/\*)/.test(src)) return
  const text = src.replace(/^\uFEFF/, '') // a BOM is an editor artefact, not a defect
  try {
    JSON.parse(text)
    return
  } catch (e) {
    const offset = firstBadOffset(text)
    const before = offset < 0 ? '' : text.slice(0, offset)
    const line = offset < 0 ? null : before.split(/\r?\n/).length
    const column = offset < 0 ? null : offset - before.lastIndexOf('\n')
    out.push({
      line,
      what: String((e && e.message) || 'invalid JSON').split('\n')[0].slice(0, 160)
        + (column ? ` (column ${column}, character offset ${offset})` : ''),
      fix: 'Repair the JSON and write the file again. A config file that no longer parses is '
        + 'usually ignored in full rather than partially, so everything it configures stops '
        + 'working at once. If a path was substituted into it, note that a backslash is an '
        + 'escape character in JSON: substitute into parsed values and re-serialize, or write '
        + 'forward slashes.',
      src: text,
    })
  }
}

// ---------------------------------------------------------------------------------------
// check 3 — SKILL.md frontmatter
// ---------------------------------------------------------------------------------------

// Restricted to files literally named SKILL.md. Any markdown file may legitimately open with
// a `---` horizontal rule, so applying this more widely would invent defects.
function checkSkillFrontmatter(file, src, out) {
  if (path.basename(file).toLowerCase() !== 'skill.md') return
  const lines = src.replace(/^\uFEFF/, '').split(/\r?\n/)
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  if (lines[i] === undefined || lines[i].trim() !== '---') {
    out.push({
      line: 1,
      what: 'SKILL.md has no YAML frontmatter block',
      fix: 'Open the file with a `---` line, then `name:` and `description:`, then a closing '
        + '`---`. Without frontmatter the skill is never registered and never dispatches.',
      src,
    })
    return
  }
  const open = i
  let close = -1
  for (let j = open + 1; j < lines.length; j++) {
    if (lines[j].trim() === '---' || lines[j].trim() === '...') {
      close = j
      break
    }
  }
  if (close === -1) {
    out.push({
      line: open + 1,
      what: 'YAML frontmatter is opened but never closed',
      fix: 'Add a closing `---` line after the frontmatter keys. An unterminated block swallows '
        + 'the whole document, so the skill body is parsed as frontmatter and the skill fails '
        + 'to load.',
      src,
    })
    return
  }

  const block = lines.slice(open + 1, close)
  const readKey = (key) => {
    for (let j = 0; j < block.length; j++) {
      const m = new RegExp('^' + key + ':[ \\t]*(.*)$').exec(block[j])
      if (m) return { value: m[1].trim(), line: open + 2 + j }
    }
    return null
  }

  const name = readKey('name')
  const dir = path.basename(path.dirname(file))
  if (!name || !name.value) {
    out.push({
      line: open + 1,
      what: 'frontmatter has no `name:`',
      fix: `Add \`name: ${dir}\` — the name is the identity used for dispatch, and a skill `
        + 'without one is unaddressable.',
      src,
    })
  } else {
    const declared = name.value.replace(/^['"]|['"]$/g, '').trim()
    if (declared && declared !== dir) {
      out.push({
        line: name.line,
        what: `frontmatter name "${declared}" does not match the directory "${dir}"`,
        fix: `Change it to \`name: ${dir}\`, or rename the directory to "${declared}". Dispatch `
          + 'uses the frontmatter name, so a mismatch means every reference by directory name '
          + 'silently misses and the skill appears to be installed but dead.',
        src,
      })
    }
  }

  const description = readKey('description')
  if (!description || !description.value) {
    out.push({
      line: open + 1,
      what: 'frontmatter has no `description:`',
      fix: 'Add a `description:` saying when to use the skill. The description is the text '
        + 'dispatch matches against; without it the skill is loaded but effectively never '
        + 'selected.',
      src,
    })
  }
}

// ---------------------------------------------------------------------------------------
// checks 4 and 5 — line scans
// ---------------------------------------------------------------------------------------

// Comment openers across the common languages. Skipping comments costs recall and buys
// precision, which is the trade this file always takes.
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|#|;|--|<!--|%|"""|')/
// Tests and fixtures quote machine paths on purpose — that is what they are testing.
const TEST_FILE = /(^|[\\/])(tests?|__tests__|spec|fixtures?|__fixtures__|e2e)[\\/]|\.(test|spec)\.[^.\\/]+$/i

// BOTH platforms, deliberately. A Windows-only matcher is itself the portability defect this
// check exists to catch. The leading class keeps the drive letter from matching inside a
// regex character class or a URL scheme, and a path must have at least one real segment.
// `\\{1,2}` matters: inside a string literal the separator is usually already doubled, which
// is correct escaping and still a hardcoded machine path.
const ABS_WINDOWS = /(?:^|[\s'"`(,=:/[])([A-Za-z]:(?:\\{1,2}|\/)[A-Za-z0-9_$][^\s'"`)<>|*?]*)/
const ABS_POSIX = /(?:^|[\s'"`(,=:[])(\/(?:home|Users)\/[A-Za-z0-9_.$-]+\/[^\s'"`)<>|*?]*)/

// JSON inside a dot-directory (.cache/, .vscode/, .terraform/, .idea/ …) is tool state or
// per-machine settings — a recorded path there is data, not a defect. Authored config in the
// same directories (.github/*.yml, and any other format) is still checked.
function isToolState(file) {
  if (path.extname(file).toLowerCase() !== '.json') return false
  return file.split(/[\\/]/).slice(0, -1).some((seg) => seg.length > 1 && seg.startsWith('.'))
}

function checkAbsolutePaths(file, src, out) {
  if (!EXT_PATH_SCAN.has(path.extname(file).toLowerCase())) return
  if (TEST_FILE.test(file)) return
  if (isMachineLocalConfig(file) || isToolState(file)) return

  const lines = src.split(/\r?\n/)
  for (let i = 0; i < lines.length && out.length < MAX_FINDINGS; i++) {
    const text = lines[i]
    if (!text || text.length > 500 || COMMENT_LINE.test(text)) continue
    // Escape hatch, because a deliberate literal path does exist (a detection fallback list,
    // a platform default). Without one, the first wrong flag gets the whole hook deleted.
    if (/path-ok/.test(text)) continue
    const hit = ABS_WINDOWS.exec(text) || ABS_POSIX.exec(text)
    if (!hit) continue
    out.push({
      line: i + 1,
      // shown raw, not JSON-quoted: re-escaping it here would misrepresent what is in the file
      what: `hardcoded absolute machine path \`${hit[1].slice(0, 120)}\``,
      fix: 'Replace it with a path derived at runtime (os.homedir(), the module\'s own '
        + 'location, an environment variable, a CLI argument) or with a template token the '
        + 'installer substitutes per machine. A literal machine path works only on the machine '
        + 'it was written on: a different user, drive, or OS gets a file-not-found — or, worse, '
        + 'silence.',
      src,
    })
  }
}

// NARROW BY DESIGN, and the narrowing is the point. Deciding in general whether an arbitrary
// backslash escape was meant to be a path is not decidable without false positives, so this
// fires only on the unambiguous shape: inside a quoted string, a single letter (not the tail
// of a word) followed by `:`, then ONE backslash, then a character that could not have been a
// deliberate escape. That is the exact shape that is destroyed at parse time — `"C:\Users\npm"`
// reads as `C:` + `U` + `sers` + a newline + `pm` — and it cannot collide with a legitimate
// `\n`, `\t`, `\\`, or regex escape.
//
// Two deliberate misses, both preferred over any risk of noise:
//   - a correctly doubled `"C:\\Users"` (not a bug), and
//   - a path whose first segment happens to start with an escape letter, e.g. `"C:\temp"`,
//     which is genuinely ambiguous. Check 4 still flags that one as a hardcoded path.
const WIN_PATH_IN_STRING =
  /(['"`])(?:[^'"`\n]{0,200}?[^A-Za-z0-9_])?[A-Za-z]:\\(?![ntrbfv0xu])[A-Za-z0-9_$]/

// String.raw`...` is the CORRECT way to write a Windows path in JS: inside a raw template a
// backslash is a literal character and no escape processing happens at all. Flagging it told
// the author their fix was the bug — the fastest way to get a check switched off. Blank those
// spans before testing, so a plain literal on the same line is still caught.
const RAW_TEMPLATE = /String\.raw`[^`]*`/g

function checkWindowsPathEscape(file, src, out) {
  if (!EXT_JS_STRINGS.has(path.extname(file).toLowerCase())) return
  const lines = src.split(/\r?\n/)
  for (let i = 0; i < lines.length && out.length < MAX_FINDINGS; i++) {
    const raw = lines[i]
    if (!raw || raw.length > 500 || COMMENT_LINE.test(raw)) continue
    const text = raw.replace(RAW_TEMPLATE, '``')
    if (!WIN_PATH_IN_STRING.test(text)) continue
    out.push({
      line: i + 1,
      what: 'a Windows path with single backslashes sits inside a string literal, so the '
        + 'backslashes are read as escape sequences',
      fix: 'Write the path with forward slashes (Node accepts them on Windows everywhere), or '
        + 'double every backslash. As written the path is destroyed when the file is parsed, '
        + 'before any runtime check can see it, and the symptom is a mangled path with the '
        + 'separators missing and stray newlines in it.',
      src,
    })
  }
}

// ---------------------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------------------

function render(file, findings) {
  const noun = findings.length === 1 ? 'problem' : 'problems'
  const parts = [
    `post-tool-verify found ${findings.length} ${noun} in the file just written. Fix before `
      + 'moving on; none of these report themselves at runtime.',
    file,
  ]
  for (const f of findings) {
    const where = f.line ? `line ${f.line}` : 'file'
    parts.push(`  ${where}: ${f.what}`)
    if (f.line && f.src) {
      const text = (f.src.split(/\r?\n/)[f.line - 1] || '').trim()
      if (text) parts.push(`    > ${text.slice(0, 160)}`)
    }
    parts.push(`    fix: ${f.fix}`)
  }
  return parts.join('\n')
}

// ---------------------------------------------------------------------------------------

function main() {
  const file = targetFile(readPayload())
  if (!file || inSkippedTree(file)) return

  let stat
  try {
    stat = fs.statSync(file)
  } catch {
    return // written then moved or deleted; nothing to inspect
  }
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES) return

  let buf
  try {
    buf = fs.readFileSync(file)
  } catch {
    return
  }
  if (buf.includes(0)) return // binary
  const src = buf.toString('utf8')
  const ext = path.extname(file).toLowerCase()

  const findings = []
  // Syntax and JSON validity still matter in a scratch file — a broken script is broken
  // wherever it lives. Style and portability findings do not: nothing under the OS temp
  // directory is shipped, so reporting a hardcoded path there is noise.
  const scratch = isScratch(file)
  if (EXT_JS_SYNTAX.has(ext)) checkJsSyntax(file, src, findings)
  if (ext === '.json') checkJson(file, src, findings)
  if (!scratch) {
    if (ext === '.md') checkSkillFrontmatter(file, src, findings)
    checkAbsolutePaths(file, src, findings)
    checkWindowsPathEscape(file, src, findings)
  }

  if (!findings.length) return // silence is the default; output has to mean something

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: render(file, findings.slice(0, MAX_FINDINGS)),
      },
    }) + '\n'
  )
}

try {
  main()
} catch {
  // A hook that throws is worse than a hook that does nothing.
}
process.exit(0)
