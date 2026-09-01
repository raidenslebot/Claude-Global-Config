/**
 * yaml.js — a deliberately tiny yaml reader for topology declarations.
 *
 * the declaration is the artifact this module exists to produce, so it has to be
 * pleasant to hand-edit, and json is not. but full yaml is a language: anchors,
 * aliases, merge keys, block scalars, tags. every one of those is a way for two
 * people to read the same file differently, which is precisely the failure this
 * tool exists to catch. so we read the flat subset — nested maps, lists of maps,
 * scalars, inline lists — and refuse everything else by name, pointing at json.
 *
 * zero dependencies is not a flex here, it is the same argument: a parser you
 * cannot read is a channel you cannot audit.
 */

/** Every failure in this module is a user-fixable declaration problem. */
export class TopologyError extends Error {
  constructor(message) {
    super(message)
    this.name = 'TopologyError'
  }
}

const JSON_HINT = 'rewrite the declaration as JSON — the YAML supported here is a flat subset.'

/**
 * Constructs that change meaning at a distance. None of them are supported.
 * The anchor/alias patterns are deliberately narrow — `**` and `*.js` are globs
 * a fleet declaration is full of, and refusing those would be worse than useless.
 */
const UNSUPPORTED = [
  [/^[|>]/, 'block scalars (| and >)'],
  [/^&[A-Za-z_][\w-]*$/, 'anchors (&name)'],
  [/^\*[A-Za-z_][\w-]*$/, 'aliases (*name)'],
  [/^!!?[A-Za-z]/, 'tags (!type)'],
  [/^\{/, 'flow mappings ({ ... })'],
]

/** Drop a trailing `#` comment without eating a `#` inside quotes. */
function stripComment(line) {
  let out = ''
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      out += ch
      if (ch === '\\' && quote === '"') {
        out += line[++i] ?? ''
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      out += ch
      continue
    }
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) break
    out += ch
  }
  return out
}

function unquote(t) {
  if (t.length >= 2 && t[0] === '"' && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\(.)/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' })[c] ?? c)
  }
  if (t.length >= 2 && t[0] === "'" && t.endsWith("'")) {
    return t.slice(1, -1).replace(/''/g, "'")
  }
  return t
}

/** Split `a, "b, c", d` on top-level commas only. */
function splitFlow(body) {
  const parts = []
  let cur = ''
  let quote = null
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quote) {
      cur += ch
      if (ch === '\\' && quote === '"') {
        cur += body[++i] ?? ''
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
      continue
    }
    if (ch === ',') {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  parts.push(cur)
  return parts.map((p) => p.trim()).filter((p) => p !== '')
}

function parseFlowSeq(t, n) {
  if (!t.endsWith(']')) throw new TopologyError(`line ${n}: unterminated inline list. ${JSON_HINT}`)
  const body = t.slice(1, -1)
  if (body.includes('[') || body.includes('{')) {
    throw new TopologyError(`line ${n}: nested inline collections are not supported. ${JSON_HINT}`)
  }
  return splitFlow(body).map((p) => parseScalar(p, n))
}

/** Scalars, plus the one collection form allowed on a value line: `[a, b]`. */
export function parseScalar(raw, n = 0) {
  const t = raw.trim()
  for (const [re, what] of UNSUPPORTED) {
    if (re.test(t)) throw new TopologyError(`line ${n}: ${what} are not supported. ${JSON_HINT}`)
  }
  if (t.startsWith('[')) return parseFlowSeq(t, n)
  if (t === '' || t === '~' || t === 'null') return null
  if (t === 'true') return true
  if (t === 'false') return false
  if (t[0] === '"' || t[0] === "'") return unquote(t)
  if (/^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(t)) return Number(t)
  return t
}

/**
 * Split `key: value`. A colon only starts a value when followed by whitespace or
 * end of line, so `url: http://x` and `model: claude-opus-5` both survive.
 */
function splitKey(text) {
  if (text[0] === '"' || text[0] === "'") {
    const q = text[0]
    let i = 1
    while (i < text.length && text[i] !== q) {
      if (q === '"' && text[i] === '\\') i++
      i++
    }
    if (i >= text.length) return null
    const rest = text.slice(i + 1).trimStart()
    if (!rest.startsWith(':')) return null
    return { key: unquote(text.slice(0, i + 1)), value: rest.slice(1).trim() }
  }
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ':') continue
    if (i + 1 === text.length || text[i + 1] === ' ') {
      return { key: text.slice(0, i).trim(), value: text.slice(i + 1).trim() }
    }
  }
  return null
}

