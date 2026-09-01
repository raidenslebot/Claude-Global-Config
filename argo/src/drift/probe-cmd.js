/**
 * probe-cmd.js — the CLI around probe.js.
 *
 * `argo drift snapshot` reads the bundle on disk. That catches policy text the
 * vendor compiled into the client, and it is genuinely blind to a prompt section
 * the service attaches at request time — which is the shape the delegation gate
 * actually has. This command closes that gap by reading the request on its way
 * out of your own machine.
 *
 * Because that means standing a proxy in front of live, authenticated traffic,
 * the posture here is deliberately conservative:
 *
 *   - --dry-run is the documented first step and spawns nothing
 *   - the listener is loopback-only and dies with the command
 *   - ANTHROPIC_BASE_URL is set for the CHILD process only; nothing persistent
 *     is written to your settings, your shell, or your environment
 *   - captured records hold the system prompt and request metadata. Credential
 *     headers are forwarded upstream and never retained (see REDACT in probe.js),
 *     and your conversation content is counted, not stored.
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { spawnPlan, unsafeShimMessage } from '../spawn.js'
import {
  diffPrompts, policySentences, sections, startProxy, toolGateSentences,
} from './probe.js'
import { probeCliVersion, storeDir } from './snapshot.js'

const HELP = `
argo drift probe — capture the system prompt as the service actually delivers it

  snapshot reads the shipped bundle. A prompt section attached at request time
  is not in the bundle, so it cannot be caught there. This runs one throwaway
  turn through a loopback proxy and reads the system prompt off the wire.

  It proxies live authenticated traffic. Credential headers are forwarded and
  never stored; the conversation is counted, not kept; the listener binds
  127.0.0.1 and is torn down when the command exits.

  KNOWN LIMIT: subscription (OAuth) auth refuses a custom base URL — the CLI
  drops to "Not logged in" and nothing reaches the proxy. This path works on
  API-key auth. On a subscription, use \`argo drift selfreport\` instead.

usage:
  argo drift probe [--models a,b] [--dry-run]
  argo drift probe --list
  argo drift probe --diff A B

options:
  --models a,b       models to probe, comma separated  [whatever claude defaults to]
  --prompt TEXT      the throwaway turn to send        ["Reply with: ok"]
  --upstream URL     forward target            [https://api.anthropic.com]
  --pool N           concurrent probes                                  [4]
  --timeout MS       per-probe timeout                             [180000]
  --dir PATH         repo whose .argo/ store to use                   [cwd]
  --dry-run          print what would be invoked, capture nothing, spawn nothing
  --json             machine-readable output
  --list             list captured prompts
  --diff A B         section-level diff of two captured prompts

examples:
  argo drift probe --dry-run
  argo drift probe --models claude-opus-5,claude-sonnet-5
  argo drift probe --diff claude-opus-5 claude-sonnet-5
`.trim()

const DEFAULT_PROMPT = 'Reply with exactly: ok'
const DEFAULT_UPSTREAM = 'https://api.anthropic.com'

/** Captured prompts live beside the snapshots, in their own folder. */
function promptDir(dir) {
  return join(storeDir(dir), 'prompts')
}

function slug(s) {
  return String(s ?? 'default').replace(/[^\w.-]/g, '_')
}

