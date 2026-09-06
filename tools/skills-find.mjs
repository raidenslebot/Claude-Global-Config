#!/usr/bin/env node
// skills-find.mjs — search the skills.sh registry, and fetch a skill into the INDEXED library.
//
//   cgc skills <query>                       search, with the third-party audit verdicts
//   cgc skills <query> --owner vercel-labs   narrow to one publisher
//   cgc skills --get <owner/repo/slug>       fetch it into the Tier-3 library, not into context
//   cgc skills --get <owner/repo/slug> --print   read it here without writing anything
//
// WHY THIS EXISTS RATHER THAN `npx skills add`. The official CLI is fine and does more than
// this. Three of its defaults are wrong for a machine this package manages:
//
//   1. `-g -a claude-code` installs into ~/.claude/skills — the SAME directory this package
//      occupies. Every skill that lands there costs session context in EVERY session, forever,
//      and this package's own budget is already 3,683 of 4,000 tokens. Twenty skills installed
//      that way is the context gone. Worse, a skill whose name collides SHADOWS one of this
//      package's, which the doctor reports as a policy break. So this writes to the indexed
//      library instead, where a skill costs nothing until something greps for it.
//   2. Installing sends a telemetry ping by default. Nothing here calls that endpoint at all.
//   3. It requires an npm package to be resolved and executed before you can even LOOK.
//
// The endpoints below are the ones the official CLI itself uses. They are undocumented — the
// DOCUMENTED /api/v1/* is walled behind a Vercel OIDC token and is unusable from a local tool —
// so they carry no stability guarantee, and every failure here says which endpoint moved rather
// than printing an empty list. An empty list and a dead endpoint must never look the same.
//
// PROVENANCE, stated because the registry states it. Listing is automatic: a skill appears
// because somebody installed it, not because anybody read it. The registry's own terms say it
// "cannot guarantee the quality, safety, correctness, or security of any skill listed here".
// The audit columns are automated scanners, not review. Read the SKILL.md before trusting it.

import { mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { join, dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildVars, askedForHelp } from './paths.mjs'

// Read at call time, not at import. A module-level capture cannot be redirected by a caller
// that sets the variable after loading, which makes every one of these paths reachable only by
// talking to the real registry — and a test that needs the network is a test nobody trusts.
const SEARCH = () => process.env.CGC_SKILLS_SEARCH_URL || 'https://skills.sh/api/search'
const DOWNLOAD = () => process.env.CGC_SKILLS_DOWNLOAD_URL || 'https://skills.sh/api/download'
const AUDIT = () => process.env.CGC_SKILLS_AUDIT_URL || 'https://add-skill.vercel.sh/audit'
const TIMEOUT = 20000

const C = { dim: '\x1b[2m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', off: '\x1b[0m' }

const HELP = `usage:
  cgc skills <query> [--owner <gh-owner>] [--limit <n>] [--json]
  cgc skills --get <owner/repo/slug> [--print] [--json]

Searches the skills.sh registry over plain HTTPS. No account, no API key, no npm package, and
no telemetry ping — this never calls the registry's tracking endpoint.

  --get     fetch a skill into the indexed library (${'{{LIBRARY_ROOT}}'}/_found/<owner>/<repo>/<slug>),
            where it costs no session context. It is NOT installed into ~/.claude/skills:
            everything there is loaded in every session, and that budget is nearly spent.
  --print   write nothing; print the SKILL.md so you can read it before deciding.

Skills are user-submitted and listed automatically by install count. The registry's own terms
say it cannot guarantee the safety or correctness of any of them. Read one before trusting it.`

/** Fetch JSON, or throw an error that names the endpoint. A dead endpoint is not an empty list. */
async function getJson(url) {
  let r
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { accept: 'application/json' } })
  } catch (e) {
    throw new Error(`${url.split('?')[0]} did not answer — ${String(e.message || e).slice(0, 90)}`)
  }
  if (!r.ok) {
    throw new Error(`${url.split('?')[0]} answered HTTP ${r.status}`
      + (r.status === 401 ? ' — this is the authenticated /api/v1 route, not the open one' : ''))
  }
  try { return await r.json() } catch (e) { throw new Error(`${url.split('?')[0]} returned something that is not JSON`) }
}

/** The automated scanner verdicts for one repo's skills, keyed by slug. Never fatal. */
export async function audits(source, slugs) {
  if (!slugs.length) return {}
  try {
    return await getJson(`${AUDIT()}?source=${encodeURIComponent(source)}&skills=${encodeURIComponent(slugs.join(','))}`)
  } catch { return {} }
}

/** The worst verdict any scanner gave, which is the only one worth showing in a row. */
export function worstRisk(entry) {
  if (!entry || typeof entry !== 'object') return null
  const order = ['critical', 'high', 'medium', 'moderate', 'low', 'safe']
  let worst = null
  for (const v of Object.values(entry)) {
    const risk = v && typeof v === 'object' ? String(v.risk || '').toLowerCase() : ''
    if (!risk) continue
    if (worst === null || order.indexOf(risk) < order.indexOf(worst)) worst = risk
  }
  return worst
}

export async function search(query, { owner, limit = 12 } = {}) {
  if (!query || query.trim().length < 2) throw new Error('a search needs at least two characters')
  const u = new URL(SEARCH())
  u.searchParams.set('q', query.trim())
  u.searchParams.set('limit', String(Math.min(Math.max(1, Number(limit) || 12), 200)))
  if (owner) u.searchParams.set('owner', owner)
  const j = await getJson(u.href)
  return Array.isArray(j.skills) ? j.skills : []
}

