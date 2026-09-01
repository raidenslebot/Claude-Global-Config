/**
 * scan.js — walk a source tree and extract the reference edges between files.
 *
 * Deliberately regex-based rather than compiler-accurate. The metric we want is
 * "how many other files NAME this path", not "what does a type-checker resolve".
 * A name is a coupling whether or not the compiler agrees, and one pass over the
 * tree produces it for any language without a toolchain per language.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, dirname, resolve, sep, extname, basename } from 'node:path'

/** Directories never worth walking. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target',
  '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', 'coverage', '__pycache__',
  '.venv', 'venv', 'env', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  'vendor', 'bin', 'obj', 'Pods', 'DerivedData', '.gradle', '.idea', '.vscode',
  '.terraform', 'bower_components', 'jspm_packages', '.pnpm-store', '.yarn',
  'site-packages', '.claude', 'strix_runs', '.output', '.vercel', '.serverless',
])

/** Extensions we know how to read edges out of. */
const LANG_BY_EXT = {
  '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'js',
  '.ts': 'js', '.mts': 'js', '.cts': 'js', '.tsx': 'js',
  '.vue': 'js', '.svelte': 'js', '.astro': 'js',
  '.py': 'python', '.pyi': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'jvm', '.kt': 'jvm', '.kts': 'jvm', '.scala': 'jvm', '.groovy': 'jvm',
  '.cs': 'csharp',
  '.c': 'c', '.h': 'c', '.cc': 'c', '.cpp': 'c', '.cxx': 'c', '.hpp': 'c', '.hh': 'c',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.ex': 'elixir', '.exs': 'elixir',
  '.dart': 'dart',
  '.lua': 'lua',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  '.sql': 'sql',
  '.md': 'markdown', '.mdx': 'markdown',
}

/**
 * Per-language patterns. Each regex must expose the referenced module/path in
 * capture group 1 (or 2 where an alternation needs it — we take the first
 * non-empty group).
 */
