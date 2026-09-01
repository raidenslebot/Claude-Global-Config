/**
 * sources.js — pure fetch + parse for the research radar.
 *
 * The thing worth monitoring is not "AI news". It is the small set of changes
 * that alter how your own fleet behaves: a new agent-tooling release you should
 * snapshot before installing, a paper that moves a number you are relying on,
 * a vendor doc page that quietly gained a policy sentence.
 *
 * Everything here is dependency-free: global fetch, and small tolerant parsers.
 * Feeds are XML but we only need a handful of fields, so a full XML parser
 * would be more failure surface than it removes.
 */

/** Strip tags and decode the five XML entities that actually show up. */
export function unxml(s) {
  return String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Pull the first <tag>...</tag> body out of a chunk. */
export function tag(chunk, name) {
  const m = chunk.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? m[1] : ''
}

/** Split a feed into entry/item chunks without parsing the whole document. */
export function chunks(xml, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>[\\s\\S]*?</${name}>`, 'gi')
  return xml.match(re) ?? []
}

/* ------------------------------------------------------------------ *
 * Parsers — pure, so they can be tested without network
 * ------------------------------------------------------------------ */

/** arXiv Atom API -> items. */
export function parseArxiv(xml) {
  return chunks(xml, 'entry').map((c) => {
    const id = unxml(tag(c, 'id'))
    return {
      source: 'arxiv',
      id,
      title: unxml(tag(c, 'title')),
      summary: unxml(tag(c, 'summary')).slice(0, 600),
      url: id,
      published: unxml(tag(c, 'published')),
      authors: chunks(c, 'author').map((a) => unxml(tag(a, 'name'))).slice(0, 6),
    }
  })
}

/** GitHub releases JSON -> items. */
export function parseGithubReleases(json, repo) {
  const arr = Array.isArray(json) ? json : []
  return arr.map((r) => ({
    source: `github:${repo}`,
    id: `${repo}@${r.tag_name ?? r.id}`,
    title: `${repo} ${r.tag_name ?? ''} ${r.name && r.name !== r.tag_name ? '— ' + r.name : ''}`.trim(),
    summary: String(r.body ?? '').slice(0, 900),
    url: r.html_url ?? `https://github.com/${repo}/releases`,
    published: r.published_at ?? r.created_at ?? '',
    prerelease: Boolean(r.prerelease),
  }))
}

/** npm registry doc -> the versions published, newest first. */
export function parseNpmVersions(json, pkg, limit = 12) {
  const times = json?.time ?? {}
  const entries = Object.entries(times)
    .filter(([v]) => v !== 'created' && v !== 'modified')
    .sort((a, b) => String(b[1]).localeCompare(String(a[1])))
    .slice(0, limit)
  return entries.map(([version, when]) => ({
    source: `npm:${pkg}`,
    id: `${pkg}@${version}`,
    title: `${pkg} ${version}`,
    summary: `published ${when}`,
    url: `https://www.npmjs.com/package/${pkg}/v/${version}`,
    published: String(when),
  }))
}

/** Generic RSS/Atom -> items. Handles both shapes. */
export function parseFeed(xml, label) {
  const isAtom = /<feed[\s>]/i.test(xml)
  const nodes = isAtom ? chunks(xml, 'entry') : chunks(xml, 'item')
  return nodes.map((c) => {
    let url = unxml(tag(c, 'link'))
    if (!url) {
      const href = c.match(/<link[^>]*href=["']([^"']+)["']/i)
      url = href ? href[1] : ''
    }
    const id = unxml(tag(c, 'guid')) || unxml(tag(c, 'id')) || url
    return {
      source: label,
      id: id || url,
      title: unxml(tag(c, 'title')),
      summary: unxml(tag(c, 'description') || tag(c, 'summary') || tag(c, 'content')).slice(0, 600),
      url,
      published: unxml(tag(c, 'published') || tag(c, 'updated') || tag(c, 'pubDate')),
    }
  })
}

/* ------------------------------------------------------------------ *
 * Relevance
 * ------------------------------------------------------------------ */

/**
 * Score an item against keywords. Title hits count double — a keyword in a
 * title is usually the subject, the same keyword in an abstract is often an
 * aside. Returns { score, hits }.
 */
export function relevance(item, keywords) {
  const title = String(item.title ?? '').toLowerCase()
  const body = String(item.summary ?? '').toLowerCase()
  const hits = []
  let score = 0
  for (const kw of keywords) {
    const k = kw.toLowerCase()
    const inTitle = title.includes(k)
    const inBody = body.includes(k)
    if (inTitle) { score += 2; hits.push(kw) }
    else if (inBody) { score += 1; hits.push(kw) }
  }
  return { score, hits }
}

