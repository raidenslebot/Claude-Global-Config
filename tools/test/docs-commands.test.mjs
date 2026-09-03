// Every `cgc …` command written in a skill, a mandate or the README is an instruction a future
// session will follow literally. A flag that was renamed, or a command that was never there,
// fails at the moment somebody is trying to do the work — and reads as the tool being broken
// rather than the sentence being stale. This walks every markdown file in the package and
// checks each invocation against what the CLI actually accepts today.
//
// The CHANGELOG is excluded on purpose: it is a record of what WAS true, and a flag named in
// the entry that removed it is the entry doing its job.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'

const CGC = join(REPO, 'tools', 'cgc.mjs')
const ROOTS = ['skills', 'config', 'docs', 'README.md']

function markdown() {
  const out = []
  const walk = (p) => {
    let st
    try { st = statSync(p) } catch { return }
    if (st.isDirectory()) { for (const e of readdirSync(p)) if (e !== 'node_modules' && !e.startsWith('.')) walk(join(p, e)) }
    else if (/\.md$/i.test(p)) out.push(p)
  }
  for (const r of ROOTS) walk(join(REPO, r))
  return out
}

const help = (args) => {
  const r = spawnSync(process.execPath, [CGC, ...args], { encoding: 'utf8', timeout: 120000 })
  return (r.stdout || '') + (r.stderr || '')
}

test('every cgc command and flag written in the docs still exists', () => {
  const commands = new Set([...help(['--help']).matchAll(/^\s{2}([a-z][a-z-]+)\s{2,}\S/gm)].map((m) => m[1]))
  assert.ok(commands.size >= 15, `cgc --help listed only ${commands.size} commands`)

  const flags = new Map()
  const flagsOf = (cmd) => {
    if (!flags.has(cmd)) flags.set(cmd, new Set([...help([cmd, '--help']).matchAll(/--[a-z][a-z0-9-]*/gi)].map((m) => m[0])))
    return flags.get(cmd)
  }

  const problems = []
  let seen = 0
  for (const file of markdown()) {
    const where = relative(REPO, file).replace(/\\/g, '/')
    for (const [i, line] of readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
      for (const m of line.matchAll(/(?:^|[`\s(])cgc\s+([a-z][a-z-]+)((?:\s+[^`\n|]*)?)/g)) {
        seen++
        const cmd = m[1]
        if (!commands.has(cmd)) { problems.push(`${where}:${i + 1}  no such command: cgc ${cmd}`); continue }
        for (const f of (m[2] || '').matchAll(/(?:^|\s)(--[a-z][a-z0-9-]*)/gi)) {
          if (!flagsOf(cmd).has(f[1])) problems.push(`${where}:${i + 1}  cgc ${cmd} ${f[1]} — the tool does not document that flag`)
        }
      }
    }
  }
  assert.ok(seen >= 100, `only ${seen} documented invocations found — the scanner stopped seeing them`)
  assert.deepEqual([...new Set(problems)], [], 'documented commands that no longer work')
})

test('every --preset and --size named in the docs is a real one', async () => {
  // A preset name is as load-bearing as a flag: "cgc render --preset ig-post" is what a session
  // will type, and a renamed canvas fails at the moment somebody is using it.
  const { PRESETS: SCREEN } = await import('../screen-render.mjs')
  const { PRESETS: PRINT } = await import('../print-render.mjs')
  const problems = []
  for (const file of markdown()) {
    const where = relative(REPO, file).replace(/\\/g, '/')
    for (const [i, line] of readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
      for (const m of line.matchAll(/--preset\s+([a-z0-9][a-z0-9-]*)/gi)) {
        const name = m[1]
        // A placeholder is not a name; the docs write those in angle brackets or as a field.
        if (/^(name|field|preset)$/i.test(name)) continue
        if (!(name in SCREEN)) problems.push(`${where}:${i + 1}  --preset ${name} is not a screen canvas`)
      }
      for (const m of line.matchAll(/--size\s+([a-z][a-z0-9-]*)/gi)) {
        const name = m[1]
        if (/^(preset|name|size)$/i.test(name)) continue
        if (!(name in PRINT)) problems.push(`${where}:${i + 1}  --size ${name} is not a print preset`)
      }
    }
  }
  assert.deepEqual([...new Set(problems)], [], 'canvases and trim sizes named in the docs that do not exist')
})
