/**
 * `argo drift` — detect when your vendor changes the agent under you.
 *
 * Your agent's behaviour can change without you changing anything. A vendor
 * ships a line into a system prompt, a default flips, a tool gets gated by
 * model — and your fan-out quietly stops firing.
 *
 * The concrete case this exists for: a line like "Do not call the AgentTool
 * unless the user requested it" appearing in a shipped build between two patch
 * versions, with no setting, flag, or env var, changes whether delegation fires
 * at all. Session logs never record a system prompt, so your own logs will say
 * nothing happened. Graph engineering is about which agents may talk to which —
 * and that edge was cut by someone else's release.
 *
 * So: keep a before/after you control. Hash the install, harvest the English
 * inside it, record your own config surface, and diff two of those.
 */

import { join, relative, resolve } from 'node:path'
import { diffSnapshots, snapshotVersion } from './extract.js'
import {
  captureSnapshot, claudeBinCandidates, listSnapshots, loadSnapshot,
  resolveRef, saveSnapshot, storeDir,
} from './snapshot.js'

const HELP = `
argo drift — snapshot and diff the agent build you depend on

  A shipped line of policy text changes what your agents do, and leaves no
  trace in any log you own. This keeps a before/after that you control.

usage:
  argo drift snapshot [--label X]     fingerprint the installed agent + your config
  argo drift diff [A] [B]             compare two snapshots (default: last two)
  argo drift list                     stored snapshots, newest first

snapshot options:
  --label X          note stored with the snapshot ("before the 2.1.5 upgrade")
  --dir PATH         repo whose .argo/ store and local config to use   [cwd]
  --limit N          max prose strings kept from the bundle           [20000]
  --bundles N        how many of the largest files to read strings from   [2]
  --dry-run          resolve everything and report, but spawn nothing and
                     write nothing
  --json             snapshot summary as JSON

diff options:
  --dir PATH         store to read from                                [cwd]
  --policy-only      only show imperative additions ("do not", "unless the user")
  --top N            max strings printed per section                     [40]
  --json             full diff as JSON

  A and B accept: latest, previous, a snapshot id, or any unambiguous part of
  one. With neither, the two most recent are used, oldest first.

  Exit 1 when policy-shaped strings were ADDED — so CI can gate on it.

binary resolution:
  ARGO_CLAUDE_BIN wins, then %APPDATA%\\npm\\claude.cmd, then claude on PATH.
  A machine with no install still snapshots its own config surface.

examples:
  argo drift snapshot --label "before upgrade"
  argo drift list
  argo drift diff                       # last two
  argo drift diff 2.1.201 2.1.232 --policy-only
`.trim()

export async function run(args) {
  const sub = args._[0] ?? 'snapshot'
  const dir = resolve(args.dir ?? process.cwd())

  // probe carries its own help text and its own safety notes, so it takes
  // --help before the shared handler does.
  if (sub === 'probe') return (await import('./probe-cmd.js')).cmdProbe(args, dir)
  if (sub === 'selfreport') return (await import('./selfreport-cmd.js')).cmdSelfReport(args, dir)

  if (args.help) {
    console.log(HELP)
    return 0
  }

  if (sub === 'snapshot') return cmdSnapshot(args, dir)
  if (sub === 'diff') return cmdDiff(args, dir)
  if (sub === 'list') return cmdList(args, dir)

  console.error(`argo drift: unknown subcommand "${sub}"\n`)
  console.log(HELP)
  return 2
}

/* ------------------------------------------------------------------ *
 * snapshot
 * ------------------------------------------------------------------ */

