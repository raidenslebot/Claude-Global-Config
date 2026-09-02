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
`--only=config|skills|hooks|deps|npm|mcp|library|argo` (several, comma-separated).

From then on the install looks after itself. Every session start runs one hook that follows
`main` (fast-forward when behind, re-applying config, hooks and skills), runs the doctor and
**repairs** any failure by re-applying the install, runs this package's own tests once per
commit, and prints one line to the user and to the session, for example:

```
CGC v1.2.0 enabled · 38/38 checks · 216/216 tests · up to date (0116008)
```

Offline is a word in that line, never an error; a dirty checkout, another branch or unpushed
local commits are named and left alone. See [Keeping it current](#keeping-it-current).

---

## What gets installed

| Phase | What |
|---|---|
| **Config** | `CLAUDE.md` and the three mandate files, with every machine path substituted for this machine |
| **Hooks** | 19 hooks merged into `settings.json`, each pinned to an absolute Node path — including the session-start check that updates, verifies and repairs the install |
| **Workflows** | `design-divergence` and `probe-model-policy`, installed as named workflows |
| **Skills** | `visual-design-mastery`; the authored skills `creative-divergence`, `design-fields`, `print-design`, `apparel-design`, `model-routing`, `cross-platform`, `string-boundaries`, `standard-of-work`, `design-tokens`, `project-memory`; the argo skill set; and 13 Tier-2 animation/3D and technical-writing skills. A skill already present under one of these names is moved to `~/.claude/.cgc-replaced/` and replaced; a plugin known to shadow them (`open-design`) is disabled |
| **Print pipeline** | `tools/print-render.mjs` (HTML/SVG at physical size → PDF + PNG, or a garment mockup, via the local Chromium) and `tools/print-lint.mjs` (the press-readiness gate) |
| **Screen pipeline** | `tools/screen-render.mjs` (a page at desktop and phone widths, or any social/slide/email/icon canvas at exact pixels; names web fonts that failed), `tools/slop-lint.mjs` (the fingerprint of AI-made design, also run by a hook on every screen file written), `tools/page-audit.mjs` (the rendered page measured: contrast, fallbacks, measure, widows, sideways scroll, tap targets, focus, reduced motion, the palette by area) and `tools/specimen.mjs` (a pairing and a palette set for real, with contrast, before they are chosen); `tools/outline-text.mjs` (any text as one SVG path with the font's own kerning — the outlined wordmark every shop asks for) |
| **argo** | linked globally as a CLI, plus its 3 agents and 9 slash commands |
| **npm** | `eslint`, `react-scan`, `react-doctor` if absent |
| **MCP** | `playwright` and `context7`, installed locally and pinned — both keyless |
| **Dependencies** | the repo's one runtime dependency, `fontkit` (the font parser behind `outline-text`), installed into the repo's own `node_modules` from its lockfile, only when absent |
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

### Print and apparel — physical media, with a real output

A business card, a flyer, a poster, a t-shirt: the model's default answer is a screen layout
scaled to the size, described in a paragraph. This config treats them as objects. The taste
layer gains a print-and-physical reference (the stock is a value; boldness can be spent on the
edge, the finish, or the back; hierarchy is measured in feet). Two technique skills carry the
craft — `print-design` (trim, bleed, safe zone, resolution, CMYK and spot colour, stock, finish,
folds, die-cuts) and `apparel-design` (screen print / DTG / embroidery / HTV constraints, placement
zones in inches, garment colour as artwork, SVG garment flats). And the output is a file:

```bash
node tools/print-render.mjs card.html --size business-card-us --marks --png 300   # PDF at trim+bleed, PNG proof
node tools/print-render.mjs front.html back.html --size business-card-us --marks  # one two-page PDF
node tools/print-lint.mjs   ./card --size business-card-us                        # every side; fails on what the press would reject
node tools/print-render.mjs mark.svg --mockup tee --zone left-chest --garment "#1c1c1e" --png 150 --presentation
```

Nine garment flats ship for mockups (tee front and back, long sleeve, hoodie, polo, jersey, cap,
beanie, tote), and a hook reports any physical design written without a `directions.md` beside
it — the divergence protocol has to be on disk before the first line of markup. Three worked
examples ship in that exact form — a letterpress card, a two-ink Riso poster, a screen-printed
tee — each with its directions (including the discarded ones), its artwork, and its spec or
placement sheet, so the shape of a finished piece is on disk before the first one is authored.

The renderer drives the headless Chromium already installed for the Playwright MCP — nothing
new to install, no account. It writes RGB and says so; the skill says what to hand an offset shop.

### Screens — the gate, the proof, and the loop

The model's first design is the centroid of every design it has seen, and the centroid has a
fingerprint: Inter alone, the purple-to-pink gradient, the glass card, three feature cards, the
centred hero with two buttons, emoji for icons, a lone acid accent on near-black, the blurred
blob, copy that says "seamless". None is wrong alone; four together is the template.
`tools/slop-lint.mjs` finds them by pattern, names each with its line and what a decision would
look like instead, and a hook reports the result on every screen file as it is written.

```bash
node tools/slop-lint.mjs page.html                  # verdict: clean / fingerprints / centroid (exit 1)
node tools/screen-render.mjs page.html --mobile     # page-1440.png and page-390.png; names fonts that failed
node tools/screen-render.mjs post.html --preset ig-post   # 1080×1350 exactly; story, yt-thumb, og, slide, email, app-icon…
node tools/page-audit.mjs page.html --mobile        # FAIL: contrast, a face that fell back, text under 10px, sideways scroll, tap targets under 24px
node tools/specimen.mjs --display "Fraunces:ital,opsz,wght@1,9..144,300" --text Archivo --palette "oklch(0.97 0.012 80),oklch(0.22 0.02 60),oklch(0.55 0.17 25)"
node tools/outline-text.mjs --font "Archivo:wdth,wght@75,600" --text HARBOR --tracking 0.14 --wdth 75 --wght 600 --out wordmark.svg
```

`page-audit` exists because a screenshot clips to the viewport: the example page below scrolled
sideways at 390px through three passes of looking, and the audit named it in one. `specimen`
exists because a face named in a catalogue is not a decision; a face set at display and reading
size, reversed, beside its palette with the contrast ratios, is.

The absence of fingerprints is not design, so the skills end in a loop rather than a verdict:
render it, look at the picture, name the weakest thing, fix it and extrapolate the fix, gate it,
render again — and *fix and refine and improve and evolve and extrapolate in that loop until it
achieves, at minimum, the equivalent of a passionate human professional's work in the field*. The
exit is a list of the professional's questions in `creative-divergence`, not a pass count. The
vocabulary with its numbers — faces and their settings, palettes, layout grammars, materials,
motion laws — is `visual-design-mastery/references/signature-moves.md`; every field that is not
a page — identity, icons, illustration, diagrams, social, slides, email, packaging, signage — has
its canvas, minimums and delivery format in `design-fields`. A page built through the loop, with
its directions and the log of its passes, ships in `creative-divergence/examples/cgc-landing/`;
an identity system and a feed series, built the same way, ship in `design-fields/examples/`.
The audit also checks the motion laws — linear easing on movement, layout properties animated,
entrances that are waits, one constant for every event, garnish that never stops.

### The tiering, and why it exists

The skill library holds **815 skills** on disk, 814 of them indexed — `build-index.mjs` carries an
`EXCLUDE` list for material this repo chooses not to surface. Installing them all would load
**~57,674 tokens of skill descriptions into every session** and make every animation request match
a hundred competing triggers. More skills would make Claude measurably worse.

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
argo graph . --brief                               # worker count from the shared surface, not a round number
argo graph . --touch src/x.js "src/api/**" --brief # task-scoped: workers own the write-set only
argo diverge                                       # disagreement per PAIR — a fleet average hides it
argo baseline                                      # was the crew ever beating a single agent?
argo drift diff                                    # did the vendor change a shipped system prompt under you?
argo topology lint                                 # R1–R9, plus MODEL: a pinned model id in a declaration
argo watch --caveats library/caveats-versions.json # have CAVEATS.md's version rows rotted?
```

The core rule: **worker count is set by the shared surface** — files reachable from more than one
partition. Freeze that surface, keep edits to it serial, and never let workers read each other's
output. A crew that does not beat a single agent on the same task is subtracting value.

Ships as a CLI, 3 agents (`graph-worker`, `graph-supervisor`, `hub-splitter`), 9 slash commands,
2 hooks, and a `graph-engineering` skill. Source and tests in [`argo/`](argo/).

---

## Model routing — automatic, on both dispatch paths

Every spawned agent gets its model from a hook, never from a guess. A `PreToolUse` hook on the
Agent tool classifies the prompt by the hardest decision the agent must make on its own —
verification and review go to `opus`, work that is already specified to `sonnet`, pure retrieval
to `haiku`, anything ambiguous inherits the session model — and rewrites the call. A second hook
on the Workflow tool injects the same policy into workflow scripts, which dispatch their agents
without ever touching the Agent tool.

If the session model was pinned to a specific version, both hooks strip every model option. An
alias cannot name a version, so inheritance is the only thing that reproduces the one you chose.

Under-assignment is treated as a correctness failure and is gated at zero against a labelled
corpus of prompts; over-assignment is a cost, measured and ratcheted down. `argo graph --brief`
cooperates: each worker section carries a `Coupling:` line the hook reads, so a worker on a hub
cannot be quietly downgraded. A shipped workflow, `probe-model-policy`, proves the Workflow-side
contract still holds after any Claude Code upgrade — zero agents, milliseconds.

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

**This is checked, not just claimed.** `doctor.mjs` classifies every registered MCP server and
**fails** on any addressed by URL — someone else's service over the network, which is where a
login prompt comes from — and it reads every scope a server can hide in, including the
project-scoped map it previously never looked at. `tools/test/no-external-auth.test.mjs` holds
both halves: that `install.mjs` can only ever register a local `command` server, and that doctor
actually reports a planted remote one. The limit worth stating: connectors provided by the host
application never appear in `.claude.json`, so nothing here can see them — those live in the
app's own connector settings.

---

## Security

`~/.claude` contains `.credentials.json` — live OAuth access and refresh tokens. **This repo must
never carry it.** Three defences:

1. `.gitignore` denies `.credentials.json`, every `.env`, `.claude.json`, keys and PEM blocks.
2. `tools/sync.mjs` tracks an explicit allowlist — it copies only the files it is told to.
3. `tools/scan-secrets.mjs` scans for token patterns and high-entropy strings, and fails if a
   denied file is present or untracked. The pre-commit hook runs it on every commit, and
   `install.mjs` wires that hook by setting `core.hooksPath`, so a fresh clone gets it too.

```bash
node tools/scan-secrets.mjs
```

---

## Keeping it current

**The install follows `main` by itself.** `config/hooks/session-start-cgc.js` runs at every
session start and resume (on clear and compact the fetch is throttled to once in five minutes):

- `git fetch` the origin's default branch; if this clone is strictly behind, `pull --ff-only` and
  re-run `install.mjs --only=config,hooks,skills` so the live config matches the new commit. A
  dirty tree, a checkout on another branch, unpushed local commits (the author's machine) or a
  diverged history are **named in the line and left alone**; offline is silent.
- `doctor.mjs --json`; any FAIL triggers the same re-apply, then a second doctor run — a hook
  removed from `settings.json` or a skill replaced by another package is back before the session
  starts, and the line says `repaired`.
- `run-tests.mjs`, once per commit and at most once a day, cached in `~/.claude/.cgc/`.
- One line, to the user (`systemMessage`) and to the session (`additionalContext`), which
  Claude opens its first reply with.

**Versioning.** `package.json` carries the version; `CHANGELOG.md` leads with it (a test holds
the two together); each release is tagged `vX.Y.Z` on `main`. A clone reports what it moved
between, and which commits, when it updates. Release: bump the version, add the entry, commit,
`git tag vX.Y.Z`, `git push --follow-tags`.

**This config wins.** Install replaces a same-named skill directory that is not ours (kept under
`~/.claude/.cgc-replaced/<name>-<time>`), disables plugins known to shadow shipped skills, merges
its hook registrations by script name so they cannot be duplicated or dropped, and honours
`CLAUDE_CONFIG_DIR`. It does not touch `.credentials.json`, permissions, or anything else in
`settings.json`, and a user's own notes below `<!-- user-additions-below -->` in `CLAUDE.md`
survive every update.

The repo is the source of truth. After editing `~/.claude` by hand, pull the changes back:

```bash
node tools/sync.mjs           # live -> repo, machine paths templatized
node tools/sync.mjs --check   # report drift, write nothing (run before a push)
```

Machine-specific paths are stored as `{{TOKENS}}` (`{{NODE}}`, `{{CONFIG_ROOT}}`,
`{{LIBRARY_ROOT}}`, `{{ESLINT_CONFIG}}`, `{{BRIDGE_ROOT}}`) and resolved at install time by
`tools/paths.mjs`. That is what makes the repo work on a machine that is not the one that built
it. An unresolved token after install is a bug — `doctor.mjs` reports it.

---

## Layout

```
config/       mandates + hooks, templatized       tools/paths.mjs        path vocabulary
  hooks.json  hook registrations to merge         tools/install.mjs      repo -> machine
skills/       skills this repo authors            tools/sync.mjs         machine -> repo
workflows/    named workflows                     tools/doctor.mjs       verify
argo/         graph-engineering toolkit           tools/uninstall.mjs    clean removal
library/      index, caveats, sources             tools/scan-secrets.mjs pre-push gate
  repos/      cloned at install (gitignored)      tools/run-tests.mjs    explicit-path test runner
docs/         architecture, troubleshooting,      tools/print-render.mjs / print-lint.mjs   paper and fabric
              the audits and their closures       tools/screen-render.mjs / slop-lint.mjs  screens
CHANGELOG.md  what a machine gained between       tools/test/            the gates
              two session starts                  .githooks/             pre-commit secret gate
```

## License

Configuration and authored skills: MIT. Cloned library repos keep their own licenses — see each
repo under `library/repos/`.