export async function cmdProbe(args, dir) {
  if (args.help) {
    console.log(HELP)
    return 0
  }
  if (args.list) return listCaptures(args, dir)
  if (args.diff) return diffCaptures(args, dir)

  const models = String(args.models ?? args.model ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
  const targets = models.length > 0 ? models : [null]

  const prompt = typeof args.prompt === 'string' ? args.prompt : DEFAULT_PROMPT
  const upstream = typeof args.upstream === 'string' ? args.upstream : DEFAULT_UPSTREAM
  const timeout = args.timeout ?? 180000
  const dryRun = args['dry-run'] === true

  const cli = await probeCliVersion()
  const bin = cli.bin
  if (!bin && !dryRun) {
    console.error(`argo drift probe: ${cli.reason}`)
    return 2
  }

  if (dryRun) {
    const plan = targets.map((m) => ({
      model: m,
      command: `${bin ?? 'claude'} -p "${prompt}"${m ? ` --model ${m}` : ''} --output-format json`,
      env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:<ephemeral>' },
      upstream,
      wouldWrite: join(promptDir(dir), `${slug(m ?? 'default')}-<hash>.json`),
    }))
    if (args.json) {
      console.log(JSON.stringify({ dryRun: true, plan }, null, 2))
      return 0
    }
    console.log('DRY RUN — nothing spawned, no proxy started, nothing written\n')
    for (const p of plan) {
      console.log(`  model     ${p.model ?? '(client default)'}`)
      console.log(`  command   ${p.command}`)
      console.log(`  env       ANTHROPIC_BASE_URL=${p.env.ANTHROPIC_BASE_URL}  (child process only)`)
      console.log(`  upstream  ${p.upstream}`)
      console.log(`  writes    ${p.wouldWrite}`)
      console.log('')
    }
    console.log('Drop --dry-run to run it for real. One short turn per model is sent.')
    return 0
  }

  const results = await pool(targets, args.pool ?? 4, (model) =>
    captureOne({ model, prompt, upstream, timeout, bin, dir })
  )

  if (args.json) {
    console.log(JSON.stringify(results.map(stripText), null, 2))
  } else {
    console.log(renderProbe(results))
  }

  // Nothing captured means the proxy was bypassed — that is a failed probe, not
  // a clean result, and it must not read as "no drift found".
  return results.some((r) => r.captured) ? 0 : 1
}

/** Bounded concurrent runner. Results keep input order, so output is stable. */
async function pool(items, size, fn) {
  const out = new Array(items.length)
  let next = 0
  const width = Math.max(1, Math.min(size, items.length))
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (;;) {
        const i = next++
        if (i >= items.length) return
        out[i] = await fn(items[i], i)
      }
    })
  )
  return out
}

/**
 * One probe: stand up a proxy, run one turn through it, keep the first
 * /v1/messages system prompt we see.
 */
async function captureOne({ model, prompt, upstream, timeout, bin, dir }) {
  const seen = []
  let proxy = null
  try {
    proxy = await startProxy({
      upstream,
      timeout,
      onCapture: (rec) => {
        if (seen.length < 4) seen.push(rec)
      },
    })
  } catch (err) {
    return { model, captured: false, error: `could not start proxy: ${err?.message ?? err}` }
  }

  let stderr = ''
  let exitCode = null
  try {
    const argv = ['-p', prompt, '--output-format', 'json']
    if (model) argv.push('--model', model)

    // No shell. The prompt reaches argv here, so a quote inside it would let
    // cmd.exe append commands to a call already carrying live credentials.
    const plan = spawnPlan(bin, argv)
    if (plan.unsafe !== null) {
      return { model, captured: false, error: unsafeShimMessage(plan) }
    }

    await new Promise((res) => {
      const child = execFile(
        plan.file,
        plan.args,
        {
          timeout,
          maxBuffer: 32 * 1024 * 1024,
          windowsHide: true,
          env: { ...process.env, ANTHROPIC_BASE_URL: proxy.url },
        },
        (err, _stdout, errOut) => {
          stderr = String(errOut ?? '').slice(0, 400)
          exitCode = err?.code ?? 0
          res()
        }
      )
      child.on('error', () => res())
    })
  } finally {
    // The listener carries live credentials in flight. It does not outlive the
    // command under any exit path.
    await proxy.close()
  }

  const first = seen[0]
  if (!first) {
    return {
      model,
      captured: false,
      exitCode,
      error:
        'no /v1/messages request reached the proxy. The client may ignore ' +
        'ANTHROPIC_BASE_URL on this auth mode, or the turn failed before sending. ' +
        (stderr ? `stderr: ${stderr}` : ''),
    }
  }

  const record = {
    capturedAt: new Date().toISOString(),
    model: model ?? first.model ?? null,
    reportedModel: first.model ?? null,
    stream: first.stream,
    messageCount: first.messageCount,
    toolNames: [...(first.toolNames ?? [])].sort(),
    systemChars: first.systemChars,
    systemBlocks: first.systemBlocks.map((b) => ({
      index: b.index,
      cached: b.cached,
      chars: b.chars,
    })),
    systemText: first.systemText,
    requestsSeen: seen.length,
  }
  record.hash = createHash('sha256').update(record.systemText).digest('hex')
  record.sections = sections(record.systemText).map((s) => ({
    heading: s.heading,
    chars: s.chars,
    hash: s.hash,
  }))
  record.policySentences = policySentences(record.systemText)
  record.toolGateSentences = toolGateSentences(record.systemText)

  const out = promptDir(dir)
  mkdirSync(out, { recursive: true })
  const file = join(out, `${slug(record.model ?? 'default')}-${record.hash.slice(0, 8)}.json`)
  writeFileSync(file, JSON.stringify(record, null, 2) + '\n', 'utf8')

  return { model: record.model, captured: true, file, record }
}

