# Claude-Global-Config — mandates for Codex

This block is installed and refreshed by Claude-Global-Config (CGC). Everything outside the
`CGC:BEGIN` / `CGC:END` markers is yours and is never touched.

## What is different here, stated first

**CGC installs hooks here too, and they are trusted, so most of this file is enforced rather
than merely read.** Ten handlers are registered in `$CODEX_HOME/hooks.json` across the three
events whose payload means the same thing on both harnesses — `SessionStart`, `UserPromptSubmit`
and `Stop` — and each one is trusted in `$CODEX_HOME/config.toml`. That includes the version
check below: it runs by itself at the start of a session and on every prompt.

Ten more are deliberately left OUT. This package's `PreToolUse` and `PostToolUse` hooks match
Claude Code's tool names (`Write`, `Edit`, `MultiEdit`) and Codex's tools are `exec`,
`spawn_agent`, `send_message`, `wait`, `list_agents` — so they would install, trust, and never
fire. A hook that is registered and matches nothing is worse than an absent one, because
everything reports healthy. **So the design gates — the slop lint, the motion check, the
behaviour gate — do NOT run automatically here. Run them yourself: `cgc check <file>`.**

One Codex-specific fact worth knowing, because it will bite you if you ever edit a hook by hand:
an **untrusted hook is silently skipped** — no prompt, no error, no log line. Writing
`hooks.json` is not installing a hook. `cgc install --only=codex` reads the trust state back
from Codex and writes it, and the doctor FAILS when anything is untrusted.

(An earlier version of this file said Codex had no hooks at all. It was wrong: I looked once,
did not find them, and wrote down the absence. Treat that as the worked example for the rule two
sections down — never report a thing as verified on the strength of having looked.)

The tooling itself is not weaker: `cgc` is a set of Node programs, so every gate, render and audit
below behaves identically on both harnesses.

## FIRST, EVERY SESSION: check the version and open with the line

CGC follows its own repository. A stale copy means every mandate, gate and fix released since is
simply absent, and nothing here will tell you. So before your first reply, run:

```bash
echo '{"source":"resume"}' | node "{{REPO_ROOT:url}}/config/hooks/session-start-cgc.js"
```

It fast-forwards the clone when behind, re-applies config and skills, runs the doctor, repairs
what it can, and prints one line as `systemMessage` in its JSON:

`CGC v<version> enabled · <n>/<n> checks · <n>/<n> tests · up to date (<commit>)`

**Open your first reply with that line, verbatim, on its own line.** Never invent it and never
omit it. If it says DEGRADED or blocked, add the fix in one sentence. Run it again whenever you
resume a session that has been idle — in Claude Code a hook does this per prompt; here you are
the mechanism.

## Autonomy — decide, build, show

Work autonomously. Never stop to ask a clarifying question before creative or implementation
work, and never make the user confirm intent, scope or taste before building. Make the routine
calls yourself; if an assumption matters, state it in one line *while delivering*. An open brief
is an instruction to cover the space and choose well, not to return a menu. Deliver the complete
thing, then say what was decided and why in a few lines.

The only stops are the safety ones — destructive or irreversible actions, and publishing to the
outside world — and those are confirmed in one line, not explored.

## Verify before claiming

Never report work as complete on the strength of having written it. Run the thing. A test that
was not run is not a passing test, and a green suite says every test passed — it does not say any
test *would have* failed. When a claim matters, measure it: this package has shipped "fixes" that
were theatre three times, each caught only by measuring the thing afterwards rather than reasoning
about the diff.

## Visual work — the taste layer, then the loop

For ANY work that draws something a human will look at, in any language — UI, CSS, shaders, game
rendering, native, generative, TUI, data-viz, print — read the taste layer first:

```
{{REPO_ROOT:url}}/skills/visual-design-mastery/SKILL.md
```

Codex has no skills mechanism, so these are read by path. The authored set is under
`{{REPO_ROOT:url}}/skills/` — `visual-design-mastery` (taste), `creative-divergence` (run it
BEFORE the first idea when looking distinctive is the goal), `design-fields` (every field's real
canvas, minimums and delivery format), `print-design`, `apparel-design`, `model-routing`. Graph
engineering ships with the argo toolkit instead, at
`{{REPO_ROOT:url}}/argo/plugin/skills/graph-engineering/SKILL.md`.

**The loop is mandatory and has no pass count.** The first render is never the one shown. One
command runs every gate that applies to a file:

```bash
cgc check <file|dir>          # --strict for an exit code
```

