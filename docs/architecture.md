# Architecture

Why this repo is shaped the way it is. Read this before changing how install, sync, or the
tiering works — most of these decisions were made after something broke.

## The problem

A Claude Code setup lives in `~/.claude`, and that directory is hostile to version control:

- It holds **live credentials** (`.credentials.json`) that rewrite themselves constantly.
- It holds **machine-specific absolute paths** in hook commands and MCP registrations.
- It mixes things a person authored with things a tool generated with pure runtime state
  (`projects/`, `history.jsonl`, `todos/`, `shell-snapshots/`).

Committing the directory wholesale leaks secrets. Committing a subset by hand goes stale.
So the repo is the **source of truth**, and two tools move between it and any machine.

```
   repo (portable, {{TOKENS}})          machine (~/.claude, real paths)
              │                                      │
              │  install.mjs  ─── realize ──────────▶ │
              │ ◀──────────── templatize ── sync.mjs  │
              │                                      │
              └────── doctor.mjs verifies ──────────┘
```

## Decision: an explicit allowlist, never a mirror

`sync.mjs` copies only files it is told to. It does not walk `~/.claude` and skip a denylist.

Denylists fail open: a new kind of secret file appears and gets committed because nobody added a
rule. An allowlist fails closed — an untracked file is simply absent. Given that the failure mode
is *publishing a live OAuth token to a public repo*, closed is the only acceptable direction.

`.gitignore` and `scan-secrets.mjs` are the second and third layers, not the first.

## Decision: tokens, with per-occurrence slash style

Machine paths are stored as `{{TOKEN}}` and resolved at install by `tools/paths.mjs`.

The subtlety that cost a real bug: **the same path needs different slash styles in the same
document.** A Windows CLI argument wants `C:\Users\...`; a `file:///` URL is only valid with
forward slashes. So the form a path was *written in* selects the token:

| Written as | Stored as | Rendered as |
|---|---|---|
| `C:\Users\...` | `{{KEY}}` | native |
| `C:/Users/...` | `{{KEY:url}}` | forward |

**Source files are always forward-slashed**, regardless. A Windows path substituted into a JS
string literal is read as escape sequences — `"C:\Users\npm"` becomes `"C:Users"`, a newline, and
`"pm"`. That silently corrupted the eslint path a hook emitted on every prompt. Node accepts
forward slashes on Windows, so there is no reason to ever write a backslash into source.

Related: substitute into **parsed JSON values, never raw JSON text**. Injecting a native Windows
path into raw text produces `"C:\Program Files\..."`, which is invalid JSON escaping.

## Decision: one canonical home per file

Hooks ship from three places — `config/hooks/`, `argo/plugin/hooks/`, and a skill's own `hooks/`.
`install.mjs` gathers them all into `~/.claude/hooks` so every registration can be written as
`{{CONFIG_ROOT}}\hooks\<name>` and stays portable.

But `sync.mjs` must **not** copy them all back, or a file that ships inside `argo/` gets a second
home in `config/hooks/` and the two drift apart with no warning. Sync skips any hook whose
canonical home is elsewhere.

The general rule: a file has exactly one place it is edited. Everything else is a generated copy.

## Decision: plugins over loose files

argo was originally installed by copying its skills, agents and commands into `~/.claude`. That
worked and was wrong. Once it was also registered as a proper plugin, all 22 of its components
loaded **twice** — and `doctor.mjs` could not see it, because it only scans loose skills while
`claude plugin details` sees plugin-provided ones.

Removing the redundant layer took the session from 73 skills to 60, and 7,186 tokens to 6,126.

Anything with a `.claude-plugin/marketplace.json` is installed as a plugin. Loose linking is only
for skills this repo authors that have no plugin wrapper.

## Decision: four tiers, and contention as the budget

| Tier | Cost | Contents |
|---|---|---|
| 1 | already paid | `visual-design-mastery` — the taste layer, unconditional |
| 2 | ~1.5k tokens | 13 skills worth loading in *every* session |
| 3 | **0** | 800+ skills on disk, indexed, read by path |
| 4 | — | not cloned; `library/sources.json` records why |

The library holds 815 skills. Installing all of them costs ~57,674 tokens per session — but the
token number is not the real argument. **Trigger contention** is: 144 skills that all fire on
"animation" make dispatch a coin flip, and a skill triggering on bare `create` or `draw` fires on
prompts that have nothing to do with it.

`doctor.mjs` reports both. When judging whether a skill earns Tier 2, contention weighs more than
size.

## Decision: hook failures must be caught at install

A hook whose interpreter or script path is wrong is a **silent no-op**. Claude Code reports
nothing; the hook simply never runs. On the origin machine a set of hooks was dead for weeks this
way, discovered only by accident.

So: `install.mjs` runs `node --check` on every hook it writes, and `doctor.mjs` verifies that
every registered hook's interpreter *and* script exist on disk. That check is the single most
important one in the file.

## Decision: no external auth, rebuilt not deleted

Every integration needing a third-party login was removed. But a capability worth having is
**rebuilt locally** rather than dropped:

- Figma → `design-tokens`, which measures a live page through the Browser pane.
- Notion / Linear / Asana / Jira → `project-memory`, file-backed under `.claude/memory/`.

