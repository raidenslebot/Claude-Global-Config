# Troubleshooting

Every entry below is a failure that actually happened while building this repo, in the order
symptom → cause → fix. The diagnostic for most of them is one command:

```bash
node tools/doctor.mjs
```

It writes nothing and repairs nothing. It exits 1 if any check fails.

---

## A hook silently does nothing

**Symptom.** A hook is registered in `settings.json`, the script exists, and nothing happens. No
error in the terminal, no entry in any log, no complaint from Claude Code. The session behaves
exactly as if the hook were not there.

**Cause.** Claude Code does not report a hook that cannot be launched. If the interpreter is not
resolvable or the script path does not exist, the hook is a no-op and the failure is invisible.
The common trigger is a hook registered as bare `node ...`: PATH inside the hook process is not
the PATH in your shell, so `node` resolves in your terminal and fails in the hook.

This is the most expensive bug in the repo's history. A set of hooks on the origin machine was
dead for **weeks** for exactly this reason. Nothing surfaced it; the config simply stopped having
any effect and nobody noticed, because a hook that does nothing looks identical to a hook that
had nothing to say.

**Fix.** Run `node tools/doctor.mjs`. Its Hooks phase resolves every registered interpreter and
stats every script path, and reports a missing script as `hook is a silent no-op`. Then re-run
`node tools/install.mjs --only=hooks`, which writes the command with the Node binary hard-pinned
to an absolute path (`tools/paths.mjs` → `detectNode()`) instead of relying on PATH.

Do not register a hook at a path outside `~/.claude` — a hook pointed into a plugin directory or
a checkout is dead on any machine that does not happen to have that exact path. `install.mjs`
gathers hooks from three source directories into the single directory `~/.claude/hooks` for this
reason.

---

## A hook emits a mangled path

**Symptom.** Hook output contains a path with the separators gone and line breaks inserted into
it, for example `C:Users<user>AppDataRoaming` with a stray newline before `pm`, or a hook
that throws `Cannot find module 'C:Users...'`.

**Cause.** A Windows path was substituted into a JavaScript string literal in a source file. The
JS parser reads the backslashes as escape sequences before anything else sees them:
`"C:\Users\npm"` is `C:` + `U` (from `\U`) + `sers` + a newline (from `\n`) + `pm`. The path is
destroyed at parse time, so no amount of runtime checking finds it.

**Fix.** Write forward slashes in any path substituted into a source file. Node accepts forward
slashes on Windows everywhere, so this costs nothing and is unambiguous. `install.mjs` passes
`{ slash: 'forward' }` to `realize()` for every file it writes into `~/.claude/hooks`; see the
comment at that call site. If you add a new templated source file that embeds a path in a string
literal, use the same option.

---

## `SyntaxError: Bad escaped character in JSON` during install

**Symptom.** `node tools/install.mjs` fails partway through the hooks phase with a JSON parse
error, or writes a `settings.json` that Claude Code then refuses to load.

**Cause.** Token substitution was applied to the raw text of a JSON file before parsing it. A
Windows path contains backslashes, which are escape characters in JSON; injecting
`C:\Users\<user>\.claude` into JSON *text* produces `\U` and `\<`, neither of which is a
legal JSON escape.

**Fix.** Parse first, substitute into the parsed values. `install.mjs` reads `config/hooks.json`
with `JSON.parse`, then maps `realize()` over each `command` string, then re-serializes with
`JSON.stringify` — which escapes the backslashes correctly on the way out. Never run a template
pass over a JSON document as a string.

If a bad `settings.json` is already on disk, `install.mjs` will refuse to overwrite it rather than
compound the damage (`settings.json is not valid JSON — fix it before installing`). Repair the
file by hand, or restore it from `~/.claude-uninstall-backup` if an uninstall has run.

---

## Library clones fail on Windows (MAX_PATH)

**Symptom.** `git clone` fails during the library phase with `Filename too long`, or clones
"succeed" while leaving files missing from deep directories. The biggest repos in
`library/sources.json` are the ones that break; small ones clone fine, which makes it look
intermittent.

**Cause.** The Windows `MAX_PATH` limit of 260 characters. Some library repos nest skill
directories deeply enough that the full path exceeds it.

**Fix.**

```bash
git config --global core.longpaths true
```

`install.mjs` sets this for you on Windows during the Prerequisites phase.

Note that this is a **git** setting only. The separate OS-level flag
`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled` is a system-wide registry
change affecting every application on the machine, and this repo does not touch it. If git's
own setting is not enough for your tree, enabling that flag is your call to make deliberately,
not something an installer should do behind you.

---

## Skills are present but not loading

**Symptom.** `~/.claude/skills/<name>/SKILL.md` exists, `doctor.mjs` reports the skill as
healthy, and Claude never dispatches to it — or dispatches to the wrong one.

**Cause.** Two distinct problems.

1. **`name:` does not match the directory.** The frontmatter `name:` is the identity used for
   dispatch. A directory called `gsap-web` whose frontmatter says `name: gsap` is addressed as
   `gsap`, and anything referring to it by directory name silently misses.
