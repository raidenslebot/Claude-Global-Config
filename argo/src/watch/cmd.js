/**
 * `argo watch` — the research radar.
 *
 * Monitors the small set of sources that change how your own fleet behaves,
 * and reports only what is new since the last run. Pairs with `argo drift`:
 * a new agent-tooling release is the cue to snapshot before you install it.
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

examples:
  argo watch --init
  argo watch
  argo watch --keywords "topology,delegation" --limit 10
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

export async function run(args) {
  if (args.help) {
    console.log(HELP)
    return 0
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

  const failures = results.filter((r) => !r.ok)
  const allItems = results.flatMap((r) => r.items ?? [])
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