function parseNode(lines, idx, indent) {
  const t = lines[idx].text
  if (t === '-' || t.startsWith('- ')) return parseSeq(lines, idx, indent)
  if (splitKey(t)) return parseMap(lines, idx, indent)
  return [parseScalar(t, lines[idx].n), idx + 1]
}

function parseMap(lines, idx, indent) {
  const map = {}
  while (idx < lines.length && lines[idx].indent === indent) {
    const line = lines[idx]
    if (line.text.startsWith('-')) break
    const kv = splitKey(line.text)
    if (!kv) throw new TopologyError(`line ${line.n}: cannot read "${line.text}" as "key: value". ${JSON_HINT}`)
    if (kv.key.startsWith('<<')) throw new TopologyError(`line ${line.n}: merge keys (<<) are not supported. ${JSON_HINT}`)
    if (Object.hasOwn(map, kv.key)) throw new TopologyError(`line ${line.n}: duplicate key "${kv.key}".`)
    idx++
    if (kv.value !== '') {
      map[kv.key] = parseScalar(kv.value, line.n)
      continue
    }
    const next = lines[idx]
    if (next && next.indent > indent) {
      const [value, after] = parseNode(lines, idx, next.indent)
      map[kv.key] = value
      idx = after
    } else if (next && next.indent === indent && (next.text === '-' || next.text.startsWith('- '))) {
      // a list may sit at the same column as the key that owns it
      const [value, after] = parseSeq(lines, idx, indent)
      map[kv.key] = value
      idx = after
    } else {
      map[kv.key] = null
    }
  }
  return [map, idx]
}

function parseSeq(lines, idx, indent) {
  const out = []
  while (idx < lines.length && lines[idx].indent === indent) {
    const line = lines[idx]
    if (line.text !== '-' && !line.text.startsWith('- ')) break
    const dash = /^-\s*/.exec(line.text)[0]
    const content = line.text.slice(dash.length)
    if (content === '') {
      idx++
      const next = lines[idx]
      if (next && next.indent > indent) {
        const [value, after] = parseNode(lines, idx, next.indent)
        out.push(value)
        idx = after
      } else {
        out.push(null)
      }
      continue
    }
    // `- id: x` is a map whose first key happens to sit on the dash line; rewrite
    // it to that column so the following keys of the same item line up naturally.
    const contentIndent = indent + dash.length
    lines[idx] = { indent: contentIndent, text: content, n: line.n }
    const [value, after] = parseNode(lines, idx, contentIndent)
    out.push(value)
    idx = after
  }
  return [out, idx]
}

/**
 * Parse the supported yaml subset. Throws TopologyError with a line number and a
 * pointer to json on anything outside it.
 *
 * @param {string} text
 * @returns {*} plain js value (object, array, scalar) or null for an empty doc
 */
export function parseYaml(text) {
  const lines = []
  const raw = text.split(/\r?\n/)
  for (let i = 0; i < raw.length; i++) {
    const stripped = stripComment(raw[i])
    if (!stripped.trim()) continue
    if (/^(?:---|\.\.\.)$/.test(stripped.trim())) continue
    const lead = /^[ \t]*/.exec(stripped)[0]
    if (lead.includes('\t')) {
      throw new TopologyError(`line ${i + 1}: tab indentation. YAML forbids tabs — use spaces, or ${JSON_HINT}`)
    }
    lines.push({ indent: lead.length, text: stripped.trim(), n: i + 1 })
  }
  if (lines.length === 0) return null

  const [value, after] = parseNode(lines, 0, lines[0].indent)
  if (after < lines.length) {
    throw new TopologyError(`line ${lines[after].n}: unexpected indentation at "${lines[after].text}". ${JSON_HINT}`)
  }
  return value
}
