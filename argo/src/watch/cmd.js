/**
 * `argo watch` — the research radar.
 *
 * Monitors the small set of sources that change how your own fleet behaves,
 * and reports only what is new since the last run. Pairs with `argo drift`:
 * a new agent-tooling release is the cue to snapshot before you install it.
 *
 * `--caveats FILE` is the other half: the version claims a caveats document
 * makes about installed skills, checked against the registry they rot toward.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fetchSource, selectNew, defaultConfig } from './sources.js'

const HELP = `
argo watch — report what changed in the sources that affect your fleet

  First run writes a default config tuned for building with Claude Code:
  arXiv multi-agent/orchestration queries, plus release feeds for the agent
  tooling you install. Edit .argo/watch.json to add your own.

options:
  --config FILE      config path                    [.argo/watch.json]
  --state FILE       seen-id store                  [.argo/watch-state.json]
  --keywords A,B     override config keywords for this run
  --min-score N      relevance floor                [1]
  --limit N          max items to show              [25]
  --all              ignore stored state; show everything fetched
  --no-save          do not update the state file (dry look)
  --json             machine-readable output
  --init             write the default config and exit
  --caveats FILE     check a caveats sidecar's version claims against npm and
                     exit: 0 nothing moved, 1 a recorded version is stale,
                     2 nothing could be checked. Rows look like
                     { skill, package, documents, recorded?, note? }

examples:
  argo watch --init
  argo watch
  argo watch --keywords "topology,delegation" --limit 10
  argo watch --caveats library/caveats-versions.json
`.trim()

function loadJson(path, fallback) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback
  } catch {
    return fallback
  }
}

function saveJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

/** Refuse a malformed sidecar rather than misreport it. */
function loadCaveatRows(path) {
  const rows = loadJson(path, null)
  if (!Array.isArray(rows)) return { error: `${path} is missing, unreadable, or not a JSON array` }
  const bad = rows.findIndex((r) => !r || ['skill', 'package', 'documents'].some((k) => typeof r[k] !== 'string'))
  if (bad !== -1) return { error: `${path} row ${bad} needs string skill, package and documents` }
  return { rows }
}

function printCaveats(rows) {
  const counts = {}
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1
  const stale = rows.filter((r) => r.stale)
  const summary = Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(' · ')
  console.log(`CAVEATS  ${rows.length} rows · ${summary} · ${stale.length} stale`)
  console.log('')
  const w = (k) => Math.max(0, ...rows.map((r) => String(r[k]).length))
  for (const r of rows) {
    const doc = r.resolved && r.resolved !== r.documents ? `${r.documents} (${r.resolved})` : r.documents
    const tail = r.live
      ? `${r.live}${r.stale ? `  ! recorded ${r.recorded}` : ''}`
      : r.reason
    console.log(`  ${r.status.padEnd(12)} ${r.package.padEnd(w('package'))}  ${r.skill.padEnd(w('skill'))}  ${doc} -> ${tail}`)
  }
  if (stale.length > 0) {
    console.log(`\n       ! ${stale.length} recorded version${stale.length === 1 ? ' has' : 's have'} moved.`)
    console.log('         regenerate the version rows with `npm view <pkg> version`.')
  }
}

/**
 * 2 when nothing could be checked — a green run on zero data is the bug —
 * 1 when a recorded version has moved, else 0. A row that is MAJOR-BEHIND
 * alone is not news: that is the state the document already records.
 */
function caveatsExit(rows) {
  if (rows.every((r) => r.status === 'unknown')) return 2
  return rows.some((r) => r.stale) ? 1 : 0
}