/** The files of one skill. `id` is owner/repo/slug. */
/** A registry id is three path segments of a URL, and it is also used to build a directory
 *  under the library. Every segment is therefore limited to the characters a GitHub owner, repo
 *  or skill slug can contain — which excludes `.`-only segments, separators and anything the
 *  shell or the filesystem would read as structure. `--get ../../../../x/repo/slug` wrote a
 *  SKILL.md four levels above the library before this existed. */
const SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/
export function parseId(id) {
  const parts = String(id).split('/').filter(Boolean)
  if (parts.length !== 3) throw new Error(`--get wants exactly <owner>/<repo>/<slug>, got "${id}"`)
  for (const p of parts) {
    if (!SEGMENT.test(p) || p === '.' || p === '..') throw new Error(`"${p}" is not a valid registry id segment`)
  }
  const [owner, repo, slug] = parts
  return { owner, repo, slug }
}

export async function fetchSkill(id) {
  const { owner, repo, slug } = parseId(id)
  const j = await getJson(`${DOWNLOAD()}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(slug)}`)
  const files = Array.isArray(j.files) ? j.files : []
  if (!files.length) throw new Error(`the registry returned no files for ${id}`)
  return { owner, repo, slug, files }
}

export async function main(argv = process.argv.slice(2)) {
  if (askedForHelp(import.meta.url, argv)) { console.log(HELP.replace('{{LIBRARY_ROOT}}', buildVars().LIBRARY_ROOT)); return 0 }
  const args = { _: [] }
  const BOOLEAN = new Set(['json', 'print'])
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      if (BOOLEAN.has(k)) { args[k] = true; continue }
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) { console.error(`skills: --${k} wants a value`); return 2 }
      args[k] = argv[++i]
    } else args._.push(a)
  }

  try {
    if (args.get) {
      const { owner, repo, slug, files } = await fetchSkill(args.get)
      const skill = files.find((f) => /(^|\/)SKILL\.md$/i.test(f.path)) || files[0]
      if (args.print) {
        if (args.json) console.log(JSON.stringify({ id: args.get, files }, null, 2))
        else console.log(skill.contents)
        return 0
      }
      const root = resolve(buildVars().LIBRARY_ROOT)
      const dest = join(root, '_found', owner, repo, slug)
      // Validate EVERY path before writing ANY: a bad third file must not leave the first two on
      // disk. And the test is the resolved path against the resolved destination — not a search
      // for "..", which an absolute path, a drive letter or a UNC prefix all pass.
      const planned = []
      for (const f of files) {
        const rel = String(f.path).replace(/\\/g, '/').replace(/^\/+/, '')
        if (!rel || /\0/.test(rel)) { console.error(`skills: refusing an empty or NUL-bearing path: ${JSON.stringify(f.path)}`); return 2 }
        const p = resolve(dest, rel)
        if (p !== dest && !p.startsWith(dest + sep)) { console.error(`skills: refusing a path that climbs out of the library: ${f.path}`); return 2 }
        planned.push([p, String(f.contents ?? '')])
      }
      for (const [p, body] of planned) {
        mkdirSync(dirname(p), { recursive: true })
        writeFileSync(p, body, 'utf8')
      }
      const verdict = worstRisk((await audits(`${owner}/${repo}`, [slug]))[slug])
      if (args.json) { console.log(JSON.stringify({ id: args.get, dest, files: files.length, risk: verdict }, null, 2)); return 0 }
      console.log(`\n  ${C.green}fetched${C.off} ${files.length} file(s) → ${dest}`)
      console.log(`  ${C.dim}Indexed, not installed: it costs no session context. Read it before you use it${verdict && verdict !== 'safe' && verdict !== 'low' ? ` — the scanners rate it ${verdict}` : ''}.${C.off}`)
      console.log(`  ${C.dim}Rebuild the index: node ${join(buildVars().LIBRARY_ROOT, '_index', 'build-index.mjs')}${C.off}\n`)
      return 0
    }

    const query = args._.join(' ')
    if (!query) { console.log(HELP.replace('{{LIBRARY_ROOT}}', buildVars().LIBRARY_ROOT)); return 2 }
    const results = await search(query, { owner: args.owner, limit: args.limit })
    if (args.json) { console.log(JSON.stringify({ query, results }, null, 2)); return 0 }
    if (!results.length) { console.log(`\n  no skill matches "${query}".\n`); return 0 }

    // One audit call per repo, not per skill.
    const bySource = new Map()
    for (const s of results) bySource.set(s.source, [...(bySource.get(s.source) || []), s.skillId])
    const verdicts = {}
    for (const [source, slugs] of bySource) Object.assign(verdicts, await audits(source, slugs))

    console.log(`\n  ${C.bold}${results.length} skill(s) for "${query}"${C.off}  ${C.dim}skills.sh · listed by install count, not by review${C.off}\n`)
    for (const s of results) {
      const risk = worstRisk(verdicts[s.skillId])
      const colour = risk === 'safe' || risk === 'low' ? C.green : risk ? C.yellow : C.dim
      console.log(`  ${String(s.name || s.skillId).padEnd(38)} ${C.dim}${String(s.installs ?? '?').padStart(8)} installs${C.off}  ${colour}${risk || 'unscanned'}${C.off}`)
      console.log(`    ${C.dim}${s.id}${C.off}`)
    }
    console.log(`\n  ${C.dim}Read one first:  cgc skills --get ${results[0].id} --print${C.off}`)
    console.log(`  ${C.dim}Keep one:        cgc skills --get ${results[0].id}   (into the indexed library, not into context)${C.off}\n`)
    return 0
  } catch (e) {
    console.error(`skills: ${e.message}`)
    return 2
  }
}

const isEntry = (() => {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false }
})()
if (isEntry) process.exit(await main())
