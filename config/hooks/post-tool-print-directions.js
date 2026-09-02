// post-tool-print-directions.js — PostToolUse on Write|Edit.
//
// WHY THIS EXISTS. The print-design and apparel-design skills require the divergence protocol
// to be WRITTEN — directions.md: the subject's DNA, three to five structurally different
// directions, the swap-test verdict on each, the one committed to — before any markup. The
// requirement was advisory, and the very first card made with those skills skipped it: the
// protocol was "run in the head", which is the first idea polished, and the result was the
// centroid. An instruction that competes with everything else in the context loses often
// enough to matter. A check that fires on the artifact does not.
//
// WHAT IT CHECKS. A file just written with a physical page size — an HTML `@page { size: ..in }`
// or an SVG whose width/height carry in/mm/cm/pt — is a print or apparel design. If there is no
// directions.md in the same directory, that is the fingerprint of a skipped protocol, and this
// says so while the design is still cheap to redo.
//
// DESIGN RULES (same as post-tool-verify.js): exit 0 always, this reports and never vetoes;
// zero false positives — it fires only on a file that is unambiguously authored at physical
// size; silence when clean; node built-ins only, nothing from any repo, no machine paths.

'use strict'

const fs = require('node:fs')
const path = require('node:path')

const PHYSICAL_HTML = /@page\s*\{[^}]*\bsize\s*:\s*[\d.]+\s*(?:in|mm|cm|pt)\b/i
const PHYSICAL_SVG = /<svg\b[^>]*\swidth="\s*[\d.]+\s*(?:in|mm|cm|pt)\s*"/i

function readStdin() {
  try { return fs.readFileSync(0, 'utf8') } catch { return '' }
}

function main() {
  let payload = {}
  try { payload = JSON.parse(readStdin() || '{}') || {} } catch { return }

  const tool = String(payload.tool_name || payload.toolName || payload.tool || '')
  if (!/^(Write|Edit|MultiEdit)$/.test(tool)) return
  const input = payload.tool_input || payload.toolInput || payload.input || {}
  const response = payload.tool_response || payload.toolResponse || {}
  const file = [input.file_path, input.filePath, input.path, input.file, response.filePath, response.file_path]
    .find((p) => typeof p === 'string' && p.length > 0)
  if (!file) return

  const ext = path.extname(file).toLowerCase()
  if (!['.html', '.htm', '.svg'].includes(ext)) return
  if (/[\\/]node_modules[\\/]/.test(file)) return

  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch { return }
  const physical = ext === '.svg' ? PHYSICAL_SVG.test(text) : PHYSICAL_HTML.test(text)
  if (!physical) return

  const dir = path.dirname(file)
  if (fs.existsSync(path.join(dir, 'directions.md'))) return

  const context =
    `PHYSICAL DESIGN WITHOUT DIRECTIONS — ${path.basename(file)} is authored at physical size ` +
    `(a print or apparel piece), but there is no directions.md beside it in ${dir}. ` +
    'The print-design / apparel-design pipeline requires the divergence protocol to be WRITTEN before ' +
    'markup: a DNA table mined from the subject\'s real artifacts (materials, motifs, palette from ' +
    'source, tempo, vernacular), three to five structurally different directions each naming its ' +
    'operator, the swap-test verdict on each ("swap the name and content for a competitor\'s — does ' +
    'it still work? then it is the category"), and the one committed to, with the reason. A design ' +
    'with no written directions is the first idea polished, which is the centroid. Write ' +
    'directions.md now, then check this file against it — and be willing to discard the file. ' +
    'The shape of the artifact: skills/print-design/examples/business-card/directions.md.'

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context },
  }) + '\n')
}

main()
