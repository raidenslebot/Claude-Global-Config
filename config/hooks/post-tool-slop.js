// PostToolUse hook: the write-time design report, on every screen file as it is written.
//
// Two halves, because a design fails in two directions. The fingerprint half names what the
// file SHOULD NOT have — the templated look the model reaches for by default (the purple
// gradient, the glass card, the centred hero). The ambition half names what it DOES NOT HAVE:
// a page can carry no fingerprint at all and still be built from nothing but flexbox,
// border-radius and a hex colour. That page is not bad; it is conventional, and conventional is
// the ceiling. A demand nobody checks is a preference, so this checks both.
//
// It reports; it never vetoes. Silent on physical designs (print-lint owns those), on non-design
// files, and on anything it cannot read. Exit 0 always.

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// Templated by install.mjs; unresolved when run straight from the repo (the tests do).
const REPO_TOKEN = '{{REPO_ROOT:url}}'
const NODE_TOKEN = '{{NODE:url}}'
const REPO = REPO_TOKEN.includes('{{') ? path.resolve(__dirname, '..', '..') : REPO_TOKEN
const NODE = NODE_TOKEN.includes('{{') ? process.execPath : NODE_TOKEN

// The fingerprint half is web-only, because its tells are web tells.
const EXTS = new Set(['.html', '.htm', '.css', '.scss', '.jsx', '.tsx', '.vue', '.svelte', '.astro'])
// The ambition half is not. A shader, a Unity script, a SwiftUI view, a Godot scene and a
// terminal UI are all things a human will look at, and until now none of them got a word.
const DESIGN_EXTS = new Set([...EXTS,
  '.svg', '.glsl', '.frag', '.vert', '.wgsl', '.shader', '.hlsl',
  '.swift', '.kt', '.dart', '.cs', '.gd', '.js', '.ts', '.mjs'])
const PHYSICAL = /@page\s*\{[^}]*\bsize\s*:\s*[\d.]+\s*(?:in|mm|cm|pt)\b/i
// Below this a file is a fragment, and asking a fragment to be ambitious is noise.
const SUBSTANTIAL = 1200

function tool(name, args) {
  const r = spawnSync(NODE, [path.join(REPO, 'tools', name), ...args], { encoding: 'utf8', timeout: 10000, windowsHide: true })
  try { return JSON.parse(r.stdout) } catch { return null }
}

function main() {
  let payload
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}') } catch { return }
  if (!/^(Write|Edit|MultiEdit)$/.test(String(payload.tool_name || ''))) return
  const file = String(payload.tool_input?.file_path || '')
  const ext = path.extname(file).toLowerCase()
  if (!file || !DESIGN_EXTS.has(ext)) return
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch { return }
  if (PHYSICAL.test(text)) return

  const parts = []
  const web = EXTS.has(ext)

  const slop = web ? (tool('slop-lint.mjs', [file, '--json']) || {}).files?.[0] : null
  if (slop && slop.score >= 2) {
    const list = slop.findings.map((f) => `${f.id} (L${f.line}: ${f.sample.slice(0, 50)})`).join('; ')
    const verdict = slop.verdict === 'centroid'
      ? 'This is the template. Do not decorate it — run the divergence protocol, change the STRUCTURE, and lint again'
      : 'Each of these is a default, not a decision — replace it or state why it stays'
    parts.push(`SLOP FINGERPRINT in ${path.basename(file)} — score ${slop.score} of ${slop.max} (${slop.verdict}): ${list}. `
      + `${verdict}: cgc lint "${file}". `
      + `The absence of fingerprints is not design: render it (cgc render "${file}" --mobile), look at desktop and phone, `
      + 'name the weakest thing, fix it, and run cgc audit on it — then again, until nothing can be named.')
  }

  // The other direction: what it never tried.
  if (text.length >= SUBSTANTIAL) {
    const t = tool('techniques.mjs', [file, '--json'])
    // Outside the web extensions the medium must be recognised, or the file is a build script
    // rather than a design and the advice would be noise.
    const speaks = t && (web || t.detected)
    if (speaks && (t.verdict === 'assembled' || t.verdict === 'conventional')) {
      const tried = t.used.length ? t.used.map((u) => u.id).join(', ') : 'nothing'
      const reach = t.missing.slice(0, 5).map((m) => m.what).join(' ')
      parts.push(`AMBITION in ${path.basename(file)} (${t.media.map((x) => x.label).join(' + ')}) — ${t.verdict}: it reaches for ${t.count} of ${t.pool} of that medium's capabilities (${tried}). `
        + (t.verdict === 'assembled'
          ? 'Nothing in this file does anything a default cannot do. It was assembled, not designed. '
          : 'It is correct and unremarkable — which is the ceiling, not the floor. ')
        + `Consider, and pick the ones the IDEA needs rather than the ones that are easiest: ${reach} `
        + `The full list with what each unlocks: cgc techniques "${file}" --all, and the craft behind them is in `
        + 'visual-design-mastery/references/advanced-techniques.md. A technique that could be removed without the piece '
        + 'changing was decoration; one that changes the structure is a decision.')
    }
  }

  if (!parts.length) return
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: parts.join(' ') + ' The moves with their real parameters are in visual-design-mastery/references/signature-moves.md.',
    },
  }) + '\n')
}

try { main() } catch { /* a reporting hook never blocks a write */ }
