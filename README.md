# Claude Global Config

A complete, portable Claude Code setup: design taste, animation craft, graph-engineering for
multi-agent work, security tooling, and the hooks that enforce all of it. Clone it onto a machine
that has nothing and run one command.

**No external accounts. No API keys.** Everything here runs on your Claude subscription and your
local filesystem. Integrations that required signing into a third-party service were removed and
their useful functionality rebuilt locally — see [No external auth](#no-external-auth).

---

## Install

```bash
git clone https://github.com/raidenslebot/Claude-Global-Config.git
cd Claude-Global-Config
```

**Windows**

```powershell
.\install.ps1
```

**macOS / Linux**

```bash
./install.sh
```

The bootstrap installs Node 20+ if it is missing (winget / brew / apt / dnf / pacman), then hands
off to `tools/install.mjs`. See exactly what it would do first:

```bash
node tools/install.mjs --dry-run
```

It is **idempotent** — re-running repairs drift rather than duplicating anything. It **merges**
`settings.json` instead of overwriting it, and it never touches `.credentials.json`.

Then verify:

```bash
node tools/doctor.mjs
```

Useful flags: `--skip-library` (skip the ~200 MB skill-library clone), `--skip-npm`,
`--only=config|skills|hooks|npm|mcp|library|argo`.

---

## What gets installed

| Phase | What |
|---|---|
| **Config** | `CLAUDE.md` and the three mandate files, with every machine path substituted for this machine |
| **Hooks** | 16 hooks merged into `settings.json`, each pinned to an absolute Node path |
| **Skills** | `visual-design-mastery`, the argo skill set, and 13 Tier-2 animation/3D and technical-writing skills |
| **argo** | linked globally as a CLI, plus its 3 agents and 9 slash commands |
| **npm** | `eslint`, `react-scan`, `react-doctor` if absent |
| **MCP** | `playwright` and `context7`, installed locally and pinned — both keyless |
| **Library** | 12 skill repos cloned and indexed; 2 rejected on the record |

---

## Architecture

Three layers, consulted in order. **The taste layer wins unconditionally** — the layers below add
specificity beneath it, never replace it.

```
TASTE       visual-design-mastery      Should this exist? What does it mean?
              ↓                        Wins every conflict.
TECHNIQUE   gsap-web, svg-animation,   How do I do it well in THIS library?
            threejs-webgl, …
              ↓
COMPONENT   21st.dev, Magic UI,        Has someone already built it?
            Aceternity, React Bits
```

### The tiering, and why it exists

The skill library holds **815 skills**. Installing them all would load **~57,674 tokens of skill
descriptions into every session** and make every animation request match a hundred competing
triggers. More skills would make Claude measurably worse.

| Tier | Cost | Rule |
|---|---|---|
| **1** — taste | already paid | `visual-design-mastery`. One skill. Unconditional. |
| **2** — resident | ~1,508 tokens | 13 skills that earn a place in *every* session |
| **3** — library | **0 tokens** | 800+ skills on disk, `grep` the index, read by path |
| **4** — rejected | — | not cloned; `library/sources.json` records why |

### Contention is the real cost, not tokens

Token count is the obvious metric and the less important one. What actually degrades a large
skill set is **trigger contention**: many skills claiming the same word, so dispatch becomes a
coin flip between them. `doctor.mjs` measures it:

```
"animation" — 11 skills      "create" — 10 skills
```

A skill whose description says `"build a scroll animation"` competes with nothing. One that says
`create`, `draw`, `export`, `save` competes with half your library and fires on prompts that have
nothing to do with it. That single distinction is why one 144-skill pack was rejected here and a
9-skill one was installed whole.

Finding something in Tier 3:

```bash
grep -i "scroll" library/INDEX.md      # locate it
node library/build-index.mjs           # rebuild after a git pull
```

**Read [`library/CAVEATS.md`](library/CAVEATS.md) before pasting code from any installed skill.**
Several ship verified defects — a duplicate-`const` SyntaxError, a package pinned two majors
behind, an API that does not exist. They are documented, not hidden.

---

## argo — graph engineering

Multi-agent work fails on **topology**, not model quality. Agents contradicting each other, costs
climbing, delegation quietly stopping — those are graph problems. argo measures the graph before
you fan out.

```bash
argo graph . --brief    # worker count from the shared surface, not a round number
argo diverge            # disagreement per PAIR — a fleet average hides it
argo baseline           # was the crew ever beating a single agent?
argo drift diff         # did the vendor change a shipped system prompt under you?
argo doctor             # topology lint
```

The core rule: **worker count is set by the shared surface** — files reachable from more than one
partition. Freeze that surface, keep edits to it serial, and never let workers read each other's
output. A crew that does not beat a single agent on the same task is subtracting value.

Ships as a CLI, 3 agents (`graph-worker`, `graph-supervisor`, `hub-splitter`), 9 slash commands,
2 hooks, and a `graph-engineering` skill. Source and tests in [`argo/`](argo/).

---

## No external auth

Every integration requiring a third-party login was removed. Nothing was simply deleted — where
the capability was worth keeping, it was rebuilt against the local filesystem and the tools Claude
already has.

| Removed | Why | Rebuilt as |
|---|---|---|
| Figma MCP | external OAuth | `design-tokens` — measures a live page through the Browser pane, or parses exported tokens |
| Notion, Linear, Asana, Jira | external OAuth | `project-memory` — file-backed decisions, backlog, and durable facts under `.claude/memory/` |
| Sanity | external OAuth | content-modeling guidance is skill-only and needs no connector |
| Slack, Intercom | external OAuth | team messaging — no local analogue that benefits Claude |
| S&P Global | external OAuth | market data is external by nature |

What remains is local-only: `playwright` (bundled browser), `context7` (keyless), and optionally
`strix` + `T3MP3ST`, both of which route through a local bridge backed by your Claude
subscription rather than any vendor API.

---

## Security

`~/.claude` contains `.credentials.json` — live OAuth access and refresh tokens. **This repo must
never carry it.** Three defences:

1. `.gitignore` denies `.credentials.json`, every `.env`, `.claude.json`, keys and PEM blocks.
2. `tools/sync.mjs` tracks an explicit allowlist — it copies only the files it is told to.
3. `tools/scan-secrets.mjs` scans for token patterns and high-entropy strings, and fails if a
   denied file is present or untracked. Run it before every push; CI runs it on every commit.

```bash
node tools/scan-secrets.mjs
```

---

## Keeping it current

The repo is the source of truth. After editing `~/.claude` by hand, pull the changes back:

```bash
node tools/sync.mjs           # live -> repo, machine paths templatized
node tools/sync.mjs --check   # report drift, write nothing (CI / pre-commit)
```

Machine-specific paths are stored as `{{TOKENS}}` (`{{NODE}}`, `{{CONFIG_ROOT}}`,
`{{LIBRARY_ROOT}}`, `{{ESLINT_CONFIG}}`, `{{BRIDGE_ROOT}}`) and resolved at install time by
`tools/paths.mjs`. That is what makes the repo work on a machine that is not the one that built
it. An unresolved token after install is a bug — `doctor.mjs` reports it.

---

## Layout

```
config/       mandates + hooks, templatized       tools/paths.mjs    path vocabulary
  hooks.json  hook registrations to merge         tools/install.mjs  repo -> machine
skills/       skills this repo authors            tools/sync.mjs     machine -> repo
argo/         graph-engineering toolkit           tools/doctor.mjs   verify
library/      index, caveats, sources             tools/scan-secrets.mjs  pre-push gate
  repos/      cloned at install (gitignored)
```

## License

Configuration and authored skills: MIT. Cloned library repos keep their own licenses — see each
repo under `library/repos/`.
