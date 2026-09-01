/**
 * probe.js — capture the system prompt as it is actually DELIVERED.
 *
 * `argo drift snapshot` reads the shipped bundle, which catches client-side
 * policy text. It cannot catch a prompt section the service attaches at request
 * time — and the delegation gate everyone is chasing is exactly that kind. On a
 * 2.1.232 install here, scanning 241 MB of bundle produced 10,299 prose strings
 * and the gate was in none of them.
 *
 * But it is not hidden, only in a different place. The client has to SEND the
 * system prompt, so it is sitting in the request body on its way out of your own
 * machine. Point the client at a loopback proxy, forward everything upstream
 * untouched, and read the `system` field on the way past.
 *
 * This is introspection of software you are running, with your credentials, on
 * your hardware. It is also handling those credentials, so:
 *
 *   - the listener binds 127.0.0.1 only, never a routable interface
 *   - Authorization / x-api-key / cookie headers are forwarded but NEVER stored,
 *     printed, or written to disk — see REDACT
 *   - only the `system` field and request metadata are captured; message content
 *     (your actual conversation) is counted, not kept
 *   - the proxy lives for one command and is torn down in a finally block
 */

import { createServer } from 'node:http'
import { createHash } from 'node:crypto'

/** Headers that carry secrets. Forwarded upstream, never retained. */
const REDACT = new Set([
  'authorization', 'x-api-key', 'cookie', 'set-cookie', 'proxy-authorization',
  'anthropic-auth-token', 'x-auth-token',
])

/** Hop-by-hop headers that must not be forwarded. */
const HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
])

/**
 * Normalise the many shapes a system prompt arrives in.
 * The Messages API accepts a string or an array of content blocks; Claude Code
 * uses the array form with cache_control markers on some blocks.
 *
 * @returns {{blocks: Array<{index:number, text:string, cached:boolean, chars:number}>, text: string}}
 */
export function normaliseSystem(system) {
  if (system == null) return { blocks: [], text: '' }
  if (typeof system === 'string') {
    return { blocks: [{ index: 0, text: system, cached: false, chars: system.length }], text: system }
  }
  if (!Array.isArray(system)) return { blocks: [], text: '' }

  const blocks = system.map((b, i) => {
    const text = typeof b === 'string' ? b : String(b?.text ?? '')
    return {
      index: i,
      text,
      cached: Boolean(typeof b === 'object' && b?.cache_control),
      chars: text.length,
    }
  })
  return { blocks, text: blocks.map((b) => b.text).join('\n\n') }
}

/**
 * Split a system prompt into addressable sections.
 *
 * The delivered prompt is one wall of text; what changes between releases is
 * usually one section inside it. Markdown headings are the natural seam, and
 * everything before the first heading is its own preamble section.
 */
export function sections(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const out = []
  let current = { heading: '(preamble)', lines: [] }

  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.*\S)\s*$/)
    if (m) {
      if (current.lines.length > 0 || current.heading !== '(preamble)') out.push(current)
      current = { heading: m[2], lines: [] }
    } else {
      current.lines.push(line)
    }
  }
  out.push(current)

  return out
    .map((s) => {
      const body = s.lines.join('\n').trim()
      return {
        heading: s.heading,
        body,
        chars: body.length,
        hash: createHash('sha256').update(s.heading + '\n' + body).digest('hex').slice(0, 12),
      }
    })
    .filter((s) => s.body.length > 0 || s.heading !== '(preamble)')
}

/**
 * Imperative sentences — the ones that change what an agent will and won't do.
 * A section can grow by a paragraph of prose and mean nothing; it grows by one
 * of these and your fan-out stops firing.
 */
const POLICY = [
  /\bdo not\b/i, /\bdon't\b/i, /\bnever\b/i, /\bmust not\b/i, /\bavoid\b/i,
  /\bonly (?:when|if|use)\b/i, /\bunless the user\b/i, /\bdo NOT\b/,
  /\brefuse\b/i, /\balways\b/i, /\brequired to\b/i, /\bnot allowed\b/i,
]

