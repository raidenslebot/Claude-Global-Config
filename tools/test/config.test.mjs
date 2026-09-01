// Integrity of the checked-in config: it has to survive substitution on a stranger's
// machine, and it must not carry a single path that only exists on the machine that wrote it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { REPO, realize, unresolved } from '../paths.mjs'

const HOOKS_JSON = join(REPO, 'config', 'hooks.json')
const raw = readFileSync(HOOKS_JSON, 'utf8')

// Deliberately hostile: spaces AND backslashes, the exact shape that broke install.
const WIN = {
  NODE: 'C:\\Program Files\\nodejs\\node.exe',
  CONFIG_ROOT: 'C:\\Users\\stranger\\.claude',
  HOME: 'C:\\Users\\stranger',
}

const allHooks = (doc) => Object.entries(doc.hooks || {})
  .flatMap(([event, groups]) => (groups || []).flatMap((g) => (g.hooks || []).map((h) => ({ event, ...h }))))

test('config/hooks.json is valid JSON with at least one registered hook', () => {
  const doc = JSON.parse(raw)
  assert.ok(doc.hooks && Object.keys(doc.hooks).length, 'no hooks registered')
  assert.ok(allHooks(doc).length > 0)
})

test('every hook command is a non-empty string of type command', () => {
  for (const h of allHooks(JSON.parse(raw))) {
    assert.equal(h.type, 'command', `${h.event}: hook type must be "command"`)
    assert.equal(typeof h.command, 'string')
    assert.ok(h.command.trim().length > 0, `${h.event}: empty command`)
  }
})

test('hooks.json still parses after realizing a Windows path table into it', () => {
  // Bug pinned (shipped 2026-09-01): substituting {{NODE}} into the RAW JSON TEXT produced
  // "C:\Program Files\..." with single backslashes and threw
  // SyntaxError: Bad escaped character in JSON. The fix is parse-first, substitute into
  // the parsed values. This test walks install.mjs's pipeline with a hostile table.
  const parsed = JSON.parse(raw).hooks
  const realized = Object.fromEntries(Object.entries(parsed).map(([event, groups]) => [
    event,
    groups.map((g) => ({ ...g, hooks: (g.hooks || []).map((h) => ({ ...h, command: realize(String(h.command), WIN) })) })),
  ]))
  const roundTripped = JSON.parse(JSON.stringify({ hooks: realized }))
  for (const h of allHooks(roundTripped)) {
    // {{NODE}} is a bare token, so it renders native: a spaced Windows path full of
    // backslashes, sitting inside a JSON string. That is the exact payload that used to
    // blow up, and it has to come back out of the round trip unchanged.
    assert.ok(h.command.includes('C:\\Program Files\\nodejs\\node.exe'),
      `${h.event}: the spaced backslashed node path did not survive — ${h.command}`)
    assert.match(h.command, /stranger[\\/].claude[\\/]hooks[\\/][\w.-]+\.(?:js|mjs|cjs)/,
      `${h.event}: the script path did not survive the round trip — ${h.command}`)
    assert.deepEqual(unresolved(h.command), [], `${h.event}: token left unresolved — ${h.command}`)
  }
})

test('substituting into the raw JSON text is unsafe, which is why install parses first', () => {
  // The failing half of the bug above, pinned so nobody "simplifies" the parse-first step
  // back into a one-line text replace. If realize ever becomes JSON-escape-aware this
  // assertion is the place to make that a deliberate decision rather than an accident.
  assert.throws(() => JSON.parse(realize(raw, WIN)), SyntaxError)
})