2. **Two skills declaring the same `name`.** Dispatch then depends on directory enumeration
   order, not on what you meant. It will look correct until the day it does not, and it will
   change when an unrelated skill is added.

**Fix.** Make `name:` equal the directory name for every skill. Then run `node tools/doctor.mjs`
— its Session context cost phase reads the frontmatter of every installed skill and fails on
`name collision "<name>": dir-a, dir-b`. Resolve a collision by removing one of the two, not by
renaming both and hoping.

Also check that the entry is a live link. A junction or symlink whose target has moved still
`lstat`s successfully, so a missing skill and a dangling link look identical from the outside;
`doctor.mjs` separates them and reports `broken link — target gone`.

---

## Context cost: "this package's skills cost ~N tokens — over its 4000 budget"

**Symptom.** `doctor.mjs` reports two numbers under *Session context cost* — everything installed,
and this package's share — and warns only on the second.

**Cause.** Every installed skill costs its frontmatter `name` plus `description` in **every
session**, whether or not it is ever invoked. That text is what dispatch matches against, so it
has to be loaded up front. Only the skill *body* is free until use. Installing 100 skills is not
"100 skills available at no cost"; it is a fixed toll on every conversation, plus a hundred more
triggers competing to match each request.

This is why the repo tiers its library: 13 resident Tier-2 skills, and 800+ Tier-3 skills that
live on disk at zero session cost and are found with `grep` over `library/INDEX.md`.

**Why two numbers.** On a machine with other plugins installed, most of the total is not this
package's. An earlier version warned on the machine total against one budget, which meant it
warned on every run on any real machine — and a gate that always warns is ignored. Now the
package is measured against its own budget (4000 tokens: the 13 Tier-2 residents plus the skills
this repo authors), and the rest is reported as a note with the heaviest names in `--json`.

**Fix, when the package is over.** `doctor.mjs` names the offenders — the five heaviest of *this
package's* skills with their individual cost — so pruning is a decision about specific skills.
Shorten a long `description` first; remove a Tier-2 resident by taking it out of
`library/sources.json` and re-running install (it stays on disk in the library, reachable by
path). Host-plugin cost is managed where those plugins are managed, not here.

---

## A skill loads twice

**Symptom.** A skill appears twice in the available-skills listing, sometimes under two names
(`foo` and `plugin:foo`). `doctor.mjs` reports no collision.

**Cause.** The skill is installed both as a loose link in `~/.claude/skills` **and** delivered by
an installed plugin. `doctor.mjs` only reads `~/.claude/skills`; it has no visibility into what a
plugin contributes, so this duplication is invisible to it by construction.

This happened here with argo. Its 22 components were being linked loosely *and* shipped by the
`argonaut` plugin, double-loading all of them into every session for no benefit.

**Fix.** Pick one delivery route. This repo chose the plugin — it gives namespacing, a real
uninstall, and one source of truth, where copies in `~/.claude` would shadow the repo and drift.
`install.mjs` deliberately skips linking argo's skills and says so in its output.

To see what a plugin actually contributes:

```bash
claude plugin details argonaut
```

Compare that list against `ls ~/.claude/skills` and remove the loose copies of anything the
plugin already provides.

---

## `npm test` reports success but ran no tests

**Symptom.** A suite "passes" in seconds with no test names in the output, or prints
`Could not find '...'` / `pattern not found` and still exits 0. The first sign is usually a
test count that stopped changing while tests were being added.

**Cause.** The test script passed a *glob* to Node's runner — `node --test "test/**/*.test.js"`.
Node only expands globs itself on 21+. On Node 20 the pattern reaches the runner literally, it
matches nothing, and the run is empty rather than failed. A shell glob is no more portable: npm
runs scripts through `sh` on POSIX (which expands) and `cmd.exe` on Windows (which does not), so
the same script silently behaves differently on the two platforms. Handing the runner a
*directory* has its own trap: on some builds `node --test <dir>` resolves the directory as a
module and dies with `Cannot find module`.

**Fix.** Hand the runner explicit file paths — the one form every supported version accepts.
`tools/run-tests.mjs` and `argo/test/run.js` do exactly this: read the test directory, filter,
resolve to absolute paths, and spawn `node --test <path> <path> …`. Both take an optional
substring filter (`node tools/run-tests.mjs paths`) so a single file is still easy to run.

**How to notice it at all.** Compare the reported test count against the number of `test(` calls
on disk. A suite that cannot lose tests silently is worth more than one that runs slightly faster.

---

## An MCP server does not connect

**Symptom.** The server is listed in `~/.claude.json` but never comes up. No error, or a generic
connection failure.

**Cause.** Two causes, both path-related.

1. **The entry point does not exist.** The path in `args[0]` points at a file that was never
   installed, or was installed to a different location than the one recorded.
2. **The interpreter is a bare command.** `"command": "node"` is resolved against the PATH of
   whatever process launches the server, which is not your shell's PATH. Relying on PATH is how
   MCP servers silently die.

**Fix.** Run `node tools/doctor.mjs`; its MCP servers phase resolves each `command` and stats
each `args[0]`, reporting `server entry missing` or `command not found` specifically. Then re-run:

