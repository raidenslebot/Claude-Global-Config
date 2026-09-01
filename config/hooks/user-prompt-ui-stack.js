// UserPromptSubmit hook: inject the mandatory UI/design resource stack pointer.
// Runs as: node <this-file>  (the hook JSON is piped to stdin and ignored).
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: "MANDATORY UI/design stack (full rules: ~/.claude/ui-design-stack.md): for ANY frontend, UI, component, styling, animation, chart, or design task use 21st.dev, magicui.design, kokonutui.com, ui.aceternity.com, reactbits.dev, bklit.com (components/charts); motion.dev, animejs.com (animation); styles.refero.design, godly.design (design reference). Check these before writing UI from scratch; use context7 MCP for their docs."
  }
}) + "\n");
