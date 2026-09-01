# Global Instructions

## MANDATORY UI/Design Resource Stack

For ANY frontend, UI, styling, animation, component, or design work — in every project, without exception — consult and use these resources FIRST, before writing anything from scratch. Full details and rules: `~/.claude/ui-design-stack.md`.

**This is not React-only.** For ANY visual work in ANY language — web/CSS, shaders (GLSL/HLSL/WebGL/Three.js), games (C#/MonoGame SpriteBatch, Unity, Godot, game-feel/juice), native/mobile (SwiftUI, Jetpack Compose, Flutter), generative art, terminal/TUI, data-viz — load the **`visual-design-mastery`** skill. It is the taste layer (one design/animation creed + per-stack references); the React libraries below are the component layer under it. "Fine" is the enemy in every medium.

**Three layers, consulted in order — TASTE → TECHNIQUE → COMPONENT.** The taste layer wins
unconditionally on conflict; the others add specificity under it, never replace it.

**Technique layer (installed skills, per-library craft):** `gsap-web` (timelines, ScrollTrigger,
pin/scrub), `svg-animation` (draw-on, morph, motion-along-path), `lottie-animation`,
`60fps-animation` (jank/compositor), `accessible-animation` (reduced-motion, vestibular),
`micro-interaction`, `page-transition-animation` (View Transitions API), `glassmorphism`,
`ascii-animation`, and the 3D stack `threejs-webgl` + `react-three-fiber` +
`web3d-integration-patterns`. One 3D stack deliberately — Babylon/PlayCanvas/A-Frame/Spline/PixiJS
are indexed, not installed.

**Tier-3 library — `{{LIBRARY_ROOT}}\` (815 skills on disk, none in context).** Only 13 skills are
resident (~1,508 tokens); installing all 815 would cost ~57,674 tokens *every session* and thrash
dispatch. Search it instead: `grep -i "<topic>" {{LIBRARY_ROOT}}\_index\INDEX.md`, then read the
SKILL.md at the path it gives. Regenerate after a `git pull` with
`node {{LIBRARY_ROOT}}\_index\build-index.mjs`.

**Precedence (do not re-litigate):** Motion beats `motion-framer`; the live component libraries
below beat `animated-component-libraries`; `visual-design-mastery/references/animation-principles.md`
replaces the 144-skill Disney cross-product. Never install `open-design` — it vendors stale copies
of 11 official Anthropic skills and would shadow the real ones.

**Component libraries:** 21st.dev (https://21st.dev/ — shadcn-compatible component marketplace, search first), Magic UI (https://magicui.design/ — animated components), KokonutUI (https://kokonutui.com/), Aceternity UI (https://ui.aceternity.com/ — animated hero/cards/backgrounds), React Bits (https://reactbits.dev/ — animated text/backgrounds), Bklit (https://bklit.com/ — data-viz/chart components).

**Animation:** Motion (https://motion.dev/) for React/JS — default choice; Anime.js (https://animejs.com/) for non-React or timeline-heavy work. Never hand-roll complex animations.

**Design reference:** Refero (https://styles.refero.design/) and Godly (https://godly.design/) — ground visual/layout decisions in these.

Use WebFetch to pull components/docs from these sites and the context7 MCP server for up-to-date library documentation.

## MANDATORY React Tooling Stack

For ANY React/Next.js/Vite/Remix/TanStack/React Native/Expo/Preact or JS/TS frontend work — every tool that applies is MANDATORY, and they must be used together (synergy), in this order: **react-doctor → eslint (react-hooks) → react-scan → strix**. Full details: `~/.claude/react-tooling-stack.md` and skill `react-tooling-stack`.

1. **react-doctor** — `npx react-doctor@latest` at project root (skill `react-doctor`). Fix or document every finding.
2. **eslint-plugin-react-hooks (global flat config)** — `eslint --no-config-lookup --config "{{ESLINT_CONFIG}}" .` — 0 new `react-hooks/*` errors. Every React project must have an `eslint.config.mjs` importing the global base for VS Code:
   ```js
   import base from "file:///{{ESLINT_CONFIG:url}}";
   export default [...base /* , ...project rules */];
   ```
3. **react-scan** — `npx -y react-scan@latest init` to wire projects; global CLI `react-scan`. Eliminate new re-render issues in affected flows.
4. **strix** — `strix --target <dir|url>` / `strix -n --scan-mode quick` for security (skills `*-with-strix`; requires Docker + `strix auth`). Authorized targets only.

Never claim a React task complete without running the applicable tools and fixing or explicitly documenting their findings. These mandates are enforced by Claude hooks (SessionStart + UserPromptSubmit).

## MANDATORY Security Tooling Stack

For ANY security testing, penetration testing, red-teaming, vulnerability hunting or research, security audit, exploit validation, CTF, OWASP work, or security review of auth/input/API/web-app code — both tools are MANDATORY and must be used together (synergy), in this order: **T3MP3ST recon → strix scan → fix → re-verify**. Full details: `~/.claude/security-stack.md` and skill `t3mp3st-security`. **Authorized targets only** — systems you own or have written permission to test; verify scope before every run.

1. **T3MP3ST** — global CLI `tempest` (backbone `local-agent` / `claude::opus` = **Claude Opus 5 on your Claude Code Max x20 login**, no API key; preconfigured — DeepSeek retired 2026-08-17); MCP tool `security_recon` (server `t3mp3st`, registered in all VS Code instances); War Room via `cd {{T3MP3ST_ROOT}} && npm run server` → http://127.0.0.1:3333/ui. Requires a one-time `claude setup-token` so the headless CLI can authenticate.
2. **strix** — `strix -n --scan-mode quick --target <dir|url>` (default gate) or full `strix --target`; skills `*-with-strix`; remediation skill `fix-security-vulnerabilities-with-strix` with re-scan to prove closure.

Never claim a security task complete without: authorization check, T3MP3ST recon, strix scan, remediation, and re-verification evidence. Enforced by Claude hooks (SessionStart + UserPromptSubmit).

## Delegation: Claude Code subagents / workflows (DeepSeek retired 2026-08-17)

**DeepSeek is no longer an acceptable backbone.** Do NOT use the `deepseek_*` /
`deepbrain_*` MCP tools or the `deepseek-delegation` skill; the alternative is
Claude Opus 5 running on your own Claude Code Max x20 login.

**Default posture on substantial implementation work: plan, delegate, verify —
delegate to Claude Code's own agents, which run on Opus 5 under your
subscription.** Use the **Agent** tool for a single focused subagent (research,
a self-contained change, a broad search) and the **Workflow** tool to fan out /
pipeline / adversarially verify across many units (audits, migrations, reviews).
Both bill to your Max x20 — no separate API. Prefer running several scoped
phases in sequence, reading each result before the next, over one mega-agent.
Do the work in the main thread yourself for architecture, security-critical
judgment, genuine ambiguity, or trivial edits where a subagent is overkill.

## MANDATORY Model Routing for spawned agents

**Two mechanism facts.** A subagent **inherits the parent's model by default**, and the model
option accepts **coarse aliases only** — `sonnet`, `opus`, `haiku`, `fable`. It cannot name a
version.

**THE EXCEPTION, and it overrides everything below.** If the main model is set to a specific
version the aliases cannot express — **Opus 4.7, Sonnet 4.6, Opus 4.8**, or any other pinned
selection — then **every** spawned agent, subagent and workflow agent runs on that same model.
Pass **no** `model` option: not to the Agent tool, not to workflow `agent()` calls, not in agent
frontmatter. Inheritance is the *only* mechanism that reproduces an exact version; passing
`opus` from an Opus 4.7 session may silently resolve to a different Opus. Omitting the option is
the instruction, not an oversight.

**Otherwise, gauge each agent by TASK DIFFICULTY** — by the hardest decision it must make on its
own, never by how much text it reads:

| Difficulty | Model |
|---|---|
| Trivial, no judgment — search, locate, inventory, count, run tests, mechanical transforms | `haiku` |
| Specified work, thinking already done — implement a decided change, tests to a spec, bounded refactor | `sonnet` |
| Verification and review — is this correct, is this finding real, adversarial checking | `opus` (named explicitly) |
| Genuinely hard — open design, unresolved ambiguity, synthesising conflicting results | **inherit** (omit) |

Pair a `sonnet` coder with an `opus` reviewer: the gate is what makes the cheaper coder safe.
**If you cannot state what the agent must NOT have to decide, do not downgrade it.** Fan-out
width multiplies whichever you choose, so this matters most when there are many agents.

**This is APPLIED AUTOMATICALLY — you do not have to pick, and you cannot forget.** A
`PreToolUse` hook rewrites the Agent tool's input before every dispatch (`updatedInput`):

- On a **pinned** session it **strips** any `model` option, forcing inheritance. That case is
  purely mechanical, so it is fully automated and cannot be violated.
- On a current-generation session it **fills in** a model only when the signal is unambiguous —
  a reviewer/verifier agent type or verification language gets `opus`; pure retrieval with no
  decision verb gets `haiku`; work explicitly scoped to a stated spec gets `sonnet`. Anything
  ambiguous is left unset, which means inherit.
- An explicit choice you made is always respected; the hook only fills a blank.

The bias is deliberate: a wrong downgrade yields confident, plausible, wrong output that nobody
notices, while an unnecessary inherit only costs money. So ambiguity always resolves upward. The
hook never returns a permission decision — it adjusts an argument, it does not grant approval.

A second hook states the applicable rule each prompt so the reasoning is visible. Full detail:
skill `model-routing`.

## MANDATORY Graph Engineering — argo

**Before dispatching more than one agent, measure the graph.** Multi-agent work
fails on *topology*, not model quality: agents contradicting each other, cost
climbing, delegation quietly stopping. Those are graph symptoms and a better
model will not fix them.

```bash
argo graph . --brief                          # worker count, shared surface, frozen files
argo graph . --touch <paths|globs> --brief    # task-scoped: workers own the write-set only
```

Paste each worker's `Coupling:` line from the brief into its prompt verbatim: `coupled` is
worded so the model-routing hook cannot downgrade a worker on a hub; `isolated` says nothing,
and your task text decides.

**Take its worker count.** It is derived from the **shared surface** — files
reachable from more than one partition — not from a round number you picked.
Two agents on a tree with a 40% shared surface is worse than one agent.

Rules that outrank the count:
1. **Workers never read each other's output.** Everything routes through you as
   supervisor. Peer edges are how a fleet talks itself into a shared mistake.
2. **The shared surface is read-only during fan-out.** Any edit to it happens in
   a serial pre-step, before a single worker starts.
3. **A crew has to beat a single agent on the same task**, or it is subtracting
   value. That is an empirical claim — measure it, don't assume it.
4. A worker that needs a frozen file changed **reports instead of editing**.

Diagnosing a fleet that has gone wrong:

```bash
argo diverge     # disagreement per PAIR — a fleet average hides the bad pair
argo baseline    # was the crew ever beating one agent?
argo drift diff  # did a shipped system prompt change under you?
argo doctor      # lint the declared topology
argo fanout      # generate the plan + per-worker briefs
```

Skill `graph-engineering` carries the full model. Agents `graph-worker`,
`graph-supervisor`, and `hub-splitter` are pre-briefed with these containment
rules — prefer them over ad-hoc subagents for partitioned work. When `argo
graph` reports a **hub-bound** verdict, split the hub with `hub-splitter`
before widening the fan-out; more workers against a hub just adds contention.