```bash
node tools/install.mjs --only=mcp
```

which installs the servers under `library/mcp-servers/` and registers each one with the Node
binary pinned to an absolute path and the entry point verified to exist before it is written.

If `~/.claude.json` does not exist at all, launch Claude Code once to create it, then re-run the
phase.

---

## The session line says DEGRADED, blocked, or "not a git clone"

The first line of every session is `session-start-cgc.js`'s report. Read it as a sentence:

- **`DEGRADED · 33/34 checks (1 failed: …)`** — the doctor found something the re-apply could not
  put back. Run `node tools/doctor.mjs` and fix what it names; the usual cause is a mandate file
  with an unresolved token or a hook that no longer parses.
- **`update blocked: local changes`** — the clone has uncommitted edits to tracked files. The repo
  is the source of truth; commit them (`node tools/sync.mjs` if the edits were made in
  `~/.claude`), or discard them, then `git pull --ff-only origin main`. Nothing is overwritten
  until you do.
- **`update blocked: diverged from origin`** — local commits that are not on `main`. Rebase them
  (`git rebase origin/main`) or push them if they belong there.
- **`ahead of origin`** — the author's machine with unpushed work; expected.
- **`on <branch>, main not followed`** — a feature branch is checked out; expected while working.
- **`offline, at <sha>`** — the fetch failed within ten seconds; nothing else changes.
- **`not a git clone`** — the directory was downloaded as an archive. Clone it with git and run
  `node tools/install.mjs` from the clone; auto-update needs a `.git`.
- **`tests timed out`** or **`(N failed)`** — run `npm test` in the repo; the suite is six seconds
  and names the case.
- **The line does not appear at all** — the hook is not registered or Node is not where
  `settings.json` pins it. `node tools/doctor.mjs` says which; `node tools/install.mjs
  --only=hooks` repairs it.

## page-audit says a face "is not available"

The page rendered in a fallback, so the design that was judged is not the one that ships. The
usual causes: the Google Fonts `<link>` is missing or misspelt (the family name must match
exactly, with `+` for spaces in the URL); the machine is offline (`screen-render` lists the
faces that loaded); or the face is local and not installed here — then either ship it as an
`@font-face` or choose one the reader will have. `specimen` shows the face set for real before
it is chosen.

## page-audit says the page scrolls sideways at 390px

A screenshot clips to the viewport and cannot show this; the audit measures
`scrollWidth` against the viewport. The usual causes are two `white-space: nowrap` cells in one
row, a fixed-width element, or an absolutely positioned decoration past the right edge. Let the
cells wrap below a breakpoint, or clip the decoration with `overflow: hidden` on its section.

## Escape hatch: revert everything

`tools/uninstall.mjs` undoes what `tools/install.mjs` did, and nothing else.

```bash
node tools/uninstall.mjs                          # DRY RUN — the default. Prints every change, writes nothing.
node tools/uninstall.mjs --yes                    # actually remove
node tools/uninstall.mjs --yes --purge-library    # also delete the cloned Tier-3 repos (~200MB)
```

A dry run is the default deliberately. Read the list it prints, then opt in with `--yes`.

**What it removes.** Only what this repo installed, derived from the repo itself: the mandate
files named by `config/*.md`, the hook scripts found in the three hook source directories plus
anything registered in `config/hooks.json`, the skills this repo authors plus the `tier2` set in
`library/sources.json`, the `argonaut` plugin and its marketplace, and the MCP servers whose
entry point lives inside this checkout.

**What it never touches, under any flag.** `.credentials.json`, `history.jsonl`, `projects/`,
`todos/`, `settings.local.json`, every setting in `settings.json` this repo did not add, every
hook in `settings.json` this repo did not install, and any text in `CLAUDE.md` below the
`<!-- user-additions-below -->` marker. Global npm packages are kept — they may predate the
install. `git core.longpaths` is kept, because it is a global git setting and not ours to revert.

Two specific safety rules are worth knowing:

- Skill links are removed with `lstat` + a non-recursive delete, which drops the junction or
  symlink itself and never descends into it. Deleting *through* a junction would destroy the
  source repo on the other end.
- A skill directory that is a **real** directory rather than one of our links is refused and
  named in the output, not deleted. `install.mjs` falls back to a copy when `mklink` is
  unavailable, so it might be ours — but it might equally be a skill you wrote, and a wrong
  guess there deletes your work.

**Where the backups land.** Every file modified rather than deleted is copied first to:

```
~/.claude-uninstall-backup/
```

That directory is outside both the repo and `~/.claude`, so removing either does not take the
backups with it. Filenames are `<name>.<YYYYMMDD-HHMMSS>.bak`, where the stamp is the **file's
own mtime**, not the time of the run — so the path is deterministic, a re-run over an unchanged
file lands on the same name instead of littering, and the name tells you which version it holds.
`settings.json`, `.claude.json` and `CLAUDE.md` are the files that get backed up.

To restore one, copy it back over the original and restart Claude Code.

The uninstaller is idempotent: running it twice reports the second pass as entirely skipped and
changes nothing.
