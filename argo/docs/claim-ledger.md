# Claim ledger

Every load-bearing claim in the @Argona0x "Graph Engineering" posts, checked
against primary sources. Verified 2026-08-17.

**Headline finding: almost nothing is fabricated.** Every hard number —
260, +80.8%, −70.0%, 45%, 17.2×, 4.4×, 0.658, 0.492, 0.463, 2.4×, d=1.18,
551 papers, 294 hours, 535,496 lines, 11 days — is real and traceable.

**The distortion is entirely in the connective tissue.** Four repeating moves:

1. **Framed as a leak.** "whoever leaked this has bigger balls than sense",
   "somebody just torched their entire career for us" — attached to peer-
   reviewed papers, public arXiv preprints, official vendor documentation, and
   open GitHub issues. Nothing leaked. This is the engagement wrapper.
2. **A variable deleted.** The Nature MI study varied coordination structure
   *and model capability*; dropping the second inverts the paper's thesis.
3. **Provenance upgraded.** *Nature Machine Intelligence* → "Nature". A
   December 2025 preprint → "last month". An X thread → a research blog post.
   A solo unreviewed preprint → implied peer review.
4. **Real launch, invented quotation.** Meta's Muse Code is real; the sentence
   presented as what Meta "led with" appears in no primary source.

---

## 1. Multi-agent topology — the 260-configuration study

**Verdict: CONFIRMED, with the thesis inverted in the retelling.**

