/**
 * Pins src/spawn.js — the one implementation of "launch without a shell".
 *
 * This module exists because the same bug was written four times, so the tests
 * are written against the behaviour that made it a bug, not against the shape
 * of the code: a shim path must not be able to smuggle a second command, and a
 * bare command name must still resolve on Windows without a shell.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'

import { spawnPlan, onPath, quoteArg, CMD_UNSAFE, unsafeShimMessage } from '../src/spawn.js'

describe('spawnPlan', () => {
  test('an .exe runs directly, with argv untouched', () => {
    const p = spawnPlan('C:\\bin\\claude.exe', ['-p', '--model', 'opus'])
    assert.equal(p.viaCmd, false)
    assert.equal(p.file, 'C:\\bin\\claude.exe')
    assert.deepEqual(p.args, ['-p', '--model', 'opus'])
    assert.equal(p.unsafe, null)
  })

  test('a POSIX binary with no extension runs directly', () => {
    const p = spawnPlan('/usr/local/bin/claude', ['-p'])
    assert.equal(p.viaCmd, false)
    assert.equal(p.file, '/usr/local/bin/claude')
  })

  test('a .cmd shim routes through cmd.exe as its own argv entry', () => {
    const p = spawnPlan('C:\\npm\\claude.cmd', ['-p', '--model', 'opus'])
    assert.equal(p.viaCmd, true)
    assert.match(p.file, /cmd\.exe$/i)
    // The shim must be a SEPARATE argv element, never concatenated into a
    // command line — that concatenation is the whole vulnerability.
    assert.deepEqual(p.args, ['/c', 'C:\\npm\\claude.cmd', '-p', '--model', 'opus'])
  })

  test('.bat takes the same route as .cmd', () => {
    assert.equal(spawnPlan('C:\\x\\y.bat', []).viaCmd, true)
  })

  test('extension matching is case-insensitive', () => {
    assert.equal(spawnPlan('C:\\x\\claude.CMD', []).viaCmd, true)
  })

  test('a quote in an argument on the shim route is refused, not escaped', () => {
    // The payload that motivated all of this: a double quote closes the
    // argument cmd.exe is parsing, and everything after it becomes commands.
    const p = spawnPlan('C:\\npm\\claude.cmd', ['--system-prompt', 'hi" && echo pwned'])
    assert.equal(p.viaCmd, true)
    assert.ok(p.unsafe, 'the argument must be reported as unsafe')
    assert.match(p.unsafe, /pwned/)
  })

  test('every character cmd.exe reinterprets is caught', () => {
    for (const ch of ['"', '<', '>', '%', '^', '&', '|', '(', ')', '!', '\r', '\n']) {
      const p = spawnPlan('a.cmd', [`x${ch}y`])
      assert.ok(p.unsafe !== null, `${JSON.stringify(ch)} should be refused on the shim route`)
      assert.ok(CMD_UNSAFE.test(ch), `${JSON.stringify(ch)} should match CMD_UNSAFE`)
    }
  })

  test('the SAME payload is safe when the binary is a real executable', () => {
    // No cmd.exe in the chain means no second parser, so nothing to escape for.
    const p = spawnPlan('C:\\bin\\claude.exe', ['--system-prompt', 'hi" && echo pwned'])
    assert.equal(p.viaCmd, false)
    assert.equal(p.unsafe, null, 'direct spawn needs no refusal — node passes argv verbatim')
  })

  test('an unsafe character in the shim PATH itself is caught too', () => {
    assert.ok(spawnPlan('C:\\weird&dir\\claude.cmd', []).unsafe !== null)
  })

  test('ordinary arguments with spaces are fine on the shim route', () => {
    const p = spawnPlan('a.cmd', ['--label', 'before the upgrade'])
    assert.equal(p.unsafe, null, 'node quotes spaces correctly; only re-parsed chars are the risk')
  })
})

describe('onPath', () => {
  test('finds a command by walking PATH x PATHEXT', () => {
    const dir = mkdtempSync(join(tmpdir(), 'argo-path-'))
    try {
      writeFileSync(join(dir, 'thing.CMD'), '@echo off\n')
      const hit = onPath('thing', { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' })
      assert.equal(hit, join(dir, 'thing.CMD'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('returns null when nothing matches', () => {
    assert.equal(onPath('definitely-not-here', { PATH: tmpdir(), PATHEXT: '.EXE' }), null)
  })

  test('respects PATHEXT order across directories', () => {
    const a = mkdtempSync(join(tmpdir(), 'argo-a-'))
    const b = mkdtempSync(join(tmpdir(), 'argo-b-'))
    try {
      writeFileSync(join(b, 'tool.EXE'), '')
      const hit = onPath('tool', { PATH: [a, b].join(delimiter), PATHEXT: '.EXE;.CMD' })
      assert.equal(hit, join(b, 'tool.EXE'), 'should find it in the second directory')
    } finally {
      rmSync(a, { recursive: true, force: true })
      rmSync(b, { recursive: true, force: true })
    }
  })

  test('tolerates a missing PATH rather than throwing', () => {
    assert.equal(onPath('x', {}), null)
  })
})

describe('quoteArg', () => {
  test('interior backslashes in a path are literal', () => {
    assert.equal(quoteArg('C:\\bin\\claude.cmd', 'win32'), '"C:\\bin\\claude.cmd"')
  })

  test('a trailing backslash is doubled so it cannot escape the closing quote', () => {
    assert.equal(quoteArg('C:\\bin\\', 'win32'), '"C:\\bin\\\\"')
  })

  test('posix single-quoting survives an embedded quote', () => {
    assert.equal(quoteArg("it's", 'linux'), "'it'\\''s'")
  })
})

describe('unsafeShimMessage', () => {
  test('names the offending value and the fix', () => {
    const msg = unsafeShimMessage(spawnPlan('a.cmd', ['x&y']), 'ARGO_CLAUDE_BIN')
    assert.match(msg, /ARGO_CLAUDE_BIN/)
    assert.match(msg, /\.exe/i)
    assert.match(msg, /x&y/)
  })
})
