# Gap analysis

Where Claude is weak *and* this repo does not already cover it. Every claim below is tied to a
file:line, a commit, or a command that was run. Candidates that could not be grounded were
dropped rather than padded; they are listed at the end so they are not raised again.

Measurements were taken during `9ed737d`..`f84a794` — other agents were committing to this repo
throughout — and every line citation below was re-verified against `f84a794`.

## What is already covered

Read before proposing anything: `skills/string-boundaries/SKILL.md` (parser-boundary bugs —
JSON escaping, Windows paths in source literals, POSIX separators, `.cmd`/PATHEXT/EINVAL,
validators sharing the generator's assumption), `skills/visual-design-mastery`,
`skills/creative-divergence`, `skills/design-tokens`, `skills/project-memory`, the 13 argo
plugin skills (`graph-engineering`, `plow-ahead`, `read-the-damn-docs`, `stay-within-limits`,
`agent-watchdog`, `plan-arbiter`, `quick-recap`, `rewind`, `visual-*`, `efficient-*`), and the
65 entries under `~/.claude/skills` (superpowers, ponytail, the Anthropic document set, the
12 animation/3D skills, `asd-ste100`).

The repo's own machinery: `tools/doctor.mjs` (context cost, name collisions, trigger
contention, hook liveness), `tools/scan-secrets.mjs`, `tools/run-tests.mjs` (53 tests),
`docs/troubleshooting.md` (nine failure post-mortems), `library/CAVEATS.md` (verified defects
in installed skills).

## The shape of the problem

Seven bugs shipped and were found afterwards. They are enumerated in
`skills/string-boundaries/SKILL.md`, and four of the nine commits in `git log` are pure
post-hoc fixes for them: `9e617d0`, `23afa56`, `c806e5a`, `9ed737d`.

The knowledge to prevent all seven now exists in this repo, written well. What does not exist
is anything that applies it without being asked. Every gap below is downstream of that, and the
ranking follows from it: the missing artifacts are gates, not prose.

---

## G1. The repo's gates do not run the repo's checks

**Gap.** CI runs neither the root test suite nor any non-Linux job, so the two verification
mechanisms that would have caught the platform-conditional bugs are manual.

**Evidence.**

- `.github/workflows/ci.yml:14` — `runs-on: ubuntu-latest`. One job, no `strategy.matrix`.
- `.github/workflows/ci.yml:64` — the only `npm test` in the file is inside
  `working-directory: argo`. It runs argo's suite.
- `package.json` — `"test": "node tools/run-tests.mjs"`. Measured just now: **53 tests,
  0 failures, 5.1s**. CI never invokes it.
- `.githooks/pre-commit` — `exec node .../tools/scan-secrets.mjs`. Secrets only; no tests.
- `ci.yml` — `doctor.mjs` runs with `|| true`; `sync.mjs --check` runs with
  `continue-on-error: true`. Neither can fail the build by design, with reasons given.
- Commit `23afa56` fixed two bugs that were platform-conditional **in opposite directions**:
  every hook dead on macOS/Linux, every `npm` call dead on Windows. A single Linux runner
  cannot observe the second; nothing automatic runs the tests that observe the first.

**Why existing coverage does not close it.** `verification-before-completion` targets the agent
about to claim done, and it was satisfied — `23afa56` and `c806e5a` both state "49 tests pass",
truthfully, and the count is now 53. The discipline held. What was missing is the check that
runs when nobody invokes it, on a machine that is not this one.

**Intervention — CI change.** Not a skill; a skill cannot execute on a Windows runner. In
`.github/workflows/ci.yml`: add `strategy.matrix.os: [ubuntu-latest, windows-latest]` with
`runs-on: ${{ matrix.os }}`, and add a `node tools/run-tests.mjs` step that is allowed to fail
the build. Roughly eight lines of YAML. Note that the `argo` step's shell script body is
POSIX `sh`; it needs `shell: bash` to survive the Windows leg.

**Resident token cost.** Zero.

**Priority: 1.** Highest ratio in the analysis. Hours of work, no session cost, and it converts
the repo's best existing asset — 53 tests written specifically because of these bugs — from
something a person remembers to run into something that runs.

---

## G2. Two tools have no tests, and one of them carries a live instance of the documented bug class