export async function run(args) {
  if (args.help) {
    console.log(HELP)
    return 0
  }

  // Before any config or state is touched: a rot check must not write a
  // default radar config into whatever directory it happens to run from.
  if (args.caveats !== undefined) {
    if (args.caveats === true) {
      console.error('argo watch: --caveats needs the path to a sidecar JSON file')
      return 2
    }
    const path = resolve(String(args.caveats))
    const { rows, error } = loadCaveatRows(path)
    if (error) {
      console.error(`argo watch: ${error}`)
      return 2
    }
    const { items } = await fetchSource({ type: 'caveats', rows })
    if (args.json) {
      console.log(JSON.stringify({
        sidecar: path,
        stale: items.filter((r) => r.stale).length,
        unknown: items.filter((r) => r.status === 'unknown').length,
        rows: items,
      }, null, 2))
    } else {
      printCaveats(items)
    }
    return caveatsExit(items)
  }

  const cwd = process.cwd()
  const configPath = resolve(args.config ?? join(cwd, '.argo', 'watch.json'))
  const statePath = resolve(args.state ?? join(cwd, '.argo', 'watch-state.json'))

  if (args.init) {
    saveJson(configPath, defaultConfig())
    console.log(`argo watch: wrote ${configPath}`)
    return 0
  }

  let config = loadJson(configPath, null)
  if (!config) {
    config = defaultConfig()
    saveJson(configPath, config)
    console.log(`argo watch: no config found, wrote defaults to ${configPath}\n`)
  }

  const keywords = args.keywords
    ? String(args.keywords).split(',').map((s) => s.trim()).filter(Boolean)
    : (config.keywords ?? [])

  const state = args.all ? { seen: [] } : loadJson(statePath, { seen: [] })
  const seen = new Set(state.seen ?? [])

  // Sources are independent and network-bound — fetch them together.
  const results = await Promise.all(
    (config.sources ?? []).map(async (src) => ({ src, ...(await fetchSource(src)) }))
  )

  // Caveat rows are statuses, not news: they never enter relevance scoring or
  // the seen-store, or a stale row would be shown once and then never again.
  const caveatRows = results.filter((r) => r.src.type === 'caveats').flatMap((r) => r.items ?? [])
  const radar = results.filter((r) => r.src.type !== 'caveats')

  const failures = radar.filter((r) => !r.ok)
  const allItems = radar.flatMap((r) => r.items ?? [])
  const fresh = selectNew(allItems, seen, keywords, { minScore: args['min-score'] ?? 1 })
  const limit = args.limit ?? 25
  const shown = fresh.slice(0, limit)

  if (args.json) {
    console.log(JSON.stringify({
      fetched: allItems.length,
      new: fresh.length,
      shown: shown.length,
      failures: failures.map((f) => ({ source: f.src.label ?? f.src.type, error: f.error })),
      items: shown,
      caveats: caveatRows,
    }, null, 2))
  } else {
    console.log(`RADAR  ${allItems.length} items fetched · ${fresh.length} new · showing ${shown.length}`)
    if (failures.length > 0) {
      console.log('')
      for (const f of failures) {
        console.log(`  ! ${f.src.label ?? f.src.repo ?? f.src.package ?? f.src.type}: ${f.error}`)
      }
    }
    if (shown.length === 0) {
      console.log('\n       nothing new. run with --all to see everything fetched.')
    }
    for (const it of shown) {
      console.log('')
      console.log(`  [${String(it.score).padStart(2)}] ${it.title}`)
      console.log(`       ${it.source}${it.published ? ' · ' + it.published.slice(0, 10) : ''}${it.hits.length ? ' · ' + it.hits.slice(0, 5).join(', ') : ''}`)
      console.log(`       ${it.url}`)
    }

    // The action that makes this worth running.
    const toolingUpdate = shown.find((it) => /^(npm|github):/.test(it.source))
    if (toolingUpdate) {
      console.log(`\n       ! agent tooling moved (${toolingUpdate.title}).`)
      console.log(`         run \`argo drift snapshot\` BEFORE installing, then \`argo drift diff\` after.`)
    }

    if (caveatRows.length > 0) {
      console.log('')
      printCaveats(caveatRows)
    }
  }

  if (!args['no-save'] && !args.all) {
    // Store every id we saw, not just the ones shown, so a relevance-filtered
    // item does not resurface as "new" the moment keywords change.
    const nextSeen = new Set(seen)
    for (const it of allItems) if (it.id) nextSeen.add(it.id)
    // Bound the store so it does not grow without limit.
    saveJson(statePath, { seen: [...nextSeen].slice(-4000) })
  }

  return 0
}
