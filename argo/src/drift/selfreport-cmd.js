/**
 * `argo drift selfreport` — store and diff an agent's report of its own gates.
 *
 * Input arrives on stdin or from a file. The `/argo:selfprobe` slash command
 * drives this from inside a live Claude Code session, where the system prompt
 * is in context and no proxy or extra auth is needed.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRecord, diffSelfReports } from './selfreport.js'
import { readJson, storeDir } from './snapshot.js'

/**
 * Stored records are plain files on disk that a user can open and edit, so a
 * BOM or a truncated write must name the offending file rather than surface a
 * bare JSON.parse stack trace.
 */
function readRecord(file) {
  try {
    return readJson(file)
  } catch (e) {
    throw new Error(`unreadable self-report ${file}: ${e.message}`)
  }
}

const HELP = `
argo drift selfreport — record what the agent says gates its own delegation

  The shipped bundle does not contain prompt sections the service attaches at
  request time, and subscription auth refuses a custom base URL, so neither a
  bundle scan nor a loopback proxy can reach them. A running agent CAN: the
  system prompt is in its context. This stores that report and diffs it over
  time.

  It is a first-person report, not a byte capture. Treated as evidence with a
  source, and every stored record says so.

usage:
  argo drift selfreport [--file F | < report.txt]
  argo drift selfreport --list
  argo drift selfreport --diff

options:
  --file F           read the report from F instead of stdin
  --model ID         model that produced it, recorded with the capture
  --label X          note stored alongside ("2.1.232, opus 5")
  --dir PATH         repo whose .argo/ store to use                  [cwd]
  --list             stored reports, oldest first
  --diff             compare the two most recent
  --json             machine-readable output

format expected from the agent:
  one line per instruction, each prefixed "GATE: ", or the single word NONE

  Exit 1 when a gate is present, so CI can notice one appearing.

in a live session, run:  /argo:selfprobe
`.trim()

function reportDir(dir) {
  return join(storeDir(dir), 'selfreports')
}

function listFiles(dir) {
  const d = reportDir(dir)
  if (!existsSync(d)) return []
  return readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => join(d, f))
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

export async function cmdSelfReport(args, dir) {
  if (args.help) {
    console.log(HELP)
    return 0
  }
  // A corrupt record in the store is a user-fixable problem, so it exits 2
  // with the filename rather than a parse stack trace from the top level.
  try {
    if (args.list) return cmdList(args, dir)
    if (args.diff) return cmdDiff(args, dir)
  } catch (e) {
    console.error(`argo drift selfreport: ${e.message}`)
    return 2
  }

  const text = args.file ? readFileSync(String(args.file), 'utf8') : readStdin()
  if (!String(text).trim()) {
    console.error('argo drift selfreport: nothing on stdin and no --file given.\n')
    console.log(HELP)
    return 2
  }

  const record = buildRecord({
    text,
    model: args.model === true ? null : args.model ?? null,
    label: args.label === true ? '' : args.label ?? '',
  })

  const out = reportDir(dir)
  mkdirSync(out, { recursive: true })
  const file = join(out, `${record.capturedAt.replace(/[:.]/g, '-')}-${record.hash.slice(0, 8)}.json`)
  writeFileSync(file, JSON.stringify(record, null, 2) + '\n', 'utf8')

  if (args.json) {
    console.log(JSON.stringify({ ...record, file }, null, 2))
    return record.gates.length > 0 ? 1 : 0
  }

  console.log(`SELFREPORT ${record.capturedAt}${record.label ? `  "${record.label}"` : ''}`)
  console.log(`           model ${record.model ?? '(unreported)'} · hash ${record.hash}`)
  console.log('')

  if (record.declaredNone) {
    console.log(`GATES      none reported.`)
  } else {
    console.log(`GATES      ${record.gates.length} instruction(s) that name AND restrict a delegation mechanism`)
    for (const g of record.gates) {
      console.log(`\n  [${g.score}] ${g.text}`)
      console.log(`       mechanisms: ${g.mechanisms.join(', ')} · restrictions: ${g.restrictions.join(', ') || '(none)'}`)
    }
    if (record.mentions.length > 0) {
      console.log(`\nMENTIONS   ${record.mentions.length} named a mechanism without restricting it (not gates)`)
      for (const m of record.mentions.slice(0, 5)) console.log(`  - ${m.text.slice(0, 140)}`)
    }
  }

  console.log(`\nCONFIDENCE [${record.confidence.level}] ${record.confidence.note}`)
  console.log(`\nCAVEAT     ${record.caveat}`)
  console.log(`\nSTORED     ${file}`)

  if (record.gates.length > 0) {
    console.log(`\nACTION     A gate is present. Rewrite standing policy as NAMED requests`)
    console.log(`           ("use the graph-worker subagent"), not as general posture`)
    console.log(`           ("delegate multi-file work") — only the named form survives.`)
  }
  return record.gates.length > 0 ? 1 : 0
}

function cmdList(args, dir) {
  const files = listFiles(dir)
  if (args.json) {
    console.log(JSON.stringify(files.map(readRecord), null, 2))
    return 0
  }
  console.log(`SELFREPORTS in ${reportDir(dir)}  (oldest first)`)
  if (files.length === 0) {
    console.log('  (none — run /argo:selfprobe in a live session)')
    return 0
  }
  for (const f of files) {
    const r = readRecord(f)
    console.log(`  ${r.capturedAt}  gates ${String(r.gates.length).padStart(2)}  ` +
      `[${r.confidence.level}]  ${r.model ?? '?'}  ${r.label ?? ''}`)
  }
  return 0
}

function cmdDiff(args, dir) {
  const files = listFiles(dir)
  if (files.length < 2) {
    console.error(`argo drift selfreport --diff: need 2 reports, found ${files.length}`)
    return 2
  }
  const [a, b] = files.slice(-2).map(readRecord)
  const d = diffSelfReports(a, b)

  if (args.json) {
    console.log(JSON.stringify({ before: a.capturedAt, after: b.capturedAt, ...d }, null, 2))
    return d.added.length > 0 ? 1 : 0
  }

  console.log(`SELFREPORT DIFF  ${a.capturedAt} -> ${b.capturedAt}`)
  console.log(`                 ${a.model ?? '?'} -> ${b.model ?? '?'}`)
  console.log(`\nADDED     ${d.added.length}  <- a new restriction on your delegation`)
  for (const s of d.added) console.log(`  + ${s}`)
  console.log(`\nREMOVED   ${d.removed.length}`)
  for (const s of d.removed) console.log(`  - ${s}`)
  console.log(`\nUNCHANGED ${d.unchanged.length}`)

  console.log(
    d.added.length > 0
      ? `\nVERDICT [changed] delegation is more restricted than it was. Re-check that your fan-out still fires.`
      : `\nVERDICT [stable] no new delegation restrictions between these reports.`
  )
  return d.added.length > 0 ? 1 : 0
}