const PATTERNS = {
  js: [
    // Static imports/exports must sit at statement position. Anchoring to line
    // start is what keeps fixture code inside a string literal — "import
    // './b.js'" as test data — from being counted as a real edge.
    /^\s*import\s+(?:[\w*{}\n\r\t, $]+\s+from\s+)?['"]([^'"]+)['"]/gm,
    /^\s*export\s+(?:\*|{[^}]*})\s+from\s+['"]([^'"]+)['"]/gm,
    // These are expressions and legitimately appear mid-line.
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bjest\.mock\s*\(\s*['"]([^'"]+)['"]/g,
  ],
  python: [
    /^\s*from\s+([.\w]+)\s+import\b/gm,
    /^\s*import\s+([.\w]+(?:\s*,\s*[.\w]+)*)/gm,
    /\bimportlib\.import_module\s*\(\s*['"]([^'"]+)['"]/g,
  ],
  go: [
    /^\s*import\s+"([^"]+)"/gm,
    /^\s*(?:[\w.]+\s+)?"([^"]+)"\s*$/gm, // inside import ( ... ) blocks
  ],
  rust: [
    /^\s*(?:pub\s+)?use\s+([\w:{}, *]+);/gm,
    /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm,
  ],
  jvm: [
    /^\s*import\s+(?:static\s+)?([\w.]+)/gm,
    /^\s*package\s+([\w.]+)/gm,
  ],
  csharp: [/^\s*using\s+(?:static\s+)?([\w.]+)\s*;/gm],
  c: [
    /^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm,
    /^\s*#\s*import\s*[<"]([^>"]+)[>"]/gm,
  ],
  ruby: [
    /\brequire(?:_relative)?\s+['"]([^'"]+)['"]/g,
    /\bautoload\s+:\w+\s*,\s*['"]([^'"]+)['"]/g,
  ],
  php: [
    /\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g,
    /^\s*use\s+([\w\\]+)/gm,
  ],
  swift: [/^\s*import\s+(\w+)/gm],
  elixir: [/\b(?:alias|import|require|use)\s+([A-Z][\w.]*)/g],
  dart: [
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bpart\s+['"]([^'"]+)['"]/g,
  ],
  lua: [/\brequire\s*\(?\s*['"]([^'"]+)['"]/g],
  shell: [
    /^\s*(?:source|\.)\s+["']?([^\s"';]+)/gm,
  ],
  sql: [/\b(?:\\i|\\ir)\s+([^\s;]+)/g],
  markdown: [
    /\]\(\.{1,2}\/([^)#\s]+)/g, // relative links only — external URLs are not coupling
  ],
}

/** Extensions tried when a reference omits one. */
const RESOLVE_EXTS = [
  '', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.d.ts', '.vue', '.svelte', '.astro', '.py', '.go', '.rs', '.java',
  '.kt', '.cs', '.rb', '.php', '.swift', '.ex', '.exs', '.dart', '.lua',
  '.c', '.h', '.cc', '.cpp', '.hpp', '.md', '.sh', '.sql',
]

/** Files tried when a reference points at a directory. */
const INDEX_NAMES = [
  'index', 'mod', 'main', '__init__', 'lib', 'init',
]

function toPosix(p) {
  return p.split(sep).join('/')
}

/**
 * Walk `root` and return every readable source file as a repo-relative posix path.
 * Honours .gitignore top-level directory entries plus SKIP_DIRS.
 */
export function walk(root, opts = {}) {
  const maxBytes = opts.maxBytes ?? 2_000_000
  // Prose is not coupling. A doc linking a result file is not a build edge, and
  // including markdown by default drowns the real graph in link noise.
  const includeDocs = opts.includeDocs ?? false
  const extraIgnores = new Set(readGitignoreDirs(root))
  const files = []

  const recurse = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        if (entry.name.startsWith('.') && entry.name !== '.github') continue
        if (extraIgnores.has(entry.name)) continue
        recurse(full)
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase()
        if (!LANG_BY_EXT[ext]) continue
        if (!includeDocs && LANG_BY_EXT[ext] === 'markdown') continue
        try {
          if (statSync(full).size > maxBytes) continue
        } catch {
          continue
        }
        files.push(toPosix(relative(root, full)))
      }
    }
  }

  recurse(root)
  return files.sort()
}

function readGitignoreDirs(root) {
  const gi = join(root, '.gitignore')
  if (!existsSync(gi)) return []
  try {
    return readFileSync(gi, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'))
      .map((l) => l.replace(/^\/+/, '').replace(/\/+$/, ''))
      .filter((l) => l && !l.includes('*') && !l.includes('/'))
  } catch {
    return []
  }
}

/** Count lines without materialising an array for big files. */
function countLines(text) {
  let n = 1
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

/**
 * Extract every raw reference string a file names.
 * Returns { refs: string[], lines: number, lang: string }.
 */
export function extractRefs(root, relPath) {
  const ext = extname(relPath).toLowerCase()
  const lang = LANG_BY_EXT[ext]
  if (!lang) return { refs: [], lines: 0, lang: 'unknown' }

  let raw
  try {
    raw = readFileSync(join(root, relPath), 'utf8')
  } catch {
    return { refs: [], lines: 0, lang }
  }

  // Count lines on the original; comments are still lines of file.
  const lineCount = countLines(raw)
  const text = stripComments(raw, lang)

  const refs = new Set()
  for (const re of PATTERNS[lang] ?? []) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      const raw = m[1] ?? m[2]
      if (!raw) continue
      // `import a, b, c` in python; `use a::{b, c}` in rust
      for (const piece of String(raw).split(/\s*,\s*/)) {
        const cleaned = piece.trim().replace(/\s+as\s+\w+$/, '')
        // A template interpolation is generated at runtime, not a static edge.
        if (cleaned && !cleaned.includes('${')) refs.add(cleaned)
      }
      if (m.index === re.lastIndex) re.lastIndex++ // zero-width guard
    }
  }

  return { refs: [...refs], lines: lineCount, lang }
}

