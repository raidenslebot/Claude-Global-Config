# MANDATORY Security Tooling Stack (global)

Applies to ANY task involving security testing, penetration testing, red-teaming, vulnerability hunting or research, security audits, exploit validation, CTFs, OWASP work, or security review of auth / input handling / APIs / web apps.

**AUTHORIZED USE ONLY:** every tool below must be pointed exclusively at systems you own or have explicit, written permission to test. Never run them against targets without authorization. Stay in scope.

## The two pillars — always used together (synergy is mandatory)

### 1. T3MP3ST — multi-agent offensive-security framework

- Global CLI: `tempest` (also `t3mp3st`) — installed from https://github.com/elder-plinius/T3MP3ST at `{{T3MP3ST_ROOT}}`, linked globally for every terminal/VS Code instance.
- Configured: backbone `local-agent` / `claude::opus` = **Claude Opus 5 on the Claude Code Max login** (no API key; `~/.t3mp3st/.env` sets `LLM_PROVIDER=local-agent`, `LLM_MODEL=claude::opus`). DeepSeek retired 2026-08-17. Needs a one-time `claude setup-token`. See memory `tempest-claude-backbone`.
- Commands: `tempest status`, `tempest test` (LLM check), `tempest interactive`, `npm run server` (War Room http://127.0.0.1:3333/ui, run inside `{{T3MP3ST_ROOT}}`), `npm run mcp`.
- VS Code MCP: server `t3mp3st` is registered in `%APPDATA%\Code\User\mcp.json` (all instances) exposing the `security_recon` tool — use it for authorized recon missions.
- Skill installed: `~/.claude/skills/t3mp3st-security/SKILL.md`.
- MANDATORY: for every authorized security assessment, use T3MP3ST's recon engine (MCP `security_recon` or CLI) before declaring results complete.

### 2. strix — autonomous AI pentesting

- Global CLI: `strix` 1.5.3; config `~/.strix/cli-config.json` → **Claude Opus 4.8** via the local `claude-max-bridge` (`openai/claude-opus-4-8` @ `http://host.docker.internal:8788/v1`, bearer-authed). DeepSeek retired 2026-08-17. Bridge at `{{BRIDGE_ROOT}}` (auto-starts at logon; `start.cmd` to run manually). See memory `claude-max-bridge`.
- Skills: `penetration-testing-with-strix`, `fix-security-vulnerabilities-with-strix`, `ci-security-scanning-with-strix`, `managed-pentesting-with-strix`.
- MANDATORY: run `strix -n --scan-mode quick --target <dir|url>` as the default security gate; use the full `strix --target` for deeper missions. Requires Docker Desktop running.

## Order of operations for security work

1. Scope + authorization check (never skip).
2. `security_recon` (T3MP3ST MCP) for recon on the authorized target.
3. `strix` scan for validated findings (headless quick scan by default).
4. Fix/remediate (skill `fix-security-vulnerabilities-with-strix`), re-scan to prove closure.
5. Report with evidence; human approves any disclosure.

## Enforcement

- Injected at SessionStart and on every UserPromptSubmit via Claude hooks.
- Skill: `~/.claude/skills/t3mp3st-security/SKILL.md`. Global instructions: `~/.claude/CLAUDE.md`.