Slack, Intercom and S&P Global have no local analogue that benefits Claude, and are simply gone.
What remains — `playwright`, `context7`, `strix`, `T3MP3ST` — is local or routes through a bridge
backed by the Claude subscription.

The removals were done by hand and recorded in a table, which made this the repo's largest
unchecked claim — the exact shape it refuses elsewhere. It is a gate now: `doctor.mjs` fails on
any MCP server addressed by URL, in every scope including the project-scoped map it used to skip,
and a test plants one to prove the report fires. Host-application connectors are outside
`.claude.json` and therefore outside this check; that limit is stated rather than covered.

## Decision: physical media go through the browser, and the browser is checked

Asked for a business card, the model produced the centroid of every card it had seen and
delivered it as a paragraph or a screenshot. Two failures, one cause each: no taste or craft for
the medium, and no output a printer could take.

The output path was chosen for what was already on the machine. The Playwright MCP server
installs a headless Chromium; Chromium renders HTML and SVG at physical units and writes a PDF
with an exact page size. So `tools/print-render.mjs` finds `playwright-core` beside the live MCP
registration (never by a named path), wraps the design in an `<iframe>` at trim + bleed inside a
page that carries the slug and crop marks, and emits the PDF and a PNG proof at a real dpi. For
apparel it composites artwork onto an SVG garment flat drawn in inches, so placement is judged
on a body before anyone orders a hundred shirts. Nothing is fetched and nothing needs an account.

What the browser cannot do is stated, not hidden: it writes RGB. Online printers convert; an
offset shop wants CMYK or PDF/X, and the skill says to ship a spec sheet naming the intent or to
convert with Ghostscript if it happens to be present. Claiming a CMYK file the tool did not make
would be exactly the confident-wrong output this repo exists to prevent.

The gate is `tools/print-lint.mjs`, static and dependency-free so it runs wherever node does:
type under the method's minimum, hairlines, rasters under 300 dpi at their placed size, a page
in pixels or at exactly trim size (bleed forgotten — the most common real mistake) all fail. It
is the same shape as every other gate here: a design that looks finished and would not survive
the press does not leave the machine.

A second gate came from a failure. The skills required the divergence protocol to be *written*
before markup; the first card made with them skipped that, the protocol was "run in the head",
and the result was the centroid the skills describe. Advisory text competes with everything else
in the context and loses. So a PostToolUse hook now fires the moment an HTML or SVG file with a
physical page size is written and there is no `directions.md` beside it. It reports, never
vetoes, and it is silent on screen work — the same rules as every hook here.

## Decision: doctor measures what this package owns, separately from what the machine has

`doctor.mjs` used to warn when the machine's total skill-description cost exceeded one budget.
On any real machine with host plugins that was every run, and a warning that fires every run is
decoration. It now reports two numbers — everything installed, and this package's share (the
Tier-2 residents plus the skills this repo authors) — and warns only against the package's own
budget; the rest is a note with names in `--json`. Trigger contention gets the same split: a
contended word is this package's problem when one of its own skills claims it, and the report
says so; host plugins contending with each other is reported as information.

## Decision: two dispatch paths, both routed, one vocabulary

Spawned agents reach a model by two different paths, and only one of them passes through the
Agent tool:

| Path | Dispatched by | Routed by |
|---|---|---|
| `Agent` tool call | the model, per call | `PreToolUse` on `Agent\|Task` — rewrites `model` in the tool input |
| workflow `agent()` | the Workflow runtime | `PreToolUse` on `Workflow` — injects `args.__modelPolicy`; the script applies it |

The second path was found by looking at a run: a six-worker fan-out with every worker on the
session model, one of them editing a single YAML file. The per-call hook had never fired for
any of them.

Two constraints decided the shape. **Scripts cannot import**, so the policy — session model,
pinned flag, and the classifier vocabulary as regex *source strings* — travels in `args`, and a
small helper inside the script rebuilds the regexes and applies the same precedence. **Hooks
cannot import each other** (they are copied to a machine where the repo may not exist), so the
Workflow hook carries its own copy of the vocabulary.

Two copies is a drift hazard, so it is gated twice: a test holds the two hooks' `SIGNAL_SOURCES`
deep-equal, and the *shipped* helper text in `workflows/design-divergence.js` is evaluated as-is
and must agree with `decide()` on every case in the labelled corpus. Change a signal in one hook
and the drift test names the other file; change the helper's precedence and the corpus names the
case.

The pin rule survives both paths by construction: the helper returns `undefined` for every agent
when `pinned` is true, and the per-call hook strips the option. A test asserts every corpus case
yields no model under a pinned policy.

The harness contract underneath — `updatedInput` honoured on the Workflow tool — was **observed,
not assumed**: a workflow that spawns nothing and returns its own `args` received the policy
through the real dispatch path. That contract belongs to the harness, not this repo, so the
probe ships as a named workflow to be re-run after upgrades.

## What is deliberately not here

- **No dependency on a package registry at runtime.** argo has zero dependencies; the tools use
  node built-ins only. A fresh machine needs Node and git, nothing else.
- **No `Date.now()` in generated files.** A timestamp that changes every run churns the git diff
  and trains everyone to ignore the file. Freshness is derived from file mtimes instead.
- **No auto-repair in `doctor.mjs`.** It checks and reports; `install.mjs` is the only writer.
  A verifier that silently fixes things hides the fact that something was broken.
