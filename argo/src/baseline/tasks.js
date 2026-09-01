/**
 * tasks.js — read the task list, and decide whether one run passed a task.
 *
 * the checks are deliberately dumb and mechanical. a model grading a model is
 * another agent in the graph, with its own failure mode, and the whole point of
 * this module is to have ONE thing in the loop that is not a model. substring,
 * regex, file on disk, exit code — four things a script can settle without an
 * opinion.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, isAbsolute } from 'node:path'
import { execFile } from 'node:child_process'

/** The four check shapes a task file may use. */
export const CHECK_TYPES = ['contains', 'regex', 'file_exists', 'command']

/** Parse a task file body into a list, with a useful error instead of a stack. */
export function parseTasks(text, source = 'tasks') {
  let data
  try {
    data = JSON.parse(text)
  } catch (err) {
    throw new Error(`${source}: not valid JSON — ${err.message}`)
  }
  if (!Array.isArray(data)) {
    throw new Error(`${source}: expected a JSON array of { id, prompt, check }`)
  }
  return data
}

/**
 * Validate a raw task list. Returns the usable tasks AND the reasons for every
 * rejection: a task list silently dropping half its entries would make both arms
 * look better than they are.
 *
 * @returns {{tasks:Array<object>, errors:string[]}}
 */
export function validateTasks(raw) {
  const tasks = []
  const errors = []
  const seen = new Set()

  ;(Array.isArray(raw) ? raw : []).forEach((entry, i) => {
    const at = `task[${i}]`
    if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${at}: not an object`)
      return
    }
    const id = entry.id == null ? '' : String(entry.id).trim()
    if (!id) {
      errors.push(`${at}: missing id`)
      return
    }
    if (seen.has(id)) {
      errors.push(`${at}: duplicate id "${id}"`)
      return
    }
    if (typeof entry.prompt !== 'string' || !entry.prompt.trim()) {
      errors.push(`${at} (${id}): missing prompt`)
      return
    }
    const problem = checkError(entry.check)
    if (problem) {
      errors.push(`${at} (${id}): ${problem}`)
      return
    }
    seen.add(id)
    tasks.push({ id, prompt: entry.prompt, check: entry.check, weight: entry.weight ?? 1 })
  })

  return { tasks, errors }
}

/** null when the check is usable, otherwise why it is not. */
export function checkError(check) {
  if (check == null || typeof check !== 'object') return 'missing check'
  if (!CHECK_TYPES.includes(check.type)) {
    return `unknown check type "${check.type}" (expected ${CHECK_TYPES.join(', ')})`
  }
  if (check.type === 'contains' && typeof check.value !== 'string') return 'contains check needs a string value'
  if (check.type === 'regex') {
    if (typeof check.pattern !== 'string') return 'regex check needs a string pattern'
    try {
      new RegExp(check.pattern, check.flags ?? '')
    } catch (err) {
      return `regex check has an uncompilable pattern — ${err.message}`
    }
  }
  if (check.type === 'file_exists' && typeof check.path !== 'string') return 'file_exists check needs a path'
  if (check.type === 'command' && typeof check.run !== 'string') return 'command check needs a run string'
  return null
}

/**
 * The half of checking that is pure text. Split out from runCheck so the match
 * semantics can be tested without a filesystem or a shell.
 *
 * Returns null for checks that are not text-based — those need the world.
 */
export function matchText(check, output) {
  const text = String(output ?? '')
  if (check?.type === 'contains') {
    const value = String(check.value ?? '')
    return check.ignoreCase === true
      ? text.toLowerCase().includes(value.toLowerCase())
      : text.includes(value)
  }
  if (check?.type === 'regex') {
    return new RegExp(check.pattern, check.flags ?? '').test(text)
  }
  return null
}

/**
 * Settle one check against one run. `cwd` scopes both file lookups and command
 * checks, so a task list can never assert about somewhere it was not pointed.
 *
 * @returns {Promise<{pass:boolean, detail:string}>}
 */
export async function runCheck(check, { output = '', cwd = process.cwd(), timeout = 60_000 } = {}) {
  const text = matchText(check, output)
  if (text !== null) {
    const what = check.type === 'contains' ? `contains ${JSON.stringify(check.value)}` : `/${check.pattern}/`
    return { pass: text, detail: `${what} -> ${text ? 'match' : 'no match'}` }
  }

  if (check.type === 'file_exists') {
    const target = isAbsolute(check.path) ? check.path : resolve(cwd, check.path)
    const hit = existsSync(target)
    return { pass: hit, detail: `${check.path} -> ${hit ? 'exists' : 'missing'}` }
  }

  if (check.type === 'command') {
    const expect = Number.isFinite(check.expectExit) ? check.expectExit : 0
    const code = await exitCodeOf(check.run, { cwd, timeout })
    return { pass: code === expect, detail: `${check.run} -> exit ${code} (expected ${expect})` }
  }

  return { pass: false, detail: `unsupported check type "${check?.type}"` }
}

/**
 * Run a task's `command` check and return its exit code.
 *
 * This is the ONE place in the codebase that keeps `shell: true`, and it is
 * deliberate rather than missed. Everywhere else a shell was an accident of
 * spawning a binary — see src/spawn.js, which removed it. Here the value IS a
 * shell line: the user wrote `{ type: 'command', run: 'npm test && npm run lint' }`
 * in their own task file, and pipes, `&&` and redirection are the point.
 *
 * Trust boundary: task files are authored by the person running the tool, the
 * same person who could run the command directly. Nothing here interpolates
 * model output or any other untrusted string into `command` — if that ever
 * changes, this needs to stop being a shell.
 */
function exitCodeOf(command, { cwd, timeout }) {
  return new Promise((done) => {
    execFile(command, [], { shell: true, cwd, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err) => {
      if (!err) return done(0)
      if (typeof err.code === 'number') return done(err.code)
      // killed by timeout, or never started at all
      done(err.killed ? 124 : 127)
    })
  })
}

/** Load and validate in one call. Throws only on a file that cannot be read or parsed. */
export function loadTasks(file) {
  const path = resolve(file)
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (err) {
    throw new Error(`cannot read task list ${path} — ${err.code ?? err.message}`)
  }
  const { tasks, errors } = validateTasks(parseTasks(text, path))
  return { path, tasks, errors }
}