test('every hook script lives under {{CONFIG_ROOT}}, not a machine-specific path', () => {
  // Regressed twice. A hook registered at a path outside ~/.claude is a silent no-op on
  // every machine that does not happen to have that exact directory.
  for (const h of allHooks(JSON.parse(raw))) {
    const script = (h.command.match(/([\w.-]+\.(?:js|mjs|cjs))/) || [])[1]
    assert.ok(script, `${h.event}: command names no .js/.mjs/.cjs script — ${h.command}`)
    // Either token form is fine here; what matters is that the root is a token at all.
    assert.match(h.command, /\{\{CONFIG_ROOT(?::url)?\}\}/,
      `${h.event}: ${script} is not under {{CONFIG_ROOT}} — ${h.command}`)
    assert.match(h.command, /\{\{NODE(?::url)?\}\}/,
      `${h.event}: ${script} does not pin the interpreter, so it dies whenever PATH differs`)
  }
})

test('a hook path realized on POSIX uses a separator POSIX can actually follow', () => {
  // Bug pinned: hooks.json used to hardcode "{{CONFIG_ROOT}}\\hooks\\name.js". realize()
  // substitutes the VALUE but never rewrites the literal separators around it, so on
  // macOS/Linux every command became "/home/x/.claude\hooks\name.js" — one filename
  // containing backslashes, which does not exist. Every hook installed "successfully" and
  // was then a silent no-op: the exact failure mode doctor.mjs calls the single most
  // important check in the file. Both the manifest and the ABS_SCRIPT normaliser in
  // tools/sync.mjs now emit "{{CONFIG_ROOT:url}}/hooks/name.js" (node accepts forward
  // slashes on Windows too). Do not "tidy" those separators back to backslashes.
  const POSIX = { NODE: '/usr/local/bin/node', CONFIG_ROOT: '/home/stranger/.claude', HOME: '/home/stranger' }
  const broken = []
  for (const h of allHooks(JSON.parse(raw))) {
    const cmd = realize(h.command, POSIX)
    const script = (cmd.match(/"([^"]*\.(?:js|mjs|cjs))"/) || [])[1] || ''
    if (script.includes('\\')) broken.push(`${h.event}: ${script}`)
  }
  assert.deepEqual(broken, [], 'hook script paths are unusable on POSIX')
})

test('hooks.json contains no absolute machine path anywhere in the file', () => {
  const hits = raw.split(/\r?\n/)
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /[A-Za-z]:[\\/](?:Users|Claude|Program Files)/.test(l))
  assert.deepEqual(hits.map(([n, l]) => `config/hooks.json:${n}: ${l.trim()}`), [])
})

test('every hook named in hooks.json ships as a file somewhere install.mjs collects from', () => {
  // A registration with no script behind it installs cleanly and then does nothing.
  const sources = [
    join(REPO, 'config', 'hooks'),
    join(REPO, 'argo', 'plugin', 'hooks'),
    join(REPO, 'skills', 'visual-design-mastery', 'hooks'),
  ]
  const shipped = new Set(sources.flatMap((d) => (existsSync(d) ? readdirSync(d) : [])))
  const missing = allHooks(JSON.parse(raw))
    .map((h) => (h.command.match(/([\w.-]+\.(?:js|mjs|cjs))/) || [])[1])
    .filter((s) => s && !shipped.has(s))
  assert.deepEqual([...new Set(missing)], [], 'hooks registered with no script in the repo')
})

test('no file under config/ contains an absolute machine path', () => {
  // The portability invariant for the whole tree. sync.mjs warns about this; here it fails.
  const ABS = /[A-Za-z]:[\\/](?:Users|Claude|Program Files)/
  const offenders = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      if (statSync(abs).isDirectory()) { walk(abs); continue }
      let text
      try { text = readFileSync(abs, 'utf8') } catch { continue }
      text.split(/\r?\n/).forEach((line, i) => {
        // A comment is inert: never parsed as a string literal, never resolved at runtime.
        // Hooks in this tree legitimately DOCUMENT the escape bug using a real-looking path
        // as the example, and flagging that is a false positive. A gate that cries wolf is
        // switched off, so it must only fire on a path the code would actually rely on.
        if (/^\s*(\/\/|\*|#)/.test(line)) return
        if (ABS.test(line)) {
          offenders.push(`${relative(REPO, abs).replace(/\\/g, '/')}:${i + 1}: ${line.trim().slice(0, 120)}`)
        }
      })
    }
  }
  walk(join(REPO, 'config'))
  assert.deepEqual(offenders, [], `absolute paths must be replaced by a {{TOKEN}} from tools/paths.mjs:\n${offenders.join('\n')}`)
})

