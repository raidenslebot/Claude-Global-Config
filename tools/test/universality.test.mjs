// This package installs onto machines nobody here will ever see. Nothing shipped may assume
// a particular machine, user, drive, operating system, or that this repository exists at all.
//
// Skills matter most: they are LINKED into the user's skills directory, not copied through
// realize(), so a {{TOKEN}} inside one is never substituted and a machine path inside one is
// permanently wrong everywhere else. A skill must describe how to FIND a thing, never where it
// happens to sit on the machine that authored it.
//
// This was an advisory rule until two skills broke it in the same week. It is a gate now.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { REPO } from '../paths.mjs'

/** Every text file this package SHIPS to a user's machine. */
function shippedFiles() {
  const roots = ['skills', 'config', 'workflows', 'library']
  const out = []
  const skipDir = new Set(['node_modules', '.git', 'repos', 'assets'])
  const wanted = /\.(md|mjs|cjs|js|json|ya?ml)$/
  for (const r of roots) {
    const base = join(REPO, r)
    if (!existsSync(base)) continue
    ;(function walk(d) {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (skipDir.has(e.name)) continue
        const p = join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (wanted.test(e.name) && statSync(p).size < 400_000) out.push(p)
      }
    })(base)
  }
  return out
}

/** A real machine path. Windows drive roots and POSIX home roots, both slash styles.
 *  Deliberately NOT anchored to one platform: a Windows-only matcher has already caused
 *  three separate silent no-ops in this codebase. */
// `Program Files` is deliberately NOT here. It is a standard OS location, identical on every
// Windows machine, so citing it in an example is not a portability defect — only paths that
// DIFFER per machine are. Flagging it made this gate reject correct teaching prose, and a gate
// with false positives gets switched off.
const MACHINE_PATH = /(?:[A-Za-z]:[\\/](?:Users|Claude)\b|\/(?:home|Users)\/(?!<|\{)[A-Za-z0-9._-]+\/)/

/** Names that only mean something inside this project. */
const PROJECT_SPECIFIC = /\b(?:Claude-Global-Config|raidenslebot|dskills)\b/

/** Illustrative placeholders are fine — teaching needs concrete-looking examples. What is
 *  forbidden is a path a machine would actually be expected to have. */
const PLACEHOLDER = /stranger|<user>|<site>|<your|example|yourname|\bu\b/i

/** A comment or blockquote line. A path inside one is inert — never parsed as a string
 *  literal, never resolved at runtime — so it is documentation, not a portability defect.
 *  Several shipped files legitimately DEMONSTRATE this bug class using a real-looking path. */
const COMMENT = /^\s*(\/\/|\*|#|>)/

test('no shipped skill hardcodes a machine path', () => {
  const offenders = []
  for (const f of shippedFiles().filter((f) => f.includes(`skills${sep}`))) {
    const lines = readFileSync(f, 'utf8').split(/\r?\n/)
    lines.forEach((line, i) => {
      if (!MACHINE_PATH.test(line)) return
      if (PLACEHOLDER.test(line)) return
      if (COMMENT.test(line)) return   // documentation, not a location the code relies on          // an illustrative example, not a real location
      offenders.push(`${relative(REPO, f)}:${i + 1}  ${line.trim().slice(0, 90)}`)
    })
  }
  assert.deepEqual(offenders, [],
    `Skills are linked, not realized — a machine path in one is wrong on every other machine.\n` +
    `Describe how to FIND the thing instead:\n  ${offenders.join('\n  ')}`)
})

test('no shipped skill depends on this repository existing by name', () => {
  const offenders = []
  for (const f of shippedFiles().filter((f) => f.includes(`skills${sep}`))) {
    const lines = readFileSync(f, 'utf8').split(/\r?\n/)
    lines.forEach((line, i) => {
      if (PROJECT_SPECIFIC.test(line)) {
        offenders.push(`${relative(REPO, f)}:${i + 1}  ${line.trim().slice(0, 90)}`)
      }
    })
  }
  assert.deepEqual(offenders, [],
    `A skill must read as authored for any project:\n  ${offenders.join('\n  ')}`)
})

test('shipped hooks are self-contained — no import from this repo', () => {
  // Hooks are COPIED to the user's hooks directory. An import reaching back into the repo
  // resolves on the authoring machine and nowhere else, and the hook then dies silently.
  const offenders = []
  for (const f of shippedFiles()) {
    if (!/[\\/]hooks[\\/]/.test(f)) continue
    const text = readFileSync(f, 'utf8')
    for (const m of text.matchAll(/(?:require\(|from\s+)['"](\.[^'"]+)['"]/g)) {
      offenders.push(`${relative(REPO, f)}  imports ${m[1]}`)
    }
  }
  assert.deepEqual(offenders, [], `hooks must be self-contained:\n  ${offenders.join('\n  ')}`)
})

test('every shipped skill declares a name matching its directory', () => {
  const base = join(REPO, 'skills')
  if (!existsSync(base)) return
  for (const dir of readdirSync(base)) {
    const f = join(base, dir, 'SKILL.md')
    if (!existsSync(f)) continue
    const fm = readFileSync(f, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)
    assert.ok(fm, `${dir}/SKILL.md has no frontmatter`)
    const name = (fm[1].match(/^name:\s*(.+)$/m) || [])[1]
    assert.ok(name, `${dir}/SKILL.md declares no name`)
    // A mismatch means the skill is installed under one name and dispatches under another,
    // which reads as "the skill silently never fires".
    assert.equal(name.trim().replace(/^["']|["']$/g, ''), dir,
      `${dir}/SKILL.md declares name "${name.trim()}" — it must equal the directory name`)
    assert.ok(/^description:/m.test(fm[1]), `${dir}/SKILL.md declares no description`)
  }
})

test('no shipped file assumes a single operating system in its paths', () => {
  // A path written only one way is a platform assumption. Config files are realized at
  // install and may carry tokens; what they may NOT carry is a literal foreign root.
  const offenders = []
  for (const f of shippedFiles().filter((f) => f.includes(`config${sep}`))) {
    const lines = readFileSync(f, 'utf8').split(/\r?\n/)
    lines.forEach((line, i) => {
      if (!MACHINE_PATH.test(line)) return
      if (PLACEHOLDER.test(line)) return
      if (COMMENT.test(line)) return   // documentation, not a location the code relies on
      offenders.push(`${relative(REPO, f)}:${i + 1}  ${line.trim().slice(0, 90)}`)
    })
  }
  assert.deepEqual(offenders, [],
    `config ships to other machines — use a {{TOKEN}}:\n  ${offenders.join('\n  ')}`)
})
