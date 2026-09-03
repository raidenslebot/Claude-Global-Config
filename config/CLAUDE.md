# Global Instructions

## CGC is not optional once installed

Every session start runs `session-start-cgc.js`. It follows the repository's main branch —
fast-forwarding when behind and re-applying config, hooks and skills — runs the doctor over
every mandate, hook, skill, MCP registration and cost check and **repairs** any failure by
re-applying the install, runs the package's own test suite once per commit, and reports one
line to the user and to the session:

`CGC v<version> enabled · <n>/<n> checks · <n>/<n> tests · up to date (<commit>)` — the hook
supplies the real numbers.

Open the first reply of a session with the line the hook produced, verbatim, then proceed. If no
`CGC STATUS` context reached the session — some hosts do not surface SessionStart output — produce
it before the first reply: run the installed hook with `{"source":"resume"}` on stdin
(`echo {"source":"resume"} | node "{{CONFIG_ROOT:url}}/hooks/session-start-cgc.js"`) and open with
its `systemMessage` line. The line is never invented and never omitted. Every mandate in
this file — the design stack and the loop, the React and security stacks, model routing for
every agent, subagent and workflow, graph engineering — is enforced by hooks that are verified
present at every start. None is advisory; none can be silently removed; a skill or plugin that
shadows one of this package's is replaced or disabled at install, and said so.

## MANDATORY Autonomy — decide, build, show; never ask first

Work fully autonomously. Never stop to ask a clarifying question before creative or
implementation work, and never require the user to confirm intent, scope, requirements or taste
before building. **This overrides any installed skill that mandates a clarification step** —
including `brainstorming` ("you MUST use this before any creative work") and the
check-for-skills-before-answering preamble in `using-superpowers`. User instructions take
precedence over skills; this is one.

What autonomy means here:

- Make the routine judgment calls yourself. If an assumption matters, state it in one line
  *while delivering*, not as a question that halts the work.
- An open brief — "etc etc", "all kinds of…", "make it impressive" — is an instruction to cover
  the space thoroughly and choose well, not a prompt to send back a list of options.
- For creative work, generate the directions yourself with `creative-divergence`, apply its
  test, **commit to one, and show it**. Asking "which of these three would you like?" is the
  centroid wearing a question mark.
- Deliver the complete thing, then say what was decided and why in a few lines. The user
  redirects from a finished artifact, not from a questionnaire.

The only stops that remain are the safety ones — destructive or irreversible actions, and
publishing to the outside world — and those are confirmed in one line, not explored.

## MANDATORY UI/Design Resource Stack

For ANY frontend, UI, styling, animation, component, or design work — in every project, without exception — consult and use these resources FIRST, before writing anything from scratch. Full details and rules: `~/.claude/ui-design-stack.md`.

