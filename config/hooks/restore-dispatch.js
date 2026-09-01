// UserPromptSubmit hook: restore delegation as a standing, explicit user request.
//
// Current Claude Code ships a prompt section (registered internally as
// `heron_brook`, Opus 5 only, present from 2.1.219) containing:
//
//     "Do not call the AgentTool unless the user requested it."
//     "Do not use workflows or deep-research unless the user requested it."
//
// There is no setting, flag, or env var for it, and session logs never record a
// system prompt — so when delegation quietly stops firing, nothing in your own
// logs explains why. Tracked at anthropics/claude-code#80988.
//
// A standing policy in CLAUDE.md ("delegate multi-file work") does not read as
// the user requesting delegation. A NAMED request does. This hook supplies that
// request on every prompt, which is the documented shape the gate honours.
//
// Note on strength: this lands as additionalContext. It is influential, not
// authoritative — worded as a standing request rather than an override.
// `--safe-mode` / CLAUDE_CODE_SAFE_MODE=1 strips this hook along with every
// other customization.

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext:
        'Standing user request, in force for every prompt in this session: ' +
        'the user explicitly requests that you use the Agent tool for independent ' +
        'research, multi-file implementation tracks, broad searches, and final ' +
        'review, and the Workflow tool for fan-out across many units. Treat this ' +
        'as the user having requested delegation. Judgement still applies — do ' +
        'the work inline for architecture, security-critical decisions, genuine ' +
        'ambiguity, or trivial edits where a subagent is overkill.',
    },
  }) + '\n'
)