async function cmdSnapshot(args, dir) {
  const dryRun = args['dry-run'] === true
  const snap = await captureSnapshot({
    projectDir: dir,
    label: args.label === true ? null : args.label ?? null,
    limit: args.limit ?? 20000,
    bundles: args.bundles ?? 2,
    dryRun,
  })

  let file = null
  if (dryRun) {
    if (!args.json) {
      console.log(`DRY RUN would invoke: ${claudeBinCandidates()[0]} --version`)
      console.log(`DRY RUN would write:  ${join(storeDir(dir), snap.id + '.json')}`)
      console.log('')
    }
  } else {
    file = saveSnapshot(dir, snap)
  }

  if (args.json) {
    console.log(JSON.stringify({ ...summary(snap), file, dryRun }, null, 2))
    return 0
  }

  console.log(renderSnapshot(snap, { file, dryRun }))
  return 0
}

function summary(snap) {
  return {
    id: snap.id,
    capturedAt: snap.capturedAt,
    label: snap.label,
    fingerprint: snap.fingerprint,
    platform: snap.platform,
    install: {
      found: snap.install.found,
      source: snap.install.source,
      root: snap.install.root,
      packageVersion: snap.install.packageVersion,
      cliVersion: snap.install.cliVersion,
      fileCount: snap.install.files.length,
      bundlesRead: snap.install.bundlesRead,
      reason: snap.install.reason ?? null,
    },
    strings: {
      count: snap.strings.count,
      scannedBytes: snap.strings.scannedBytes,
      truncated: snap.strings.truncated,
    },
    config: { root: snap.config.root, entries: snap.config.entries.length },
  }
}

/** Human-readable capture report. */
export function renderSnapshot(snap, { file = null, dryRun = false } = {}) {
  const L = []
  const i = snap.install
  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`

  L.push(`SNAP   ${snap.id}${snap.label ? `  "${snap.label}"` : ''}`)
  L.push(`       ${snap.capturedAt} · ${snap.platform} · fingerprint ${snap.fingerprint.slice(0, 16)}`)
  L.push('')

  if (!i.found) {
    L.push(`INSTALL not found — ${i.reason ?? 'no candidate path exists'}`)
    L.push(`       set ARGO_CLAUDE_BIN to the binary if it lives somewhere unusual`)
  } else {
    L.push(`INSTALL ${i.root}`)
    L.push(
      `       source ${i.source} · package ${i.packageVersion ?? '?'} · cli ${i.cliVersion ?? '?'}`
    )
    // The two versions disagreeing means the binary you run is not the one npm
    // thinks is installed. That is drift you would otherwise never see.
    if (i.packageVersion && i.cliVersion && i.packageVersion !== i.cliVersion) {
      L.push(
        `       <-- MISMATCH: package.json says ${i.packageVersion}, the binary on PATH reports ` +
          `${i.cliVersion}. You are not running what npm installed.`
      )
    }
    L.push(`       ${i.files.length} files hashed${i.skipped.length ? `, ${i.skipped.length} skipped` : ''}`)
    for (const b of i.bundlesRead) L.push(`       read ${b.path} (${mb(b.bytes)})`)
    for (const o of i.otherRoots) L.push(`       also present: ${o.path} (${o.source})`)
  }
  L.push('')

  L.push(`PROSE  ${snap.strings.count} English strings from ${mb(snap.strings.scannedBytes)} of bundle`)
  if (snap.strings.truncated) {
    L.push(`       <-- hit the --limit of ${snap.strings.limit}; raise it or diffs will lie`)
  }
  const policyish = snap.strings.items.filter((s) => /\b(do not|never|always|unless the user|only when|avoid)\b/i.test(s))
  L.push(`       ${policyish.length} of them are imperative — those are the ones that gate behaviour`)
  L.push('')

  L.push(`CONFIG ${snap.config.root}`)
  for (const e of snap.config.entries.slice(0, 12)) {
    L.push(`       ${e.sha256.slice(0, 8)}  ${e.path}`)
  }
  if (snap.config.entries.length > 12) {
    L.push(`       ... and ${snap.config.entries.length - 12} more`)
  }
  for (const n of snap.config.notes) L.push(`       note: ${n}`)
  L.push('')

  if (dryRun) L.push(`DRY RUN nothing written. Drop --dry-run to store this snapshot.`)
  else L.push(`STORED ${file}`)
  L.push('')
  L.push(`NEXT   upgrade, re-run \`argo drift snapshot\`, then \`argo drift diff\`.`)
  L.push('')
  L.push(`LIMIT  this reads the SHIPPED BUNDLE. Prompt sections delivered at runtime`)
  L.push(`       by the service are not in it and cannot be caught here — the known`)
  L.push(`       AgentTool delegation gate is one of those. Catch those behaviourally:`)
  L.push(`       run one delegating task on two models and count the child tasks that`)
  L.push(`       start. A difference is the gate, not the task.`)
  return L.join('\n')
}

