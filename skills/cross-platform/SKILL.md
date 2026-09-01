---
name: cross-platform
description: "Catches the bug class in which the process or filesystem that acts on a value follows different rules from the shell you tested in. Use before \"registering a hook or MCP server command\", \"spawning a subprocess by bare name\", \"deleting a symlink or junction\", \"cloning a deep tree on Windows\", \"shipping a shell script with a shebang\", or \"resolving the home directory portably\". Also use on the symptoms: \"the hook is registered but does not fire\", \"works in my terminal but not from the hook\", \"node not found from inside the hook\", \"Filename too long on git clone\", \"will deleting this symlink delete the target\", \"bad interpreter: /bin/bash^M\", \"does mklink need admin\", \"$HOME is empty on Windows\", \"a rename that only alters case did nothing\". Not for escaping, quoting, or a value whose meaning shifts between parsers — string-boundaries owns that."
---

# Process and filesystem semantics that differ by platform

`string-boundaries` covers a value that changes meaning between two parsers. This skill covers
the other class: the value is correct, and the thing that acts on it follows rules you did not
test against. Nothing is mangled. The subprocess looks up the name differently, the delete
follows the link, the kernel reads the shebang to a byte you cannot see.

Every bug in this class is one unasked question:

> **Which process will actually do this, and what does it see — its own PATH snapshot, its
> own name-resolution rules, its own filesystem — rather than what my shell sees?**

Your interactive shell is the one environment a hook, an MCP server, or a CI step never runs
in. Ask the question whenever a command, path, or link will be acted on by a process you did
not launch by hand.

## The differences, and what each one did here

