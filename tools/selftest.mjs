#!/usr/bin/env node
// selftest.mjs — run the package's own test suite in the BACKGROUND and record the result.
//
//   node tools/selftest.mjs --head <sha> --state <dir>
//
// The session-start hook used to run the suite inline and wait for it, with a 240 s budget.
// Two things were wrong with that, and both hit the weaker machine hardest:
//
//   - a session start BLOCKED for as long as the suite took — four minutes of nothing, on every
//     new commit, on a machine where the suite takes four minutes;
//   - when it did not finish in time, the result was cached for a DAY as "tests timed out",
//     with a failure count of 1 that no test had earned. Every session on that commit repeated
//     it, and nothing re-tried until the next commit.
//
// So the hook now claims the run, starts THIS process detached, and returns at once with the
// last completed result. This process owns the claim from here: it runs the suite at reduced
// priority so it does not fight the session that started it, kills the whole tree if the
// budget is exceeded (the runner spawns `node --test` workers, and killing the runner alone
// left every worker behind), writes the result beside the config, and releases the claim.
// The next session start reads the result; a timed-out one is re-tried after a short
// cooldown, never cached for the day.

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// No import from paths.mjs: the session tests copy this ONE file into a stub clone beside a
// stub runner, and exercise the real thing.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('usage: node tools/selftest.mjs --head <sha> --state <dir>\nRuns the test suite in the background and records the result in <dir>/selftest.json.')
  process.exit(0)
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const head = arg('--head') || ''
const STATE = arg('--state')
if (!STATE) { console.error('usage: selftest.mjs --head <sha> --state <dir>'); process.exit(2) }

// Twenty minutes: a suite of ~900 cases takes a few minutes on a fast machine and must be
// allowed several times that on a slow one. The claim the hook holds goes stale at 30 minutes,
// so a run that hangs past this is killed here well before another session doubts the claim.
export const BUDGET_MS = Number(process.env.CGC_SELFTEST_BUDGET_MS || 20 * 60 * 1000)

const RESULT = path.join(STATE, 'selftest.json')
const CLAIM = path.join(STATE, 'selftest.running')

/** Run one command with a timeout that kills the whole process tree. */
function runTree(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      env: { ...process.env },
      detached: process.platform !== 'win32',
    })
    // Below normal, so the session that started this stays responsive. Children inherit it.
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL) } catch { /* not permitted here: still runs */ }
    let text = '', settled = false, timedOut = false
    child.stdout.on('data', (d) => { text += d })
    child.stderr.on('data', (d) => { text += d })
    const finish = (status) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ status, text, timedOut }) }
    const timer = setTimeout(() => {
      timedOut = true
      try {
        if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 })
        else process.kill(-child.pid, 'SIGKILL')
      } catch { /* already gone */ }
      setTimeout(() => finish(null), 2000).unref()
    }, timeoutMs)
    child.on('error', () => finish(null))
    child.on('close', (code) => finish(code))
  })
}

const started = Date.now()
try {
  const r = await runTree(process.execPath, [path.join(HERE, 'run-tests.mjs')], BUDGET_MS)
  const num = (k) => { const m = new RegExp(`(?:ℹ|#)\\s*${k}\\s+(\\d+)`).exec(r.text); return m ? Number(m[1]) : null }
  // A run that produced no counts is a run that did not happen — a crashed runner, a syntax
  // error mid-edit. It is recorded as unread, never as 0 of 0 and never as a failure count.
  const unread = !r.timedOut && num('tests') === null && num('pass') === null
  const res = {
    head, at: Date.now(), durationMs: Date.now() - started, budgetMs: BUDGET_MS,
    total: num('tests') ?? 0, pass: num('pass') ?? 0,
    // A timed-out run failed nothing; it is unfinished. A finished run with no fail count but
    // a non-zero exit failed somewhere the counts did not show.
    fail: r.timedOut ? 0 : (num('fail') ?? (r.status === 0 ? 0 : 1)),
    skipped: num('skipped') ?? 0, timedOut: r.timedOut, unread,
  }
  fs.mkdirSync(STATE, { recursive: true })
  fs.writeFileSync(RESULT, JSON.stringify(res))
} finally {
  try { fs.rmSync(CLAIM, { force: true }) } catch { /* a stale-claim sweep beat us to it */ }
}
