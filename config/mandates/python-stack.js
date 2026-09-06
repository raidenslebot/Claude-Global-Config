// UserPromptSubmit hook: inject the mandatory Python tooling stack pointer.
// Runs as: node <this-file>  (the hook JSON is piped to stdin and ignored).
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: "MANDATORY Python stack (full rules: {{CONFIG_ROOT:url}}/python-tooling-stack.md): for ANY Python work use uv — `uvx <tool>` to run something once, PEP 723 inline metadata (`# /// script`) + `uv add --script` + `uv run file.py` for a single file, `uv init`/`uv add`/`uv run` for a project, `uv python install|pin` for interpreters. Never `pip install` into a project you also `uv run`. Four verified traps: `uv version` is the PROJECT's version, so check `uv --version`; `uv sync` DELETES anything `uv pip install` put in the venv; `uv run` auto-syncs and can rewrite uv.lock, so pass `--locked` in CI; project commands ignore VIRTUAL_ENV while `uv pip` honours it silently. Commit uv.lock."
  }
}) + "\n");