// ── library/sources.json ────────────────────────────────────────────────────

const SOURCES = join(REPO, 'library', 'sources.json')

test('library/sources.json is valid JSON with both a repos and a tier2 list', () => {
  const s = JSON.parse(readFileSync(SOURCES, 'utf8'))
  assert.ok(Array.isArray(s.repos) && s.repos.length, 'repos must be a non-empty array')
  assert.ok(Array.isArray(s.tier2) && s.tier2.length, 'tier2 must be a non-empty array')
})

test('every tier2 entry names a skill and the path it is linked from', () => {
  // install.mjs joins LIBRARY_ROOT with s.path.split('/'); a missing path silently links nothing.
  for (const s of JSON.parse(readFileSync(SOURCES, 'utf8')).tier2) {
    assert.equal(typeof s.name, 'string', `tier2 entry without a name: ${JSON.stringify(s)}`)
    assert.ok(s.name.length, 'empty tier2 name')
    assert.equal(typeof s.path, 'string', `tier2 "${s.name}" has no path`)
    // A skill may live at the ROOT of its repo (asd-ste100-skill, animate-skill,
    // css-animation-skill all ship SKILL.md at the top level), so a path with no
    // separator is legitimate. What must hold is that separators, when present, are
    // forward slashes — a backslash here would not resolve on POSIX.
    assert.ok(!s.path.includes('\\'), `tier2 "${s.name}" path must use / not \\ — ${s.path}`)
    assert.ok(!/^[A-Za-z]:|^[\\/]/.test(s.path), `tier2 "${s.name}" path must not be absolute — ${s.path}`)
  }
})

test('every repo is either clonable or explicitly rejected with a reason', () => {
  for (const r of JSON.parse(readFileSync(SOURCES, 'utf8')).repos) {
    assert.equal(typeof r.name, 'string', `repo without a name: ${JSON.stringify(r)}`)
    if (r.rejected) {
      assert.equal(typeof r.reason, 'string', `rejected repo "${r.name}" states no reason`)
      assert.ok(r.reason.trim().length > 10, `rejected repo "${r.name}" reason is too thin to act on`)
    } else {
      assert.equal(typeof r.url, 'string', `repo "${r.name}" has neither url nor rejected`)
      assert.match(r.url, /^https:\/\//, `repo "${r.name}" url must be https — ${r.url}`)
    }
  }
})

test('no two sources share a name, in either list', () => {
  // install.mjs clones into join(root, s.name) and links into skills/s.name — a duplicate
  // name means one entry silently overwrites the other.
  const s = JSON.parse(readFileSync(SOURCES, 'utf8'))
  for (const [label, list] of [['repos', s.repos], ['tier2', s.tier2]]) {
    const names = list.map((x) => x.name)
    const dupes = names.filter((n, i) => names.indexOf(n) !== i)
    assert.deepEqual([...new Set(dupes)], [], `duplicate ${label} names`)
  }
})

test('every tier2 skill path points into a repo that sources.json actually clones', () => {
  const s = JSON.parse(readFileSync(SOURCES, 'utf8'))
  const clonable = new Set(s.repos.filter((r) => !r.rejected).map((r) => r.name))
  for (const t of s.tier2) {
    const repo = t.path.split('/')[0]
    assert.ok(clonable.has(repo), `tier2 "${t.name}" lives in "${repo}", which is not a clonable repo entry`)
  }
})