**Gap.** `tools/sync.mjs` and `tools/uninstall.mjs` are unexercised by any test, and
`sync.mjs` contains a Windows-only regex that makes its stated purpose a silent no-op on
macOS and Linux.

**Evidence.**

- `tools/sync.mjs:94`:

  ```js
  const ABS_SCRIPT = /"[A-Za-z]:[^"]*[\\/]([\w.-]+\.(?:js|mjs|cjs))"/g
  ```

  The `[A-Za-z]:` requires a drive letter. Run against the three realistic forms:

  | input | matches |
  | --- | --- |
  | `"C:/Program Files/nodejs/node.exe" "C:/Users/a/.claude/hooks/x.js"` | yes |
  | `"/usr/bin/node" "/home/a/.claude/hooks/x.js"` | **no** |
  | `"/opt/homebrew/bin/node" "/Users/a/.claude/hooks/x.js"` | **no** |

  The comment above it (`sync.mjs:85-88`) states what the miss costs: "otherwise
  the repo records a path that exists only on the machine that wrote it, and the hook is a
  silent no-op everywhere else." That is precisely the failure `23afa56` was written to fix,
  surviving inside the function `23afa56` edited.

- Filename references across `tools/test/*.test.mjs`: `install.mjs` 24, `paths.mjs` 8,
  `doctor.mjs` 6, `scan-secrets.mjs` 6, `sync.mjs` **2**, `uninstall.mjs` **0**. Both
  `sync.mjs` references are comments (`config.test.mjs:88` and `:122`), and `cli.test.mjs` —
  the file that actually spawns the tools — mentions neither. Neither tool is executed by any
  test. `uninstall.mjs` is 391 lines and is the only tool in the repo that deletes files.

**Why existing coverage does not close it.** `string-boundaries` already names this exact
pattern — "a character class that omits something *silently never matches* instead of erroring
→ test with input the pattern was not designed for" — and it names `sync.mjs`'s sibling bug as
its item 3. The knowledge landed one commit ago and did not find the live instance, because
nothing re-reads existing code against a newly written rule.

**Intervention — tests, plus a one-character fix.** The pattern to copy already exists:
`config.test.mjs:81`, "a hook path realized on POSIX uses a separator POSIX can actually
follow". Add `tools/test/sync.test.mjs` asserting `normalise()` templatizes a POSIX absolute
hook path, and `tools/test/uninstall.test.mjs` asserting the dry-run default writes nothing and
the real-directory refusal holds. Widen `ABS_SCRIPT` to accept a leading `/`.

**Resident token cost.** Zero.

**Priority: 1.** A live defect in shipped code, in the repo's least-tested and most destructive
files. Pairs with G1: G1 makes the tests run, G2 gives them something to run against.

---

## G3. Documented numbers drift from measured ones, and nothing compares them

**Gap.** The repo asserts figures in prose that its own tooling can compute, and three of them
are currently wrong.

**Evidence.** All three broke at `9ed737d`, which added `asd-ste100` to `tier2` and its repo to
`repos`, and touched no prose. `README.md` and `docs/architecture.md` were last modified two
commits earlier at `b425807`. Verified against `c806e5a:library/sources.json`: before
`9ed737d`, `tier2.length` was 12 and clonable repos were 11 — matching the prose exactly.

| Claim | Location | Measured |
| --- | --- | --- |
| "12 Tier-2 animation/3D skills" | `README.md:59`, `docs/architecture.md:87` | `sources.json.tier2.length` = **13** |
| "11 skill repos cloned and indexed" | `README.md:63` | non-rejected `repos` = **12** |
| "~2,100 tokens" resident | `README.md:91`, `docs/architecture.md:87` | **~1,446** |

The token figure was measured with `doctor.mjs`'s own method (`name` + `description`
frontmatter chars / 4, `doctor.mjs:180-185`) over the 13 installed Tier-2 `SKILL.md` files.
Per-skill it ranges 84 (`60fps-animation`) to 154 (`gsap-web`). `config/CLAUDE.md:21` gives a
fourth number, "~1,350" — closer, still not equal, and 55% apart from the README's.