| Semantic | What differs | What it produced here | Do this |
| --- | --- | --- | --- |
| **PATH is a snapshot** | A child inherits its parent's environment as of the parent's launch. A hook launched by Claude Code sees Claude Code's PATH, not your terminal's. `install.ps1` notes the same thing about winget: it updates the machine PATH, not the running shell. | A hook registered as bare `node` was a silent no-op for **weeks** — no error anywhere (`docs/troubleshooting.md`, "A hook silently does nothing"). Same cause for MCP servers ("An MCP server does not connect", cause 2). | Pin the interpreter absolutely: `process.execPath` (`tools/paths.mjs` → `detectNode()`). `tools/install.mjs` writes every hook command and MCP registration with that path. |
| **Bare-name resolution** | POSIX: the loader searches PATH, exec bit included. Windows without a shell: Node appends only `.com`/`.exe`. `npm`, `claude`, `argo` are `.cmd` shims found only by walking PATHEXT, which cmd.exe does and Node does not. | `spawnSync('npm')` → ENOENT; `spawnSync('npm.cmd')` → EINVAL, Node refusing `.cmd` since the 2024 argument-injection CVE (`tools/install.mjs` `run()`, `tools/uninstall.mjs` `run()`). `argo/test/divergence.test.js`: every probe died on ENOENT advising the user to put `claude` on PATH, which they had. | `argo/src/spawn.js`: `onPath()` walks PATH+PATHEXT; `spawnPlan()` runs `.exe` direct and routes `.cmd`/`.bat` through cmd.exe as its own argv entry, refusing any argument cmd.exe would reparse. The escaping half of that story is string-boundaries. |
| **Removing a link** | `stat` follows a link; `lstat` describes the link itself. Handed the bare link path, `rmSync`, `Remove-Item -Recurse`, `rmdir /s` and `rm -rf` each removed only the junction — but the same path with a trailing separator resolves *through* it: `rmdir /s /q link\` and `rm -rf link/` emptied the target, and `rm` left the link standing. On Windows `unlink()` on a junction gives EPERM; `rmdir` drops the reparse point only. | Skill links point at the source checkout. Deleting through one during uninstall would have destroyed the repo on the other end (`tools/uninstall.mjs` `unlinkDir()`; `docs/troubleshooting.md`, "Escape hatch"). | `lstatSync(p).isSymbolicLink()`, then `rmSync(p, { recursive: false })`, falling back to `rmdirSync(p)`. A non-recursive delete cannot empty a target however the path is spelled. Refuse a real directory — it is user data. |
| **Creating a link** | A Windows junction (`mklink /J`) needs no privilege, links directories only, and stores an absolute target. A Windows symlink may need admin or Developer Mode. POSIX symlinks need nothing. | `tools/install.mjs` `linkDir()`: junction on Windows, `symlinkSync(target, link, 'dir')` on POSIX, copy as the fallback — "a working config beats a clever one". | Junction for directories on Windows. Never assume symlink privilege. Keep a copy fallback, and make the remover able to tell your link from a real directory. |
| **A dangling link** | `existsSync` follows the link, so one whose target moved reads as absent. `lstat` still succeeds. | A missing skill and a dead link looked identical from outside (`docs/troubleshooting.md`, "Skills are present but not loading"). `existsSync` in the uninstaller would have left the dead link behind. | `lstat` to detect the entry, `existsSync(join(p, 'SKILL.md'))` for liveness, `readlinkSync` to name the lost target — `tools/doctor.mjs`, Tier-2 phase. |
| **MAX_PATH 260** | Windows APIs fail past 260 characters unless the app opts in *and* the OS flag is on. git has its own switch. Linux allows 4096 (macOS 1024) and rarely gets near it. | `git clone` of the largest library repos failed with `Filename too long`, or half-succeeded with deep files missing (`docs/troubleshooting.md`, "Library clones fail on Windows"). | `git config --global core.longpaths true` — `install.mjs`, Prerequisites. The registry flag `LongPathsEnabled` is machine-wide and the user's call; an installer does not flip it. |
| **Line endings on a script** | The kernel reads the shebang up to the newline, so `#!/bin/bash\r` names an interpreter called `bash\r`. Windows reads no shebang at all, and an extensionless file is not executable there. | `pixel-plugin` was rejected: its launcher is an extensionless bash script with CRLF endings that cannot exec on Windows (`library/sources.json`, caveat). | Force LF in `.gitattributes` (`*.sh text eol=lf`). Give anything shipped an extension and an explicit interpreter — `<abs node> <abs script>` — so no exec bit, shebang, or line ending is trusted. |
| **Home directory** | `~` is expanded by a shell, never by a process reading a config. cmd.exe sets no `HOME`, and PowerShell's `$HOME` is a shell variable no child inherits; Windows uses `USERPROFILE`. Git Bash exports `HOME=/c/Users/<user>` (MSYS form) beside `USERPROFILE=C:\Users\<user>`. | Every shipped hook and tool derives the config root from `os.homedir()` (`tools/paths.mjs`, `config/hooks/*.js`); `argo/src/drift/snapshot.js` honours `CLAUDE_CONFIG_DIR` before it. | `os.homedir()`, after any override variable the tool documents. Never `~` in a value a non-shell reads; never `process.env.HOME` alone. |
| **Case** | NTFS and APFS ignore case by default; ext4 does not. PATHEXT is upper-case, and CreateProcess ignores case. git with `core.ignorecase=true` (the Windows/macOS default) sees a case-only rename as no change. | `spawnPlan` matches `.CMD` as `.cmd` (`argo/src/spawn.js`; pinned by `argo/test/spawn.test.js`, "extension matching is case-insensitive"). `config/hooks/post-tool-verify.js` lowercases basenames before comparing. The rename no-op was not a recorded failure here, but it reproduces on this checkout: `mv a.txt A.txt` leaves `git status` empty. | Compare names case-insensitively wherever the OS might. Rename through `git mv a.txt A.txt`, which records the case-only rename a plain `mv` hides. Never rely on two names differing only by case coexisting. |

## Rules that fall out

- **Absolute interpreter, absolute script, no shell.** The launcher's PATH is unknowable; a
  path is not.