Kim, Y., Gu, K., Park, C., et al. *Capable language models can outgrow the
benefits of collaboration.* Nature Machine Intelligence **8**, 1157–1172 (2026).
Preprint: [arXiv:2512.08296](https://arxiv.org/abs/2512.08296) ·
[journal](https://www.nature.com/articles/s42256-026-01268-y)
Affiliations: MIT, Google Research, Google DeepMind.

| claim | verdict | reality |
|---|---|---|
| 260 configurations, prompts/tools/compute held constant | ✅ | Near-verbatim from the abstract. Six benchmarks, five architectures, three LLM families. |
| "moved nothing but the wiring" | ❌ **FALSE** | Varied coordination structure **and model capability**. Capability is the paper's headline variable, not a nuisance one. |
| +80.8% to −70.0% | ✅ | Exact. Both endpoints verbatim. |
| "averaging out at 0.0%" | ⚠️ | Actual mean **−0.3%**, 95% CI [−58.7%, +77.2%]. Slightly negative, enormous spread. |
| "for Nature last month" | ⚠️ | *Nature Machine Intelligence*, July 2026 — a different journal. Preprint posted 9 Dec 2025. |
| 45% capability ceiling | ⚠️ | Real as a regression trend (β = −0.236, p = 0.004), not a rule. Validated at 94% on two of six benchmarks — ~6% go the other way. |
| 17.2× vs 4.4× error amplification | ✅ | Exact, correctly attributed. Independent systems amplify trace-level errors 17.2×; centralized coordination contains it to 4.4× via validation bottlenecks. p = 0.030. |

**What the paper actually concludes** — and what the "graph engineering" pitch
is built on inverting:

> single-agent baseline performance emerges as the most robust predictor of
> whether coordination improves or decreases performance

The title says it: capable models **outgrow** the benefits of collaboration. As
models improve, topology design matters *less*. This is the single most
important correction in this ledger.

---

## 2. Shared memory and hallucination contagion

**Verdict: CONFIRMED — every number — but it is one unreviewed preprint.**

Rodrigues, C. *Hallucination as Context Drift: Synchronization Protocols for
Multi-Agent LLM Systems.* [arXiv:2606.21666](https://arxiv.org/abs/2606.21666)
(19 June 2026). Solo author, not peer reviewed.

| protocol | hallucination rate | API calls / trial |
|---|---|---|
| full broadcast | 0.658 | 126 |
| no synchronisation | 0.492 | 18 |
| verified compressed summaries (SSVP) | 0.463 | 53 |

- Full broadcast is **34% worse than no sync at all** (p = 0.0022, d = 1.18).
- 126 / 53 = **2.4×** the API calls of the winner. ✅
- SSVP uses **58% fewer calls** than full broadcast. ✅
- 8 scenarios, one model family, **n = 30 per condition**. ✅
- **Effect does not replicate on software tasks** — all conditions converge
  under 0.2. ✅ He reports this caveat, to his credit.

Weight it as one narrow study, not as settled science.

---

## 3. The AgentTool suppression

**Verdict: CONFIRMED on every detail. The strongest claim in the set.**

Source: [anthropics/claude-code#80988](https://github.com/anthropics/claude-code/issues/80988),
opened 24 July 2026. Open, no staff response at time of writing.

- Prompt section registered internally as **`heron_brook`**, containing two
  joined lines:
  - *"Do not call the AgentTool unless the user requested it."*
  - *"Do not use workflows or deep-research unless the user requested it."*
- Present in **v2.1.219**, absent in **v2.1.218**. ✅
- **Opus 5 only** — model-gated, so the same repo fans out on one model and
  runs flat on another. ✅
- No setting, no flag, no env var. ✅
- Session logs never record a system prompt, so local logs show nothing. ✅

**This is live and it affects this machine.** A user-configured delegation
policy in `CLAUDE.md` does not count as "the user requesting it"; a *named*
request ("use the auditor subagent for the pre-check") does.

Corrections to his version:
- The workaround is a `UserPromptSubmit` hook — real, and it works — but the
  injected text lands as **additional context**, not as "user-side" context.
  The distinction matters for how reliably it overrides.
- The mode that strips hooks is **`--safe-mode`** / `CLAUDE_CODE_SAFE_MODE=1`
  (shipped 2.1.169), not "simple mode". No such feature as "simple mode".

---

## 4. Orchestrator economics — "96% of the performance at 46% of the price"

**Verdict: PARTLY TRUE. Real number, wrong provenance, stripped caveat.**

Actual source: [@ClaudeDevs, 8 July 2026](https://x.com/ClaudeDevs/status/2074606058128224365) —
not the multi-agent research engineering post it is usually attributed to.

- Fable 5 orchestrator → Sonnet 5 workers on BrowseComp: **86.8% vs 90.8%**
  accuracy, **$18.53 vs $40.56** per problem. That is the 96% / 46%.
- Companion pattern: Sonnet 5 executor + Fable 5 advisor ≈ 92% of Fable solo
  on SWE-bench Pro at ~63% of cost.
- **Anthropic's own August 2026 guidance walks this back**: a single frontier
  model at lower reasoning effort now often beats the orchestrator pattern on
  cost-performance. Quoting the July number as current is out of date.

---

## 5. Robin — the autonomous discovery loop

**Verdict: CONFIRMED, with two specific errors.**

Ghareeb, A., Chang, H., Mitchener, L., et al. *A multi-agent system for
automating scientific discovery.* Nature **655**, 497–505 (19 May 2026).
[Preprint arXiv:2505.13400](https://arxiv.org/abs/2505.13400) ·
**Code: [github.com/Future-House/robin](https://github.com/Future-House/robin)** (Apache-2.0)

| claim | verdict |
|---|---|
| 551 papers in 30 min vs 294 human hours | ✅ verbatim |
| 151 papers → 10 candidate mechanisms | ✅ verbatim |
| AMD, leading cause of blindness in developed world, 1.5M Americans | ✅ verbatim |
| ABCA1 upregulated 3-fold | ✅ (adj. p = 2.13×10⁻⁸³) |
| The loop is public on GitHub | ✅ real, runnable, ~669 stars |
| "a drug that has sat in pharmacies for years" | ⚠️ **ripasudil** — approved in **Japan only** since 2014, not FDA-approved |
| "an experiment no human ordered" | ❌ **FALSE** — Robin *recommended* it; humans accepted and executed it. Robin has no lab automation. Also, the RNA-seq was on **Y-27632**-treated cells, a research-grade ROCK inhibitor, not ripasudil. |

The architecture lesson he draws is sound and is the genuinely valuable part:
the loop writes its **own next question**, reading is split from judging, and
every cycle closes on a physical experiment rather than another model's opinion.

---

## 6. Grok Bot / SpaceXAI

**Verdict: CONFIRMED, except the number five.**

- **SpaceXAI is the real corporate name**, not his shorthand. SpaceX–xAI
  ~$1.25T all-stock merger agreed 2 Feb 2026; AI unit rebranded SpaceXAI on
  6 July 2026. SpaceX acquired Anysphere/Cursor 15 Aug 2026 — which is why an
  xAI product ships on a Cursor plan.
- Grok Bot launched in beta **11 Aug 2026**. $200/mo via Cursor Ultra;
  $120/seat Teams Premium; ~$300/mo SuperGrok Heavy. ✅
- "Five hireable workers" — ⚠️ the roster size is not five in the docs.
- Shared-computer warning is **verbatim** from
  [docs.x.ai](https://docs.x.ai/grok-bot/approvals-security-and-privacy): ✅
  > All of your Bots share one cloud computer assigned to your user account
  > … **Do not use separate Bots as a security boundary.**
- No Bot-specific spend cap; audit view "coming". ✅ verbatim
- Teach-by-demonstration records **up to ten minutes**. ✅ verbatim

**Five Eyes guidance: CONFIRMED.** *Careful Adoption of Agentic Artificial
Intelligence (AI) Services*, released 1 May 2026 — CISA, NSA, ACSC (AU),
Canadian Centre for Cyber Security, NCSC-UK, NCSC-NZ. First joint Five Eyes
guidance specifically on agentic AI. Warns against "broad or unrestricted
access, especially to sensitive data or critical systems" and recommends
agentic AI for "low-risk and non-sensitive" work only.
[CISA announcement](https://www.cisa.gov/news-events/news/cisa-us-and-international-partners-release-guide-secure-adoption-agentic-ai)

---

## 7. Meta Muse Code

**Verdict: PARTLY TRUE. Real launch, fabricated quotation.**

- Muse Code (beta) released **5 Aug 2026**, powered by Muse Spark 1.2, from
  Meta Superintelligence Labs.
  [Meta research blog](https://research.meta.ai/blog/introducing-muse-code-and-muse-spark-1-2) ✅
- Sub-agent fan-out is real: Meta's blog says it "can coordinate multiple
  persistent subagents", and Zuckerberg described it fanning out "to separate
  sub-agents working in parallel in isolated worktrees". ✅
- ❌ The exact sentence he presents as Meta's lead — *"Muse Code distributes
  complex tasks to sub-agents rather than having one agent do everything"* —
  appears in no primary source, and inverts Meta's actual emphasis on
  *persistent* agents.

---

## 8. The Bun rewrite

**Verdict: PARTLY TRUE. Right numbers, wrong noun, overstated autonomy.**

[Rewriting Bun in Rust](https://bun.com/blog/bun-in-rust), 8 July 2026.

- **535,496 lines of Zig** across 1,448 files → Rust, **3–14 May 2026 (11
  days)**, 6,778 commits. ✅
- ~$165,000 at API pricing: 5.9B uncached input, 690M output, 72B cached reads.
- Peak concurrency: **64 Claude instances** (4 workflows × 16 agents).
- ❌ **Bun is a runtime, not a JavaScript engine.** Its engine is
  JavaScriptCore (C++, from WebKit) and was *not* rewritten.
- ⚠️ "one million lines" is the size of the **resulting Rust output/diff**, not
  the original codebase. Rust expands relative to Zig.
- ⚠️ **Not autonomous.** Bun's founder Jarred Sumner supervised continuously:
  "For most of those 11 days (and after), I monitored workflows — manually
  reading the outputs to check for issues and bugs." He designed the
  implementer/reviewer pattern and corrected multiple false starts.
- Result: full suite passed on six platforms, zero tests skipped or deleted
  (57,337–60,624 tests/platform, 1.3M+ assertions). Contested publicly —
  Zig's creator called it unreviewed slop.

**The relevant lesson is the architecture, not the autonomy**: a
parallel implementer/reviewer pattern with a human supervisor, at 64-way
concurrency, over a partitioned tree. That is the real graph engineering
artifact in the whole corpus.

---

## Bottom line

| | |
|---|---|
| **Take seriously** | Nature MI topology study · error amplification 17.2× vs 4.4× · the `heron_brook` AgentTool suppression · Five Eyes agentic guidance · Robin's loop architecture · Bun's implementer/reviewer pattern |
| **Take with caveats** | Hallucination-contagion numbers (one unreviewed preprint) · 45% ceiling (regression trend, not law) · 96%/46% (superseded by Anthropic's own later guidance) |
| **Discard** | The leak framing · "moved nothing but the wiring" · the fabricated Meta quote · "no human ordered it" · Bun-as-engine |
