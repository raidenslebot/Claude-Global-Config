# Landscape: who else is doing this

Verified 2026-08-17. Separated by signal, because the gap between the research
and the content built on top of it is wide.

---

## Where the term actually came from

**Not from @Argona0x.** "Graph Engineering" spread after **Peter Steinberger**
([@steipete](https://x.com/steipete), creator of OpenClaw) posted twelve words
on **18 July 2026**:

> Are we still talking loops or did we shift to graphs yet?

2.9M views. Argona's pinned "full course" article is dated **24 July** — six
days later. A content wave followed through July–August 2026: Medium, Substack,
eigent.ai, explainx.ai, V12 Labs, Flowtivity, AI Builder Club. Most of it
rewrites the same three studies.

The honest assessment, which several of those posts make themselves:

> Nothing shipped in July 2026 that you couldn't build in 2025. LangGraph,
> AutoGen, and Google ADK were doing graph orchestration well before the term
> existed.

The term is a **naming convention for existing practice**. That is not nothing —
naming a layer is how it gets owned — but it is not a new capability.

---

## The real research

This is where the substance is. Automated topology search for multi-agent LLM
systems is an active, credible subfield.

| system | what it does |
|---|---|
| **GPTSwarm** (ICML 2024) | Treats agents as an optimizable computational graph; searches over the connections themselves. The origin point for this line of work. |
| **MASS** — Multi-Agent System Search | Meta-framework searching a customizable topology space; substantial gains over single-agent design. |
| **AgentPrune** | Prunes the communication graph to cut token cost while holding performance. The efficiency angle. |
| **MaAS** | Dynamic routing — adaptively selects backbone models *and* architectures per sample. |
| **G-Designer** | Generates task-adaptive topologies with a variational graph auto-encoder. |
| **MacNet** | Collaborative scaling laws over DAG-structured agent networks. |
| **EvoMAC / EvoAgent / AgentNet** | Self-evolving topologies — agents and connections mutate at test time. |
| **G-Safeguard** | Topology as a *security* lens: attack surface follows the graph. |
| **AgentSwift** | Value-guided hierarchical search over agent designs. |

Anchor papers for the claims in [`claim-ledger.md`](claim-ledger.md):

- **Kim, Gu, Park et al.**, *Capable language models can outgrow the benefits of
  collaboration*, Nature Machine Intelligence 8:1157–1172 (2026) ·
  [arXiv:2512.08296](https://arxiv.org/abs/2512.08296) — **the one to read.**
- **Rodrigues**, *Hallucination as Context Drift*,
  [arXiv:2606.21666](https://arxiv.org/abs/2606.21666) — one unreviewed preprint.
- **Ghareeb et al.**, *A multi-agent system for automating scientific discovery*,
  Nature 655:497–505 (2026) · code at
  [github.com/Future-House/robin](https://github.com/Future-House/robin).

Also worth tracking: *Why Do Multi-Agent LLM Systems Fail?* (Berkeley, MAST
taxonomy) for failure-mode vocabulary.

---

## Frameworks that let you express the graph

The distinction that matters: most frameworks let you **run** a graph. Few let
you **measure** one.

| | expresses topology | measures it |
|---|---|---|
| **LangGraph** | Explicitly — nodes, edges, conditional routing, checkpointers. The most graph-native option. | Via LangSmith tracing. |
| **Claude Agent SDK** + Claude Code subagents/hooks/plugins | Implicitly — dispatch is a tool call, not a declared edge. | No native topology view. |
| **OpenAI Agents SDK** | Handoffs as edges; the guide models workflows as graphs. | Traces, not graph metrics. |
| **Google ADK** + A2A protocol | Agent-to-agent as a first-class protocol. | Vertex Agent Engine telemetry. |
| **Microsoft AutoGen / AG2**, Semantic Kernel | Conversation patterns over explicit graphs. | Limited. |
| **CrewAI**, Mastra, PydanticAI, Agno, smolagents | Roles and crews; topology mostly implicit. | Limited. |
| **DSPy** (+ GEPA) | Optimizes the program, including multi-module structure. | Compiler-style metrics. |
| **Temporal / Restate / Inngest / DBOS** | Durable execution — the graph is the workflow. | Excellent execution visibility, no agent-quality metrics. |

**Argonaut's niche is the empty column.** `argo topology lint` enforces rules on
a declared graph; `argo graph` derives the width the *repo* supports; `argo
diverge` measures whether the fleet actually agrees. None of the above do that.

For sandboxed fan-out where workers write to overlapping paths: **E2B, Daytona,
Modal, Fly.io Machines**, or Claude Code's own `isolation: "worktree"`.

---

## Observability and eval

To produce your own numbers rather than quoting anyone else's:

- **Tracing:** LangSmith, Langfuse (self-hostable), Braintrust, Arize Phoenix,
  W&B Weave, Helicone, AgentOps, Laminar. OpenTelemetry GenAI semantic
  conventions are the portable option.
- **Eval:** promptfoo, DeepEval, Ragas, **Inspect** (UK AISI — strong for agent
  evals), OpenAI Evals, LM Eval Harness.
- **Agent benchmarks:** SWE-bench Verified, τ-bench / τ²-bench, GAIA, WebArena,
  OSWorld, Terminal-Bench, MLE-bench.

---

## People worth reading

Signal, roughly ranked:

- **Anthropic engineering** — the multi-agent research system post, and the
  `@ClaudeDevs` orchestrator/advisor cost measurements. Primary source for
  Claude-specific patterns.
- **Simon Willison** — reliably first and reliably accurate on what actually
  shipped. Covered the Bun rewrite the day it landed.
- **Hamel Husain, Shreya Shankar, Eugene Yan, Jason Liu** — evals and LLM
  engineering practice. The antidote to vibes-based agent claims.
- **Omar Khattab** (DSPy), **Harrison Chase** (LangGraph) — the people building
  the abstractions rather than describing them.
- **Peter Steinberger** — OpenClaw; originated the term under discussion.
- **Jarred Sumner** (Bun) — the *Rewriting Bun in Rust* post is the single most
  useful practitioner document here: 64-way concurrency, implementer/reviewer
  pairs, a real test oracle, continuous human supervision, honest about cost.
- **swyx / Latent Space**, **Nathan Lambert / Interconnects** — synthesis.

### The same-genre tier

Accounts running the identical formula to @Argona0x — dramatic hook, a real
paper's numbers, "I ran it on my own setup", a branded frame, actionable
bullets, "bookmark this", link to a gated article. The numbers are usually real;
the framing is usually distorted; the leak language is theatre.

**How to read any of them in thirty seconds:** find the primary source they are
describing. If the post named it plainly, it is worth reading. If the post
framed a public arXiv preprint or an open GitHub issue as a leak, assume the
rest of the framing is doing the same work — then go read the paper, which is
free.
