// Every command a shipped skill or mandate tells the reader to run must work in ANY project.
//
// This gate exists because the whole toolkit was, for a while, unusable outside this repository.
// The skills said `node tools/slop-lint.mjs page.html`, which is a path relative to THIS repo:
// in the user's other projects that file does not exist, so the lint, the audit and the renders
// failed, nothing was gated, and the design mandates fired over work nothing checked. The fix is
// the `cgc` command, linked globally at install; this test is what stops the relative form
// coming back.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'
import { COMMANDS } from '../cgc.mjs'

/** Every file a user reads or a model executes from: the skills, and the installed mandates. */
function shipped() {
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(md|html|css|svg|txt|json)$/.test(name)) out.push(p)
    }
  }
  walk(join(REPO, 'skills'))
  for (const m of readdirSync(join(REPO, 'config')).filter((f) => f.endsWith('.md'))) out.push(join(REPO, 'config', m))
  return out
}

const TOOL = /(?:node\s+(?:"[^"]*[/\\])?)?\btools[/\\](slop-lint|page-audit|screen-render|print-render|print-lint|outline-text|specimen|doctor|install|uninstall|sync|scan-secrets|run-tests)\.mjs/

test('no shipped skill or mandate tells the reader to run a path relative to this repo', () => {
  const offenders = []
  for (const f of shipped()) {
    // A skill may NAME a tool's file when explaining where something lives; what it must not do
    // is present it as a command. Both forms are caught: the node invocation and the bare path.
    readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (!TOOL.test(line)) return
      // The one legitimate use: an import inside an example's own generator, which runs from
      // its own directory inside this repo.
      if (/^\s*import\s|require\(/.test(line)) return
      offenders.push(`${f.slice(REPO.length + 1)}:${i + 1}  ${line.trim().slice(0, 100)}`)
    })
  }
  assert.deepEqual(offenders, [],
    'These commands resolve only inside this repository. Use the global `cgc` command:\n  ' + offenders.join('\n  '))
})

test('every cgc subcommand names a tool that ships, and the dispatcher runs it', () => {
  for (const [name, [file]] of Object.entries(COMMANDS)) {
    assert.ok(existsSync(join(REPO, 'tools', file)), `cgc ${name} → tools/${file} is missing`)
  }
  // The dispatcher itself, through node: --help lists every command and exits 0.
  const r = spawnSync(process.execPath, [join(REPO, 'tools', 'cgc.mjs'), '--help'], { encoding: 'utf8', timeout: 60000 })
  assert.equal(r.status, 0, r.stderr)
  for (const name of Object.keys(COMMANDS)) assert.match(r.stdout, new RegExp(`\\b${name}\\b`), `--help omits ${name}`)
  const bad = spawnSync(process.execPath, [join(REPO, 'tools', 'cgc.mjs'), 'nonsense'], { encoding: 'utf8', timeout: 60000 })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /unknown command/)
})

test('the package declares the bin that puts cgc on PATH', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
  assert.equal(pkg.bin && pkg.bin.cgc, 'tools/cgc.mjs', 'package.json must declare the cgc bin, or npm link installs nothing')
  assert.match(readFileSync(join(REPO, 'tools', 'cgc.mjs'), 'utf8'), /^#!\/usr\/bin\/env node/, 'a bin script needs its shebang for POSIX')
})

test('a subcommand forwards its arguments and its exit code', () => {
  const cgc = join(REPO, 'tools', 'cgc.mjs')
  // `lint` on a file that is not there says so AND exits non-zero — a gate that returns 0 for a
  // path it never read is worse than no gate, because a script believes it passed.
  const r = spawnSync(process.execPath, [cgc, 'lint', join(REPO, 'no-such-file-' + process.pid + '.html')], { encoding: 'utf8', timeout: 60000 })
  assert.match(r.stdout + r.stderr, /no such file/i)
  assert.equal(r.status, 1, 'a missing file must not exit 0')
  // The help names the command the reader actually has.
  const help = spawnSync(process.execPath, [cgc, 'lint', '--help'], { encoding: 'utf8', timeout: 60000 })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /cgc lint/)
})

test('every command is named somewhere the model will actually read it', async () => {
  // `cgc icons` and `cgc outline` existed and were named only in the README, which is the one
  // place nothing reads while working. A gate nobody is told to run is a gate that does not
  // exist, which is the same defect as the repo-relative paths this file was written for.
  const { COMMANDS } = await import('../cgc.mjs')
  const { readFileSync, readdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { REPO } = await import('../paths.mjs')

  // The mandate, the routing hooks, and every shipped skill: everywhere a command can reach
  // the model at the moment it is doing the work.
  const surfaces = [readFileSync(join(REPO, 'config', 'CLAUDE.md'), 'utf8')]
  const hookDir = join(REPO, 'config', 'hooks')
  for (const f of readdirSync(hookDir)) surfaces.push(readFileSync(join(hookDir, f), 'utf8'))
  const skills = join(REPO, 'skills')
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(md|js|mjs)$/.test(e.name)) surfaces.push(readFileSync(p, 'utf8'))
    }
  }
  walk(skills)
  const everywhere = surfaces.join('\n')

  // These four are how the package looks after itself, not design work the model is routed to.
  const plumbing = new Set(['doctor', 'install', 'uninstall', 'sync', 'scan', 'test', 'where', 'version'])
  const unrouted = Object.keys(COMMANDS).filter((k) => !plumbing.has(k) && !everywhere.includes(`cgc ${k}`))
  assert.deepEqual(unrouted, [],
    'these commands exist but nothing tells the model to run them: ' + unrouted.map((u) => `cgc ${u}`).join(', '))
})
