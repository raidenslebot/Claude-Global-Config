# Enforcement audit

Every rule, mandate and invariant this repo states, sorted into exactly one of three buckets:
**ENFORCED** (something fails), **ADVISORY** (nothing detects a violation), **UNENFORCEABLE** (no
mechanical check can decide it).

The standard applied is the repo's own, from `skills/standard-of-work/SKILL.md:14`:

> A rule stated in a document is **advisory**. It is read, agreed with, and then not applied,
> because nothing happens when it isn't. A rule enforced by something that **fails** is a **gate**.

Measured at commit `17c6610`, working tree with `config/hooks/pre-tool-model-route.js` modified.
`node tools/run-tests.mjs` → **94 tests, 0 failures, 5.7s**. Every absence claim below names the
search that found nothing.

---

## Summary

| Bucket | Count | Headline |
|---|---|---|
| ENFORCED — fails the build or the install | 17 | The portability, path-substitution and hook-syntax invariants are genuinely gated |
| ENFORCED — detects and reports, never fails | 3 | `post-tool-verify`, `stop-verify`, `pre-tool-model-route` |
| ADVISORY | 13 | Includes every `config/*.md` MANDATORY stack, and three gates that exist but are not wired |
| UNENFORCEABLE | 8 | Taste, precedence between advice layers, scope authorization |
| Documentation defects found | 6 | Two files title a section "Enforcement" and describe injection |

**Three live defects found while auditing**, each a case where the gate that would have caught it
does not exist:

1. `config/hooks/react-doctor.mjs` ships, installs, and is registered nowhere. It has never run.
2. `.githooks/pre-commit` is wired on this machine only. Nothing wires it on a fresh clone,
   despite the file claiming `install.mjs` does.
3. `docs/troubleshooting.md:143` says "12 resident Tier-2 skills"; `library/sources.json` declares
   13. The docs-numbers gate exists but does not cover that file.

---

## ENFORCED

### Fails the build, the install, or the commit

