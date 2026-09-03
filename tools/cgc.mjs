#!/usr/bin/env node
// cgc — the design toolkit, from any directory.
//
// Every gate this package installs used to be written `node tools/slop-lint.mjs page.html`,
// which is a path relative to THIS repository. In any other project that file does not exist:
// the command fails, the gate never runs, and the work ships unchecked — the design mandates
// fire, nothing verifies them, and the output is exactly what they exist to prevent. So the
// tools are exposed as one command, linked globally at install, and the skills name that.
//
//   cgc lint <file|dir…>              the fingerprint of AI-made screen design
//   cgc audit <file|url> [--mobile]   the rendered page measured (contrast, faces, tap targets…)
//   cgc render <file|url> [--mobile]  screenshots at the widths people use, or --preset <canvas>
//   cgc print <file…>                 paper and fabric: PDF at trim+bleed, PNG proof, mockup
//   cgc print-lint <file|dir…>        the press-readiness gate
//   cgc outline --font <f> --text <s>  text as one SVG path, no font needed
//   cgc specimen --display <f> --text <f>  a pairing and a palette, set and rendered
//   cgc doctor · install · uninstall · sync · scan · test · where · version
//
// Every subcommand takes the flags its tool documents; `cgc <name> --help` prints them.

import { spawnSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, realpathSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

// name → [module, one-line description]. The order is the order `cgc` prints.
export const COMMANDS = {
  lint: ['slop-lint.mjs', 'the fingerprint of AI-made screen design'],
  audit: ['page-audit.mjs', 'the rendered page, measured'],
  techniques: ['techniques.mjs', 'what a piece reaches for, and the capabilities it never tried'],
  motion: ['motion-render.mjs', 'step an animation under a virtual clock and photograph every frame'],
  render: ['screen-render.mjs', 'screenshots at real widths, or an exact canvas'],
  print: ['print-render.mjs', 'paper and fabric: PDF, PNG proof, garment mockup'],
  'print-lint': ['print-lint.mjs', 'the press-readiness gate'],
  outline: ['outline-text.mjs', 'text as one SVG path'],
  specimen: ['specimen.mjs', 'a pairing and a palette, set for real'],
  doctor: ['doctor.mjs', 'verify this install'],
  install: ['install.mjs', 'apply the config to this machine'],
  uninstall: ['uninstall.mjs', 'remove what install wrote'],
  sync: ['sync.mjs', 'live config → repo'],
  scan: ['scan-secrets.mjs', 'the secret scanner'],
  test: ['run-tests.mjs', "the package's own tests"],
}

const HELP = `cgc — the design toolkit, from any directory

usage:
  cgc <command> [args…]        every command takes the flags its tool documents
  cgc <command> --help         those flags

${Object.entries(COMMANDS).map(([k, [, d]]) => `  ${k.padEnd(11)} ${d}`).join('\n')}
  where       print this package's directory
  version     print its version

The loop: cgc render page.html --mobile · look · cgc lint page.html · cgc audit page.html --mobile
`

export function main(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') { console.log(HELP); return cmd ? 0 : 1 }
  if (cmd === 'where') { console.log(REPO); return 0 }
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
    try { console.log(JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version) } catch { console.log('?') }
    return 0
  }
  const entry = COMMANDS[cmd]
  if (!entry) {
    console.error(`cgc: unknown command "${cmd}". One of: ${Object.keys(COMMANDS).join(', ')}, where, version.`)
    return 1
  }
  // Spawned rather than imported: each tool owns its own exit code, and a tool that calls
  // process.exit must not take this dispatcher's process down mid-report.
  const r = spawnSync(process.execPath, [join(HERE, entry[0]), ...rest], { stdio: 'inherit', windowsHide: true })
  if (r.error) { console.error(`cgc: could not run ${entry[0]} — ${r.error.message}`); return 1 }
  return r.status === null ? 1 : r.status
}

// Only when this file IS the process's entry: an unguarded call ran the dispatcher on import,
// which took down the first test that tried to read its command table. Real paths, so the npm
// shim (which invokes the linked copy) still counts as the entry.
const isEntry = (() => {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false }
})()
if (isEntry) process.exit(main())
