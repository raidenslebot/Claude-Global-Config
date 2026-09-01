/**
 * runner.js — the two arms, and the headless claude call underneath them.
 *
 * the arms differ in exactly one thing: whether the model is allowed to fan the
 * work out. same task, same check, same budget — the only independent variable
 * is the shape of the graph. anything else that differs between the arms makes
 * the comparison worthless, which is why the framing text lives here as two
 * constants instead of being assembled per call.
 *
 * the prompt goes over stdin rather than argv. on windows a .cmd shim runs
 * through cmd.exe, and cmd.exe mangles quotes, carets and newlines in a way that
 * would quietly corrupt long prompts — a corrupted prompt would show up as a
 * failed task, which is exactly the kind of fake regression this tool exists to
 * detect.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { spawnPlan, unsafeShimMessage } from '../spawn.js'
import { runCheck } from './tasks.js'
import { simulateOutcome } from './simulate.js'

/** Documented install path of the Claude Code CLI on windows. */
const WINDOWS_DEFAULT = 'C:\\Users\\Administrator.DESKTOP-F9F60B0\\AppData\\Roaming\\npm\\claude.cmd'

export const MISSING_BIN_HELP =
  'argo baseline: could not run the Claude CLI. Set ARGO_CLAUDE_BIN to the full path of your ' +
  'claude executable (e.g. ARGO_CLAUDE_BIN="C:\\path\\to\\claude.cmd"), put `claude` on PATH, ' +
  'or re-run with --dry-run to exercise the pipeline offline.'

export const AUTH_HELP =
  'argo baseline: the Claude CLI answered "Not logged in". Authenticate it first — run `claude` ' +
  'once interactively and /login, or `claude setup-token` for headless use — then re-run. Probes ' +
  'that never reached a model are not task failures, so no verdict was produced.'

/** A probe that never reached a model. Not the same thing as a task the agent failed. */
export function isAuthFailure(text) {
  return /not logged in|please run \/login|invalid api key|authentication_error|oauth token has expired/i
    .test(String(text ?? ''))
}

/**
 * Did a whole arm fail to reach a model at all?
 *
 * An arm that never ran is not an arm that scored zero, and only the first of
 * those may be compared. This has to be asked of BOTH arms, not just the
 * control: a crew arm killed by an expired token or a rate limit scores 0/N,
 * which is the most damning result the report can print, and it would be printed
 * with full confidence against a solo arm that really did answer. The arms run
 * one after the other, so an outage that starts between them hits the crew arm
 * alone — the asymmetric case is the likely one, not the exotic one.
 *
 * Pure: takes the run records, returns why the arm is unusable, or null.
 *
 * @param {Array<object>} runs
 * @param {'solo'|'crew'} arm
 * @returns {{arm:string, reason:string, message:string, details:string[]}|null}
 */
export function armFailure(runs, arm = 'solo') {
  const list = Array.isArray(runs) ? runs : []
  if (list.length === 0) return null

  const of = (reason, message, details = []) => ({ arm, reason, message, details })

  if (list.some((r) => r?.missingBinary)) return of('missing-binary', MISSING_BIN_HELP)

  if (list.some((r) => r?.authFailure)) {
    return of(
      'auth',
      arm === 'solo'
        ? AUTH_HELP
        : `${AUTH_HELP}\n          It was the CREW arm that never reached a model, while solo answered — ` +
          'scoring that would have printed a confident "crew-subtracts" for an auth outage.'
    )
  }

  if (list.every((r) => r?.error)) {
    return of(
      'dead-arm',
      `argo baseline: every ${arm} probe failed, so ${arm === 'solo'
        ? 'there is no control to compare against'
        : 'there is no crew arm to compare the control against'}. ` +
        'Probes that never reached a model are not task failures, so no verdict was produced.',
      list.slice(0, 3).map((r) => `  ${r?.arm ?? arm}/${r?.id}#${r?.repeat}: ${r?.error}`)
    )
  }

  return null
}

/** One agent, no delegation. This is the control. */
export const SOLO_FRAME =
  'You are working ALONE. Do not delegate, do not spawn subagents, do not use any Task or agent ' +
  'tool. Do the whole task yourself and print the final answer.'

/** Supervisor plus workers. This is the treatment. */
export function crewFrame(workers) {
  const n = Math.max(2, Number(workers) || 2)
  return (
    `You are the SUPERVISOR of a crew of ${n} workers. Split the task into ${n} parts, delegate one ` +
    'part to each worker, then integrate their results yourself and print the final answer. Workers ' +
    'do not talk to each other; everything routes through you.'
  )
}

