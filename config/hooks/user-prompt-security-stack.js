// UserPromptSubmit hook: inject the mandatory security tooling stack pointer.
// Runs as: node <this-file>  (the hook JSON is piped to stdin and ignored).
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: "MANDATORY Security stack (full rules: ~/.claude/security-stack.md): for ANY security testing / pentest / red-team / vuln-hunting / security-audit task use T3MP3ST (global CLI `tempest`, MCP tool security_recon, skill t3mp3st-security) AND strix (skills *-with-strix) TOGETHER — recon -> scan -> fix -> re-verify, before claiming completion. AUTHORIZED TARGETS ONLY — systems you own or have written permission to test."
  }
}) + "\n");
