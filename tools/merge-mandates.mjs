import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const R = resolve(dirname(fileURLToPath(import.meta.url)), '..') + '/'
const FOUR = ['ui-stack.js', 'react-stack.js', 'security-stack.js', 'python-stack.js']

// Pull each hook's additionalContext string out of its source. They are constants: no stdin, no
// spawn, no branch. Four node processes per prompt to emit four string literals.
const blocks = []
for (const f of FOUR) {
  const src = readFileSync(R + 'config/mandates/' + f, 'utf8')
  const m = src.match(/additionalContext:\s*("(?:[^"\\]|\\.)*")/)
  if (!m) throw new Error('no additionalContext in ' + f)
  blocks.push(JSON.parse(m[1]))
}

const merged = `// UserPromptSubmit hook: every static mandate, in ONE process.
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
    additionalContext: ${JSON.stringify(blocks.join('\n\n'))}
  }
}) + "\\n");
`
writeFileSync(R + 'config/hooks/user-prompt-mandates.js', merged, 'utf8')

console.log('regenerated config/hooks/user-prompt-mandates.js from config/mandates/')