/** The exact text one arm sends for one task. */
export function buildPrompt(task, arm, workers) {
  const frame = arm === 'crew' ? crewFrame(workers) : SOLO_FRAME
  return `${frame}\n\nTASK\n${task.prompt}`
}

/**
 * Candidate binaries, most explicit first. ARGO_CLAUDE_BIN wins so a user with a
 * different install never has to edit this file.
 */
export function claudeCandidates(env = process.env) {
  return [env.ARGO_CLAUDE_BIN, WINDOWS_DEFAULT, 'claude'].filter(Boolean)
}

/**
 * Pick a binary without spawning anything. An explicit ARGO_CLAUDE_BIN is taken
 * as stated even when it does not exist — silently falling back from an override
 * the user typed would run a different binary than the one they named, and they
 * would read the results as if it were theirs. Bare 'claude' is the last resort,
 * left for PATH to resolve at spawn time; if that fails, the failure is turned
 * into MISSING_BIN_HELP rather than an ENOENT stack.
 */
export function resolveClaudeBin(env = process.env, exists = existsSync) {
  if (env.ARGO_CLAUDE_BIN) return env.ARGO_CLAUDE_BIN
  for (const candidate of claudeCandidates(env)) {
    if (candidate === 'claude') break
    if (exists(candidate)) return candidate
  }
  return 'claude'
}

/** cmd.exe needs quotes around anything with a space; nothing else here needs escaping. */
function quote(value) {
  const s = String(value)
  return /[\s&|<>^]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s
}

/** The argv the CLI is invoked with, minus the prompt (which travels on stdin). */
export function cliArgs({ model, extra = [] } = {}) {
  const args = ['-p', '--output-format', 'json']
  if (model) args.push('--model', quote(model))
  return args.concat(extra)
}

/** Human-readable line for --dry-run, so "what would this run" is answerable. */
export function describeInvocation({ bin, model, promptLength }) {
  return `${bin} ${cliArgs({ model }).join(' ')}   <- prompt on stdin (${promptLength} chars)`
}

/**
 * Does this failure mean "no such binary" rather than "the model refused"?
 * Worth getting right: a missing shim scored as a failed task would read as a
 * task list the agent cannot do, which is the opposite of the truth.
 */
export function isMissingBinary(err, stderr = '') {
  if (err?.code === 'ENOENT') return true
  const text = `${err?.message ?? ''} ${stderr}`
  return /is not recognized as an internal|command not found|ENOENT|no such file or directory|cannot find the (path|file) specified/i
    .test(text)
}

/**
 * Pull the useful fields out of `--output-format json`.
 *
 * Defensive on purpose: the CLI's envelope is not ours, and a renamed field
 * should cost us the cost column, not the whole run.
 */
export function parseCliJson(stdout) {
  const raw = String(stdout ?? '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  const empty = { text: raw.trim(), costUsd: null, tokens: null, durationMs: null, isError: false, raw: null }
  if (start === -1 || end <= start) return empty

  let obj
  try {
    obj = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return empty
  }
  if (obj == null || typeof obj !== 'object') return empty

  const text = typeof obj.result === 'string' ? obj.result : firstString(obj)
  const usage = obj.usage && typeof obj.usage === 'object' ? obj.usage : null
  const tokens = usage
    ? num(usage.input_tokens) + num(usage.output_tokens) +
      num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens)
    : numOrNull(obj.total_tokens)

  return {
    text: text ?? '',
    costUsd: numOrNull(obj.total_cost_usd ?? obj.cost_usd),
    tokens,
    durationMs: numOrNull(obj.duration_ms),
    // the CLI's own opinion of the call. a probe it considers failed is not a
    // task the agent got wrong, and scoring it as one is how a dead run turns
    // into a confident verdict.
    isError: obj.is_error === true,
    raw: obj,
  }
}

function num(v) {
  return Number.isFinite(v) ? v : 0
}

function numOrNull(v) {
  return Number.isFinite(v) ? v : null
}

function firstString(obj) {
  for (const v of Object.values(obj)) if (typeof v === 'string' && v.trim()) return v
  return null
}

/**
 * One headless call. Never throws — one flaky probe should not take the whole
 * comparison with it — but it does distinguish "the agent answered and was
 * wrong" from "the call never happened", because only the first one is a task
 * result and only the first one belongs in a score.
 */
