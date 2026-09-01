// Anything with a shebang must be stored and checked out with LF endings.
//
// On Linux the kernel reads the shebang up to the newline, so `#!/usr/bin/env bash\r` names an
// interpreter called "bash\r" and the script dies with "bad interpreter". install.sh and the
// git pre-commit hook are exactly such files, and on the origin machine both sat in the working
// tree as CRLF because core.autocrlf=true and no .gitattributes said otherwise. That was
// harmless there (MSYS bash tolerates CR) and would have been fatal on a POSIX clone made by a
// contributor with autocrlf off. .gitattributes is the fix; this is the gate that keeps it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, openSync, readSync, closeSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'

function git(...args) {
  const r = spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout : null
}

function head(file, n = 256) {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(n)
    const got = readSync(fd, buf, 0, n, 0)
    return buf.subarray(0, got).toString('latin1')
  } finally {
    closeSync(fd)
  }
}

const tracked = (git('ls-files', '-z') ?? '').split('\0').filter(Boolean)
const shebang = tracked.filter((f) => existsSync(join(REPO, f)) && head(join(REPO, f), 2) === '#!')

test('.gitattributes pins LF for shell scripts and git hooks', () => {
  const p = join(REPO, '.gitattributes')
  assert.ok(existsSync(p), '.gitattributes is missing')
  const text = readFileSync(p, 'utf8')
  for (const rule of [/^\*\.sh\s+text\s+eol=lf/m, /^\.githooks\/\*\s+text\s+eol=lf/m, /^\*\.js\s+text\s+eol=lf/m]) {
    assert.match(text, rule, `.gitattributes lacks ${rule}`)
  }
})

test('every tracked file with a shebang has an LF first line in the working tree', (t) => {
  if (tracked.length === 0) return t.skip('git not available or not a checkout')
  assert.ok(shebang.length > 0, 'expected at least install.sh and .githooks/pre-commit to carry a shebang')
  const crlf = shebang.filter((f) => /\r/.test(head(join(REPO, f)).split('\n')[0]))
  assert.deepEqual(crlf, [], `CRLF shebang line — dies with "bad interpreter" on Linux: ${crlf.join(', ')}`)
})

test('every tracked file with a shebang is stored LF in the index', (t) => {
  if (tracked.length === 0) return t.skip('git not available or not a checkout')
  const eol = git('ls-files', '--eol', ...shebang)
  if (eol === null) return t.skip('git ls-files --eol unsupported')
  const bad = eol.split('\n').filter(Boolean)
    .map((line) => line.match(/^i\/(\S+)\s+w\/\S+\s+attr\/[^\t]*\t(.+)$/))
    .filter((m) => m && m[1] !== 'lf' && m[1] !== 'none')
    .map((m) => `${m[2]} (i/${m[1]})`)
  assert.deepEqual(bad, [], `stored with CR in the index: ${bad.join(', ')}`)
})
