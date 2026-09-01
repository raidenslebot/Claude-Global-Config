// UserPromptSubmit hook: inject the mandatory React tooling stack pointer.
// Runs as: node <this-file>  (the hook JSON is piped to stdin and ignored).
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: "MANDATORY React tooling stack (full rules: ~/.claude/react-tooling-stack.md): for ANY React/Next.js/Vite/Remix/React Native/Expo/JS/TS frontend work use react-doctor (npx react-doctor@latest, skill react-doctor), the global eslint-plugin-react-hooks flat config (eslint --no-config-lookup --config {{ESLINT_CONFIG}} . ; projects must import it in eslint.config.mjs), react-scan (npx react-scan@latest init / global CLI) for perf, and strix (strix --target, skills *-with-strix) for security — use ALL applicable tools together, in the order: react-doctor -> eslint -> react-scan -> strix, before claiming completion."
  }
}) + "\n");
