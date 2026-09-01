/** `argo diverge` — ask several agents the same thing, score how far apart they land. */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { analyse, rankFiles } from '../graph/index.js'
import { defaultProbes, normaliseProbes, buildPrompt, syntheticAnswer } from './probes.js'
import { askClaude, buildArgv, quoteArg, resolveClaudeBin, runPool, BIN_HINT, AUTH_HINT } from './claude.js'
import { buildReport, renderText, renderMarkdown } from './report.js'

const HELP = `
argo diverge [path] — measure pairwise divergence across your agents

  Asks M agent configurations the same N questions R times each and scores every
  (agent_i, agent_j) pair on every question. Pairwise is the whole point: the
  average of two contradictory answers looks fine, so a fleet mean hides exactly
  the failure this measures.

options:
  --probes FILE      JSON array of probes; default: ~8 generated from the repo graph
  --agents FILE      JSON array of { name, model?, systemPrompt?, appendPrompt? }
                     default: two configs on the same model, so you find out
                     whether your fleet is self-consistent at all
  --repeats N        samples per agent per probe                     [1]
                     2 or more also measures each agent against itself
  --threshold F      divergence above which a pair fails; exit 1     [0.35]
  --gate max|mean    which per-pair number the threshold reads       [max]
                     max  = the single worst probe. one question your
                            agents contradict each other on fails the run
                     mean = averaged across probes. lenient, and it hides
                            a flat contradiction behind probes that agreed
  --model ID         pin a model (claude-opus-5, claude-sonnet-5, ...)
  --concurrency N    probes in flight at once                        [4]
  --limit N          how many generated probes to use                [8]
  --timeout N        seconds per probe call                          [180]
  --prompt-arg       pass the prompt as an argv element instead of on stdin
  --dry-run          synthetic answers, no model calls, no tokens spent
  --json             full report as JSON
  --md               markdown report
  --out FILE         write the chosen output to FILE instead of stdout

artifacts:
  .argo/divergence.json and .argo/divergence.md under the analysed path.
  --dry-run writes .argo/divergence.dry-run.* instead, so synthetic numbers
  never overwrite a measured run.

binary resolution:
  ARGO_CLAUDE_BIN, then the known npm install path, then \`claude\` on PATH.

examples:
  argo diverge . --dry-run
  argo diverge . --repeats 3 --threshold 0.25
  argo diverge . --gate mean          # lenient: average across probes
  argo diverge . --agents agents.json --json --out .argo/diverge.json
`.trim()