export function callClaude({ bin, prompt, model, timeout = 180_000, cwd = process.cwd() }) {
  return new Promise((done) => {
    const started = process.hrtime.bigint()
    const finish = (extra) => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      done({ ms: Math.round(ms), ...extra })
    }

    let child
    try {
      // No shell: a model id or bin path carrying a quote would otherwise be
      // re-parsed by cmd.exe after node had already quoted it (DEP0190).
      const plan = spawnPlan(bin, cliArgs({ model }))
      if (plan.unsafe !== null) {
        return finish({ ok: false, output: '', error: unsafeShimMessage(plan) })
      }
      child = execFile(
        plan.file,
        plan.args,
        { cwd, timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
        (err, stdout, stderr) => {
          if (err && isMissingBinary(err, stderr)) {
            return finish({ ok: false, missingBinary: true, output: '', error: MISSING_BIN_HELP })
          }
          const parsed = parseCliJson(stdout)
          if (parsed.isError || (err && !parsed.text)) {
            const why = parsed.text ||
              (err?.killed ? `timed out after ${timeout}ms` : (String(stderr).trim() || err?.message || 'probe failed'))
            return finish({
              ok: false,
              output: parsed.text ?? '',
              error: why,
              authFailure: isAuthFailure(parsed.text),
            })
          }
          finish({ ok: true, output: parsed.text, costUsd: parsed.costUsd, tokens: parsed.tokens, reportedMs: parsed.durationMs })
        }
      )
    } catch (err) {
      return finish({ ok: false, missingBinary: isMissingBinary(err), output: '', error: err.message })
    }

    child.stdin?.on('error', () => {})
    child.stdin?.end(prompt)
  })
}

/**
 * Bounded-concurrency map that preserves input order. Probes run in parallel
 * because a serial sweep of two arms times repeats is slow enough that nobody
 * re-runs the control, and a control nobody re-runs is not a control.
 */
export async function mapPool(items, limit, fn) {
  const list = Array.isArray(items) ? items : []
  const out = new Array(list.length)
  const width = Math.max(1, Math.min(Number(limit) || 1, list.length || 1))
  let next = 0

  const lane = async () => {
    for (;;) {
      const i = next++
      if (i >= list.length) return
      out[i] = await fn(list[i], i)
    }
  }

  await Promise.all(Array.from({ length: width }, lane))
  return out
}

/** Every (task, repeat) probe one arm owes, in a fixed order. */
export function probesFor(tasks, repeats) {
  const n = Math.max(1, Number(repeats) || 1)
  const probes = []
  for (const task of tasks) {
    for (let repeat = 0; repeat < n; repeat++) probes.push({ task, repeat })
  }
  return probes
}

/**
 * Run one arm end to end and return raw runs in probe order.
 *
 * In --dry-run nothing is spawned and no check is executed: the simulator decides
 * the outcome directly and every run is flagged `simulated`, because pretending a
 * substring matched would be the tool lying to the user about its own control.
 */
export async function runArm({ arm, tasks, opts = {} }) {
  const {
    workers = 3, repeats = 1, concurrency = 4, model = null, timeout = 180_000,
    cwd = process.cwd(), dryRun = false, seed = 1337, bin = null,
  } = opts

  const probes = probesFor(tasks, repeats)

  if (dryRun) {
    return probes.map(({ task, repeat }) => {
      const sim = simulateOutcome({ seed, taskId: task.id, arm, repeat, workers })
      return {
        id: task.id,
        arm,
        repeat,
        pass: sim.pass,
        ms: sim.ms,
        costUsd: sim.costUsd,
        tokens: sim.tokens,
        output: sim.output,
        detail: `simulated (seed ${seed}, difficulty ${sim.difficulty})`,
        simulated: true,
        error: null,
      }
    })
  }

  return mapPool(probes, concurrency, async ({ task, repeat }) => {
    const call = await callClaude({
      bin,
      prompt: buildPrompt(task, arm, workers),
      model,
      timeout,
      cwd,
    })

    if (!call.ok) {
      return {
        id: task.id, arm, repeat, pass: false, ms: call.ms, costUsd: null, tokens: null,
        output: call.output ?? '', detail: 'probe failed', simulated: false,
        error: call.error, missingBinary: call.missingBinary === true,
        authFailure: call.authFailure === true,
      }
    }

    const verdictOfCheck = await runCheck(task.check, { output: call.output, cwd, timeout })
    return {
      id: task.id, arm, repeat, pass: verdictOfCheck.pass, ms: call.ms,
      costUsd: call.costUsd, tokens: call.tokens, output: call.output,
      detail: verdictOfCheck.detail, simulated: false, error: null,
    }
  })
}