/** JSON output carries the analysis, not the whole prompt body. */
function stripText(r) {
  if (!r?.record) return r
  const { systemText, ...rest } = r.record
  return { ...r, record: rest }
}

function renderProbe(results) {
  const L = []
  for (const r of results) {
    L.push(`PROBE  ${r.model ?? '(client default)'}`)
    if (!r.captured) {
      L.push(`       FAILED — ${r.error}`)
      L.push('')
      continue
    }
    const rec = r.record
    L.push(`       ${rec.systemChars.toLocaleString()} chars · ${rec.systemBlocks.length} block(s) · ` +
      `${rec.sections.length} section(s) · hash ${rec.hash.slice(0, 12)}`)
    L.push(`       tools offered: ${rec.toolNames.length}${rec.toolNames.length ? ` (${rec.toolNames.slice(0, 8).join(', ')}${rec.toolNames.length > 8 ? ', ...' : ''})` : ''}`)
    L.push('')
    L.push(`       SECTIONS`)
    for (const s of rec.sections.slice(0, 20)) {
      L.push(`         ${String(s.chars).padStart(6)}  ${s.hash}  ${s.heading}`)
    }
    if (rec.sections.length > 20) L.push(`         ... and ${rec.sections.length - 20} more`)
    L.push('')
    L.push(`       TOOL-GATE SENTENCES (${rec.toolGateSentences.length})`)
    for (const s of rec.toolGateSentences.slice(0, 10)) L.push(`         ${clip(s)}`)
    if (rec.toolGateSentences.length === 0) L.push(`         (none naming a delegation tool)`)
    L.push('')
    L.push(`       POLICY SENTENCES (${rec.policySentences.length})`)
    for (const s of rec.policySentences.slice(0, 10)) L.push(`         ${clip(s)}`)
    if (rec.policySentences.length > 10) L.push(`         ... and ${rec.policySentences.length - 10} more`)
    L.push('')
    L.push(`       STORED ${r.file}`)
    L.push('')
  }
  L.push(`Re-run after an upgrade, then \`argo drift probe --diff A B\`.`)
  return L.join('\n')
}

function clip(s) {
  return s.length > 140 ? s.slice(0, 137) + '...' : s
}

/* ------------------------------------------------------------------ *
 * list / diff over captured prompts
 * ------------------------------------------------------------------ */

function loadCaptures(dir) {
  const out = promptDir(dir)
  if (!existsSync(out)) return []
  const rows = []
  for (const name of readdirSync(out).sort()) {
    if (!name.endsWith('.json')) continue
    const file = join(out, name)
    try {
      const rec = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
      rows.push({ id: name.replace(/\.json$/, ''), file, rec })
    } catch {
      // a hand-edited capture should not break the listing
    }
  }
  return rows.sort((a, b) =>
    a.rec.capturedAt < b.rec.capturedAt ? 1 : a.rec.capturedAt > b.rec.capturedAt ? -1 : 0
  )
}