**E1 — No credential reaches the tree.**
`.githooks/pre-commit:8` execs `tools/scan-secrets.mjs`, and `install.mjs` wires it on every
machine by setting `core.hooksPath`. Failure looks like: `git commit` aborts with the scanner's
finding list (redacted — `cli.test.mjs:323-331` asserts neither report echoes the secret).
Pinned by `cli.test.mjs:295-373` (planted key fails, entropy sweep has teeth, `.gitignore` covers
the three forbidden files, the repo's own tree scans clean).
**The caveat that used to sit here is resolved, and in the direction that matters:** this gate was
once portable only through CI, and there is no CI now — but the local half became portable when
**A6** was closed, so the gate travels with the repo instead of with a runner.

**E2 — A generated hook that does not parse.**
`tools/install.mjs:152-156` runs `node --check` on every hook it writes; a failure calls `fail()`,
and `install.mjs:379` exits 1. Failure text: `hooks/<name> does not parse — <SyntaxError line>`.
Pinned by `cli.test.mjs:131-141`.

**E3 — An unresolved `{{TOKEN}}` in an installed mandate.**
`tools/doctor.mjs:56-59` → `FAIL  <name> has unresolved tokens: <keys>`, exit 1.
Pinned by `cli.test.mjs:56-64` and by `paths.test.mjs` ("no mandate in config/ ships an unresolved
token of any shape"). The `[A-Z0-9_]` character class at `paths.mjs:105` and `:118` is itself the
fix for a guard that shared the substituter's blind spot.
**Asymmetry worth recording:** `install.mjs:111` only `warn`s on the same condition. Install can
exit 0 shipping a mandate that `doctor` calls broken. See **A9**.

**E4 — A registered hook whose interpreter or script is missing.**
`tools/doctor.mjs:80-88` → `FAIL  <event>: script missing, hook is a silent no-op — <path>` or
`interpreter not found`. `doctor.mjs:80-82` calls this "the single most important check in this
file". Pinned by `cli.test.mjs:236-256`, which asserts every script named in `config/hooks.json`
is individually confirmed `ok` by doctor — not merely absent from the failures.
**Direction matters:** registered → file on disk. The converse is not checked. See **A10**.

**E5 — Hook registrations must be portable.**
`config.test.mjs:67-79` fails any command that does not carry both `{{CONFIG_ROOT}}` and `{{NODE}}`
("a hook registered at a path outside `~/.claude` is a silent no-op"; "does not pin the
interpreter, so it dies whenever PATH differs").

**E6 — A hook path realized on POSIX must be followable on POSIX.**
`config.test.mjs:81-98`. Pins the bug where `{{CONFIG_ROOT}}\hooks\name.js` realized to
`/home/x/.claude\hooks\name.js` — one filename containing backslashes — and every hook installed
"successfully" and did nothing on macOS and Linux.

**E7 — Substituting into raw JSON text is unsafe.**
`config.test.mjs:37-58` walks install's parse-first pipeline with a hostile Windows table;
`config.test.mjs:60-65` asserts the *failing* half still throws, so nobody "simplifies" parse-first
back into a text replace.

**E8 — No absolute machine path anywhere under `config/`, and none in `hooks.json`.**
`config.test.mjs:100-105` and `config.test.mjs:121-145`. Comment lines are exempted deliberately
(`config.test.mjs:132-136`) because several shipped hooks demonstrate the escape bug with a
real-looking path, and a gate with false positives gets switched off.

**E9 — Every hook named in `hooks.json` ships as a file.**
`config.test.mjs:107-119`. "A registration with no script behind it installs cleanly and then does
nothing."

**E10 — Universality of everything shipped.**
`universality.test.mjs` gates five separate invariants: no machine path in a shipped skill (`:59-73`),
no dependence on this repo's name (`:75-87`), hooks are self-contained with no relative import
(`:89-101`), every skill's frontmatter `name` equals its directory and a `description` exists
(`:103-119`), no config file assumes one OS (`:121-136`). Its header at `:9` records the
transition: *"This was an advisory rule until two skills broke it in the same week. It is a gate
now."*

**E11 — `library/sources.json` structural invariants.**
`config.test.mjs:151-203`: valid JSON, every tier2 entry names a skill and a relative
forward-slashed path, every repo is clonable-with-url or rejected-with-a-reason over ten
characters, no duplicate names in either list, every tier2 path points into a clonable repo.

**E12 — Documented numbers must match measurement.**
`docs-numbers.test.mjs`: tier-2 count in prose vs `sources.tier2.length` (`:49-59`), clonable repo
count (`:61-70`), every tier-2 path resolves on disk (`:72-78`), the quoted resident token cost is
within 15% of measured using doctor's own method (`:80-104`), and the built index never reports
fewer repos than `sources.json` declares (`:119-131`). This is the repo's cleanest example of
converting prose into a gate.
**Coverage hole:** the `DOCS` list at `docs-numbers.test.mjs:47` is
`['README.md', 'config/CLAUDE.md', 'config/ui-design-stack.md', 'docs/architecture.md']`.
`docs/troubleshooting.md` is not in it, and `docs/troubleshooting.md:143` currently says
"12 resident Tier-2 skills" against a measured 13. The gate is right; its scope is one file short.

**E13 — The settings.json merge is non-destructive and idempotent.**
`cli.test.mjs:78-129` plants a foreign hook and a stale copy of one of ours, installs twice, and
asserts: unrelated top-level settings survive, the foreign hook is neither dropped nor rewritten,
the stale one is updated rather than duplicated and repointed at the scratch root, and the second
install produces a byte-identical file.

**E14 — Install refuses to overwrite an unparseable `settings.json`.**
`install.mjs:176` → `fail('settings.json is not valid JSON …')`; pinned by `cli.test.mjs:197-207`,
which asserts both a non-zero exit and that the broken file is untouched.

**E15 — `--dry-run` writes nothing; `doctor` writes nothing.**
`cli.test.mjs:47-54` and `:211-217`. The second asserts `existsSync(join(home,'.claude')) === false`
after a doctor run, which is the mechanical form of `docs/architecture.md:127`'s "No auto-repair in
doctor.mjs".

**E16 — No shipped agent or workflow hardcodes a model.**
`model-policy.test.mjs:90-104` (agent frontmatter) and `:106-120` (workflow `agent()` calls).
Frontmatter `model:` overrides inheritance for every session including a pinned one, so a single
"helpful" pin silently defeats the routing rule.

**E17 — argo's test suite is runnable by one command, on any supported Node.**
`argo/package.json` declares `"test": "node test/run.js"`, which hands node explicit file paths.
The glob it replaced only expanded on Node 21+, so on Node 20 a real failure hid behind a
"pattern not found" message that exited 0 — the suite looked green and had not run.
**This is weaker than the others and is listed honestly:** nothing forces it. The Stop hook
(**E19**) runs the declared test command at the end of a turn and reports what it says, which is
what actually causes it to run; there is no build to fail, because this repo has no CI.

### Detects and reports, but never fails

These are stronger than advisory — a violation always produces a specific, located finding — but
weaker than a gate: nothing exits non-zero, and the model can read the finding and move on. Each
file states this as a deliberate choice, with the reason.

**E18 — `config/hooks/post-tool-verify.js`.** PostToolUse on `Write|Edit`
(`config/hooks.json:74-86`). Five deterministic checks: JS syntax via `node --check` with an ESM
retry (`:169-189`), JSON validity with a binary-searched offset (`:199-245`), SKILL.md frontmatter
name/directory mismatch (`:253-332`), hardcoded absolute machine path on both platforms
(`:360-386`), and a Windows path inside a JS string literal (`:409-428`). Design rule 1 at `:26-28`:
*"Exit 0, always. This reports; it never vetoes. A veto on a false positive makes the session
unusable, and one unusable session gets the hook deleted."* Every narrowing in the file — the
`path-ok` escape hatch at `:371`, the `String.raw` blanking at `:407`, the scratch-file skip at
`:135-144` — is bought precision at the cost of recall, which is the correct trade for a check
nobody can switch off individually.

**E19 — `config/hooks/stop-verify.js`.** Stop hook. Detects the project's *declared* test command
across eight ecosystems (`:136-213`), runs it inside a 10s budget, and quotes the failure lines.
Never invents a command; stays silent when the project declares none. Caches on a
content-sensitive key (`:310-313`) so an unchanged tree is not re-verified. `:21-26` states why it
cannot block: *"A Stop hook that blocks turns one false positive into a loop the user cannot
escape."*

**E20 — `config/hooks/pre-tool-model-route.js`.** PreToolUse on `Agent|Task`
(`config/hooks.json:99-111`). This one is genuinely authoritative on the mechanism it controls: it
rewrites `hookSpecificOutput.updatedInput`, so a caller cannot spawn an agent on a model it did not
choose, and a model the caller passed is overridden (`:193-199`; pinned by
`model-route-hook.test.mjs:93-107`). On a pinned session it strips the option unconditionally
(`:195`), which is mechanical and therefore absolute. It is listed here rather than under "fails"
because when its *classifier* is wrong nothing fails — it just routes differently. Thirteen
hand-picked cases pin the classifier (`model-route-hook.test.mjs:41-138`). See **A11** for the
corpus gate the file claims and does not have.

---

## ADVISORY

Stated somewhere; nothing detects a violation.

### A1 — The UI/design resource stack

**Stated:** `config/CLAUDE.md:3-37`, the whole of `config/ui-design-stack.md`, and injected three
times per prompt (`config/hooks/session-start-ui-stack.js`, `user-prompt-ui-stack.js`,
`skills/visual-design-mastery/hooks/user-prompt-visual.js`).

**Evidence of absence:**
`grep -rn "21st\|magicui\|reactbits\|aceternity" tools/ .github/ .githooks/` → no hits. The only
matches for `visual-design-mastery` across `tools/` are four path constants naming its hooks
directory (`install.mjs:139`, `sync.mjs:36`, `config.test.mjs:112`, `uninstall.mjs:127`).

**What would have to fail:** that a UI file was written without any of these being consulted.

**Do not build it.** There is no artifact that records consultation. The nearest proxy — "a
`.tsx` was written and no WebFetch/context7 call preceded it in this turn" — misfires on editing
an existing component, a one-line style fix, an offline machine, and any project with its own
design system that deliberately does not use these libraries. That is a gate switched off within
a day, which is worse than none.

**What in this mandate *is* safely gateable, cheaply:** the negative and structural claims, all of
which are assertions about files.
- "Never install `open-design`" and the two rejected packs (`config/CLAUDE.md:28-29`,
  `ui-design-stack.md:95-100`) — a test asserting those names appear in `library/sources.json`
  with `rejected: true`. Zero false positives; `config.test.mjs:172-183` already asserts every
  rejected entry carries a reason, so the shape exists.
- "One 3D stack deliberately — Babylon/PlayCanvas/A-Frame/Spline/PixiJS are indexed, not
  installed" (`CLAUDE.md:17-18`) — a test asserting none of those five names appears in
  `sources.json.tier2`. Zero false positives.
- The eleven technique skills listed at `ui-design-stack.md:37-49` — a test asserting each is
  present in `sources.json.tier2`. This is the same class as **E12** and would have caught the
  prose/measurement drift it was written for.

### A2 — The React tooling stack, and a gate that exists but is not wired

**Stated:** `config/CLAUDE.md:39-52`, `config/react-tooling-stack.md:47-53` — the order
`react-doctor → eslint → react-scan → strix`, "Never claim a React task complete without running
the applicable tools."

**Evidence of absence:** nothing in `tools/`, `.github/` or `.githooks/` invokes any of them; the
only `react-scan`/`react-doctor` hits in `tools/` are `install.mjs:295` (a global npm install list)
and `uninstall.mjs:377` (a "kept, deliberately" note).

**But the gate is already written.** `config/hooks/react-doctor.mjs` is a 106-line PostToolUse
hook that runs `react-doctor --verbose --scope changed --blocking warning --no-score` after an
`Edit|Write|MultiEdit|NotebookEdit|ApplyPatch` (`:13`, `:48-50`). It is copied to
`~/.claude/hooks/` on every install (`install.mjs:143`, whose filter is `/\.(js|mjs|cjs)$/`), it is
on disk right now at 4,100 bytes (recorded in `argo/.argo/drift/2.1.235-bcf19b8b.json:38-42`), and
`grep -c react-doctor ~/.claude/settings.json` → **0**. It has never run. It is registered nowhere
in `config/hooks.json` either — the registered set is the 14 scripts at `config/hooks.json:8,14,20,26,37,42,47,52,57,62,67,80,92,105`.

**Feasibility of wiring it: high.** It already degrades safely — `:40-46` documents that it exits 0
silently when no runner is found, probes the local bin with `existsSync`, and tolerates 127/9009.
Cost is latency on every JS/TS edit and an `npx` shell-out. Mitigation: keep the PostToolUse
matcher tight and give it a short `timeout` in the registration. This is the cheapest real
enforcement available anywhere in this repo, because the hard part is already done.

Note it is also a false-positive risk of a different kind: `--blocking warning` means a
warning-level finding produces output on edits to files the turn did not intend to audit. Scope it
to `--scope changed` (already the default in the file) and confirm the output volume on one real
React project before registering.

### A3 — The security tooling stack

**Stated:** `config/CLAUDE.md:54-61`, `config/security-stack.md:24-30` — T3MP3ST recon → strix scan
→ fix → re-verify, "Never claim a security task complete without … re-verification evidence."

**Evidence of absence:** `strix` and `tempest` appear nowhere in `tools/`, `.github/` or
`.githooks/` (same grep as A1).

**Do not build a run-the-scanner gate.** `strix` requires Docker Desktop running
(`security-stack.md:22`), a target the operator is authorized to test, and minutes per run. A hook
that pentests on every security-adjacent edit is unusable, and `security-stack.md:5`'s
"AUTHORIZED USE ONLY" is a legal judgment no check can make. This is the clearest case in the
report where a gate would be actively harmful.

**What is safely gateable:** whether the mandate is *executable on this machine at all*. `doctor.mjs`
resolves `node`, `git` and `argo` (`:44-45`, `:144-152`) and stats every MCP entry point
(`:104-110`), but never checks `tempest`, `strix`, or the bridge at `{{BRIDGE_ROOT}}`. A `warn`-level
doctor phase resolving those three would have zero false positives (it is a PATH lookup and a
stat), and would surface the case where the mandate has been telling Claude for months to run a
tool that is not installed. Warn, not fail — they are documented as optional
(`paths.mjs:43-46`, "Absent is fine; the mandates say so").

### A4 — Graph engineering: measure before you fan out

**Stated:** `config/CLAUDE.md:125-163`, `argo/plugin/skills/graph-engineering/SKILL.md`, injected
conditionally by `argo/plugin/hooks/user-prompt-graph.js` (its `:1-6` says so plainly: "put the
graph facts in front of the model BEFORE it picks a worker count").

**Evidence of absence:** `grep -rn "argo graph\|shared surface\|fan-out" tools/ .github/ config/hooks/`
returns three hits, all prose: `install.mjs:263` (a success message), `model-policy.test.mjs:108`
(a comment), `restore-dispatch.js:30` (injected text).

**Rule by rule:**
- *"Take its worker count"* — a PreToolUse hook on `Agent` could count dispatches per session and
  attach the measured `argo graph` verdict from the Nth onward. That is still injection, not a
  gate. **Blocking** a fan-out is not safe: the hook cannot distinguish a fleet the user asked for
  from one the model invented, and refusing legitimate parallel work is exactly the misfire that
  gets a hook deleted.
- *"Workers never read each other's output"* — gateable only at the harness level (agent A must not
  be handed agent B's transcript). This repo does not control that surface. Not buildable here.
- *"The shared surface is read-only during fan-out"* — gateable in principle by a PreToolUse
  `Write|Edit` check against a frozen-file list, but the frozen list is per-fan-out state that
  nothing persists. Would need `argo fanout` to write a manifest first. Real, but a project, not a
  gate.
- *"A crew has to beat a single agent"* — `argo baseline` exists precisely to measure it, and
  nothing requires running it. Requiring it per-fan-out means paying for a duplicate single-agent
  run every time. Not worth gating; see **U8**.

### A5 — The delegation posture

**Stated:** `config/CLAUDE.md:63-77`, and injected as a standing user request by
`config/hooks/restore-dispatch.js`. That file self-classifies honestly at `:16-18`:
*"this lands as additionalContext. It is influential, not authoritative."*

Not gateable, and the file already says so. Whether a given task warranted delegation is judgment
(see **U7**). No action.

### A6 — The pre-commit gate is not installed by the installer

**Stated:** `.githooks/pre-commit:3` — *"Wired by: git config core.hooksPath .githooks (install.mjs
does this)"*, and README's security section, which claimed the hook ran on every commit.

**Evidence of absence:**
`grep -rn "hooksPath" . --include=*.mjs --include=*.js --include=*.md --include=*.yml --include=*.sh --include=*.ps1`
(excluding `library/repos`) → **zero hits**. `install.mjs` sets `core.longpaths` (`:96`) and nothing
else. On this machine `git config --get core.hooksPath` returns `.githooks`, so it was set by hand
once; `.git/hooks/` contains only `.sample` files.

**Consequence:** on every fresh clone, one of the four gates
`skills/standard-of-work/SKILL.md:19-20` cites as having held with zero escapes does not exist. The
failure mode it guards is publishing a live OAuth token (`tools/scan-secrets.mjs:6-12`).

**Feasibility: trivial, zero false positives.** `git config core.hooksPath .githooks` is
repo-local, idempotent, and reversible. `git config --get core.hooksPath` is a read. See the
ranking.

### A7 — CI runs neither the root test suite nor any non-Linux job

**Status: withdrawn 2026-09-01 — there is no CI.** The workflow was deleted at the owner's
request; this repo does not use GitHub Actions. The root-suite half of the finding is answered
locally (the Stop hook runs the declared test command every turn, and both suites run from one
command each). The non-Linux half is **not answered by anything** and is an accepted limitation:
see `docs/gap-analysis.md` G1, and `skills/cross-platform` for how to catch that bug class
without a second runner. The evidence below is the record of the original finding.

**Evidence.** `.github/workflows/ci.yml:14` — `runs-on: ubuntu-latest`, one job. `grep -n "runs-on\|matrix"`
over `.github/` returns exactly that one line and no `matrix` at all. The only `npm test` in the
file is at `:64`, inside `working-directory: argo` (`:48`). `package.json:11` declares
`"test": "node tools/run-tests.mjs"` — measured just now at **94 tests, 0 failures**, invoked by
nothing automatic. `doctor.mjs` runs with `|| true` (`:34`); `sync.mjs --check` runs with
`continue-on-error: true` (`:45`). Both have stated reasons and both are correct as written — a
hosted runner has no real install to inspect.

`docs/gap-analysis.md:38-72` (G1) raised this and it is still exactly true. Two of its supporting
facts have since moved: the test count is 94, not 53, and the `sync.mjs` regex defect it cites as
live (G2) has been fixed at `sync.mjs:99`.

### A8 — `sync.mjs` and `uninstall.mjs` have no executing test

**Status: closed 2026-09-01.** `tools/test/uninstall.test.mjs` (dry-run writes nothing, a link is
removed without following it, a real directory is refused, protected files stay byte-identical, a
second run is a no-op, and `npm`/`claude` are provably never invoked) and `tools/test/sync.test.mjs`
(templatize round-trip, drift report, the mtime guard). The trailing-separator delete-through
spelling is not exercised: `uninstall.mjs` builds every path with `join()` and cannot produce it.

**Evidence of absence:** `grep -rn "uninstall\|sync\.mjs" tools/test/` returns two hits, both
comments (`config.test.mjs:88` and `:122`). `cli.test.mjs` — the file that actually spawns tools —
names neither. `uninstall.mjs` is 391 lines and is the only tool in the repo that deletes files.

The whole uninstall contract documented at `docs/troubleshooting.md:230-279` is unasserted: dry-run
is the default, `.credentials.json`/`history.jsonl`/`projects/`/`todos/` are never touched, skill
links are removed with `lstat` + non-recursive delete so deleting *through* a junction cannot
destroy the source repo, a real directory is refused rather than deleted, backup names come from
the file's own mtime (`uninstall.mjs:79`) rather than `Date.now()`, and a second run reports
everything skipped.

**Feasibility: high, zero false positives.** These are behavioural assertions against a scratch
`HOME`, and `cli.test.mjs:20-35` already provides the harness (`scratch()` + `runTool()` with
`HOME`/`USERPROFILE` redirected). The dry-run-writes-nothing test is four lines and mirrors
`cli.test.mjs:47-54` exactly.

### A9 — `install.mjs` does not verify its own work

`install.sh` and `install.ps1` both end by *printing* `Verify with: node tools/doctor.mjs`; neither
runs it. Inside `install.mjs`, only two conditions call `fail()`: Node older than 20 (`:87`) and a
hook that fails `node --check` (`:154`). These call `warn()` and leave the exit code at 0:
unresolved tokens in a mandate (`:111`), a missing MCP entry point (`:329`), a failed `npm link`
(`:264`), a failed plugin install (`:286`), a missing tier-2 skill (`:367`). `doctor.mjs` **fails**
on several of the same conditions (`:59`, `:106-108`, `:126-134`).

So `install.mjs` can report *"Install incomplete"* never, and print *"Next: node tools/doctor.mjs"*,
on a config doctor would call broken.

**Feasibility: moderate.** Running doctor automatically at the end of a full install and
propagating its exit code is four lines, but doctor fails on conditions install deliberately
tolerates (no `~/.claude.json` yet on a first-ever run, argo not yet on PATH before a shell
restart). Scope the auto-run to the phases that actually executed, or promote the specific
`warn`s above to `fail`s and leave the bootstrap scripts alone. The second is simpler and has no
false positives — each of those five conditions is already a hard failure by doctor's own
judgment.

### A10 — Nothing can see a hook that ships but is never registered

**This is the known past failure, and there is a live instance.**

**Evidence of absence.** `doctor.mjs`'s Hooks phase (`:63-91`) iterates `settings.hooks` and
nothing else; the only `readdirSync` calls in the file are `:171` and `:226`, both over
`skillsDir`. `config.test.mjs:107-119` checks the forward direction only — registered → shipped.
`cli.test.mjs:148` asserts `written.length >= 8`, a floor, so an extra unregistered file passes.
`grep -rni "orphan\|unregistered\|not registered\|never registered"` over `tools/ config/ docs/
.github/ .githooks/` returns one hit, an unrelated sentence in `post-tool-verify.js:263`.

**Live instance.** `config/hooks/react-doctor.mjs` — see **A2**. Install writes 15 hook files;
`config/hooks.json` registers 14. `README.md:58` says "14 hooks merged into `settings.json`", which
is literally true and is exactly why nobody noticed the 15th.

**Feasibility: trivial, and — unusually — zero false positives.** The one false-positive class
would be a shared helper module living in a hooks directory without being an entry point.
`universality.test.mjs:89-101` already forbids any hook importing a relative path, so in this repo
every file in a hook source directory *is* an entry point. That existing gate is what makes this
one safe.

**Second-order note.** `sync.mjs:106-111` derives `config/hooks.json` *from* the live
`settings.json`. A hook never registered on the origin machine can therefore never enter
`hooks.json` by syncing. The loop is closed only by a test that reads the source directories
directly.

### A11 — A cited gate that does not exist

`config/hooks/pre-tool-model-route.js:26-29` states:

> Over-assignment is minimised the only honest way — by widening the high-confidence downgrade
> rules one measured case at a time, each pinned by a labelled corpus test. See
> `tools/test/model-corpus.test.mjs`; the gate there is ZERO under-assignments, with
> over-assignment reported as a number rather than assumed away.

`ls tools/test/` → `cli.test.mjs, config.test.mjs, docs-numbers.test.mjs, model-policy.test.mjs,
model-route-hook.test.mjs, paths.test.mjs, universality.test.mjs`. **`model-corpus.test.mjs` does
not exist.** The classifier is pinned by 13 hand-written cases in `model-route-hook.test.mjs:41-138`.

This matters more than a stale comment, because the file's safety argument (`:16-24`) rests on the
claim that under-assignment is measured, not assumed. It is currently assumed. Either build the
corpus or delete the paragraph — leaving it is a false evidence claim under
`standard-of-work/SKILL.md:42-53`.

### A12 — `library/CAVEATS.md` version rows rot with nothing to notice

**Status: closed 2026-09-01.** `argo watch --caveats library/caveats-versions.json`, with
`tools/test/caveats.test.mjs` holding the sidecar and the prose to the same numbers. Run by hand,
not in CI, for exactly the reason given below: it depends on npm's uptime.

`library/CAVEATS.md:8` says the version rows rot and to regenerate them with `npm view`.
`grep -rn "npm view\|npm outdated\|registry.npmjs" tools/ .github/ library/*.mjs` → **zero hits**.
`docs/gap-analysis.md:220-247` (G5) documented this, noted that
`argo/src/watch/sources.js:185` already fetches `https://registry.npmjs.org/<pkg>`, and priced the
script at ~40 lines. Still open. Low harm (the blast radius is a stale version pasted into a
starter, which the caveats file mitigates by existing), and the gate would depend on npm's uptime,
so it belongs in CI as a non-blocking step, not as a build gate.

### A13 — Documented decisions with no assertion behind them

From `docs/architecture.md`, each stated as a decision and each unasserted:
- `:27-35` "an explicit allowlist, never a mirror" — implemented at `sync.mjs:19-28`; no test reads
  `TRACKED` and asserts a denylist has not crept in.
- `:58-68` "one canonical home per file" — implemented at `sync.mjs:34-40`; no test asserts a hook
  whose canonical home is `argo/` or a skill is skipped by sync.
- `:125-126` "No `Date.now()` in generated files" — `grep -rn "Date.now()"` over `tools/*.mjs` and
  `library/build-index.mjs` returns one hit, the *comment* at `uninstall.mjs:79` explaining the
  rule. Currently obeyed. A test grepping non-comment lines is three lines and has one false
  positive to think about (a legitimate elapsed-time measurement), so scope it to files that write
  output.

Partly closed since: `tools/test/line-endings.test.mjs` now reads `.gitattributes` and every
tracked file carrying a shebang — which is how it asserts `.githooks/pre-commit` and `install.sh`
are stored and checked out with LF, the one property whose loss makes both unexecutable on Linux.
Their *behaviour* is still unasserted, as is `install.ps1` entirely. `.github/workflows/ci.yml` has
left the list by being deleted rather than tested. So: two of the repo's own gates remain ungated
against deletion, down from four.

---

## UNENFORCEABLE

Legitimate answers. Nobody should spend a session trying to gate these.

**U1 — "Make one decision only this project would make." "Fine is the enemy."**
`skills/visual-design-mastery/SKILL.md`, echoed in `user-prompt-visual.js:76-77`. Distinctiveness
is a judgment about a design's relationship to every other design a reader has seen. No file-level
check reaches it. `skills/creative-divergence` and the `design-divergence` workflow are the right
response: a *process* that makes genericness less likely, not a check that detects it.

**U2 — "The taste layer wins unconditionally on conflict."**
`README.md:69`, `ui-design-stack.md:19-21`, `CLAUDE.md:9-10`. This is a precedence rule between two
bodies of advice. Nothing records which layer decided a given line of code, so there is no artifact
to inspect.

**U3 — "The component libraries are for EXECUTION, never for deciding the concept."**
`ui-design-stack.md:103-109`. The rule is about *when in the process* a library was consulted. Two
identical diffs, one written after deciding the concept and one written by adapting an Aceternity
hero, are byte-identical. Undecidable by construction.

**U4 — "Ground layout decisions in Refero and Godly."**
`ui-design-stack.md:116`. Even a logged fetch would not establish that a decision was grounded in
what was fetched.

**U5 — "Judge difficulty by the hardest decision the agent must make on its own."**
`CLAUDE.md:93-101`. The regexes in `pre-tool-model-route.js:55-93` are a deliberate approximation,
and the file's safety argument (`:16-24`) is that its *errors* are one-directional rather than that
its classification is right. The residual — is this prompt asking for a decision? — is the same
natural-language judgment the agent is being routed to make. The correct response is **A11**'s
corpus measuring the error rate, not a stricter classifier.

**U6 — "AUTHORIZED TARGETS ONLY."**
`config/security-stack.md:5`, `CLAUDE.md:56`. Whether the operator holds written permission to test
a host is not a fact available to any process on this machine.

**U7 — Most of `skills/standard-of-work/SKILL.md`.** The evidence ladder's *rows* are gateable
individually where a project happens to have the tooling ("tests pass" → run them; "N things" →
count them) and several already are — that is what **E12** and **E19** do. But calibrating the bar
by "blast radius × reversibility × audience" (`:65-81`), "say the uncomfortable thing" (`:97-99`),
"report what you found but did not do" (`:95`) and "an honest 'done, with three caveats' beats a
confident 'done'" (`:115-116`) are judgments about a report's honesty. A check cannot read a
sentence and decide whether the caveat in it is the one that mattered.

**U8 — "A crew has to beat a single agent on the same task."**
`CLAUDE.md:144-146`. Empirical and measurable — `argo baseline` exists for it — but not decidable
*before* the fan-out, which is when the rule applies, and measuring it means paying for the
duplicate single-agent run the rule is trying to avoid. The skill correctly frames it as a claim to
test, not a precondition to enforce.

---

## Documentation defects

Recording these separately because each is a false statement about enforcement, which is the
specific error `skills/standard-of-work/SKILL.md` was written against.

**D1 — Two files title a section "Enforcement" and then describe injection.**
`config/react-tooling-stack.md:55-57`: *"## Enforcement — This stack is injected at SessionStart and
on every UserPromptSubmit via Claude hooks."* `config/security-stack.md:32-34`: identical shape.
`config/CLAUDE.md:52` and `:61`: *"These mandates are enforced by Claude hooks (SessionStart +
UserPromptSubmit)."*
Those hooks emit `additionalContext` and nothing else — `user-prompt-react-stack.js:3-8`,
`user-prompt-security-stack.js:3-8`, `session-start-*.js:9-11` are each a single
`process.stdout.write` of a JSON blob. Nothing fails. By `standard-of-work/SKILL.md:12-14` that is a
preference. `post-tool-verify.js:5-11` states the distinction correctly and in the same repo:
*"An ADVISORY hook injects reminder text and hopes the model obeys it … A GATE inspects the artifact
and reports a concrete defect."* The mandate files should say "injected", not "enforced".

**D2 — `.githooks/pre-commit:3` claims `install.mjs` wires `core.hooksPath`.** It does not. See **A6**.

**D3 — `config/hooks/pre-tool-model-route.js:28-29` cites a test file that does not exist.** See **A11**.

**D4 — `docs/gap-analysis.md` is stale in two places.** G2's live `sync.mjs` regex defect is fixed
(`sync.mjs:94-99` now matches a POSIX root; the comment at `:96-98` records the fix). Its "53 tests"
is now 94. Its G1 is still exactly true, and its G2 test half is still open.

**D5 — `docs/troubleshooting.md:143` says "12 resident Tier-2 skills"; measured 13.** The
docs-numbers gate would catch it if `docs/troubleshooting.md` were added to
`docs-numbers.test.mjs:47`.

**D6 — Already enforced, described as if it were only a convention.** Two worth recording as
documentation improvements rather than defects: `docs/architecture.md:127` states "No auto-repair in
`doctor.mjs`" as a decision, and it *is* gated (`cli.test.mjs:216` asserts doctor created nothing).
`universality.test.mjs:9` correctly notes the portability rule became a gate, but `README.md` and
`docs/architecture.md` never mention that the portability invariant is enforced at all — a reader
would reasonably assume it is a convention.

---

## Ranking

Scored by **harm if violated × feasibility of a safe gate**. "Safe" means a gate that cannot
misfire, because a gate that misfires gets switched off and that is worse than none.

| # | Item | Harm | Safe-gate feasibility | Verdict |
|---|---|---|---|---|
| 1 | A7 — CI runs no root tests, one OS | High | Trivial, no false positives | **Withdrawn** — no CI; root suite runs locally, second OS uncovered |
| 2 | A10 — orphan hooks invisible | High | Trivial, no false positives | **Done** — `hook-registration.test.mjs` |
| 3 | A6 — pre-commit not installed | High | Trivial, no false positives | **Done** — `install.mjs` sets `core.hooksPath` |
| 4 | A2 — wire `react-doctor.mjs` | Medium-high | High; the hook is already written | **Done** — registered on PostToolUse |
| 5 | A8 — no test for sync/uninstall | Medium-high | High; harness exists | **Done** — see A8 |
| 6 | A9 — install does not verify itself | Medium | Moderate; promote five warns to fails | Next |
| 7 | A11 — missing model corpus | Medium | Moderate; needs a labelled corpus | Next |
| 8 | A1/A3 negative claims, D5 doc scope | Low-medium | Trivial | Fold into the next visit |
| 9 | A12 — CAVEATS version drift | Low | Moderate; depends on npm uptime | **Done** — `argo watch --caveats`, run by hand |
| — | A1/A3/A4 behavioural mandates | High | **Unsafe** | Do not build |

### Build these three first

**1. ~~Make the existing tests run, on both platforms.~~ Superseded — this repo has no CI.**
The original recommendation was a two-OS GitHub Actions matrix. That is no longer the plan: the
workflow was removed at the owner's request, so the recommendation is recorded here rather than
followed, and the finding is marked withdrawn under **A7**.

What replaced the runnable half: `tools/run-tests.mjs` and `argo/test/run.js` hand node explicit
file paths, so one command runs each suite identically on Node 20 and 24, under `sh` and under
`cmd.exe`; the Stop hook runs the declared test command at the end of every turn.

What nothing replaced: the second platform. `commit 23afa56` fixed two bugs that were
platform-conditional in **opposite directions** — every hook dead on POSIX, every `npm` call dead
on Windows — and one machine can observe at most half of that class. Anyone with the other
platform should run both suites there before trusting a portability claim; `skills/cross-platform`
lists the techniques that make each hazard provable without owning the machine
(env-as-parameter, platform-as-parameter, empty-PATH spawn, byte-level line-ending checks).

**2. Close the orphan-hook hole in both directions.**

*A test*, in `tools/test/config.test.mjs` next to its mirror at `:107-119`:

> `shipped` = `readdirSync` over `config/hooks`, `argo/plugin/hooks`,
> `skills/visual-design-mastery/hooks`, filtered to `/\.(js|mjs|cjs)$/`.
> `registered` = the basename matched out of every `command` in `config/hooks.json` by
> `/([\w.-]+\.(?:js|mjs|cjs))/`.
> `assert.deepEqual([...shipped].sort(), [...registered].sort())`.

It fails today, naming `react-doctor.mjs`. It is safe because `universality.test.mjs:89-101` already
forbids a hook importing a relative path, so every file in those directories is an entry point and
there is no shared-helper false positive to worry about.

*A doctor check*, appended to `doctor.mjs`'s Hooks phase (`:63-91`), covering the machine rather
than the repo:

> `readdirSync(join(CONFIG_ROOT,'hooks'))`, filtered the same way; for each file, `fail` if no
> registered `command` string contains its basename — message
> `"<name> is installed but registered nowhere — it has never run"`.

This half matters because `sync.mjs:106-111` builds `config/hooks.json` *from* the live
`settings.json`, so a hook never registered on a machine can never enter the manifest by syncing.
The repo-side test alone would not close the loop.

**3. Install the pre-commit gate, and prove it is installed.**

*Installer*, in `install.mjs`'s Prerequisites phase near `:96`, guarded on `existsSync(join(REPO,'.git'))`:
`run('git', ['config', 'core.hooksPath', '.githooks'], { cwd: REPO })` — repo-local, not `--global`,
idempotent, and reversible. Report it with `ok()`.

*Doctor*, a new check: read `git config --get core.hooksPath` with `cwd: REPO`, and `fail` when it
is not `.githooks` —
`"pre-commit secret scan is not wired: git config core.hooksPath is '<value>'. Run node tools/install.mjs."`
It is a config read, so it cannot misfire.

*Test*, in `config.test.mjs`: assert `.githooks/pre-commit` exists and its body names
`tools/scan-secrets.mjs`. That closes **A13**'s observation that four of this repo's own gates are
themselves ungated against deletion.

*Why third and not lower:* the scanner is the highest-stakes file in the repo
(`scan-secrets.mjs:6-12`) and it is currently wired on exactly one machine, by hand, with the file
that documents the wiring asserting an installer step that does not exist.

### The one to build fourth, and why it is not in the top three

Registering `config/hooks/react-doctor.mjs` in `config/hooks.json` as a `PostToolUse` `Write|Edit`
hook is the cheapest real enforcement available anywhere here — the gate is written, tested by its
own defensive design, and self-silencing when the runner is absent. It ranks fourth only because
item 2 is what makes it impossible to forget the *next* one. Wiring this hook without building the
orphan check fixes one instance and leaves the class open, which is the failure
`standard-of-work/SKILL.md:88-90` names directly: *"Fix the class, not the instance."*
