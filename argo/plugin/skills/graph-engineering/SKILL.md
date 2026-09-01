---
name: graph-engineering
description: "Use BEFORE running agents in parallel, dispatching subagents, splitting work across a fleet, or choosing a worker count — and when debugging a multi-agent setup that got slower, more expensive, or started contradicting itself. Covers fan-out width, shared surface, supervisor placement, peer edges, state broadcast, and divergence between agents. Triggers on: subagents, parallel agents, fan out, delegate, worker count, agent fleet, orchestration, multi-agent, swarm, crew, sub-agent, dispatch."
---

# Graph Engineering

Three layers, and only the third one is usually unowned:

| layer | question it answers |
|---|---|
| prompt engineering | what one agent is **told** |
| context engineering | what one agent can **see** |
| **graph engineering** | **which agents may talk to which** |

Every edge you draw between two agents is a channel a mistake can travel down.
Most fleets have never written their graph down, so nobody can say which edges
exist — and the edges that cause the damage are the accidental ones.

**The failure this prevents:** you ask two of your own agents the same question
and get two different answers. Each is individually right. The pair is wrong.
Nothing in a fleet-average metric shows you this.

## The first question, before any of the others

**Is a crew earning its calls at all?**

A crew is a bet on your own diagram. The control that settles the bet is a
single agent doing the same work. Keep it alive.

```bash
argo baseline --tasks tasks.json
```