/* ------------------------------------------------------------------ *
 * diff
 * ------------------------------------------------------------------ */

async function cmdDiff(args, dir) {
  const rows = listSnapshots(dir)
  if (rows.length === 0) {
    console.error(`argo drift: no snapshots in ${storeDir(dir)} — run \`argo drift snapshot\` first`)
    return 2
  }

  let aRow
  let bRow
  if (args._.length >= 3) {
    const a = resolveRef(dir, args._[1])
    const b = resolveRef(dir, args._[2])
    if (a.error) return fail(a.error)
    if (b.error) return fail(b.error)
    aRow = a.row
    bRow = b.row
  } else if (args._.length === 2) {
    // One id given: compare it against the newest. Naming the newest itself is
    // read as "what changed on the way here", so step the older side back one.
    const a = resolveRef(dir, args._[1])
    if (a.error) return fail(a.error)
    aRow = a.row
    bRow = rows[0]
    if (aRow.id === bRow.id) {
      if (rows.length < 2) return fail(`${aRow.id} is the only snapshot stored`)
      aRow = rows[1]
    }
  } else {
    if (rows.length < 2) {
      console.error(
        'argo drift: only one snapshot stored. Take another after the next upgrade, ' +
          'then diff them.'
      )
      return 2
    }
    aRow = rows[1]
    bRow = rows[0]
  }

  if (aRow.id === bRow.id) return fail(`both sides resolve to the same snapshot (${aRow.id})`)

  const a = loadSnapshot(aRow.file)
  const b = loadSnapshot(bRow.file)
  const d = diffSnapshots(a, b)

  if (args.json) {
    console.log(JSON.stringify(d, null, 2))
  } else {
    console.log(renderDiff(d, a, b, {
      policyOnly: args['policy-only'] === true,
      top: args.top ?? 40,
    }))
  }

  // A policy-shaped addition is the failure condition: something now tells the
  // agent not to do a thing it used to do.
  return d.policyAdded.length > 0 ? 1 : 0
}

function fail(msg) {
  console.error(`argo drift: ${msg}`)
  return 2
}