**This is not React-only.** For ANY visual work in ANY language — web/CSS, shaders (GLSL/HLSL/WebGL/Three.js), games (C#/MonoGame SpriteBatch, Unity, Godot, game-feel/juice), native/mobile (SwiftUI, Jetpack Compose, Flutter), generative art, terminal/TUI, data-viz — load the **`visual-design-mastery`** skill. It is the taste layer (one design/animation creed + per-stack references); the React libraries below are the component layer under it. "Fine" is the enemy in every medium.

**Three layers, consulted in order — TASTE → TECHNIQUE → COMPONENT.** The taste layer wins
unconditionally on conflict; the others add specificity under it, never replace it.

**Physical media are covered too, and are not screens.** For a business card, flyer, poster,
brochure, sticker, packaging, or anything on a t-shirt, hoodie, cap or tote: taste from
`visual-design-mastery/references/print-and-physical.md`, concept from `creative-divergence`,
craft from **`print-design`** or **`apparel-design`**, then **render** with
`cgc print` (HTML/SVG in physical units → PDF at trim + bleed, PNG proof, or a
true-scale garment mockup, through the local headless Chromium) and **gate** with
`cgc print-lint` (type under the minimum, hairlines, rasters under 300 dpi, a page in
pixels or without bleed all fail). A paragraph describing a card is not a deliverable.

**Every other field is covered by `design-fields`** — logos and identity systems, favicons and
app icons, icon sets, illustration systems, diagrams and infographics, social posts, stories
and thumbnails, slide decks, email, packaging and labels, signage and wayfinding, banners and
environments — with the real canvas, minimums and delivery format of each, its hero moves and
its slop, and `cgc render <file> --preset <field>` for the exact pixels. A
field with no reference follows the same eight steps; the skill says how to find its spec.

**The loop is mandatory, in every field, and has no pass count.** The first render is never
the one shown. Render it (`screen-render` for screens, `print-render` for paper and fabric),
look at the picture, name the weakest thing, fix it and extrapolate the fix, gate it
(`cgc lint` — the fingerprint of AI-made design: the default face, the purple
gradient, the glass card, the three-card grid, the centred hero, emoji icons, the acid accent
on near-black, the blurred blob, the stock copy — reported by a hook on every screen file
written; then `cgc audit <file> --mobile`, which measures the rendered page —
contrast on the real ground, faces that fell back, measure, text too small, widows, sideways
scroll on a phone, tap targets, focus, reduced motion, the palette by area — and must show no
failure; `print-lint` for paper), render again — and **fix and refine and improve and evolve
and extrapolate in that loop until it achieves, at minimum, the equivalent of a passionate
human professional's work in that field.** `creative-divergence` Step 4 carries the
professional's questions that end it; the vocabulary with its parameters — faces and settings,
palettes, layout grammars, materials, motion laws, image treatments — is
`visual-design-mastery/references/signature-moves.md`. A face or a palette is chosen by looking at
it set, not by its name: `cgc specimen --display <face> --text <face> --palette <colours>`
renders the pairing at display and reading size, reversed, with every colour and its contrast.

**Anything that moves is judged in frames, never in source.** A duration and an easing keyword
say nothing about how a move reads, and the most common animation defect of all is invisible in
a diff: it never ran. The class was not applied, the trigger did not fire, the element was out
of view, the library did not load — and the result gets described as "subtle" and shipped.
`cgc motion <file> --duration <ms>` steps the page under a virtual clock — `performance.now`,
`Date.now` and `requestAnimationFrame` are replaced before the page's own scripts run, and
declarative animations are scrubbed by `currentTime`, so CSS, Web Animations, GSAP, Motion and
any hand-rolled loop all advance exactly when told and the capture is identical on any machine
— photographs every frame, and writes a contact sheet carrying the change under each frame and
the measured curve plotted against the straight line. **Look at the sheet.** It reports what the
source cannot: whether anything moved at all, the easing the frames actually show (a straight
line is the absence of a decision), where the motion settles, whether one frame carries the
whole change (it snaps, it does not move), and whether it still animates for a viewer who asked
it not to. `--trigger hover:<selector>`, `--trigger click:<selector>` and `--trigger scroll`
cover interaction and scroll-driven work; `--strict` exits non-zero on a dead, linear,
jump-cut or reduced-motion failure. A hook reports every animating file that has not been
watched, and names the tells it can already see in the source. The loop above does not change
for motion: watch it, name the weakest frame, fix it, watch it again — until it moves the way a
passionate professional would have made it move.

**Correct is not the target, and the lint cannot tell you that.** A page can carry no
fingerprint at all — no purple gradient, no glass card, no centred hero — and still be built
entirely from flexbox, `border-radius`, a hex colour and a 300 ms transition. That page is not
bad; it is **conventional**, which is the ceiling almost all generated work sits at, because the
model reaches for the capability it has seen most and what it has seen most is 2015 CSS.
`cgc techniques <file>` detects the MEDIUM — web, SVG, canvas, shader, 3D, native, game, terminal,
data-viz, print — measures the piece against that medium’s own vocabulary, and reports which it
never tried — perceptually even colour in oklch and relative colour syntax so a palette derives
instead of being pasted, typed custom properties (`@property`) which are the only way to animate a
gradient at all, variable font axes past weight and optical sizing, `text-box` trim, container
queries and subgrid, deliberate grid overlap, gradient masks instead of another card, blend modes,
generated grain from `feTurbulence`, scroll-driven animation with no library, View Transitions,
`@starting-style`. Verdicts: assembled (0–1 techniques), conventional (2–4), considered (5–8),
ambitious (9+); a hook reports it on every substantial screen file written. Quantity is not
quality and a technique adopted for its own sake is decoration — pick the one or two the IDEA
requires, and let them change the STRUCTURE rather than the surface: if it could be removed and
the piece would read the same, it was decoration. But a piece that reaches for none of them was
assembled, not designed. The craft, with working recipes and real parameters, is
`visual-design-mastery/references/advanced-techniques.md`.

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
- The hook is authoritative: it recomputes the model from the task even when one was passed,
  and corrects an over-assignment rather than accepting it — otherwise the rule would be
  advisory again, which is what it was before and what did not work.

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