`library/INDEX.md` is the counter-example that shows this is fixable: its "814 skills" is
emitted by `build-index.mjs` and is exactly reproducible — 814 bullet lines, confirmed.

**Why existing coverage does not close it.** `doctor.mjs` §7 measures the live machine and
prints the number; it never compares it to the number written down. `config.test.mjs:146-198`
already asserts invariants over `sources.json` (valid JSON, no duplicate names, every tier2
path points into a cloned repo) but nothing about prose. No skill can make a stale integer fail
a build.

**Intervention — test, in the file that already holds these invariants.** About 15 lines in
`tools/test/config.test.mjs`: extract the integers named in `README.md`,
`docs/architecture.md` and `config/CLAUDE.md`, assert against `sources.json.tier2.length` and
the non-rejected repo count. The token figure is harder to pin (it depends on what is
installed) — the honest fix there is to delete the number from the prose and point at
`node tools/doctor.mjs`, which prints the real one.

**Resident token cost.** Zero.

**Priority: 2.** No user is harmed by a wrong skill count. It matters because "every claim
needs evidence" is this repo's stated standard, and the three numbers a reader meets first are
the ones that failed it — one commit after they were correct.

---

## G4. Process environment and filesystem-link semantics

**Gap.** Nothing in the installed set covers the Windows and subprocess hazards that are not
parser-boundary problems: PATH inheritance, junctions, `MAX_PATH`, and exec bits.

**Evidence of absence.** Across the 65 skills in `~/.claude/skills`, the string "windows"
appears in exactly one `SKILL.md` — `ponytail-help`, naming a config-file location — and in
zero `description` fields. `PATHEXT`, `MAX_PATH`, `longpaths`, `junction` and `CRLF` return
nothing across `~/.claude/skills` and `argo/plugin/skills`.

**Evidence the hazards are real, all from this repo's own record:**

1. **A subprocess does not inherit your shell's PATH.** A hook registered as bare `node` is a
   silent no-op. `docs/troubleshooting.md` calls this "the most expensive bug in the repo's
   history" — hooks dead for **weeks** with no error anywhere. The same cause reappears for
   MCP servers ("An MCP server does not connect", cause 2).
2. **Deleting through a junction destroys the target.** `tools/uninstall.mjs` guards it with
   `lstat` + non-recursive delete; `docs/troubleshooting.md` states the consequence plainly.
   Data-loss grade, and the fix is one API choice.
3. **`MAX_PATH` 260.** Library clones fail or half-succeed; `install.mjs` sets
   `git config --global core.longpaths true`, and deliberately does *not* set the machine-wide
   `LongPathsEnabled` registry flag. The distinction between the two is the part worth
   carrying.
4. **CRLF makes an extensionless script unexecutable.** `library/sources.json`, `pixel-plugin`
   caveat.

**Why existing coverage does not close it.** `string-boundaries` is scoped, by its own
description, to "a value handed from one parser to another", and covers `.cmd`/PATHEXT/EINVAL
and separators well. None of the four above is a parser disagreement: (1) is environment
inheritance, (2) is filesystem link semantics, (3) is a kernel limit, (4) is an exec-format
check. Widening `string-boundaries` to hold them would blur a description that is currently
sharp, which is the failure mode this repo rejected a 144-skill pack for.

