// delivered — a calculation exists and the user never receives it.
//
// Both directions of this are the same defect seen from either end: a producer and a consumer
// that disagree about a NAME, in a tree where nothing is individually broken.
//
//   read, never written   Something reads `x.storageHealth`; nothing in the tree ever assigns
//                         it, declares it or returns it. The consumer waits for a value no
//                         producer sends, and gets `undefined` every time, silently.
//   written, never read   Something computes a field into a returned object, or assigns it onto
//                         an object, and nothing anywhere reads it back. The work happened and
//                         went nowhere.
//
// THE WHOLE DIFFICULTY IS NOISE, and the rule that governs every judgement below is: when the
// tree could be hiding a producer or a consumer from us, we drop the name rather than report it.
// A missed defect costs nothing here — the other gates still run. One confident wrong finding
// costs the report its credibility, and this package has already shipped one warning that fired
// on every run.

const WORDS = /^_?(?:[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+|[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+|[a-z0-9]+(?:_[a-z0-9]+)+)$/

// Extensions where `key:` means an object literal. In Python and friends it means a type
// annotation, and reading it as a property write would invent producers that do not exist.
const BRACED = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.svelte', '.vue'])

// Receivers whose properties belong to somebody else's API. A finding on one of these is a
// finding about Node or the DOM, which is never what this check is for.
const FOREIGN = new Set([
  'process', 'console', 'globalThis', 'window', 'document', 'navigator', 'location', 'history',
  'screen', 'performance', 'crypto', 'module', 'exports', 'require', 'import', 'JSON', 'Math',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'RegExp', 'Promise', 'Map', 'Set',
  'WeakMap', 'WeakSet', 'Symbol', 'Reflect', 'Proxy', 'Intl', 'BigInt', 'Buffer', 'URL',
  'URLSearchParams', 'TextEncoder', 'TextDecoder', 'AbortController', 'Error', 'TypeError',
  'React', 'ReactDOM', 'self', 'super', 'NodeJS',
])

// Names that are host, framework or standard-library property names. Extended only with names
// actually hit while tuning this against real trees.
const HOST = new Set([
  // DOM
  'addEventListener', 'removeEventListener', 'dispatchEvent', 'createElement', 'createElementNS',
  'createTextNode', 'getElementById', 'querySelector', 'querySelectorAll', 'getBoundingClientRect',
  'getAttribute', 'setAttribute', 'removeAttribute', 'hasAttribute', 'innerHTML', 'outerHTML',
  'innerText', 'textContent', 'classList', 'className', 'appendChild', 'removeChild',
  'insertBefore', 'parentNode', 'parentElement', 'childNodes', 'firstChild', 'lastChild',
  'firstElementChild', 'nextSibling', 'previousSibling', 'contentWindow', 'contentDocument',
  'documentElement', 'readyState', 'preventDefault', 'stopPropagation', 'currentTarget',
  'relatedTarget', 'clientWidth', 'clientHeight', 'clientX', 'clientY', 'offsetWidth',
  'offsetHeight', 'offsetTop', 'offsetLeft', 'scrollTop', 'scrollLeft', 'scrollWidth',
  'scrollHeight', 'scrollIntoView', 'naturalWidth', 'naturalHeight', 'devicePixelRatio',
  'localStorage', 'sessionStorage', 'requestAnimationFrame', 'cancelAnimationFrame',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'matchMedia', 'getComputedStyle',
  'getPropertyValue', 'setProperty', 'insertRule', 'cssText', 'isConnected', 'defaultPrevented',
  'contentRect', 'boundingClientRect', 'isIntersecting', 'getContext', 'toDataURL', 'drawImage',
  'fillRect', 'clearRect', 'fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha',
  'globalCompositeOperation', 'createLinearGradient', 'createRadialGradient', 'addColorStop',
  'getImageData', 'putImageData', 'currentTime', 'playbackRate', 'baseURI', 'ownerDocument',
  'shadowRoot', 'attachShadow', 'getRootNode', 'closest', 'matches', 'namedItem',
  // React / framework
  'defaultProps', 'propTypes', 'displayName', 'componentDidMount', 'componentWillUnmount',
  'componentDidUpdate', 'shouldComponentUpdate', 'getDerivedStateFromProps', 'setState',
  'forceUpdate', 'dangerouslySetInnerHTML', 'createRoot', 'createPortal', 'forwardRef',
  'useState', 'useEffect', 'useMemo', 'useRef', 'useCallback',
  // standard library
  'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toJSON',
  'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'toISOString', 'toFixed',
  'toPrecision', 'toUpperCase', 'toLowerCase', 'charCodeAt', 'charAt', 'codePointAt',
  'fromCharCode', 'lastIndexOf', 'startsWith', 'endsWith', 'padStart', 'padEnd', 'trimStart',
  'trimEnd', 'replaceAll', 'localeCompare', 'findIndex', 'findLast', 'findLastIndex', 'flatMap',
  'forEach', 'isArray', 'isInteger', 'isFinite', 'isSafeInteger', 'parseFloat', 'parseInt',
  'getTime', 'getFullYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes',
  'getSeconds', 'getMilliseconds', 'getTimezoneOffset', 'getOwnPropertyNames',
  'getOwnPropertyDescriptor', 'defineProperty', 'setPrototypeOf', 'getPrototypeOf',
  'fromEntries', 'groupBy', 'allSettled', 'lastItem', 'byteLength', 'buffer',
  // Node
  'isDirectory', 'isFile', 'isSymbolicLink', 'isBlockDevice', 'isCharacterDevice', 'isFIFO',
  'isSocket', 'withFileTypes', 'maxBuffer', 'windowsHide', 'killSignal', 'detached', 'shell',
  'exitCode', 'execPath', 'execArgv', 'argv0', 'nextTick', 'hrtime', 'memoryUsage', 'cpuUsage',
  'platform', 'arch', 'homedir', 'tmpdir', 'cwd', 'chdir', 'kill', 'unref',
  'readFileSync', 'writeFileSync', 'appendFileSync', 'readdirSync', 'statSync', 'lstatSync',
  'existsSync', 'mkdirSync', 'rmSync', 'renameSync', 'copyFileSync', 'unlinkSync', 'realpathSync',
  'readlinkSync', 'symlinkSync', 'chmodSync', 'utimesSync', 'createReadStream',
  'createWriteStream', 'promises', 'constants', 'errno', 'syscall', 'setEncoding', 'isTTY',
  'columns', 'stdout', 'stderr', 'stdin', 'stdio', 'signal', 'status', 'pid', 'spawnSync',
  'execSync', 'execFileSync', 'pathToFileURL', 'fileURLToPath', 'parseArgs', 'inspect',
  'deepStrictEqual', 'notStrictEqual', 'strictEqual', 'doesNotThrow', 'rejects', 'ifError',
  'randomUUID', 'randomBytes', 'createHash', 'createHmac', 'digest', 'timingSafeEqual',
  // hit while tuning: a Node http response and a DOM node, both reached through objects the
  // tree does assign onto, so provenance alone did not filter them.
  'headersSent', 'statusCode', 'writeHead', 'setHeader', 'getHeader', 'namespaceURI',
  'nodeType', 'nodeName', 'nodeValue', 'currentNode', 'nextNode', 'createTreeWalker',
])

const OWNED = new Set(['then', 'catch', 'finally', 'length', 'name', 'message', 'stack', 'code'])

/** Every `.name` in a file, with its receiver and whether the occurrence reads or writes. */
function members(code, on) {
  const ws = (c) => c === ' ' || c === '\n' || c === '\t' || c === '\r'
  for (let i = 0; i < code.length; i++) {
    if (code[i] !== '.') continue
    if (code[i + 1] === '.' || code[i - 1] === '.') continue          // ...spread
    if (/[0-9]/.test(code[i - 1] || '')) continue                     // 1.5
    let k = i + 1
    while (k < code.length && ws(code[k])) k++
    const m = /^[A-Za-z_$][\w$]*/.exec(code.slice(k, k + 96))
    if (!m) continue
    const name = m[0]
    const end = k + name.length

    let j = i - 1
    if (code[j] === '?' || code[j] === '!') j--
    while (j >= 0 && ws(code[j])) j--
    let recv = null
    if (j >= 0 && /[\w$]/.test(code[j])) {
      let s = j
      while (s >= 0 && /[\w$]/.test(code[s])) s--
      recv = code.slice(s + 1, j + 1)
    }

    let f = end
    while (f < code.length && ws(code[f])) f++
    const a = code[f] || '', b = code[f + 1] || ''
    let kind = 'read'
    if (a === '(') kind = 'call'
    else if (a === '=' && b !== '=') kind = 'write'
    else if ((a === '+' || a === '-') && b === a) kind = 'both'
    else if ('+-*/%&|^?'.includes(a) && (b === '=' || (b === a && code[f + 2] === '='))) kind = 'both'
    on(name, recv, kind, k)
  }
}

/** Local object BAGS: `const x = { … }` where x never leaves this file's scope — it is only ever
 *  member-accessed (`x.foo`), never returned, spread, stringified, passed as an argument, aliased
 *  or reassigned. That last part is the whole point. The returned/serialized/typed-result objects
 *  that made the naive write-side detector fire on everything ALL escape their scope, so requiring
 *  the bag to stay put excludes them by construction. What is left is the honest case: a value
 *  computed into a local record, its siblings read back by name, and one field never touched.
 *  Each bag reports { bagName, keys:[{name,…at}], accessed:Set<name>, escaped:bool }. */
function localBags(code, at) {
  const bags = []
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g
  let m
  while ((m = re.exec(code))) {
    const bagName = m[1]
    const open = code.indexOf('{', m.index + 1 + bagName.length)
    if (open < 0) continue
    let d = 0, end = -1
    for (let i = open; i < code.length; i++) {
      if (code[i] === '{') d++
      else if (code[i] === '}') { d--; if (!d) { end = i; break } }
    }
    if (end < 0) continue
    re.lastIndex = open + 1
    const region = code.slice(open, end + 1)
    if (region.includes('...')) continue
    // own depth-1 keys
    const keys = []
    let depth = 0
    for (let i = 0; i < region.length; i++) {
      const c = region[i]
      if (c === '}') { depth--; continue }
      if (c === '(' || c === '[') { let dd = 0; for (; i < region.length; i++) { const x = region[i]; if (x === '(' || x === '[') dd++; else if (x === ')' || x === ']') { dd--; if (!dd) break } } continue }
      const isOpen = c === '{'
      if (isOpen) depth++
      // A key follows the opening brace OR a comma, both at depth 1. The opening brace must be
      // handled here, not `continue`d past — otherwise the FIRST key of every bag is lost and a
      // three-field record counts as two.
      if (depth === 1 && (isOpen || c === ',')) {
        const rest = region.slice(i + 1)
        const mm = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(rest)
        if (mm) keys.push({ name: mm[1], ...at(open + i + 1 + rest.indexOf(mm[1])) })
      }
    }
    if (keys.length < 3) continue

    // A spread — `{ ...bag }` / `[...bag]` — forwards the whole object into a consumer this scan
    // cannot follow, so it escapes. This MUST be checked separately: the standalone-use scan below
    // excludes a name preceded by a dot (so it does not match `foo.bag`), and `...bag` is
    // dot-preceded too, so a spread is invisible to it. Missing this reported `base.size_bytes` as
    // dropped when `base` was spread straight into the return.
    // An EXPORTED binding is the widest escape there is: its consumer may be another module in
    // this tree, or a package nobody here can see. Reported on a real design-token file — a
    // three-field `export const CLIP` whose third field was used by an importer — and the
    // evidence sentence said "CLIP never leaves this scope" with `export` on the same line. The
    // conclusion was contested; the evidence was simply false.
    let escaped = new RegExp(`\\.\\.\\.\\s*${bagName}(?![\\w$])`).test(code)
      || /\bexport\s+$/.test(code.slice(Math.max(0, m.index - 16), m.index))
    // every standalone use of the bag name, outside its own declaration
    const accessed = new Set()
    const use = new RegExp(`(?<![\\w$.])${bagName}(?![\\w$])`, 'g')
    let u
    while ((u = use.exec(code)) && !escaped) {
      if (u.index >= m.index && u.index <= open) continue    // the declaration itself
      let p = u.index + bagName.length
      while (p < code.length && /\s/.test(code[p])) p++
      if (code[p] === '.') {
        const km = /^\.\s*([A-Za-z_$][\w$]*)/.exec(code.slice(p))
        if (km) { accessed.add(km[1]); continue }
        escaped = true                                       // computed member access
      } else {
        escaped = true                                       // returned, argument, alias, reassigned…
      }
    }
    bags.push({ bagName, keys, accessed, escaped })
  }
  return bags
}

const each = (re, s, fn) => { let m; const r = new RegExp(re.source, re.flags); while ((m = r.exec(s))) fn(m) }

export const id = 'delivered'
export const title = 'Delivered — computed, and nobody receives it'
export const why = 'A property one side produces and nothing consumes, or consumes and nothing produces.'

export function run(ctx) {
  // The whole mechanism is brace-shaped: `{ key: v }` is a property write, `x = y` is a local.
  // In Python those collide (`x = y` is the commonest line in the file) and the driver's literal
  // stripper leaves indented `#` comments intact, so prose leaks into the scan. Rather than guess
  // across that, this check reasons only about brace-language source. Undercounting a Python tree
  // is the correct answer here; a confident wrong finding is not.
  // Minified or bundled output is somebody else's code with the whitespace removed; the shorthand
  // and declaration forms this scan relies on are gone, so it reads as one huge line and produces
  // nothing but false positives. Skip any file whose longest line runs past 1,000 characters.
  const minified = (f) => f.src.length > 5000 && Math.max(...f.src.split('\n').map((l) => l.length)) > 1000
  const src = ctx.sources.filter((f) => BRACED.has(f.ext) && !minified(f))
  if (!src.length) {
    const other = ctx.sources.length
    return { findings: [], scanned: 0, note: other ? `no brace-language (JS/TS) source in this tree — ${other} file(s) in other languages or minified bundles are out of scope by design` : 'no source files in this tree' }
  }

  const anyWrite = new Map()      // name → where: a property this tree is seen to SUPPLY
  const anyRead = new Set()       // name: any consumer at all — dot, call or destructure
  const valueRead = new Map()     // name → where: read as a VALUE off a nameable receiver
  const drop = new Set()          // names we refuse to reason about
  const tainted = new Set()       // receiver names whose properties are reached dynamically
  const imported = new Set()      // bindings that belong to another module's API
  const builtByFile = new Map()   // file → receiver names THIS FILE constructs or assigns onto
  const bags = []                 // local, non-escaping object records, for the write side

  const at = (f) => (i) => ({ file: f.rel, line: ctx.lineOf(f.src, i) })
  const build = (rel, name) => { (builtByFile.get(rel) || builtByFile.set(rel, new Set()).get(rel)).add(name) }

  for (const f of src) {
    const code = f.code
    const here = at(f)
    // Bindings imported from anywhere: the names on them are not this tree's contract.
    each(/\bimport\s+([^;]*?)\bfrom\b/g, code, (m) => each(/[A-Za-z_$][\w$]*/g, m[1], (x) => imported.add(x[0])))
    each(/\b(?:const|let|var)\s+([^=;]+?)=\s*require\s*\(/g, code, (m) => each(/[A-Za-z_$][\w$]*/g, m[1], (x) => imported.add(x[0])))

    // Dynamic reach. `o[expr]` with anything but an integer index — and a blanked string literal
    // counts as unknown on purpose — means o's property set is not knowable by reading.
    each(/([A-Za-z_$][\w$]*)\s*\[([^\]\n]*)\]/g, code, (m) => {
      const o = m.index + m[0].indexOf('[') + 1
      const key = f.src.slice(o, o + m[2].length)     // the REAL key: a blanked string is not "empty"
      if (/^\s*$/.test(key) || /^\s*\d+\s*$/.test(key)) return   // `T[]`, `rows[0]`
      tainted.add(m[1])
    })
    each(/([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?JSON\s*\.\s*parse\s*\(/g, code, (m) => tainted.add(m[1]))
    each(/Object\s*\.\s*(?:assign|keys|values|entries|fromEntries)\s*\(\s*([A-Za-z_$][\w$]*)/g, code, (m) => tainted.add(m[1]))

    const declared = /\.d\.ts$/i.test(f.rel) || /(^|[\\/])types?([\\/]|\.|$)/i.test(f.rel)

    // Provenance, PER FILE: an object this file CONSTRUCTS as a literal (`x = { … }`). Assigning a
    // property ONTO an object (`x.y = …`) is deliberately NOT construction — VSCode's `quickPick`,
    // a Node `res`, a DOM node all get properties set on them and are still somebody else's object,
    // and reading `quickPick.selectedItems` (a real API field) off one was a false positive. The
    // set is scoped to the reading file so one unrelated `v = {}` cannot vouch for every `v.foo`.
    // The literal must be NON-EMPTY: `options = {}` is a default-parameter or a fallback, and the
    // object it names is the CALLER'S bag whose fields come from outside — reading `options.onPoll`
    // off one and finding no writer says nothing. `{}` builds nothing; `{ a: 1 }` builds.
    each(/([A-Za-z_$][\w$]*)\s*=\s*\{\s*(?=[^\s}])/g, code, (m) => build(f.rel, m[1]))

    members(code, (name, recv, kind, i) => {
      if (kind === 'write' || kind === 'both') anyWrite.set(name, anyWrite.get(name) || here(i))
      if (kind === 'read' || kind === 'both' || kind === 'call') anyRead.add(name)
      if (kind === 'read' && !declared && recv && !valueRead.has(name)) valueRead.set(name, { ...here(i), recv })
      if (declared) drop.add(name)
      if (recv && (FOREIGN.has(recv) || imported.has(recv))) drop.add(name)
    })

    // Any object-literal key, method or class field PROVES the name is supplied — enough to keep
    // the read side quiet. This is the loose producer set; the strict one (below) is the returned
    // literals only.
    each(/[{,]\s*([A-Za-z_$][\w$]*)\s*:/g, code, (m) => { const n = m[1]; if (!anyWrite.has(n)) anyWrite.set(n, here(m.index)); if (declared) drop.add(n) })
    // The closing delimiter is a LOOKAHEAD. Consuming it made each match eat the comma that the
    // next shorthand needs as its opening delimiter, so `{ root, files, git, inGit, isTestPath }`
    // registered root, git and isTestPath and silently skipped every other one — which is how
    // `ctx.inGit`, supplied three lines away in the same object, was reported as never written.
    each(/[{,]\s*([A-Za-z_$][\w$]*)\s*(?=[,}])/g, code, (m) => { anyRead.add(m[1]); if (!anyWrite.has(m[1])) anyWrite.set(m[1], here(m.index)) })
    each(/[{,;}]\s*(?:async\s+|static\s+|get\s+|set\s+|\*\s*)*([A-Za-z_$][\w$]*)\s*\([^)(]*\)\s*\{/g, code, (m) => { if (!anyWrite.has(m[1])) anyWrite.set(m[1], here(m.index)) })
    each(/^[ \t]*#?([A-Za-z_$][\w$]*)\s*=(?!=)/gm, code, (m) => { if (!anyWrite.has(m[1])) anyWrite.set(m[1], here(m.index)) })
    // A TS class field declared with a modifier or a type: `private readonly packBoard = …`,
    // `protected count: number`, `foo!: T`. The head-of-line rule above captures the modifier as
    // the name and misses the field, so `this.packBoard` reads it and is wrongly called unwritten.
    each(/^[ \t]*(?:public|private|protected|readonly|static|declare|abstract|override|\s)+([A-Za-z_$][\w$]*)\s*[:=!?]/gm, code, (m) => { if (!anyWrite.has(m[1])) anyWrite.set(m[1], here(m.index)) })

    for (const bag of localBags(code, here)) bags.push(bag)
  }

  const admissible = (n) => WORDS.test(n) && !HOST.has(n) && !OWNED.has(n) && !imported.has(n) && !drop.has(n)

  // Every name still in play, so one prose/test/markup pass can clear them all at once. A name
  // spoken in a comment, a string, a test, a doc or any non-brace file has a life this index
  // cannot follow — a bracket access built from it, a documented schema, a serialized contract.
  const inPlay = new Set([...valueRead.keys(), ...bags.flatMap((b) => b.keys.map((k) => k.name))].filter(admissible))
  if (inPlay.size) {
    const isSource = new Set(src)
    const elsewhere = [
      ...ctx.files.filter((f) => !isSource.has(f)).map((f) => f.src),
      ...src.map((f) => ctx.commentsOnly(f.src)),
    ].join('\n')
    for (const n of [...inPlay]) if (new RegExp(`(?<![\\w$])${n}(?![\\w$])`).test(elsewhere)) inPlay.delete(n)
  }

  const findings = []
  const seen = new Set()

  // (a) READ, NEVER WRITTEN — the guaranteed undefined. `x.foo` read off an object this tree
  //     builds, and nothing anywhere supplies `foo`.
  for (const [n, r] of valueRead) {
    if (!inPlay.has(n) || anyWrite.has(n)) continue
    // A one- or two-character receiver (`v`, `c`, `el`, `m`) is almost always a loop or callback
    // binding over data made elsewhere; reasoning about its shape is unreliable, so it is dropped.
    if (r.recv.length < 3) continue
    if (tainted.has(r.recv) || !(builtByFile.get(r.file)?.has(r.recv))) continue
    if (seen.has(n)) continue
    seen.add(n)
    findings.push({
      file: r.file, line: r.line,
      what: 'a property is read that nothing in this tree ever supplies',
      evidence: `${r.recv}.${n} is read here; no assignment, key, field or returned object anywhere names ${n}`,
      fix: `have the producer of ${r.recv} set ${n}, or stop reading it`,
    })
  }
  const reads = findings.length

  // (b) WRITTEN, NEVER READ — a field of a LOCAL object that never leaves its scope, whose other
  //     fields ARE read back by name off that same object, and this one never is. Because the bag
  //     is proven not to escape (never returned, spread, serialized or passed on), a field nobody
  //     accesses is genuinely dropped — not delivered wholesale. The consumption signal is
  //     `bag.field`, tied to THIS object, so it cannot be inflated by some unrelated `.field`
  //     elsewhere in the tree.
  for (const b of bags) {
    if (b.escaped || b.accessed.size < 2) continue          // must be a member-accessed, contained record
    for (const k of b.keys) {
      const n = k.name
      if (b.accessed.has(n) || !inPlay.has(n) || seen.has(n)) continue
      seen.add(n)
      findings.push({
        file: k.file, line: k.line,
        what: 'a field is set on a local object and never read back off it',
        evidence: `${b.bagName}.${n} is never accessed, though ${b.accessed.size} other field(s) of ${b.bagName} are, and ${b.bagName} never leaves this scope`,
        fix: `read ${b.bagName}.${n} where the value was meant to be used, or drop the field`,
      })
    }
  }

  const note = `${reads} read-never-written (ordered first: each is an undefined at runtime), ${findings.length - reads} written-never-read. `
    + 'Two-plus-word names only (single words are overwhelmingly host/library/DOM). '
    + 'Blind by design to: non-brace languages (Python/Go/… — the mechanism is JS/TS-shaped); '
    + 'anything named in a .d.ts, a types path, a test, prose, a comment, a string, or bracketed access; '
    + 'properties of imports, globals, and any object this tree never constructs (an API payload, a Node handle, a DOM node — its writer is elsewhere). '
    + 'The READ side reports a field only when the reading file itself CONSTRUCTS its receiver as an object literal, and only when that receiver is named in three characters or more: a function parameter, an import, or a one- or two-letter binding could be handed anything by a caller this tree does not contain, so its provenance is unknown and it is passed over. That is the blind spot to know about — `render(store) { store.storageHealth }` is the named failure class and is NOT reported. '
    + 'The write side reports ONLY a field of a LOCAL object that never leaves its scope and whose other fields ARE read back off it — any object that is returned, spread, serialized or passed on is left alone, because there a missing read means "delivered whole", not "dropped".'

  return { findings, scanned: inPlay.size, note }
}
