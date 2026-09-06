// UserPromptSubmit hook: every static mandate, in ONE process.
//
// These four blocks were four hooks — four node processes per prompt, each ~110 ms of runtime
// startup to emit one constant string. Nothing in any of them reads stdin, spawns anything, or
// branches. On a 24-core machine that was a third of a second per prompt nobody noticed; on the
// laptop this package must also run on it is the difference between a hook stack that is
// tolerated and one that gets deleted. The text is unchanged; only the process count is.
//
// The four sources live in config/mandates/ — not config/hooks/, because an unregistered file
// there is a hook that silently does nothing. Edit a source, then: node tools/merge-mandates.mjs.
// Nothing regenerates this automatically; a test asserts the generated file matches its sources.
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: "MANDATORY UI/design stack (full rules: ~/.claude/ui-design-stack.md): for ANY frontend, UI, component, styling, animation, chart, or design task use 21st.dev, magicui.design, kokonutui.com, ui.aceternity.com, reactbits.dev, bklit.com (components/charts); motion.dev, animejs.com (animation); styles.refero.design, godly.design (design reference). Check these before writing UI from scratch; use context7 MCP for their docs.\n\nMANDATORY React tooling stack (full rules: ~/.claude/react-tooling-stack.md): for ANY React/Next.js/Vite/Remix/React Native/Expo/JS/TS frontend work use react-doctor (npx react-doctor@latest, skill react-doctor), the global eslint-plugin-react-hooks flat config (eslint --no-config-lookup --config {{ESLINT_CONFIG:url}} . ; projects must import it in eslint.config.mjs), react-scan (npx react-scan@latest init / global CLI) for perf, and strix (strix --target, skills *-with-strix) for security — use ALL applicable tools together, in the order: react-doctor -> eslint -> react-scan -> strix, before claiming completion.\n\nMANDATORY Security stack (full rules: ~/.claude/security-stack.md): for ANY security testing / pentest / red-team / vuln-hunting / security-audit task use T3MP3ST (global CLI `tempest`, MCP tool security_recon, skill t3mp3st-security) AND strix (skills *-with-strix) TOGETHER — recon -> scan -> fix -> re-verify, before claiming completion. AUTHORIZED TARGETS ONLY — systems you own or have written permission to test.\n\nMANDATORY Python stack (full rules: {{CONFIG_ROOT:url}}/python-tooling-stack.md): for ANY Python work use uv — `uvx <tool>` to run something once, PEP 723 inline metadata (`# /// script`) + `uv add --script` + `uv run file.py` for a single file, `uv init`/`uv add`/`uv run` for a project, `uv python install|pin` for interpreters. Never `pip install` into a project you also `uv run`. Four verified traps: `uv version` is the PROJECT's version, so check `uv --version`; `uv sync` DELETES anything `uv pip install` put in the venv; `uv run` auto-syncs and can rewrite uv.lock, so pass `--locked` in CI; project commands ignore VIRTUAL_ENV while `uv pip` honours it silently. Commit uv.lock."
  }
}) + "\n");