/** Human-readable diff report. */
export function renderDiff(d, a, b, { policyOnly = false, top = 40 } = {}) {
  const L = []
  const clip = (s) => (s.length > 150 ? s.slice(0, 147) + '...' : s)

  L.push(`DRIFT  ${a.id}`)
  L.push(`   ->  ${b.id}`)
  L.push(`       ${a.capturedAt}  ->  ${b.capturedAt}`)
  L.push('')

  L.push(`VERSION`)
  if (d.versionChanged) {
    L.push(`       ${d.versionChanged.from ?? '?'}  ->  ${d.versionChanged.to ?? '?'}`)
  } else {
    L.push(`       unchanged (${snapshotVersion(b) ?? 'unknown'})`)
  }
  if (d.cliVersionChanged) {
    L.push(`       cli reports ${d.cliVersionChanged.from ?? '?'}  ->  ${d.cliVersionChanged.to ?? '?'}`)
  }
  L.push('')

  L.push(`BINARY ${d.hashChanged.length} file hash change(s)`)
  for (const h of d.hashChanged.slice(0, top)) {
    const from = h.from ? h.from.slice(0, 8) : '--------'
    const to = h.to ? h.to.slice(0, 8) : '--------'
    L.push(`       ${h.status.padEnd(7)} ${from} -> ${to}  ${h.path}`)
  }
  if (d.hashChanged.length > top) L.push(`       ... and ${d.hashChanged.length - top} more`)
  L.push('')

  L.push(`CONFIG ${d.configChanged.length} change(s) in your own surface`)
  for (const c of d.configChanged.slice(0, top)) {
    L.push(`       ${c.status.padEnd(7)} ${c.path}`)
  }
  L.push('')

  L.push(`POLICY ${d.policyAdded.length} imperative string(s) ADDED — these change behaviour silently`)
  if (d.policyAdded.length === 0) L.push('       (none — nothing new tells the agent to hold back)')
  for (const p of d.policyAdded.slice(0, top)) {
    L.push(`       + [${p.patterns.join(', ')}]`)
    L.push(`         ${clip(p.text)}`)
  }
  if (d.policyAdded.length > top) L.push(`       ... and ${d.policyAdded.length - top} more`)
  L.push('')

  if (d.policyRemoved.length > 0) {
    L.push(`       ${d.policyRemoved.length} imperative string(s) REMOVED`)
    for (const p of d.policyRemoved.slice(0, Math.min(top, 10))) {
      L.push(`       - ${clip(p.text)}`)
    }
    L.push('')
  }

  if (!policyOnly) {
    L.push(`PROSE  +${d.added.length} / -${d.removed.length} English strings`)
    for (const s of d.added.slice(0, top)) L.push(`       + ${clip(s)}`)
    if (d.added.length > top) L.push(`       ... and ${d.added.length - top} more added`)
    for (const s of d.removed.slice(0, Math.min(top, 10))) L.push(`       - ${clip(s)}`)
    if (d.removed.length > 10) L.push(`       ... and ${d.removed.length - 10} more removed`)
    L.push('')
  }

  if (d.truncated) {
    L.push(`WARN   one side hit the string --limit. Additions and removals past the cap are`)
    L.push(`       artefacts of the cap, not the vendor. Re-snapshot with a higher --limit.`)
    L.push('')
  }

  L.push(`VERDICT ${verdict(d)}`)
  return L.join('\n')
}

function verdict(d) {
  if (d.policyAdded.length > 0) {
    const pats = new Set()
    for (const p of d.policyAdded) for (const x of p.patterns) pats.add(x)
    return (
      `[gated] ${d.policyAdded.length} new imperative string(s) (${[...pats].sort().join(', ')}). ` +
      `Re-run your fan-out benchmark before trusting the topology you had.`
    )
  }
  if (d.hashChanged.length > 0 || d.versionChanged) {
    return (
      `[changed] the build moved but no new imperative prose landed. ` +
      `Behaviour probably held; the hashes tell you it is not the same binary.`
    )
  }
  if (d.configChanged.length > 0) {
    return `[local] the vendor build is identical — the drift is in your own config.`
  }
  return `[stable] nothing moved.`
}

/* ------------------------------------------------------------------ *
 * list
 * ------------------------------------------------------------------ */

async function cmdList(args, dir) {
  const rows = listSnapshots(dir)
  if (args.json) {
    console.log(JSON.stringify(rows, null, 2))
    return 0
  }
  if (rows.length === 0) {
    console.log(`no snapshots in ${storeDir(dir)} — run \`argo drift snapshot\``)
    return 0
  }
  console.log(`SNAPSHOTS in ${storeDir(dir)}  (newest first)`)
  console.log(`  captured              id                            pkg        cli        strings  label`)
  for (const r of rows) {
    console.log(
      `  ${(r.capturedAt || '').slice(0, 19).padEnd(21)} ${r.id.padEnd(29)} ` +
        `${String(r.packageVersion ?? '-').padEnd(10)} ${String(r.cliVersion ?? '-').padEnd(10)} ` +
        `${String(r.strings).padStart(7)}  ${r.label ?? ''}`
    )
  }
  console.log('')
  console.log(`  ${rows.length} snapshot(s) · store is ${relative(process.cwd(), storeDir(dir)) || '.'}`)
  return 0
}