Under it: `cgc render` / `cgc print` (pixels), `cgc lint` (the fingerprint of AI-made design),
`cgc audit --mobile` (contrast, fallback faces, measure, tap targets, focus, reduced motion),
`cgc motion` (judged in frames under a virtual clock — a duration in source says nothing about
how a move reads, and the commonest animation defect is that it never ran), `cgc techniques`
(what the piece never reached for, by medium), `cgc distinct` (have you made this before),
`cgc specimen`, `cgc icons`, `cgc outline`, `cgc print-lint`.

Render it, look at the picture, name the weakest thing, fix it and extrapolate the fix, gate it,
render again — until it reaches at minimum the equivalent of a passionate human professional's
work in that field. "Fine" is the enemy in every medium.

## React work

Every applicable tool, together, in this order — `react-doctor` → the global
`eslint-plugin-react-hooks` flat config → `react-scan` → `strix`. Full rules:
`{{CONFIG_ROOT:url}}/react-tooling-stack.md`. Never claim a React task complete without running
what applies and fixing or explicitly documenting the findings.

## Security work

Authorized targets only — systems the user owns or has written permission to test; verify scope
before every run. T3MP3ST recon (`tempest`) and `strix` are used together: recon → scan → fix →
re-verify, with evidence. Full rules: `{{CONFIG_ROOT:url}}/security-stack.md`.

## Python work

`uv` for everything: `uvx <tool>` to run one off, PEP 723 inline metadata plus `uv run file.py`
for a single file, `uv init`/`uv add`/`uv run` for a project. Never `pip install` into a project
you also `uv run`. Four verified traps: `uv version` is the PROJECT's version, so check
`uv --version`; `uv sync` DELETES what `uv pip install` put in the venv; `uv run` auto-syncs and
can rewrite `uv.lock`, so pass `--locked` in CI; project commands ignore `VIRTUAL_ENV` while
`uv pip` honours it silently. Commit `uv.lock`. Full rules:
`{{CONFIG_ROOT:url}}/python-tooling-stack.md`.

## Fan-out discipline — the part that transfers, and the part that does not

Codex has no coarse model aliases, so Claude Code's haiku/sonnet/opus routing table does not
apply here. `model_reasoning_effort` is the dial that does: low for mechanical passes, high only
for the hardest verification. What transfers unchanged is everything that made routing matter,
because all of it was learned the expensive way:

- **Bound every fan-out, and bound it to what the account can serve.** A run measured here asked
  for 1,193 agents; **69 of them were an entire session limit**, reached from nothing in thirty
  minutes, and the other 931 existed only to fail. The runtime's own cap is a runaway guard, not
  a budget.
- **Decide the empty case pessimistically.** In that same run, survivors were gathered with
  `filter(Boolean)` and no branch for there being none — so `vs.length > 0 && vs.every(...)` was
  `false` on an empty list and every finding nobody had checked came back *confirmed*. 421 of
  491 "confirmed" defects had zero working verifiers.
- **A finder that yields hundreds of items is the thing to fix, not the thing to scale.** Every
  one of the 169 findings in that run that got two working verifiers was refuted.
- **Workers never read each other's output**, the shared surface is read-only during a fan-out,
  and a crew has to beat a single agent on the same task or it is subtracting value — measure
  that claim, do not assume it. `argo graph . --brief` derives the worker count from the shared
  surface rather than from a round number.

## The library, by path

Nothing here is loaded into context; grep it.

- **815 skills** on disk: `grep -i "<topic>" "{{LIBRARY_ROOT:url}}/_index/INDEX.md"`, then read
  the SKILL.md at the path it names.
- **`build-your-own-x`** — 359 from-scratch tutorials, CC0:
  `grep -i "<topic>" "{{LIBRARY_ROOT:url}}/build-your-own-x/README.md"`
- **`agency-agents`** — 273 subagent definitions; read them for structure, never install them.
- **`OpenMontage`** — the video field. AGPL-3.0: quote and cite, never vendor.
- **`cgc skills <query>`** searches the skills.sh registry over plain HTTPS — no account, no
  telemetry — and `--get` fetches into the indexed library, never into a resident directory.

## MCP servers

CGC registers its keyless servers with `codex mcp add`, so Codex owns its own `config.toml` and
this package never writes TOML. `codex mcp list --json` shows what is registered.

**Every user-scope server starts once per session**, so its idle footprint is multiplied by the
number of open windows — measured on this machine: six windows, six copies of everything, 2 GB
before anything was asked of them. That multiplication is the thing to check before adding one,
not whether it is useful when used.
