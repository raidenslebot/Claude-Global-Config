# MANDATORY React Tooling Stack (global)

Applies to ANY work touching React, Next.js, Vite, Remix, TanStack, React Native, Expo, Preact, or any JS/TS frontend code with JSX/TSX.

## The four pillars — always used together (synergy is mandatory)

If more than one tool applies, use ALL of them. Never pick just one. Never claim a React task is complete without running the applicable tools and fixing or explicitly documenting their findings.

### 1. react-doctor — static audit (correctness, performance, architecture, security, a11y)

- CLI: `npx react-doctor@latest` at the project root (global CLI also installed: `react-doctor`).
- Rule config: `doctor.config.ts` in the project when needed.
- Skill installed: `~/.claude/skills/react-doctor/SKILL.md` — load it for detailed workflow.
- MANDATORY: run the audit before claiming completion of any React work; fix findings or document why not.

### 2. eslint-plugin-react-hooks — Rules of React + React Compiler lints (global ESLint flat config)

- Global flat config: `{{ESLINT_CONFIG}}`
  (eslint 10 + eslint-plugin-react-hooks + @eslint/js + typescript-eslint, all installed globally).
- CLI (agents/terminal):
  `eslint --no-config-lookup --config "{{ESLINT_CONFIG}}" .`
- VS Code: every React/TS project must have an `eslint.config.mjs` at its root that imports the global base (create it if missing, and merge the project's own rules after the spread):

  ```js
  import base from "file:///{{ESLINT_CONFIG:url}}";
  export default [...base /* , ...project rules */];
  ```

- MANDATORY: 0 new lint errors from the react-hooks rules (`rules-of-hooks`, `exhaustive-deps`, and the recommended preset) before completion.

### 3. react-scan — runtime render performance

- Global CLI installed: `react-scan`.
- Wire a project: `npx -y react-scan@latest init` (auto-detects framework, installs the package, sets up the app).
- Manual: script tag `//unpkg.com/react-scan/dist/auto.global.js` before other scripts, or `scan()` / `useScan()` from `react-scan/react`.
- Browser extension: https://github.com/aidenybai/react-scan/blob/main/BROWSER_EXTENSION_GUIDE.md
- MANDATORY: for any work on rendering/state/effects/performance, run the app with React Scan and eliminate highlighted re-render issues introduced by the change.

### 4. strix — autonomous security pentesting

- CLI: `strix --target <dir|url>` (global install: `strix` 1.5.3 via `uv tool install strix-agent`).
- Headless gate: `strix -n --target ./ --scan-mode quick` — exit code non-zero when vulnerabilities found.
- Skills installed: `penetration-testing-with-strix`, `fix-security-vulnerabilities-with-strix`, `ci-security-scanning-with-strix`, `managed-pentesting-with-strix` (`~/.claude/skills/`).
- Requires Docker running and an LLM key (`strix auth` / `STRIX_LLM` + `LLM_API_KEY`, saved to `~/.strix/cli-config.json`).
- MANDATORY: for any web app/API work (auth, input handling, routes, endpoints) or before shipping security-relevant changes, run Strix against the target you own/have written authorization to test. Authorized use only.

## Order of operations for React changes

1. `react-doctor` audit → fix/document.
2. `eslint --no-config-lookup --config <global> .` → 0 new errors.
3. `react-scan` runtime pass on affected flows → no new re-render regressions.
4. `strix` security scan → no unresolved validated vulnerabilities (when security-relevant).
5. Only then claim completion.

## Enforcement

- This stack is injected at SessionStart and on every UserPromptSubmit via Claude hooks.
- Umbrella skill: `~/.claude/skills/react-tooling-stack/SKILL.md`.
- Global instructions: `~/.claude/CLAUDE.md`.
