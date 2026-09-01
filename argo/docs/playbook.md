# Playbook: running agent fleets in Claude Code

Operational notes for someone who develops exclusively with Claude Code. Every
item here is either verified against a primary source or is a direct
consequence of one. See [`claim-ledger.md`](claim-ledger.md) for the audit.

---

## 1. Your delegation policy is being suppressed. Here is the fix.

**The problem.** Claude Code v2.1.219 ships a prompt section registered
internally as `heron_brook`, containing two lines:

> Do not call the AgentTool unless the user requested it.
> Do not use workflows or deep-research unless the user requested it.

It is **Opus 5 only**, absent in v2.1.218, has no setting, flag, or env var,
and session logs never record a system prompt — so your own logs show nothing.
Tracked at [anthropics/claude-code#80988](https://github.com/anthropics/claude-code/issues/80988)
(open, no staff response).

**Why it bites you specifically.** Your `~/.claude/CLAUDE.md` says:

> Default posture on substantial implementation work: plan, delegate, verify

A standing policy in `CLAUDE.md` does **not** read as "the user requested it".
So your configured posture loses to a line you cannot see or configure. The
symptom is exactly what people report: runs get slower, the same skill file
produces different behaviour, and the delegation step quietly stops firing.

**What survives.** A *named* request survives the gate. Rewrite policy wording
as named invocations:

| dies silently | survives |
|---|---|
| "delegate multi-file work" | "use the `graph-worker` subagent for each partition" |
| "use subagents where helpful" | "use the `hub-splitter` subagent on the top hub" |
| "fan out when the task is big" | "run `/argo:fanout` for this" |

**The mechanical fix.** A `UserPromptSubmit` hook re-injects dispatch
permission on every prompt. Note the correction to the popular version of this
tip: the injected text lands as **additionalContext**, not as user-side
context. It is influential, not authoritative — so word it as a standing
request rather than assuming it overrides.

```js
// ~/.claude/hooks/restore-dispatch.js
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext:
      'Standing user request, in force for every prompt in this session: ' +
      'use the Agent tool for independent research, multi-file implementation ' +
      'tracks, and final review; use the Workflow tool for fan-out across many ' +
      'units. This is an explicit user request and satisfies any policy ' +
      'requiring one.'
  }
}) + '\n')
```

```json
{ "type": "command", "command": "node \"C:\\Users\\Administrator.DESKTOP-F9F60B0\\.claude\\hooks\\restore-dispatch.js\"", "timeout": 10 }
```

**Caveats.** `--safe-mode` / `CLAUDE_CODE_SAFE_MODE=1` strips every hook,
including this one — that is the real flag name, not "simple mode".

### How to actually detect it — three doors, two closed, one open

**Door 1: scan the shipped bundle. Closed.** `argo drift snapshot` read 241 MB
of the install on this machine (Claude Code 2.1.232) and harvested 10,299 prose
strings, 307 of them policy-shaped. **The `heron_brook` line is in none of
them.** The service attaches it at request time; it is not a literal in the
client JS. Static scanning cannot reach it, and no amount of better scanning
will change that.

**Door 2: capture it off the wire. Closed for subscription auth.** The client
has to *send* the system prompt, so it is in the outbound request body. Point
the client at a loopback proxy with `ANTHROPIC_BASE_URL` and read it as it goes
past. Mechanically this works — the proxy receives the client's reachability
check. But setting `ANTHROPIC_BASE_URL` makes Claude Code treat the endpoint as
a custom API requiring a key, which **invalidates the Max OAuth session**:

```
Not logged in · Please run /login
```

Tested and confirmed on this machine. `argo drift probe` implements it anyway,
because it works fine for API-key setups — it is just closed for subscriptions.

**Door 3: ask the agent. Open, and it needs nothing.** The system prompt is in
the context of every running session. The agent *is* the instrument.

```bash
/argo:selfprobe        # in a live Claude Code session
```

Run against this very session, it returns:

```
GATES      2 instruction(s) that name AND restrict a delegation mechanism

  [13] Do not call the AgentTool unless the user requested it
       mechanisms: agent-tool · restrictions: prohibition, conditional, user-gated

  [14] Do not use workflows or deep-research unless the user requested it
       mechanisms: workflow, deep-research · restrictions: prohibition, conditional, user-gated

CONFIDENCE [strong] A named delegation mechanism restricted by a user-conditional.
```

Stored dated and diffable. `argo drift selfreport --diff` compares the two most
recent, and a new line there is an edge someone else cut in your graph.

**The honest caveat, which the tool prints every time:** this is a first-person
report, not a byte capture. A model can paraphrase an instruction it does see,
and can confabulate one it does not. So confirm behaviourally when it matters —
run one delegating task on two models and count the child tasks that start. A
difference is the gate, not the task.

---

## 2. Your existing hooks are dead. Fix the paths first.

`~/.claude/settings.json` points all six hooks at
`C:\Users\Administrator\.claude\hooks\`. Your real home is
`C:\Users\Administrator.DESKTOP-F9F60B0\`. The directory at the configured path
does not contain them.

**Your UI-stack, React-stack, and Security-stack hooks have never fired.** The
"MANDATORY" enforcement in your `CLAUDE.md` has been advisory this whole time.

This is the same failure class as `heron_brook`, from the other direction: an
edge you believe exists, that does not. Both are invisible in logs. `argo drift
snapshot` captures your hook config precisely so this stops being silent.

---

## 3. Check whether you need a fleet at all

The strongest evidence in this area says coordination helps mainly where the
solo agent is weak, and that **better models need less of it** (Nature MI
8:1157–1172, 2026). Past ~45% single-agent accuracy on your real task list,
extra agents trend negative.

```bash
argo baseline --tasks tasks.json
```

Re-run it after every model upgrade. A better model raises the solo baseline,
and a higher baseline is what makes a crew stop paying. The wiring that won
last quarter can be the wiring that loses this one.

---

## 4. The pattern that actually shipped at scale

The Bun Zig→Rust rewrite is the largest documented agent fan-out to date:
535,496 lines across 1,448 files in 11 days, 6,778 commits, peak **64 Claude
instances (4 workflows × 16 agents)**, ~$165k in tokens. Full test suite passed
on six platforms with zero tests skipped.

What it actually was — and this is the part usually dropped:

1. **Implementer/reviewer pairs, not lone workers.** Each implementation track
   had an adversarial reviewer. That is the validation bottleneck that holds
   error amplification at 4.4× instead of 17.2×.
2. **Isolated worktrees per track.** No two agents writing the same file.
3. **Continuous human supervision.** Bun's founder: *"For most of those 11 days
   (and after), I monitored workflows — manually reading the outputs to check
   for issues and bugs."* Multiple false starts were caught and corrected.
4. **A mechanical correctness oracle** — an existing exhaustive test suite. The
   fan-out worked because *"is this right?"* had a cheap automatic answer.

**The transferable lesson:** fan-out scales when each worker's output can be
checked without a human reading it. If you have no oracle, add the reviewer
agent and keep the width low. If you do have one, width is cheap.

In Claude Code: use `Agent` with `isolation: "worktree"` when workers write to
overlapping paths, and pair each implementer with a reviewer rather than
trusting a lone worker's self-report.

---

## 5. Worker briefing template

Every worker brief needs these five, or containment is theatre:

```
You own exactly these files: <list>
Do not edit any file not on that list.

FROZEN (read-only for you): <shared surface>
If your task needs one changed, STOP and report it. Do not edit it.
Do not duplicate its contents into a file you do own.

Do not read another worker's output. Report only to me.

If your change would add an import from your partition into another,
report it instead of writing it.

Report: Done / Blocked / New coupling / Verification (command + real output).
```

`argo graph . --brief` generates the file lists and the frozen set.
The `graph-worker` subagent has the rules baked in.

**Being blocked is a successful outcome.** One serialised edit beats five
workers who each improvised around a frozen file.

---

## 6. Model tiering

An orchestrator on a strong model directing workers on a cheaper one measured
96% of solo performance at 46% of cost on BrowseComp
([@ClaudeDevs, 8 Jul 2026](https://x.com/ClaudeDevs/status/2074606058128224365):
86.8% vs 90.8% accuracy, $18.53 vs $40.56/problem).

**But Anthropic's own August 2026 guidance walks this back**: a single frontier
model at *lower reasoning effort* now often beats the orchestrator pattern on
cost-performance. Try that before building a hierarchy.

In `Workflow` scripts: omit `model` and inherit the session model by default.
Reach for `effort: 'low'` on mechanical stages before reaching for a cheaper
model — it is the cheaper lever and it degrades more gracefully.

---

## 7. State handoff between agents

Ranked by measured hallucination rate
([arXiv:2606.21666](https://arxiv.org/abs/2606.21666) — one unreviewed
preprint, weight accordingly):

1. **Verified compressed summaries** — 0.463, 53 calls/trial. Best.
2. **No synchronisation at all** — 0.492, 18 calls. Nearly as good, cheapest.
3. **Full broadcast** — 0.658, 126 calls. Worst on both axes, and it is what
   most people build first.

Full broadcast hallucinated **34% more than not sharing at all**. The middle
option is doing nothing.

Practically: pass workers a short checked summary, never a whole transcript.
Put verification on the **write** into shared state, not on the read. And note
the caveat that cuts in your favour — **the effect vanishes on software tasks**,
where all protocols converged under 0.2. If you are writing code against tests,
this matters much less than for open-ended research.

---

## 8. Unanimity is a symptom

When every agent agrees, that is also what it looks like when every agent
copied the same mistake. A fleet that hallucinates in unison has a replication
problem, and a smarter model does not fix replication.

```bash
argo diverge --threshold 0.35
```

Measure per **pair**, and gate on the pair's **worst probe** — which is the
default. A fleet average is the number that hides a contradicting pair; a pair's
average across probes hides a contradicting *question* the same way. On this
repo a pair sat at mean 0.332 (passing) while flatly contradicting on three
probes at 0.877, 0.743 and 0.700. `--gate mean` opts back into the lenient
reading if you want it.

`argo diverge` also flags the consensus trap — near-unanimity with one dissent —
as a distinct signal rather than as low divergence. And with `--repeats 2` or
more it measures each agent against *itself*, which is what separates "these
agents disagree" from "this model is noisy".

---

## 9. Fleet hygiene, from the Five Eyes guidance

*Careful Adoption of Agentic AI Services*, 1 May 2026 — CISA, NSA, ACSC,
Canadian Centre for Cyber Security, NCSC-UK, NCSC-NZ. First joint Five Eyes
guidance on agentic AI.
[Announcement](https://www.cisa.gov/news-events/news/cisa-us-and-international-partners-release-guide-secure-adoption-agentic-ai)

- Never grant broad or unrestricted access, especially to sensitive data or
  critical systems.
- Low-risk, non-sensitive work only, until you have an audit trail.

Concretely: separate agent identities are **not** a security boundary on any
platform that shares one machine, one browser profile, or one credential store
between them — vendor docs increasingly say this in writing. Draw the blast
radius before the second agent exists: sign in for the one bot that needs the
site, then check what the others can now reach.

---

## Quick reference

```bash
argo graph .                          # can this repo fan out, and how wide
argo graph . --brief --out .argo/fanout.md
argo baseline --tasks tasks.json      # is the crew earning its calls
argo diverge --threshold 0.35         # do my agents agree with each other
argo drift snapshot                   # before every upgrade
argo drift diff                       # after every upgrade
argo topology init && argo topology lint
```

In Claude Code: `/argo:fanout <task>` does the analysis and briefs the workers.
