// PostToolUse hook: the fingerprint of AI-made design, reported on every screen file as it is
// written. The taste layer names the templated look and asks the model to refuse it; a demand
// nobody checks is a preference, so this checks. It runs tools/slop-lint.mjs on the file just
// written and reports when the score reaches two — one strong tell (the purple gradient, the
// glass card, the centred hero) or two weak ones. It reports; it never vetoes. Silent on
// physical designs (print-lint owns those), on non-design files, and on anything it cannot
// read. Exit 0 always.

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// Templated by install.mjs; unresolved when run straight from the repo (the tests do).
const REPO_TOKEN = '{{REPO_ROOT:url}}'
const NODE_TOKEN = '{{NODE:url}}'
const REPO = REPO_TOKEN.includes('{{') ? path.resolve(__dirname, '..', '..') : REPO_TOKEN
const NODE = NODE_TOKEN.includes('{{') ? process.execPath : NODE_TOKEN

const EXTS = new Set(['.html', '.htm', '.css', '.scss', '.jsx', '.tsx', '.vue', '.svelte', '.astro'])
const PHYSICAL = /@page\s*\{[^}]*\bsize\s*:\s*[\d.]+\s*(?:in|mm|cm|pt)\b/i

function main() {
  let payload
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}') } catch { return }
  if (!/^(Write|Edit|MultiEdit)$/.test(String(payload.tool_name || ''))) return
  const file = String(payload.tool_input?.file_path || '')
  if (!file || !EXTS.has(path.extname(file).toLowerCase())) return
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch { return }
  if (PHYSICAL.test(text)) return

  const r = spawnSync(NODE, [path.join(REPO, 'tools', 'slop-lint.mjs'), file, '--json'], { encoding: 'utf8', timeout: 8000, windowsHide: true })
  let result
  try { result = JSON.parse(r.stdout).files[0] } catch { return }
  if (!result || result.score < 2) return

  const list = result.findings.map((f) => `${f.id} (L${f.line}: ${f.sample.slice(0, 50)})`).join('; ')
  const verdict = result.verdict === 'centroid'
    ? 'This is the template. Do not decorate it — run the divergence protocol, change the STRUCTURE, and lint again'
    : 'Each of these is a default, not a decision — replace it or state why it stays'
  const context = `SLOP FINGERPRINT in ${path.basename(file)} — score ${result.score} of ${result.max} (${result.verdict}): ${list}. `
    + `${verdict}: cgc lint "${file}". `
    + 'The absence of fingerprints is not design: render it (cgc render "' + file + '" --mobile), look at desktop and phone, name the weakest thing, fix it, and run cgc audit on it — then again, until nothing can be named. '
    + 'The moves with their real parameters are in visual-design-mastery/references/signature-moves.md.'
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context },
  }) + '\n')
}

try { main() } catch { /* a reporting hook never blocks a write */ }