- **Resolve names yourself when there is no shell to do it.** `onPath()` is a dozen lines and
  replaces the one feature of `shell: true` anybody actually wanted.
- **`lstat` before any delete; recursive only on what you created as a real directory.**
- **Junction on Windows, symlink on POSIX, copy when both fail** — and record which, so the
  remover can refuse what it did not make.
- **Fix the tool you own, leave the machine to the user.** `core.longpaths` is git's; the
  registry flag is the OS's.
- **Derive locations, never type them.** `os.homedir()`, `process.execPath`, the module's own
  `import.meta.url`. Skills are linked, not templated: a typed path is permanently wrong on
  every other machine.

## Verification — proving it on the platform you do not own

- **Fake the environment, not the OS.** `onPath(name, env)` takes `env` as a parameter, so a
  test passes `{ PATH: dir, PATHEXT: '.JS' }` with a real file in a real directory and proves
  the PATHEXT walk on Linux (`argo/test/divergence.test.js`). `spawnPlan('C:\\npm\\x.cmd')` is
  a string in, a plan out — runnable anywhere (`argo/test/spawn.test.js`).
- **Platform as a parameter.** `quoteArg(value, platform)` and `resolveClaudeBin(env, 'win32')`
  branch on an argument, not `process.platform`, so both branches run on every OS in one test.
- **Prove the PATH snapshot.** Spawn the hook with `env: { ...process.env, PATH: '' }` and the
  absolute interpreter: it must still run. With the bare name it must fail with ENOENT. That is
  the hook's real launch condition, reproduced on any OS.
- **Prove the link contract with a real link in a tmpdir.** Symlink on POSIX, `mklink /J` on
  Windows, pointing at a directory holding a sentinel file. Run the remover. Assert the sentinel
  survives and the link is gone — and run it again with a trailing separator on the path, the
  spelling that deleted through on Windows. `docs/enforcement-audit.md` A8 names this as the
  test `uninstall.mjs` still lacks.
- **Check bytes, not appearance.** `git ls-files --eol <script>` shows index and worktree
  endings; `tr -cd '\r' < f | wc -c` must print 0 for anything with a shebang. An editor shows
  CRLF and LF identically.
- **Run the runtime prover.** `node tools/doctor.mjs` resolves each hook interpreter, stats
  each script, and separates a dead link from a missing skill. It is the check that would have
  caught the weeks-dead hooks on day one.
- **Both OSes in CI, `fail-fast: false`.** `.github/workflows/ci.yml` runs
  `[ubuntu-latest, windows-latest]`; its comment records eight bugs that were
  platform-conditional in opposite directions, so one OS catches at most half.

## Slop to recoil from

- **`shell: true` to make a spawn work.** It restores cmd.exe's PATHEXT search by adding the
  parser that re-reads your quoting; Node 24 deprecates it (DEP0190). Resolve the name instead.
- **A home path typed in.** `C:\Users\<user>`, `/home/<user>`, or `~/.claude` inside a value
  code reads. `tools/test/universality.test.mjs` fails the build on it, for a reason.
- **Assuming bash.** A `#!/bin/bash` hook, `sh -c`, `command -v`, `which`, `$(...)`. The
  launcher is Claude Code, not your terminal; every hook here is `<abs node> <abs script>`.
- **A recursive delete on anything that might be a link**, above all through a path built
  with a trailing separator or glob (`link/`, `link\*`) — the spelling that resolves through it.
- **`existsSync` to decide whether a link is installed, or `stat` to decide what to delete.**
- **"Works on my machine" meaning "works in my interactive shell"** — the one environment the
  hook never runs in.
- **Flipping `LongPathsEnabled` from an installer.** Machine-wide, affects every application,
  not yours to decide.
- **`if (process.platform === 'win32')` around something Node already abstracts** —
  `path.join`, `os.homedir`, `os.tmpdir`, `os.EOL`. Branch only on a real semantic difference;
  junction versus symlink is one, a separator is not.
