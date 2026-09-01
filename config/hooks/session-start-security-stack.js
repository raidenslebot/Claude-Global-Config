// SessionStart hook: surface the mandatory security tooling stack as context.
// Runs as: node <this-file>  (the hook JSON is piped to stdin and ignored).
const fs = require("fs");
const os = require("os");
const path = require("path");
const file = path.join(os.homedir(), ".claude", "security-stack.md");
let text = "";
try { text = fs.readFileSync(file, "utf8"); } catch { process.exit(0); }
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text }
}) + "\n");