function listCaptures(args, dir) {
  const rows = loadCaptures(dir)
  if (args.json) {
    console.log(JSON.stringify(rows.map((r) => ({ id: r.id, file: r.file, ...stripRec(r.rec) })), null, 2))
    return 0
  }
  if (rows.length === 0) {
    console.log(`no captured prompts in ${promptDir(dir)} — run \`argo drift probe\``)
    return 0
  }
  console.log(`CAPTURED PROMPTS in ${promptDir(dir)}  (newest first)`)
  console.log(`  captured              model                 chars   sections  policy  id`)
  for (const r of rows) {
    const c = r.rec
    console.log(
      `  ${(c.capturedAt || '').slice(0, 19).padEnd(21)} ${String(c.model ?? '-').padEnd(21)} ` +
        `${String(c.systemChars).padStart(6)}  ${String(c.sections?.length ?? 0).padStart(8)}  ` +
        `${String(c.policySentences?.length ?? 0).padStart(6)}  ${r.id}`
    )
  }
  return 0
}

function stripRec(rec) {
  const { systemText, ...rest } = rec
  return rest
}

function findCapture(rows, ref) {
  const key = String(ref)
  const exact = rows.filter((r) => r.id === key || r.rec.model === key)
  if (exact.length >= 1) return exact[0]
  const partial = rows.filter((r) => r.id.includes(key))
  if (partial.length === 1) return partial[0]
  if (partial.length > 1) return { error: `"${ref}" matches ${partial.length} captures` }
  return { error: `no capture matching "${ref}"` }
}

function diffCaptures(args, dir) {
  const rows = loadCaptures(dir)
  if (rows.length < 2) {
    console.error('argo drift probe: need two captured prompts to diff')
    return 2
  }
  const refA = args.diff === true ? null : args.diff
  const refB = args._[1] ?? null
  const a = refA ? findCapture(rows, refA) : rows[1]
  const b = refB ? findCapture(rows, refB) : rows[0]
  if (a.error) return failProbe(a.error)
  if (b.error) return failProbe(b.error)

  const d = diffPrompts(a.rec.systemText, b.rec.systemText)
  if (args.json) {
    console.log(JSON.stringify({ from: a.id, to: b.id, ...d }, null, 2))
  } else {
    console.log(renderPromptDiff(d, a, b))
  }
  return d.policyAdded.length > 0 ? 1 : 0
}

function failProbe(msg) {
  console.error(`argo drift probe: ${msg}`)
  return 2
}

function renderPromptDiff(d, a, b) {
  const L = []
  L.push(`PROMPT DRIFT  ${a.id}`)
  L.push(`          ->  ${b.id}`)
  L.push(`       ${d.charsBefore.toLocaleString()} chars -> ${d.charsAfter.toLocaleString()} chars`)
  L.push('')
  L.push(`SECTIONS +${d.added.length} / -${d.removed.length} / ~${d.changed.length}`)
  for (const s of d.added) L.push(`       + ${s.heading} (${s.chars} chars)`)
  for (const s of d.removed) L.push(`       - ${s.heading} (${s.chars} chars)`)
  for (const c of d.changed) {
    L.push(`       ~ ${c.heading} (${c.before.chars} -> ${c.after.chars} chars)`)
  }
  L.push('')
  L.push(`POLICY ${d.policyAdded.length} added / ${d.policyRemoved.length} removed`)
  for (const s of d.policyAdded) L.push(`       + ${clip(s)}`)
  for (const s of d.policyRemoved.slice(0, 10)) L.push(`       - ${clip(s)}`)
  L.push('')
  L.push(
    d.policyAdded.length > 0
      ? `VERDICT [gated] the delivered prompt gained ${d.policyAdded.length} imperative sentence(s).`
      : `VERDICT [stable] no new imperative sentence in the delivered prompt.`
  )
  return L.join('\n')
}

export { promptDir }