**Intervention — skill.** One page, quoted-phrase triggers only ("the hook is registered but
never fires", "Filename too long on git clone", "will deleting this symlink delete the
target"), no bare topic words. `doctor.mjs`'s contention check should be run against it before
it lands.

**Resident token cost.** ~110–130 tokens, estimated from the measured Tier-2 distribution
(84–154, median ~111) for a description of comparable length.

**Priority: 3.** It is knowledge, and producing good knowledge is the thing this repo is
already best at. G1 and G2 exist because the knowledge did not help; adding more knowledge
first would repeat that.

---

## G5. `CAVEATS.md` version rows rot with nothing to notice

**Gap.** The file states its own decay and offers no mechanism against it.

**Evidence.** `library/CAVEATS.md:8`: "Regenerate the version rows with
`npm view <pkg> version` — they rot." Its Tier-3 table is stamped "Verified against live npm on
2026-08-31" and carries nine recorded/live version pairs, several two majors apart
(`babylonjs-engine` 7.x vs 9.23.0, `locomotive-scroll` v4 vs 5.0.1). A grep for
`npm view|npm outdated|registry.npmjs` across the tree returns exactly one hit:
`argo/src/watch/sources.js:185`, which already fetches
`https://registry.npmjs.org/<pkg>` and exposes it as `fetchSource({type:'npm'})`.

**Why existing coverage does not close it.** `read-the-damn-docs` and the `context7` MCP make
Claude look a version up when it is *asked* about one. Neither notices that a version already
written down has gone stale. That is the actual failure: the caveats file is trusted precisely
because it says it was verified.

**Intervention — script, reusing what exists.** ~40 lines: parse the caveats table, call the
existing `fetchSource({ type: 'npm', package })`, print rows where live differs from recorded.
Add it to the CI job from G1 as a non-blocking step so the drift is visible without gating a
merge on npm's uptime.

**Resident token cost.** Zero.

**Priority: 3.** Real, cheap, and already half-built — but the blast radius is "you paste a
stale version into a starter", which the caveats file already mitigates by existing.

---

## Ranking

**Build first: G1, then G2.** They are one piece of work in two halves — make the gates run,
and give them the two files nobody tested. Between them they would have caught, mechanically
and without anyone remembering to look, the POSIX-hooks bug and the Windows-spawn bug from
`23afa56`, the spawn recurrence in `c806e5a`, and the live `sync.mjs` defect that is in the
tree right now. Cost is hours and zero session tokens.

**Build third: G3.** Fifteen lines in a test file that already exists, closing the gap between
what the repo measures and what it claims.

**Build later, if at all: G4 and G5.** Both are justified and neither is urgent. G4 is worth a
session only once G1/G2 exist, because its whole premise is that written-down knowledge is not
self-applying. G5 should be attached to some other visit to `library/`, not scheduled alone.

**Not worth building at all:** everything in the next section.

---

## Considered and rejected

**A second self-verification skill.** `verification-before-completion` is installed, thorough,
and was *satisfied* by both fix commits — each states a true, freshly measured test count. The
gap is that CI runs no tests and no Windows job (G1), which is a YAML change. Adding a skill
here would also put a second set of triggers against the one that works, which `doctor.mjs`'s
contention check exists to prevent.

**Escaping and parser boundaries.** Owned by `skills/string-boundaries/SKILL.md`, excluded by
brief, and good. Its item 4 — "a validator written from the same assumption as the code cannot
catch that assumption being wrong" — is the sharpest sentence in the repo.

**Time zones and dates.** Rejected on evidence of competence, not absence of evidence.
`tools/uninstall.mjs:79-88` stamps backup filenames from the file's own `mtime` rather than
`Date.now()`, with a counter suffix for a same-mtime collision — which also handles the
DST-repeated-hour case. `docs/architecture.md` states "No `Date.now()` in generated files" as a
deliberate decision with its reason. There is no failure here to cite.

**Concurrency.** No concurrent code exists in the tree to fail: the installer is sequential and
argo is a set of dependency-free CLIs. Agent-level concurrency is covered by
`graph-engineering` and the frozen-shared-surface rule, which this analysis's own brief
enforces. Nothing to ground a proposal on.

**CSV, spreadsheet and data correctness.** The `xlsx` skill is installed and
`string-boundaries` carries a CSV-delimiter row. No failure in this repo to cite; proposing it
would be a listicle entry.

**Reading a large unfamiliar codebase systematically.** `argo/src/graph/scan.js` plus
`argo graph`, `hub-splitter` and the built-in `Explore` agent already do dependency-graph-led
reading. No cited failure of opportunistic grepping in this repo's history.

**Knowing when a task is finished.** Both directions are already covered and they do not
overlap: `ponytail` for gold-plating, `argonaut:plow-ahead` "Stop Conditions" for stopping
early. No evidence of either failure mode in the record.

**Regex correctness as its own gap.** The two regex defects in the history — `paths.mjs`'s
`[A-Z_]` blind spot fixed in `9ed737d`, and `sync.mjs:94`'s drive letter, still live — are both
platform/format-assumption defects rather than regex-craft defects, and `string-boundaries`
already names the pattern. Folded into G2 as a concrete instance instead of listed separately.
