---
name: model-routing
description: "Which model a spawned agent should run on. Use before dispatching any subagent or workflow fan-out, when deciding whether to pass a model option at all, when asked to 'use a cheaper model for subagents', 'stop the agents costing so much', 'why did that fan-out cost so much', or when a session is pinned to a specific model version and every agent must match it. Covers the inheritance default, why the model option cannot name a version, and how to route by role without losing quality."
---

# Model routing for spawned agents

## The two mechanism facts everything follows from

**1. A subagent inherits the parent's model by default.** Omitting the model option is therefore
an *active choice with a defined result*, not an oversight.

**2. The model option takes coarse aliases only** — `sonnet`, `opus`, `haiku`, `fable`. There is
no way to name a version through it.

Fact 2 has a consequence people get wrong: **if a session is pinned to a specific version, you
cannot reproduce it by passing an alias.** Passing `opus` from a session running an older Opus
may resolve to a *different* Opus. Inheritance is the only mechanism that reproduces an exact
version.

## The pin rule

> **If the session model was deliberately set to a specific version, every spawned agent must
> inherit it. Pass no model option anywhere — not to the Agent tool, not to workflow `agent()`
> calls, not in agent frontmatter.**

This is not a preference about cost. It is the only correct behaviour: an alias cannot express
"the version I chose", so overriding is guaranteed to be wrong and silently so. The result looks
fine and is running a model you did not select.

A hook detects this per session and states the rule in context, so it cannot be forgotten.

## Routing by role, when the session is on a current-generation model

Route to the **hardest decision the agent has to make on its own** — never to the average of its
work, and never to the volume of text it will read.

Four tiers, not three. The reviewer is its own tier and is named **explicitly** — that is the
distinction people collapse, and collapsing it is what makes a fan-out expensive *or* weak.

| Role | Model | Why |
|---|---|---|
| **Architect** — open-ended design, genuine ambiguity, deciding what "good" means | **inherit** (omit) | The orchestrator *is* the architect. Work needing its full context and judgment stays on it. |
| **Reviewer** — verification, adversarial checking, the quality gate | **`opus`, explicitly** | See below. This is the deliberate exception to "inherit for judgment". |
| **Coder** — implementing a specified change, tests to a stated spec, a bounded refactor | `sonnet` | The architectural intent is already in the prompt. It executes a decision rather than making one. |
| **Runner** — search, file location, inventory, counting, running tests, mechanical transforms | `haiku` | Zero reasoning required, and this tier fans out widest. |

### Why the reviewer is named and not inherited

Inheriting looks right and is wrong in **both** directions:

- If the orchestrator is a **weaker** model, inheriting puts your quality gate below the standard
  it exists to enforce. A verifier that cannot out-reason the coder is decoration.
- If the orchestrator is the **most capable and most expensive** model, inheriting spends that
  premium on a bounded, well-specified task — read this diff, decide if it is correct — which a
  strong-but-cheaper model does at least as well. Review is high-reasoning but *narrow*: the
  context is handed to it.

Naming `opus` is therefore correct whichever direction the orchestrator sits in. It is the one
place where an explicit override beats inheritance on both quality and cost at once.

**Always pair a `sonnet` coder with an `opus` reviewer.** That pairing is what makes the
downgrade safe — it is not "cheaper coding", it is "cheaper coding plus a gate". Downgrade the
coder without the gate and you have simply lowered the standard.

**The test for the other tiers:** if the agent must decide something *for itself* that is not
already in its prompt, it inherits. If every decision is made and it is carrying them out, it
goes cheaper.

## Why fan-out width is where this matters

Each subagent runs in **its own conversation, starting fresh**. It does not continue the parent's
context; it loads its own instructions and whatever it reads. So the cost of a fan-out is roughly
*per-agent startup × number of agents*, and it does not amortise the way a long single session
does.

That has two consequences:

- **The model choice multiplies.** Choosing well matters least for one agent and most for thirty.
- **Prompt size multiplies too.** A fan-out where each worker reads the whole repo is expensive
  regardless of model. Narrow what each agent is asked to read before reaching for a cheaper
  model — scope is the larger lever, and it costs no quality at all.

Order of operations: **scope the work, then pick the model.** A cheap model given too much to
read is both expensive and bad.

## Where routing loses quality, and how to keep it

Downgrading is not free. The failure is specific and predictable:

- **A weaker model returns confident, plausible, wrong output** on judgment tasks. It does not
  fail loudly. Never route verification, review, or "is this real?" work down — the whole point
  of a verifier is catching what the first pass missed.
- **A downgraded agent given an underspecified prompt will guess.** If you route to `sonnet`, the
  prompt must contain the decisions. Routing down and briefing vaguely is how quality is lost,
  and it gets blamed on the model.
- **Adversarial panels should not all be cheap.** If several verifiers vote, at least the
  deciding lens should inherit.

The rule that keeps quality: **route down only when you can state what the agent must NOT have to
decide.** If you cannot, it inherits.

## Slop to recoil from

- **Routing by task size.** "It only reads three files" says nothing about how hard the thinking
  is. A one-line answer can require the strongest model.
- **Passing an alias from a pinned session** — the exact bug this skill exists to prevent.
- **Downgrading the verifier** to save on a review pass. That inverts the purpose of the pass.
- **Treating a cheaper model as a fix for an expensive fan-out** when the real cause is that
  every worker was handed the entire repository.
- **Quoting prices from memory.** Rates change and are easy to misremember; several widely
  circulated cost comparisons contain arithmetic errors. If a decision genuinely turns on
  current pricing, look it up rather than recalling it — and note that the routing table above
  is justified by *capability fit*, which does not go stale.
- **Setting a model in agent frontmatter "to be safe".** That silently overrides inheritance for
  every future session, including pinned ones, which is precisely the failure above.

## Workflow fan-outs — a second dispatch path, covered separately

The per-dispatch routing hook fires on the Agent tool. **Workflow agents never pass through
it**: the Workflow runtime dispatches them directly. Left alone, every worker in a fan-out
inherits the session model — correct on a pinned session, pure over-assignment on a routable
one. That was observed: six workers on the top-tier model, one of them editing a single YAML
file.

So a second hook fires on the **Workflow tool call itself** and injects the session policy into
the script's `args` before it runs:

```js
args.__modelPolicy = { sessionModel, pinned, signals }
```

The script applies the same classifier with a small helper (scripts cannot import anything, so
it is inlined — the shipped `workflows/design-divergence.js` is the reference copy):

```js
const M = (prompt, extra) => {
  const m = routeModel(POLICY, { prompt, ...(extra || {}) })
  return m ? { model: m } : {}
}
agent(prompt, { label, phase, ...M(prompt) })
```

`routeModel` returns an alias or `undefined` (inherit), and returns `undefined` for **every**
agent when `pinned` is true. Two gates keep this honest: the hook's copy of the signal
vocabulary is held byte-identical to the routing hook's by test, and the shipped helper text is
evaluated against `decide()` over the entire labelled corpus.

Limits, stated plainly: a workflow whose `args` is a bare string cannot carry the policy and
inherits. And a script that omits the helper inherits — which is the safe direction, so a
forgotten helper costs money, never correctness.

## How this composes

`graph-engineering` decides **how many** agents and what they may read; this skill decides **what
each one runs on**. Do them in that order — worker count and scope come first, because a badly
shaped fan-out is expensive at any model tier.