/** Items not seen before, ranked by relevance then recency. */
export function selectNew(items, seenIds, keywords, { minScore = 1 } = {}) {
  const seen = seenIds instanceof Set ? seenIds : new Set(seenIds ?? [])
  return items
    .filter((it) => it.id && !seen.has(it.id))
    .map((it) => ({ ...it, ...relevance(it, keywords) }))
    .filter((it) => keywords.length === 0 || it.score >= minScore)
    .sort((a, b) => b.score - a.score || String(b.published).localeCompare(String(a.published)))
}

/* ------------------------------------------------------------------ *
 * Fetching
 * ------------------------------------------------------------------ */

/** One fetch with a timeout, returning null rather than throwing. */
export async function get(url, { timeout = 20_000, json = false, headers = {} } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'argonaut-watch/0.1 (+graph-engineering toolkit)', ...headers },
    })
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` }
    return { ok: true, status: res.status, body: json ? await res.json() : await res.text() }
  } catch (err) {
    return { ok: false, status: 0, error: err?.name === 'AbortError' ? 'timeout' : String(err?.message ?? err) }
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ *
 * Caveat version rot
 *
 * A caveats document records, per skill, the package version its content is
 * written against and the live version seen when it was verified. Both rot.
 * The claims live again in a JSON sidecar (an array of rows) so nothing here
 * parses prose: a prose parser that false-alarms gets switched off, and a
 * switched-off check is worse than none.
 *
 *   { skill, package, documents, recorded?, note? }
 *
 * `documents` is a version, a range, or a dist-tag ("next"). `recorded` is
 * the live version the document printed on its verification date; once the
 * registry has moved past it the row is stale and the document needs its
 * version rows regenerated.
 * ------------------------------------------------------------------ */

/**
 * The shape a sidecar row must have before anything downstream trusts it. One
 * validator for both doors — the `--caveats FILE` path and a caveats source in
 * the radar config — so a row that would crash the printer is refused at
 * either, with the same words. Returns a reason, or null when the rows are fine.
 */
export function validateCaveatRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 'needs a non-empty "rows" array'
  const bad = rows.findIndex((r) =>
    !r || typeof r !== 'object' || ['skill', 'package', 'documents'].some((k) => typeof r[k] !== 'string'))
  if (bad !== -1) return `row ${bad} needs string skill, package and documents`
  // `recorded` is compared to the registry by string equality; a JSON number
  // (9.7 for "9.7.0") would read as stale on every run.
  const num = rows.findIndex((r) => r.recorded !== undefined && typeof r.recorded !== 'string')
  if (num !== -1) return `row ${num}: recorded must be the exact version as a string`
  return null
}

/** The one registry fetch every npm-backed source goes through. */
export function npmDoc(pkg) {
  return get(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`, { json: true })
}

/**
 * Leading major and minor of a version or range. "^8.18.8" -> [8, 18],
 * "7.x" -> [7, null], "next" -> null.
 *
 * The WHOLE string must be a version. "React 18 / R3F 8" is prose that
 * happens to contain digits; reading 18 out of it produced a confident status
 * for a claim nobody made.
 */
export function versionParts(v) {
  const m = String(v ?? '').trim()
    .match(/^(?:[\^~]|[<>]=?|=)?\s*v?(\d+)(?:\.(\d+|x|\*))?(?:\.(?:\d+|x|\*))?(?:[-+][0-9A-Za-z.-]+)?$/)
  if (!m) return null
  return [Number(m[1]), m[2] == null || /^[x*]$/.test(m[2]) ? null : Number(m[2])]
}

/**
 * One sidecar row against one registry response. Pure.
 *
 * Status is coarse on purpose: MAJOR-BEHIND means the skill's API examples are
 * probably wrong, minor-behind that its version text is, and patch drift is
 * ignored. A `documents` naming a dist-tag resolves through the doc's
 * dist-tags first, so a skill that pins `pkg@next` is compared against what
 * that tag installs today. Offline or unparseable degrades to "unknown" with
 * a reason — never to a false "current".
 */
