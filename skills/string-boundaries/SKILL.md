---
name: string-boundaries
description: "Catches the bug class where a value changes meaning as it crosses from one parser to the next. Use before \"substituting a machine path into a serialized config\", \"templating a config for another machine\", \"putting a Windows path into a JS string literal\", \"assembling a command line as a string\", \"passing a regex through a shell\", or \"hand-rolling a validator for generated output\". Also use on the symptoms: \"my backslash disappeared\", \"SyntaxError: Bad escaped character at position\", \"ENOENT spawning npm on Windows\", \"EINVAL running a .cmd\", \"should I set shell: true\", \"the hook installed fine but never runs\", \"works on Windows, silently does nothing on Linux\". Not for prose formatting, character-encoding conversion, or i18n — only for a value handed from one parser to another."
---

# Strings that cross a parser boundary

Every bug in this class is one unasked question:

> **Who parses this string next, and do they agree with me about what these characters mean?**

A value is not text. It is text *plus* an agreement about which characters are data and which
are punctuation. The bug lives where the writer's agreement and the reader's differ — and it is
usually silent. The output is still valid. It just means something else.

Ask the question whenever you are about to put a value into something another program reads: a
config file, generated source, a command line, a template, a test fixture, a filename.

## The crossings, and what the reader does differently

| Crossing | What changes on the other side | Do this instead |
| --- | --- | --- |
| JSON text ↔ JSON value | `\` introduces an escape, so `C:\Program Files` is invalid JSON | parse, substitute into the parsed value, re-serialize |
| source string literal ↔ path | `\U` `\A` `\n` inside `"..."` are escapes, not characters | forward slashes in emitted source; Node accepts them on Windows |
| Windows ↔ POSIX separator | `\` is an ordinary filename character on POSIX, so `a\b\c` is ONE filename | forward slashes on both; no platform branch |
| shell line ↔ argv | the shell re-splits, globs, and re-reads quoting you already applied | argv array, `shell: false` — no command string to escape |
| `.cmd`/`.bat` ↔ CreateProcess | a batch shim is not executable, and cmd.exe re-parses node's quoting | `argo/src/spawn.js` |
| regex ↔ the data it scans | a character class that omits something *silently never matches* instead of erroring | test with input the pattern was not designed for |
| YAML frontmatter ↔ prose | `:` `#` `"` and a leading `-` in an unquoted scalar change the parse | quote the whole value, escape inner quotes, parse it back |
| URL ↔ filesystem path | `file:///C:/x` is only valid forward-slashed and percent-encoded | choose per occurrence, not per file — `{{TOK:url}}` vs `{{TOK}}` in `tools/paths.mjs` |
| CSV/TSV ↔ its own delimiter | a comma, tab, or newline inside a field ends the field | a real writer, or a format whose delimiter cannot occur in the data |
| heredoc ↔ file content | the shell reads the body before the file exists | write the file with a file-writing tool |

## The seven that shipped here, in one session

Each was written by someone who had read the surrounding code.

1. **Substituting into raw JSON text.** `{{NODE}}` in `config/hooks.json` replaced with
   `C:\Program Files\nodejs\node.exe` gave `SyntaxError: Bad escaped character in JSON at
   position 136`. Fix in `tools/install.mjs`: `JSON.parse` first, `realize()` into each
   `h.command` value, `JSON.stringify` out. Pinned by `tools/test/config.test.mjs` —
   "substituting into the raw JSON text is unsafe, which is why install parses first".

2. **A Windows path inside a JS string literal.**
   `"C:\Users\stranger\AppData\Roaming\npm\node_modules"` became
   `C:UsersstrangerAppDataRoaming` + a real newline + `pm`. The file still parsed, so
   nothing failed — the corrupted value shipped inside a hook that ran on every prompt and sat
   visible in output for a while. `install.mjs` now writes every hook with `{ slash: 'forward' }`.

3. **Backslash is a filename character on POSIX.** `{{CONFIG_ROOT}}\hooks\x.js` realizes on
   Linux to `/home/u/.claude\hooks\x.js` — one file, backslashes in its name. Every hook
   installs "successfully" and never runs. Pinned by "a hook path realized on POSIX uses a
   separator POSIX can actually follow".

