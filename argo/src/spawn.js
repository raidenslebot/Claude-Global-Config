/**
 * spawn.js — launch a child process without handing a command line to a shell.
 *
 * This exists because the same bug was written four times. `shell: true` hands
 * the finished command line to cmd.exe, which re-parses it AFTER node has
 * already quoted it: node escapes an embedded quote as `\"`, cmd.exe reads that
 * as a quote toggle, and one double quote in a user-authored config file can
 * append arguments or whole commands. Node 24 deprecates exactly this (DEP0190).
 *
 * Every fix for it is the same fix, so it lives in one place now. The mitigation
 * is to remove the second parser rather than try to out-quote it — you cannot
 * escape correctly for cmd.exe and the CRT simultaneously, and code that claims
 * to is code nobody can check.
 *
 * Not covered here, deliberately: a command the USER wrote as a shell line
 * (a baseline task's `{ type: 'command', run: 'npm test' }`). That is a shell
 * command by intent, and running it through a shell is the feature. See
 * src/baseline/tasks.js.
 */

import { existsSync } from 'node:fs'
import { join, delimiter } from 'node:path'

/**
 * Characters cmd.exe still acts on after node has quoted an argument.
 *
 * Measured on node 24, not assumed: node quotes an argument containing `&` or
 * `|`, so those survive — but it does not quote one containing `>`, and a `"`
 * inside a quoted argument closes it, after which `&& whatever` is a second
 * command. Both were reproduced against a batch shim before this list existed.
 */
export const CMD_UNSAFE = /["<>%^&|()!\r\n]/

/**
 * How to launch `bin` with `argv` and no shell.
 *
 * A .cmd/.bat shim cannot be exec'd — it needs an interpreter — so that case
 * routes through cmd.exe with the shim as its own argv entry, which lets node
 * quote each argument rather than concatenating a command line. cmd.exe still
 * re-parses what node produced, so an argument it would reinterpret is refused
 * outright instead of being escaped hopefully.
 *
 * ponytail: refusing is the whole mitigation for the shim path. Escaping for
 * both cmd.exe and the CRT at once (doubled quotes, verbatim argv) would keep
 * those cases working; do that only if someone actually hits it — pointing the
 * relevant env var at the .exe is the one-line fix and is already documented.
 *
 * @param {string} bin
 * @param {string[]} argv
 * @returns {{file: string, args: string[], viaCmd: boolean, unsafe: string|null}}
 */
export function spawnPlan(bin, argv = []) {
  const file = String(bin)
  if (!/\.(cmd|bat)$/i.test(file)) return { file, args: argv, viaCmd: false, unsafe: null }
  const unsafe = [file, ...argv].find((a) => CMD_UNSAFE.test(String(a))) ?? null
  return {
    file: process.env.ComSpec || 'cmd.exe',
    args: ['/c', file, ...argv],
    viaCmd: true,
    unsafe: unsafe === null ? null : String(unsafe),
  }
}

/**
 * First PATH + PATHEXT hit for a bare command name, or null.
 *
 * Without a shell node only appends .com/.exe to a bare name, so a bare command
 * never finds the .cmd shim npm installs on Windows. Resolving it here hands
 * spawnPlan a concrete file: .exe runs direct, .cmd takes the shim route.
 * Windows only — on POSIX the loader already searches PATH properly.
 */
export function onPath(name, env = process.env) {
  const exts = String(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  for (const dir of String(env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const hit = join(dir, name + ext)
      if (existsSync(hit)) return hit
    }
  }
  return null
}

/**
 * Quote one argument FOR DISPLAY — dry-run previews and error messages.
 *
 * Deliberately not on the execution path: nothing this returns is handed to a
 * shell, because there is no longer a shell. Quoting a value and hoping the
 * other side's parser agrees with yours is the bug class this module avoids by
 * construction.
 */
export function quoteArg(value, platform = process.platform) {
  const s = String(value)
  if (platform === 'win32') {
    return `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`
  }
  return `'${s.replace(/'/g, "'\\''")}'`
}

/**
 * The refusal message for a shim path carrying a character cmd.exe would
 * reinterpret. One wording, so every caller says the same actionable thing.
 */
export function unsafeShimMessage(plan, envVar = 'ARGO_CLAUDE_BIN') {
  return (
    `refusing to launch through cmd.exe: ${quoteArg(plan.unsafe)} contains a character ` +
    `cmd.exe would reinterpret. point ${envVar} at the .exe instead of the .cmd shim.`
  )
}