export function compareCaveat(row, res) {
  const out = { ...row, live: null, status: 'unknown', stale: false, reason: '' }
  if (!res?.ok) {
    // The registry answered and has no such package. That is a wrong name in the
    // sidecar, and "could not check" would let it pass on every run forever.
    if (res?.status === 404) return { ...out, status: 'not-found', reason: 'not on the registry — the package name in the sidecar is wrong' }
    return { ...out, reason: `could not check: ${res?.error ?? 'no response'}` }
  }
  const tags = res.body?.['dist-tags'] ?? {}
  const live = tags.latest ?? null
  if (!live) return { ...out, reason: 'could not compare: registry lists no latest version' }
  out.live = live
  out.stale = row.recorded != null && String(row.recorded) !== live
  const resolved = tags[row.documents] ?? row.documents
  const doc = versionParts(resolved)
  const now = versionParts(live)
  if (!doc || !now) {
    out.reason = !doc
      ? `could not compare: "${row.documents}" is neither a version nor a dist-tag`
      : `could not compare: latest "${live}" is not a version`
    return out
  }
  const cmp = (now[0] - doc[0]) || (doc[1] == null ? 0 : now[1] - doc[1])
  out.status = cmp < 0 ? 'ahead' : cmp === 0 ? 'current' : now[0] > doc[0] ? 'MAJOR-BEHIND' : 'minor-behind'
  out.resolved = resolved
  return out
}

/** Check every row of a sidecar. One registry fetch per distinct package; never throws. */
export async function checkCaveats(rows, fetchDoc = npmDoc) {
  const docs = new Map()
  for (const r of rows) {
    if (docs.has(r.package)) continue
    docs.set(r.package, Promise.resolve()
      .then(() => fetchDoc(r.package))
      .catch((err) => ({ ok: false, error: String(err?.message ?? err) })))
  }
  return Promise.all(rows.map(async (r) => compareCaveat(r, await docs.get(r.package))))
}

/** Fetch and parse one configured source. Never throws. */
export async function fetchSource(src) {
  try {
    if (src.type === 'arxiv') {
      const q = encodeURIComponent(src.query)
      const url = `https://export.arxiv.org/api/query?search_query=${q}` +
        `&sortBy=submittedDate&sortOrder=descending&max_results=${src.limit ?? 25}`
      const r = await get(url)
      return r.ok ? { ok: true, items: parseArxiv(r.body) } : { ok: false, error: r.error, items: [] }
    }
    if (src.type === 'github-releases') {
      const url = `https://api.github.com/repos/${src.repo}/releases?per_page=${src.limit ?? 10}`
      const r = await get(url, { json: true, headers: { accept: 'application/vnd.github+json' } })
      return r.ok ? { ok: true, items: parseGithubReleases(r.body, src.repo) } : { ok: false, error: r.error, items: [] }
    }
    if (src.type === 'npm') {
      const r = await npmDoc(src.package)
      return r.ok ? { ok: true, items: parseNpmVersions(r.body, src.package, src.limit ?? 12) } : { ok: false, error: r.error, items: [] }
    }
    if (src.type === 'caveats') {
      // Rows carry their own failure ("could not check"), so the source is ok
      // even offline; cmd.js decides the exit code from the rows. A source with
      // no usable rows at all is a config error and is reported as one.
      const reason = validateCaveatRows(src.rows)
      if (reason) return { ok: false, error: `a caveats source ${reason}`, items: [] }
      return { ok: true, items: await checkCaveats(src.rows) }
    }
    if (src.type === 'feed') {
      const r = await get(src.url)
      return r.ok ? { ok: true, items: parseFeed(r.body, src.label ?? src.url) } : { ok: false, error: r.error, items: [] }
    }
    return { ok: false, error: `unknown source type "${src.type}"`, items: [] }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err), items: [] }
  }
}

/**
 * Default radar for someone building with Claude Code. Tuned to what changes
 * your own setup, not to what is popular.
 */
export function defaultConfig() {
  return {
    keywords: [
      'multi-agent', 'agent', 'orchestration', 'subagent', 'coordination',
      'topology', 'hallucination', 'context', 'delegation', 'llm agent',
      'tool use', 'evaluation', 'benchmark',
    ],
    sources: [
      {
        type: 'arxiv',
        label: 'arXiv multi-agent LLM',
        query: 'abs:"multi-agent" AND abs:"language model"',
        limit: 25,
      },
      {
        type: 'arxiv',
        label: 'arXiv agent orchestration',
        query: 'abs:"LLM agents" AND (abs:"orchestration" OR abs:"coordination")',
        limit: 25,
      },
      // The one that pairs with `argo drift`: a new release is the cue to
      // snapshot before you install it.
      { type: 'npm', package: '@anthropic-ai/claude-code', limit: 12 },
      { type: 'github-releases', repo: 'anthropics/claude-code', limit: 10 },
    ],
  }
}