/**
 * Blank out comments before extracting edges. An import written in a doc
 * comment as an example is not a dependency, and counting it inflates fan-in on
 * exactly the files that document themselves best.
 *
 * Conservative on purpose: `//` is only treated as a comment when it is not
 * preceded by a colon, so `https://example.com` survives intact.
 */
export function stripComments(text, lang) {
  const C_FAMILY = new Set(['js', 'go', 'rust', 'jvm', 'csharp', 'c', 'php', 'swift', 'dart'])
  if (C_FAMILY.has(lang)) {
    return String(text)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:\\/])\/\/[^\n]*/g, '$1')
  }
  if (lang === 'python' || lang === 'ruby' || lang === 'shell' || lang === 'elixir') {
    return String(text).replace(/(^|[^\\])#[^\n]*/g, '$1')
  }
  if (lang === 'lua') return String(text).replace(/(^|[^\\])--[^\n]*/g, '$1')
  if (lang === 'sql') return String(text).replace(/(^|[^\\])--[^\n]*/g, '$1')
  return String(text)
}

/**
 * Resolve a raw reference string emitted by `from`/`file` into a repo-relative
 * path, or null when it points outside the tree (a package, a stdlib module).
 *
 * Strategy, cheapest first:
 *   1. relative path arithmetic  ('./foo', '../bar/baz')
 *   2. python-style dotted relative ('.foo.bar', '..pkg')
 *   3. root-anchored path ('src/lib/thing')
 *   4. dotted/namespaced tail match ('com.acme.Thing' -> any Thing.java in tree)
 *   5. bare basename match, only when unambiguous
 */