/** Pull policy-shaped sentences out of a chunk of prompt text. */
export function policySentences(text) {
  return String(text ?? '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 15 && s.length <= 400)
    .filter((s) => POLICY.some((re) => re.test(s)))
}

/** Sentences mentioning a named tool — the delegation gate's fingerprint. */
export function toolGateSentences(text, tools = ['AgentTool', 'Task', 'Workflow', 'deep-research', 'subagent']) {
  const re = new RegExp(`\\b(${tools.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i')
  return String(text ?? '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 10 && re.test(s))
}

/**
 * Start a loopback capture proxy.
 *
 * @param {object}   opts
 * @param {number}   opts.port      0 lets the OS choose a free one
 * @param {string}   opts.upstream  e.g. 'https://api.anthropic.com'
 * @param {function} opts.onCapture called with each captured request record
 * @returns {Promise<{url:string, port:number, close:()=>Promise<void>}>}
 */
export function startProxy({ port = 0, upstream, onCapture, timeout = 300_000 } = {}) {
  const base = String(upstream).replace(/\/+$/, '')

  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('error', () => { try { res.destroy() } catch {} })

    req.on('end', async () => {
      const body = Buffer.concat(chunks)

      // Capture before forwarding — a failed upstream call is still evidence.
      if (req.method === 'POST' && /\/v1\/messages/.test(req.url ?? '')) {
        try {
          const parsed = JSON.parse(body.toString('utf8'))
          const { blocks, text } = normaliseSystem(parsed.system)
          onCapture?.({
            url: req.url,
            model: parsed.model ?? null,
            stream: Boolean(parsed.stream),
            // Conversation content is counted, never kept.
            messageCount: Array.isArray(parsed.messages) ? parsed.messages.length : 0,
            toolNames: Array.isArray(parsed.tools)
              ? parsed.tools.map((t) => t?.name).filter(Boolean)
              : [],
            systemBlocks: blocks,
            systemText: text,
            systemChars: text.length,
          })
        } catch {
          // A body we cannot parse is not worth failing the user's call over.
        }
      }

      // Forward upstream, headers intact so auth still works.
      const headers = {}
      for (const [k, v] of Object.entries(req.headers)) {
        if (HOP.has(k.toLowerCase())) continue
        headers[k] = Array.isArray(v) ? v.join(', ') : String(v)
      }

      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeout)
      try {
        const upstreamRes = await fetch(base + (req.url ?? '/'), {
          method: req.method,
          headers,
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
          signal: ctrl.signal,
          redirect: 'manual',
        })

        const outHeaders = {}
        upstreamRes.headers.forEach((v, k) => {
          if (HOP.has(k.toLowerCase())) return
          outHeaders[k] = v
        })
        res.writeHead(upstreamRes.status, outHeaders)

        if (upstreamRes.body) {
          // Stream SSE through rather than buffering — the CLI needs tokens live.
          const reader = upstreamRes.body.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            res.write(Buffer.from(value))
          }
        }
        res.end()
      } catch (err) {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { type: 'argo_proxy_error', message: String(err?.message ?? err) } }))
      } finally {
        clearTimeout(timer)
      }
    })
  })

  return new Promise((resolveP, rejectP) => {
    server.on('error', rejectP)
    // Loopback only. This carries live credentials; it must not be reachable.
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port
      resolveP({
        url: `http://127.0.0.1:${actual}`,
        port: actual,
        close: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}

/**
 * Compare two captured prompts section by section.
 * Sections are matched by heading; a heading whose hash moved is "changed".
 */
export function diffPrompts(before, after) {
  const A = new Map(sections(before).map((s) => [s.heading, s]))
  const B = new Map(sections(after).map((s) => [s.heading, s]))

  const added = []
  const removed = []
  const changed = []

  for (const [heading, s] of B) {
    if (!A.has(heading)) added.push(s)
    else if (A.get(heading).hash !== s.hash) {
      changed.push({ heading, before: A.get(heading), after: s })
    }
  }
  for (const [heading, s] of A) if (!B.has(heading)) removed.push(s)

  const beforePolicy = new Set(policySentences(before))
  const afterPolicy = new Set(policySentences(after))
  const policyAdded = [...afterPolicy].filter((s) => !beforePolicy.has(s))
  const policyRemoved = [...beforePolicy].filter((s) => !afterPolicy.has(s))

  return {
    added, removed, changed,
    policyAdded, policyRemoved,
    charsBefore: String(before ?? '').length,
    charsAfter: String(after ?? '').length,
  }
}