4. **A guard sharing the blind spot of the thing it guards.** `realize()` matched
   `/\{\{([A-Z_]+)\}\}/`, and so did `unresolved()`. `{{T3MP3ST_ROOT}}` contains a digit, so it
   matched neither: never substituted **and** never reported unresolved. It shipped into the
   live mandate telling Claude to `cd` somewhere that does not exist. **A validator written
   from the same assumption as the code cannot catch that assumption being wrong.** Both now
   use `[A-Z0-9_]` — `tools/paths.mjs`.

5. **Shell heredoc eating escapes.** `cat > f <<'EOF'` with `\\+` in the body arrived as `\+`
   — a literal plus, quietly changing what a regex matched. Hit repeatedly in one session. The
   shell is a parser standing between you and the file. Remove it: write the file with a
   file-writing tool, or pass the value as argv.

6. **`.cmd` cannot be spawned directly on Windows.** `spawnSync('npm', …, {shell:false})` gives
   ENOENT (a bare name resolves only `.com`/`.exe`); `spawnSync('npm.cmd', …)` gives EINVAL
   (Node refuses `.cmd` since the 2024 argument-injection CVE); `shell: true` reintroduces that
   CVE. `argo/src/spawn.js` is the worked solution — resolve the real shim through
   PATH+PATHEXT, route `.cmd`/`.bat` through cmd.exe with the shim as its own argv entry, and
   **refuse** any argument matching `["<>%^&|()!\r\n]` instead of escaping it. Its reasoning is
   the point: you cannot escape correctly for cmd.exe and the CRT simultaneously, and code
   claiming to is code nobody can check.

7. **One command string, three parsers.** `node --test <dir>` resolves the directory as a
   module on some versions; `node --test "**/*.test.mjs"` relies on node expanding the glob,
   which older supported versions do not; a shell glob in an npm script expands under `sh` and
   not under `cmd.exe`. `tools/run-tests.mjs` sidesteps all three by enumerating absolute file
   paths itself and passing them as argv.

## Rules that fall out

- **Substitute into parsed structures, never into serialized text.** Parse, mutate the value,
  re-serialize with the format's own writer. Holds for JSON, YAML, TOML, XML, INI, HTML.
- **Pass data as argv, not inside a command string.** No shell means no second parser and
  nothing to escape.
- **Prefer the form valid on every target over the form native to one.** Forward slashes beat a
  platform branch: `/` is legal on Windows, `\` is a filename character on POSIX.
- **Decide per occurrence, not per file.** One document can legitimately need both forms — a
  `file:///` import and a CLI argument two lines apart.
- **Never let a validator share the code's assumption.** Derive it from the format's rules, not
  from the generator's, and feed it input the generator was not built for.
- **Pin the value, not the string.** What matters is what the reader ends up holding.

## Verification — proving the value survived

Each of these has caught a real bug in this repo.

- **Round-trip and compare bytes.**
  `assert.equal(realize(templatize(doc, vars), vars), doc)` over a document containing spaces,
  backslashes, and a value that is a strict prefix of another. `tools/test/paths.test.mjs`.
- **Run the target parser on the output.** `node --check` on generated source, `JSON.parse` on
  generated JSON. `install.mjs` does both at install time, because a hook with a syntax error
  fails silently at runtime.
- **Assert on the RUNTIME value, not the source text.** The strongest check here writes a
  realized hook, `import`s it, and compares `mod.ESLINT` against the path substituted in. Bug 2
  passed `node --check` cleanly; only the imported value exposed the mangling.
- **Keep the negative case in the same test.** That test also asserts the native-slash version
  parses *and* that its value is wrong. Without the negative, the test proves nothing about the
  bug it guards.
- **Realize the template for the other platform and assert on the separator** — the whole of
  bug 3 is invisible from a Windows machine.

## Slop to recoil from

- A hand-rolled `escapeX()`. Writing one means you are on the wrong side of the boundary; move
  the value out of the string instead.
- `shell: true` to make a spawn work. It fixes the symptom by adding the parser that caused it.
- Doubling backslashes until it runs. That is fitting a constant to one input; the next path
  breaks it, and nobody can tell why the count is what it is.
- Regex-editing a structured format — `.replace()` across JSON, YAML, or XML text.
- A validator built from the generator's own regex. Bug 4, verbatim.
- "It parses, so it's fine." Bugs 2 and 3 both parsed.
- Branching on platform for separators, which doubles what has to be tested to avoid typing `/`.