export function resolveRef(raw, fromFile, index) {
  if (!raw) return null
  const ref = raw.trim().replace(/^['"]|['"]$/g, '')
  if (!ref) return null
  // Protocol-ish or obviously external.
  if (/^(https?:|node:|data:|file:|@types\/)/.test(ref)) return null

  const fromDir = dirname(fromFile)

  // 1. Explicit relative path.
  if (ref.startsWith('./') || ref.startsWith('../')) {
    const joined = toPosix(join(fromDir, ref)).replace(/^\.\//, '')
    return tryPaths(joined, index)
  }

  // 2. Python / Elixir style leading-dot relative import.
  if (ref.startsWith('.')) {
    const dots = ref.match(/^\.+/)[0].length
    const rest = ref.slice(dots).replace(/\./g, '/')
    let dir = fromDir
    for (let i = 1; i < dots; i++) dir = dirname(dir)
    const joined = toPosix(join(dir, rest))
    return tryPaths(joined, index)
  }

  // 3. Root-anchored, or an alias we can strip ('@/x', '~/x', 'src/x').
  const dealiased = ref.replace(/^(@|~)\//, '')
  const rootHit = tryPaths(dealiased, index)
  if (rootHit) return rootHit
  for (const prefix of ['src/', 'lib/', 'app/', 'packages/']) {
    const hit = tryPaths(prefix + dealiased, index)
    if (hit) return hit
  }

  // 4. Dotted namespace -> path tail ('com.acme.Thing', 'App\\Models\\User').
  if (/[.\\:]/.test(ref)) {
    const asPath = ref.replace(/::/g, '/').replace(/\\/g, '/').replace(/\./g, '/')
    const hit = tryPaths(asPath, index) || tryTail(asPath, index)
    if (hit) return hit
  }

  // 5. Bare name — accept only when exactly one file in the tree has that stem.
  return tryTail(dealiased, index)
}

/** Extensions TypeScript's NodeNext resolution lets you write but not ship. */
const REWRITABLE = /\.(js|jsx|mjs|cjs)$/

/** Build-output roots that shadow a real source root. */
const BUILD_DIRS = ['dist/', 'build/', 'out/', 'lib/', '.next/', 'es/', 'esm/', 'cjs/']
const SOURCE_DIRS = ['src/', 'lib/', 'app/', 'packages/', '']

function tryPaths(base, index) {
  const clean = base.replace(/^\.\//, '').replace(/\/+$/, '')

  // Candidate stems, cheapest first.
  const stems = [clean]

  // TS NodeNext: `import './thing.js'` on disk is './thing.ts'. Without this,
  // every test file in a modern TS repo looks like it references nothing.
  if (REWRITABLE.test(clean)) stems.push(clean.replace(REWRITABLE, ''))

  // `../dist/llm/index.js` is a reference to the source that compiles to it.
  // The build dir is gitignored and never in the index, so remap it.
  for (const bd of BUILD_DIRS) {
    const at = clean.startsWith(bd) ? 0 : clean.indexOf('/' + bd)
    if (at === -1) continue
    const tail = clean.slice(at === 0 ? bd.length : at + 1 + bd.length)
    if (!tail) continue
    for (const sd of SOURCE_DIRS) {
      stems.push(sd + tail)
      if (REWRITABLE.test(tail)) stems.push(sd + tail.replace(REWRITABLE, ''))
    }
  }

  for (const stem of stems) {
    if (!stem) continue
    for (const ext of RESOLVE_EXTS) {
      const cand = stem + ext
      if (index.byPath.has(cand)) return cand
    }
    for (const name of INDEX_NAMES) {
      for (const ext of RESOLVE_EXTS) {
        if (!ext) continue
        const cand = `${stem}/${name}${ext}`
        if (index.byPath.has(cand)) return cand
      }
    }
  }
  return null
}

function tryTail(base, index) {
  const stem = basename(base).replace(/\.[^.]+$/, '')
  if (!stem || stem.length < 3) return null
  const hits = index.byStem.get(stem.toLowerCase())
  if (hits && hits.length === 1) return hits[0]
  return null
}

/** Build the lookup structures resolveRef needs. */
export function buildIndex(files) {
  const byPath = new Set(files)
  const byStem = new Map()
  for (const f of files) {
    const stem = basename(f).replace(/\.[^.]+$/, '').toLowerCase()
    if (!byStem.has(stem)) byStem.set(stem, [])
    byStem.get(stem).push(f)
  }
  return { byPath, byStem }
}

/**
 * Full scan: tree -> { files, edges, meta }.
 *
 * edges is a Map<from, Set<to>> of intra-repo references only. External
 * packages are counted separately in meta so you can see how much of a file's
 * coupling leaves the tree.
 */
export function scanRepo(root, opts = {}) {
  const absRoot = resolve(root)
  const files = walk(absRoot, opts)
  const index = buildIndex(files)

  const edges = new Map()
  const meta = new Map()

  // Coverage tracking. A reference that looks intra-repo (relative or anchored)
  // but resolves to nothing is a hole in the graph, and a silent hole would make
  // a fan-out plan look safer than it is. Count them and report the rate.
  const coverage = { total: 0, resolved: 0, external: 0, missedIntraRepo: 0 }

  for (const file of files) {
    const { refs, lines, lang } = extractRefs(absRoot, file)
    const out = new Set()
    let external = 0
    let missed = 0

    for (const raw of refs) {
      coverage.total++
      const target = resolveRef(raw, file, index)
      if (target && target !== file) {
        out.add(target)
        coverage.resolved++
      } else if (!target) {
        external++
        if (looksIntraRepo(raw)) {
          missed++
          coverage.missedIntraRepo++
        } else {
          coverage.external++
        }
      }
    }

    edges.set(file, out)
    meta.set(file, { lines, lang, external, missed, rawRefs: refs.length })
  }

  return { root: absRoot, files, edges, meta, coverage }
}

/**
 * Does this reference claim to point inside the tree? Relative paths and
 * anchored paths do; bare package names and stdlib modules do not. Only the
 * first kind counts as a miss when it fails to resolve.
 */
function looksIntraRepo(raw) {
  if (/^(https?:|node:|data:|file:)/.test(raw)) return false
  return raw.startsWith('./') || raw.startsWith('../') || raw.startsWith('.') ||
    raw.startsWith('@/') || raw.startsWith('~/')
}

export { LANG_BY_EXT, SKIP_DIRS }