The controlled result (Kim, Gu, Park et al., *Capable language models can
outgrow the benefits of collaboration*, Nature Machine Intelligence 8:1157–1172,
2026; preprint [arXiv:2512.08296](https://arxiv.org/abs/2512.08296)) — 260
configurations, six benchmarks, five architectures, three model families:

- Same work swung **+80.8%** (structured financial reasoning, centralized
  coordination) to **−70.0%** (sequential planning, independent coordination).
- Overall mean improvement: **−0.3%**, 95% CI [−58.7%, +77.2%]. Coordination
  is not reliably positive; it is high-variance around roughly nothing.
- **Capability ceiling** (β = −0.236, p = 0.004): past ~45% single-agent
  accuracy, extra agents produce negative returns. Validated at 94% on
  SWE-bench Verified and Terminal-Bench — so ~6% of cases go the other way.

**Read the paper's actual thesis, not the popular inversion of it.** The study
varied coordination structure *and model capability*, and its conclusion is
that as models get stronger, coordination design matters **less**. Graph
engineering is most valuable exactly where your solo agent is weak. Anyone
selling it as universally decisive has deleted the second variable.

Treat 45% as a **prior to override with your own measurement**, not a law.

If solo already works, stop here. The rest of this skill is for when it doesn't.

## The laws

**1. Freeze the shared surface — compute it, don't guess it.**
Partition the repo, then find the files named from more than one partition.
That set is what every worker must read and therefore what no worker may
freely edit. It is not the big files. Fan-in tracks nothing about file size.

```bash
argo graph . --brief --out .argo/fanout.md
```

**2. Worker count is set by the shared surface, not by taste.**
Wall-clock is bounded by the slowest worker, so an unbalanced cut wastes the
extra processes. `argo graph` sweeps widths and reports effective speedup;
take its recommendation over a round number.

**3. No peer edges. Ever, by default.**
A worker reading another worker's draft turns one wrong step into four.
Measured: independent systems with no correction step amplify trace-level
errors **17.2×**; centralized coordination with a validation bottleneck holds
it to **4.4×** (Nature MI 2026, p = 0.030). Route every output to the
supervisor. If a peer edge is genuinely required, declare it explicitly with a
written justification — `argo topology lint` enforces this.

**4. Compressed, verified summaries beat full state broadcast.**
Broadcasting whole state to everyone is the thing most people build first and
it is measurably worse than no sharing at all. Hallucination rate by protocol
(Rodrigues, *Hallucination as Context Drift*,
[arXiv:2606.21666](https://arxiv.org/abs/2606.21666), June 2026):

| protocol | hallucination rate | API calls/trial |
|---|---|---|
| full broadcast | **0.658** | 126 |
| no synchronisation | **0.492** | 18 |
| verified compressed summaries | **0.463** | 53 |

Full broadcast cost 2.4× the calls of the winner and hallucinated 34% *more
than doing nothing* (p = 0.0022, d = 1.18). The middle option is doing nothing,
and it beats the thing everyone builds first. Caveat honestly: this is a single
unreviewed preprint, one model family, n=30 per condition.

**5. Never propagate state nobody checked.**
Unreviewed state entering a shared layer is how an entire fleet copies one
mistake — the contamination effect above is a full standard deviation of extra
error. Put verification on the write, not on the read.

**6. Cut sync frequency until it hurts.**
Sync is a cost and a contamination channel at once. The winning protocol used
58% fewer calls than the one that broke it. The cheaper configuration is often
also the more accurate one — which is why "it got slower AND worse" is such a
common report.

**7. Keep the shared layer small enough to diff.**
A written standard can be diffed. A running conversation cannot.

**8. Unanimity is a symptom, not a success.**
When every agent agrees, that is also exactly what it looks like when every
agent copied the same mistake. A fleet that hallucinates in unison has a
replication problem, and handing it a smarter model does not fix replication.

**9. Measure divergence per PAIR, and gate on the worst probe.**
The average of two contradictory answers looks healthy. The pair is the unit —
and within a pair, the *question they split on* is the unit. Averaging across
probes hides a flat contradiction behind every question they happened to agree
on, which is the same mistake a fleet average makes, one level down.

```bash
argo diverge --threshold 0.35              # gates on the worst probe
argo diverge --threshold 0.35 --gate mean  # lenient, hides single contradictions
```

**10. Re-run all of it after every model upgrade.**
A better model raises the solo baseline, and a higher baseline is what makes a
crew stop paying. The wiring that won last quarter can be the wiring that
loses this one.

**11. The arrows can be erased from outside your system.**
A vendor can ship a line into a system prompt that changes whether delegation
fires, with no setting, flag, or env var. Session logs never record a system
prompt, so your own logs will say nothing happened.

```bash
argo drift snapshot     # before you upgrade
argo drift diff         # after
```

## Where this does NOT bite

Say so out loud when it applies, rather than selling the frame:

- **Plain, well-specified software tasks** with a clear spec and a test to check
  against. The contamination effect **does not replicate** in the software
  domain — every protocol converged under 0.2 hallucination rate and the whole
  effect vanished. If you are writing code against tests, this matters much
  less than it does for open-ended research.
- **Strong models on tasks they already handle.** The capability ceiling is
  real and it moves up with every release.
- **Small trees**, where the shared surface is a rounding error.
- **Genuinely independent work** (separate services, separate repos) — there is
  no graph to engineer because there are no edges.
- **One-shot questions.** A crew is overhead with nothing to amortise it.

## Applying it in Claude Code

Before dispatching parallel `Agent` calls over a repo:

1. `argo graph . --brief --out .argo/fanout.md` — get the plan.
2. Use its worker count. Give each worker **only** its own file list.
3. Paste the FROZEN list into every worker's brief as read-only.
4. Tell each worker: report to the supervisor, never read a peer's output.
5. Any edit to a frozen file happens in a **serial pre-step**, before fan-out.

`/argo:fanout` does steps 1–3 for you.

## Running this fleet in Claude Code

Three agent definitions implement the discipline above. Dispatch them by name:

| agent | does what |
|---|---|
| `graph-supervisor` | the validation bottleneck — aggregates worker reports, owns the frozen surface, re-measures the graph afterwards. This is the 17.2× → 4.4× step from law 3. |
| `graph-worker` | owns one partition and nothing else. Reports up, never sideways. |
| `hub-splitter` | shrinks the shared surface by splitting one hub. A serial pre-step; never runs while workers do. |

Declare the fleet before you run it, so lint is checking the graph you will
actually dispatch:

```bash
argo topology init .     # agents carry an agentType naming the definition above
argo topology lint       # R9 flags an agentType nothing ships
```

## Skills that pick up where this one stops

This skill decides the shape of the fleet. Four others in this plugin handle
what happens inside it — reach for them by name rather than re-deriving them:

| skill | when this one hands off to it |
|---|---|
| `agent-watchdog` | A run already happened and nobody supervised it. `graph-supervisor` aggregates workers it dispatched; `agent-watchdog` reconstructs what was asked and audits what actually changed, after the fact. |
| `efficient-frontier` | You have decided a crew is worth it and now have to choose models. Spend the expensive one on judgement, the cheap ones on volume. The measured trade and its later walk-back are in `docs/playbook.md`. |
| `efficient-fable` | The concrete orchestrator-and-helpers arrangement of the above, on codebase-heavy work. |
| `stay-within-limits` | Before a wide fan-out. Width multiplies token burn, and a crew that hits a usage ceiling half-way through is worse than a narrower one that finishes — the shared surface caps width, but so does your quota. |

Order in practice: `stay-within-limits` → this skill → `efficient-frontier` →
dispatch → `agent-watchdog` if something looks off afterwards.

## Plugins that fan out — plan the partition here first

Two other plugins on this machine dispatch their own fleets. They decide *what*
each agent does; this skill decides *how many* and *over which files* — so run
`argo graph` before them, not instead of them:

- **`claude-security`** (the `/claude-security` scan) fans a repo out to seven
  agents — inventory, researchers, verifiers, patch generator/verifier. That is
  a fan-out over the same shared surface this skill measures. `argo graph .`
  gives it the honest worker count and the frozen hub files before it spreads;
  on a `hub-bound` repo, splitting the top hub first (via `hub-splitter`) makes
  its scan wider and cheaper. The security stack (`t3mp3st` recon → `strix`
  scan) is the single-agent control to run first — if one agent already clears
  the finding, the seven-agent fan-out is subtracting value, exactly as the
  baseline law says.
- **`superpowers:dispatching-parallel-agents`** is the general "2+ independent
  tasks" dispatcher. It assumes the tasks are already independent; this skill is
  how you *prove* they are — the shared surface is the set that makes two
  "independent" tasks secretly collide. Compute it first, freeze it, then let
  superpowers dispatch the genuinely-disjoint remainder.

## Honest provenance

Every number above traces to a primary source and is quoted with its caveats.
Two of the three load-bearing results come from a **single study each**, one of
them an unreviewed solo preprint. The Nature MI result is the strongest and its
real thesis cuts *against* over-investing here: better models need less
coordination design.

Measure your own numbers with the tools above rather than quoting anyone
else's, including these. `docs/claim-ledger.md` has the claim-by-claim audit,
including where the popular retellings distort the sources.