export async function run(args) {
  if (args.help) {
    console.log(HELP)
    return 0
  }

  const root = resolve(args._[0] ?? process.cwd())
  const dryRun = args['dry-run'] === true
  const threshold = numberOr(args.threshold, 0.35)
  const gate = args.gate === 'mean' ? 'mean' : 'max'
  const repeats = Math.max(1, Math.trunc(numberOr(args.repeats, 1)))
  const concurrency = Math.max(1, Math.trunc(numberOr(args.concurrency, 4)))
  const timeout = Math.max(1, Math.trunc(numberOr(args.timeout, 180))) * 1000
  const limit = Math.max(1, Math.trunc(numberOr(args.limit, 8)))
  const model = typeof args.model === 'string' ? args.model : undefined

  let agents
  let probes
  try {
    agents = loadAgents(args.agents, model)
    probes = args.probes ? loadProbes(args.probes) : generateProbes(root, limit)
  } catch (err) {
    console.error(`argo diverge: ${err.message}`)
    return 2
  }

  if (agents.length < 2) {
    console.error('argo diverge: need at least two agent configurations to score a pair')
    return 2
  }
  if (probes.length === 0) {
    // Blame the right thing. Telling someone who just passed --probes to "pass
    // --probes FILE" points them at the one input that is not the problem.
    console.error(
      args.probes
        ? `argo diverge: no probes — ${resolve(String(args.probes))} is an empty array.`
        : `argo diverge: no probes — ${root} has no recognised source files, so nothing could be generated. Pass --probes FILE.`
    )
    return 2
  }

  const { bin, source } = resolveClaudeBin()
  const jobs = []
  for (const agent of agents) {
    for (let p = 0; p < probes.length; p++) {
      for (let r = 0; r < repeats; r++) jobs.push({ agent, probe: probes[p], probeIndex: p, repeat: r })
    }
  }

  if (dryRun) {
    console.error(`argo diverge: DRY RUN — ${jobs.length} call(s) would run as:`)
    console.error(`  binary   ${bin}   (${source})`)
    console.error(`  cwd      ${root}`)
    // argv entries are passed to the process directly, so they are unquoted.
    // Quoting is applied here and only here, to keep a value with a space in it
    // from reading as two arguments on the page.
    console.error(`  argv     ${buildArgv({ model: agents[0].model, systemPrompt: agents[0].systemPrompt, appendPrompt: agents[0].appendPrompt }).map((a) => (/\s/.test(a) ? quoteArg(a) : a)).join(' ')}`)
    console.error(`  prompt   on stdin, e.g. ${JSON.stringify(buildPrompt(probes[0], { root }).slice(0, 120))}...`)
    console.error('')
  }

  const errors = []
  const results = await runPool(
    jobs,
    async (job, i) => {
      if (dryRun) return { ...job, ok: true, text: syntheticAnswer(job.agent.name, job.probe, job.repeat) }
      const res = await askClaude({
        bin,
        prompt: buildPrompt(job.probe, { root }),
        model: job.agent.model,
        systemPrompt: job.agent.systemPrompt,
        appendPrompt: job.agent.appendPrompt,
        cwd: root,
        timeout,
        promptAsArg: args['prompt-arg'] === true,
      })
      if (!args.json) {
        console.error(
          `  [${String(i + 1).padStart(3)}/${jobs.length}] ${job.agent.name} · ${job.probe.id} · ` +
            `r${job.repeat + 1} · ${res.ok ? `${res.ms}ms` : 'FAILED'}`
        )
      }
      return { ...job, ...res }
    },
    concurrency
  )

  const samples = {}
  for (const agent of agents) samples[agent.name] = probes.map(() => [])
  for (const r of results) {
    if (r.ok) samples[r.agent.name][r.probeIndex].push(r.text)
    else errors.push({ agent: r.agent.name, probe: r.probe.id, repeat: r.repeat, error: r.error })
  }

  if (!dryRun && errors.length === jobs.length) {
    console.error(`argo diverge: every call failed. First error: ${errors[0].error}`)
    // Point at the thing that is actually broken. "check your binary path" is
    // useless advice when the binary ran fine and simply is not logged in.
    console.error(`argo diverge: ${/not logged in|\/login|authenticat|unauthor|api key/i.test(errors[0].error) ? AUTH_HINT : BIN_HINT}`)
    return 2
  }

  const report = buildReport({
    root,
    agents,
    probes,
    samples,
    threshold,
    gate,
    repeats,
    model: model ?? '(cli default)',
    mode: dryRun ? 'dry-run' : 'live',
    errors,
  })

  const artifacts = join(root, '.argo')
  mkdirSync(artifacts, { recursive: true })
  // Synthetic runs get their own filenames. Letting --dry-run overwrite the
  // artifacts of a measured run would replace real numbers with invented ones
  // under a name that reads as authoritative — which is the failure mode this
  // whole tool is about.
  const stem = dryRun ? 'divergence.dry-run' : 'divergence'
  writeFileSync(join(artifacts, `${stem}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  writeFileSync(join(artifacts, `${stem}.md`), `${renderMarkdown(report)}\n`, 'utf8')

  let output
  if (args.json) output = JSON.stringify(report, null, 2)
  else if (args.md) output = renderMarkdown(report)
  else output = renderText(report, { top: args.top ?? 3 })

  if (args.out) {
    const target = resolve(args.out)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, `${output}\n`, 'utf8')
    console.log(`argo diverge: wrote ${target}`)
  } else {
    console.log(output)
  }

  if (!args.json) console.error(`argo diverge: artifacts in ${artifacts}`)

  // Non-zero on a breached pair so this can sit in CI. A pair, not the fleet
  // average — and by default the pair's WORST probe, not its average across
  // probes, because averaging across probes hides a flat contradiction behind
  // every question the pair happened to agree on.
  if (report.breaches.length > 0) return 1

  // "Nothing was measurable" must not exit 0. A green CI run that happened
  // because every call failed is the same silent-pass this tool exists to
  // catch, one level up.
  if (report.verdict.level === 'no-data') {
    console.error('argo diverge: no pair scored a single probe — measured nothing, so this is not a pass')
    return 2
  }

  return 0
}

/**
 * Default fleet: two configs on the same model. Deliberately boring — if two
 * identical configs disagree, nothing further up the stack is worth measuring.
 */
function loadAgents(file, defaultModel) {
  if (!file) {
    return [
      { name: 'agent-a', model: defaultModel },
      { name: 'agent-b', model: defaultModel },
    ]
  }
  const raw = readJson(file)
  if (!Array.isArray(raw)) throw new Error('agents file must be a JSON array')
  const seen = new Set()
  return raw.map((a, i) => {
    let name = String(a?.name ?? `agent-${i + 1}`)
    while (seen.has(name)) name = `${name}'`
    seen.add(name)
    return {
      name,
      model: a?.model ?? defaultModel,
      systemPrompt: a?.systemPrompt,
      appendPrompt: a?.appendPrompt,
    }
  })
}

function loadProbes(file) {
  return normaliseProbes(readJson(file))
}

/**
 * Read a JSON config file. Strips a UTF-8 BOM first, because PowerShell's
 * `Out-File -Encoding utf8` writes one and JSON.parse refuses it — which on
 * this platform is a config file a user wrote in the obvious way.
 */
function readJson(file) {
  const path = resolve(String(file))
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '')
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`${path} is not valid JSON — ${err.message}`)
  }
}

function generateProbes(root, limit) {
  const { graph, plan } = analyse(root)
  return defaultProbes({ plan, ranked: rankFiles(graph) }, { limit })
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
