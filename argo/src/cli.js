#!/usr/bin/env node
/**
 * argo — Graph Engineering toolkit.
 *
 * Measure the topology of a repo and an agent fleet before paying for either.
 *
 *   argo graph     [path]   fan-out plan: hubs, partitions, shared surface
 *   argo diverge            ask N agents the same thing, score how far apart they land
 *   argo baseline           solo vs crew on a real task list; is the crew earning its calls
 *   argo drift              snapshot and diff the agent build you depend on
 *   argo topology           declare the agent graph, lint it, render it
 *   argo watch              sourcing monitors for the research loop
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))

const COMMANDS = {
  graph:    { module: './graph/cmd.js',    blurb: 'repo dependency graph -> fan-out plan' },
  diverge:  { module: './divergence/cmd.js', blurb: 'measure pairwise divergence across your agents' },
  baseline: { module: './baseline/cmd.js', blurb: 'solo vs crew — is the fan-out earning its calls' },
  drift:    { module: './drift/cmd.js',    blurb: 'detect when your vendor changes the agent under you' },
  topology: { module: './topology/cmd.js', blurb: 'declare, lint and render the agent graph' },
  watch:    { module: './watch/cmd.js',    blurb: 'monitor sources for findings worth replicating' },
  doctor:   { module: './doctor/cmd.js',   blurb: 'run the whole chain, return one prioritised verdict' },
}

const HELP = `
argo — Graph Engineering toolkit

  prompt engineering   what one agent is told
  context engineering  what one agent can see
  graph engineering    which agents may talk to which   <- this tool

usage: argo <command> [options]

commands:
${Object.entries(COMMANDS)
  .map(([name, c]) => `  ${name.padEnd(10)} ${c.blurb}`)
  .join('\n')}

  argo <command> --help    options for one command

global:
  --json                   machine-readable output
  --version
`.trim()

/** Minimal flag parser: --key=value, --key value, --bool, -x. */
export function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const body = arg.slice(2)
      const eq = body.indexOf('=')
      if (eq !== -1) {
        out[body.slice(0, eq)] = coerce(body.slice(eq + 1))
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        out[body] = coerce(argv[++i])
      } else {
        out[body] = true
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      out[arg.slice(1)] = true
    } else {
      out._.push(arg)
    }
  }
  return out
}

function coerce(v) {
  if (v === 'true') return true
  if (v === 'false') return false
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v)
  return v
}

async function main() {
  const argv = process.argv.slice(2)
  const args = parseArgs(argv)

  if (args.version) {
    const pkg = JSON.parse(
      await import('node:fs/promises').then((fs) => fs.readFile(join(HERE, '..', 'package.json'), 'utf8'))
    )
    console.log(pkg.version)
    return
  }

  const command = args._[0]
  if (!command || args.help === true && !command) {
    console.log(HELP)
    return
  }

  const entry = COMMANDS[command]
  if (!entry) {
    console.error(`argo: unknown command "${command}"\n`)
    console.log(HELP)
    process.exitCode = 2
    return
  }

  const modulePath = join(HERE, entry.module)
  if (!existsSync(modulePath)) {
    console.error(`argo: "${command}" is not built yet (${entry.module} missing).`)
    process.exitCode = 3
    return
  }

  const mod = await import(entry.module)
  const rest = { ...args, _: args._.slice(1) }
  // The raw argv after the command, for the few commands where token ORDER
  // carries meaning that the parsed shape loses (graph --touch).
  const code = await mod.run(rest, argv.slice(argv.indexOf(command) + 1))
  if (typeof code === 'number') process.exitCode = code
}

main().catch((err) => {
  console.error(`argo: ${err?.stack ?? err}`)
  process.exitCode = 1
})
