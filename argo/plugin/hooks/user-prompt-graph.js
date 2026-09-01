// UserPromptSubmit hook: when the user is about to parallelise work, put the
// graph facts in front of the model BEFORE it picks a worker count.
//
// Deliberately conditional. A hook that fires on every prompt is noise, and
// noise gets ignored — which is the same outcome as not having the hook. This
// one stays silent unless the prompt is actually about fanning work out.

import { readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Phrases that mean "I am about to run more than one agent". */
const FANOUT_INTENT = /\b(fan[- ]?out|parallel|subagent|sub-agent|in parallel|concurrently|multi[- ]?agent|agent fleet|swarm|worker[s]?\b|delegate|dispatch|split (?:the )?(?:work|repo|task)|orchestrat)/i

/** Phrases that mean "my fleet is misbehaving" — different advice applies. */
const TROUBLE_INTENT = /\b(contradict|disagree|inconsistent|hallucinat|got slower|more expensive|token cost|burning tokens|not delegating|stopped working)\b/i

const MAX_FROZEN_SHOWN = 12

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function emit(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: context,
      },
    }) + '\n'
  )
}

function main() {
  let payload = {}
  try {
    payload = JSON.parse(readStdin() || '{}')
  } catch {
    return // malformed input is not our problem; stay silent
  }

  const prompt = String(payload.prompt ?? '')
  const cwd = typeof payload?.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd()

  const wantsFanout = FANOUT_INTENT.test(prompt)
  const inTrouble = TROUBLE_INTENT.test(prompt)
  if (!wantsFanout && !inTrouble) return

  const lines = []

  if (wantsFanout) {
    lines.push(
      'GRAPH ENGINEERING — this prompt is about running more than one agent. ' +
        'Before choosing a worker count, run `argo graph . --brief` (or /argo:fanout) ' +
        'and take its recommendation. Worker count is set by the shared surface, ' +
        'not by a round number.'
    )
    lines.push(
      'Rules that matter more than the count: workers never read each other\'s ' +
        'output (route everything through you as supervisor); files in the shared ' +
        'surface are read-only during fan-out and any edit to them happens in a ' +
        'serial pre-step; a crew has to beat a single agent on the same task or it ' +
        'is subtracting value.'
    )
  }

  if (inTrouble) {
    lines.push(
      'GRAPH ENGINEERING — symptoms like agents contradicting each other, costs ' +
        'rising, or delegation silently stopping are topology symptoms, not model ' +
        'quality symptoms. Useful checks: `argo diverge` measures disagreement per ' +
        'PAIR (a fleet average hides it); `argo drift diff` catches the vendor ' +
        'changing a shipped system prompt under you; `argo baseline` says whether ' +
        'the crew was ever beating a single agent.'
    )
  }

  // If a plan already exists in this repo, the frozen list is the single most
  // useful thing to have in context — it is what workers must not touch.
  const planPath = join(cwd, '.argo', 'fanout.md')
  if (existsSync(planPath)) {
    try {
      const text = readFileSync(planPath, 'utf8')
      const frozen = [...text.matchAll(/^- `([^`]+)` — (\d+) refs/gm)].map((m) => m[1])
      const ageDays = (Date.now() - statSync(planPath).mtimeMs) / 86_400_000

      if (frozen.length > 0) {
        const shown = frozen.slice(0, MAX_FROZEN_SHOWN)
        lines.push(
          `Existing plan at .argo/fanout.md lists ${frozen.length} FROZEN file(s) — ` +
            `read-only for every worker: ${shown.map((f) => `\`${f}\``).join(', ')}` +
            (frozen.length > shown.length ? `, +${frozen.length - shown.length} more` : '')
        )
      }
      if (ageDays > 7) {
        lines.push(
          `That plan is ${Math.round(ageDays)} days old. A hub grows out of habit — ` +
            're-run `argo graph` before trusting it.'
        )
      }
    } catch {
      // an unreadable plan is not worth failing the prompt over
    }
  }

  if (lines.length > 0) emit(lines.join('\n\n'))
}

main()
