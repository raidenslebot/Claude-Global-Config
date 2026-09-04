// Round-trip and substitution invariants for the path templating vocabulary.
//
// Everything in config/ and skills/ is stored with {{TOKENS}} in place of machine paths.
// If templatize -> realize is not the identity, this repo silently corrupts a stranger's
// config on install. Both bugs that shipped on 2026-09-01 were in this class.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { templatize, realize, unresolved, buildVars, REPO, hostConfigs, pluginServers, readJsonQuietly } from '../paths.mjs'

const TOOLS = join(REPO, 'tools')

// A Windows-shaped table: spaces, backslashes, and one value that is a strict prefix of
// another (HOME vs CONFIG_ROOT). All three properties have broken this code before.
const WIN = {
  CONFIG_ROOT: 'C:\\Users\\stranger\\.claude',
  HOME: 'C:\\Users\\stranger',
  NODE: 'C:\\Program Files\\nodejs\\node.exe',
  LIBRARY_ROOT: 'C:\\Claude\\dskills',
  ESLINT_CONFIG: 'C:\\Users\\stranger\\AppData\\Roaming\\npm\\node_modules\\.global-eslint\\eslint.config.mjs',
}

const POSIX = {
  CONFIG_ROOT: '/home/stranger/.claude',
  HOME: '/home/stranger',
  NODE: '/usr/local/bin/node',
  LIBRARY_ROOT: '/home/stranger/dskills',
}

const roundTrip = (text, vars) => realize(templatize(text, vars), vars)

test('a backslash document survives templatize -> realize byte-identical', () => {
  const doc = [
    '"C:\\Users\\stranger\\.claude\\hooks\\x.js"',
    'node "C:\\Program Files\\nodejs\\node.exe" --check',
    'library at C:\\Claude\\dskills\\_index\\INDEX.md',
    'home is C:\\Users\\stranger and nothing else',
  ].join('\n')
  assert.equal(roundTrip(doc, WIN), doc)
})

test('a forward-slash document survives templatize -> realize byte-identical', () => {
  const doc = [
    'import base from "file:///C:/Users/stranger/.claude/eslint.config.mjs"',
    'exec("C:/Program Files/nodejs/node.exe")',
    'C:/Claude/dskills/_index/INDEX.md',
  ].join('\n')
  assert.equal(roundTrip(doc, WIN), doc)
})

test('a path containing spaces survives the round trip in either slash style', () => {
  // C:\Program Files\nodejs\node.exe is the value that produced the JSON escaping crash.
  const back = 'run "C:\\Program Files\\nodejs\\node.exe" now'
  const fwd = 'run "C:/Program Files/nodejs/node.exe" now'
  assert.equal(roundTrip(back, WIN), back)
  assert.equal(roundTrip(fwd, WIN), fwd)
})

test('a posix document survives the round trip byte-identical', () => {
  const doc = '#!/home/stranger/.claude/x\nnode /usr/local/bin/node\nHOME=/home/stranger\n'
  assert.equal(roundTrip(doc, POSIX), doc)
})

test('slash style is chosen per occurrence, so both forms of one path coexist in one file', () => {
  // Bug pinned: rendering a whole file in native style broke `file:///` imports, which are
  // only valid forward-slashed, while the CLI argument on the next line needs backslashes.
  const doc = 'import x from "file:///C:/Users/stranger/.claude/a.mjs"\nspawn("C:\\Users\\stranger\\.claude\\a.mjs")\n'
  const t = templatize(doc, WIN)
  assert.match(t, /\{\{CONFIG_ROOT:url\}\}\/a\.mjs/, 'forward occurrence must take the :url token')
  assert.match(t, /\{\{CONFIG_ROOT\}\}\\a\.mjs/, 'backslash occurrence must take the bare token')
  assert.equal(realize(t, WIN), doc)
})

test('a :url token always renders forward-slashed even when native style is requested', () => {
  assert.equal(realize('{{NODE:url}}', WIN), 'C:/Program Files/nodejs/node.exe')
  assert.equal(realize('{{NODE}}', WIN), 'C:\\Program Files\\nodejs\\node.exe')
})

test('the longest matching value wins, so a prefix var cannot chew up a longer one', () => {
  // HOME is a strict prefix of CONFIG_ROOT. Shortest-first would produce
  // "{{HOME}}\.claude\hooks", which realizes fine but records the wrong vocabulary and
  // breaks the moment CONFIG_ROOT is not HOME/.claude (CLAUDE_CONFIG_DIR).
  const t = templatize('C:\\Users\\stranger\\.claude\\hooks\\x.js', WIN)
  assert.equal(t, '{{CONFIG_ROOT}}\\hooks\\x.js')
  assert.equal(templatize('C:\\Users\\stranger\\Documents', WIN), '{{HOME}}\\Documents')
  assert.equal(realize(t, WIN), 'C:\\Users\\stranger\\.claude\\hooks\\x.js')
})

test('longest-first holds when the prefix var is declared first in the table', () => {
  // Ordering must come from value length, not from Object key order.
  const ordered = { HOME: WIN.HOME, CONFIG_ROOT: WIN.CONFIG_ROOT }
  assert.equal(templatize('C:\\Users\\stranger\\.claude\\hooks\\x.js', ordered), '{{CONFIG_ROOT}}\\hooks\\x.js')
})

test('an unresolvable token is left intact rather than replaced with undefined', () => {
  assert.equal(realize('{{NOPE}}/x', WIN), '{{NOPE}}/x')
})

test('unresolved() reports the bare key for both the plain and the :url token form', () => {
  const found = unresolved('a {{NODE}} b {{CONFIG_ROOT:url}} c {{NODE:url}} d')
  assert.deepEqual(found.sort(), ['CONFIG_ROOT', 'NODE'])
  assert.deepEqual(unresolved('nothing to see here'), [])
})

test('realizing with slash:forward emits no backslash anywhere it substituted', () => {
  // Bug pinned: "C:\Users\npm" inside a JS string literal is read as escapes and becomes
  // "C:Users" + newline + "pm", silently corrupting the eslint path a hook emits.
  // install.mjs writes every .js/.mjs/.cjs hook with slash:'forward' for exactly this reason.
  const src = 'const ESLINT = "{{ESLINT_CONFIG}}"\nconst NODE = "{{NODE}}"\nconst CFG = "{{CONFIG_ROOT}}"'
  const out = realize(src, WIN, { slash: 'forward' })
  assert.ok(!out.includes('\\'), `slash:forward still emitted a backslash:\n${out}`)
  assert.ok(out.includes('"C:/Users/stranger/AppData/Roaming/npm/node_modules/.global-eslint/eslint.config.mjs"'))
})

test('realizing with slash:back emits no forward slash inside a substituted path', () => {
  assert.equal(realize('{{NODE}}', { NODE: 'C:/Program Files/nodejs/node.exe' }, { slash: 'back' }),
    'C:\\Program Files\\nodejs\\node.exe')
})

test('a hook realized with slash:forward parses AND carries the path it was given', async () => {
  // The strongest form of the escaping check: node has to accept the file, and the value
  // the module actually exposes at runtime has to still be the path we substituted.
  const dir = mkdtempSync(join(tmpdir(), 'cgc-paths-'))
  try {
    const src = [
      '// generated hook',
      'export const ESLINT = "{{ESLINT_CONFIG}}"',
      'export const NODE = "{{NODE}}"',
      'export const CFG = "{{CONFIG_ROOT}}"',
      '',
    ].join('\n')
    const want = (k) => WIN[k].replace(/\\/g, '/')

    const good = join(dir, 'hook.mjs')
    writeFileSync(good, realize(src, WIN, { slash: 'forward' }), 'utf8')
    const r = spawnSync(process.execPath, ['--check', good], { encoding: 'utf8' })
    assert.equal(r.status, 0, `node --check rejected the realized hook:\n${r.stderr}`)
    const mod = await import(pathToFileURL(good).href)
    assert.equal(mod.ESLINT, want('ESLINT_CONFIG'))
    assert.equal(mod.NODE, want('NODE'))
    assert.equal(mod.CFG, want('CONFIG_ROOT'))

    // Teeth: the native-slash version parses too, which is precisely why the bug was
    // silent. Its runtime value is mangled — node_modules becomes node + a real newline.
    const bad = join(dir, 'bad.mjs')
    writeFileSync(bad, realize(src, WIN), 'utf8')
    const mangled = await import(pathToFileURL(bad).href)
    assert.notEqual(mangled.ESLINT, want('ESLINT_CONFIG'))
    assert.notEqual(mangled.ESLINT, WIN.ESLINT_CONFIG)
    assert.ok(mangled.ESLINT.includes('\n'), 'expected \\n in the path to have become a newline')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('buildVars produces absolute, non-empty values for every path this repo substitutes', () => {
  const vars = buildVars()
  for (const key of ['CONFIG_ROOT', 'REPO_ROOT', 'HOME', 'NODE', 'LIBRARY_ROOT', 'ESLINT_CONFIG']) {
    assert.ok(vars[key], `${key} is empty`)
    assert.ok(String(vars[key]).length >= 4,
      `${key}=${vars[key]} is under templatize's 4-char floor and would never be tokenised`)
  }
})

test('overrides passed to buildVars win over detection', () => {
  assert.equal(buildVars({ NODE: 'X:\\pinned\\node.exe' }).NODE, 'X:\\pinned\\node.exe')
})

// ── Regression: a token name containing a DIGIT ─────────────────────────────
// Shipped bug. realize() and unresolved() both used /\{\{([A-Z_]+)\}\}/, which excludes
// digits. {{T3MP3ST_ROOT}} therefore matched NEITHER: it was never substituted, and the
// guard meant to catch that never reported it. A mandate shipped to the live config
// telling Claude to cd into a literal "{{T3MP3ST_ROOT}}".
//
// The general lesson this pins: a validator written from the same assumption as the code
// it validates cannot catch that assumption being wrong.

test('a token whose name contains a digit is substituted, not silently ignored', () => {
  // String.raw, not a plain quoted literal. Written as 'C:\Claude\T3MP3ST' the value is
  // actually "C:ClaudeT3MP3ST" — and asserting against the SAME mangled literal makes the
  // test pass while pinning a destroyed string. This test guards the escape bug class and
  // was itself an instance of it, which is the sharpest possible demonstration that a guard
  // written from the same assumption as the code cannot catch that assumption being wrong.
  const vars = { T3MP3ST_ROOT: String.raw`C:\Claude\T3MP3ST`, NODE: String.raw`C:\Program Files\nodejs\node.exe` }
  const out = realize('run inside `{{T3MP3ST_ROOT}}` with {{NODE}}', vars)
  assert.ok(!out.includes('{{'), `a digit-bearing token survived substitution: ${out}`)
  assert.ok(out.includes(String.raw`C:\Claude\T3MP3ST`), `expected the raw path, got: ${out}`)
  // Prove the value was never mangled: a real backslash must survive into the output.
  assert.ok(out.includes('\\'), 'the substituted path lost its separators')
  assert.ok(!out.includes('\n'), 'a \\n escape was produced from a path separator')
})

test('unresolved() reports a digit-bearing token rather than passing it as clean', () => {
  // The guard must not share the substituter's blind spot.
  assert.deepEqual(unresolved('see {{T3MP3ST_ROOT}}'), ['T3MP3ST_ROOT'])
  assert.deepEqual(unresolved('see {{T3MP3ST_ROOT:url}}'), ['T3MP3ST_ROOT'])
})

test('a digit-bearing path round-trips templatize -> realize byte-identical', () => {
  const vars = { T3MP3ST_ROOT: String.raw`C:\Claude\T3MP3ST` }
  const original = String.raw`cd C:\Claude\T3MP3ST && npm run server`
  assert.equal(realize(templatize(original, vars), vars), original)
  // Without String.raw both literals mangle IDENTICALLY, so the round trip still passes
  // while proving nothing. Assert the separators are really present.
  assert.ok(original.includes('\\'), 'the fixture lost its backslashes before the test ran')
})

test('no mandate in config/ ships an unresolved token of any shape', () => {
  // Catches the class directly at the artifact, independent of the regex used to find it.
  const dir = join(REPO, 'config')
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
    const text = readFileSync(join(dir, f), 'utf8')
    const realized = realize(text, buildVars())
    const left = realized.match(/\{\{[^}]{1,40}\}\}/g)
    assert.equal(left, null, `${f} still holds ${left && left.join(', ')} after realize()`)
  }
})

test('every scope an MCP server loads from is enumerated, not only ~/.claude.json', (t) => {
  // A server registered in two places is two servers RUNNING — one process each, in every
  // session, for the life of every window. Each config file looks correct on its own, which is
  // why nothing caught it until a machine with fifteen windows open ran out of memory.
  const home = mkdtempSync(join(tmpdir(), 'cgc-scopes-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const write = (rel, obj) => {
    const p = join(home, ...rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8')
    return p
  }

  // The host application's own registry, at the platform's application-data location.
  const hostRel = process.platform === 'win32' ? ['AppData', 'Roaming', 'Claude', 'claude_desktop_config.json']
    : process.platform === 'darwin' ? ['Library', 'Application Support', 'Claude', 'claude_desktop_config.json']
      : ['.config', 'Claude', 'claude_desktop_config.json']
  write(hostRel, { mcpServers: { playwright: { command: 'cmd', args: ['/c', 'npx', '-y', '@playwright/mcp@latest'] } } })
  const found = hostConfigs(home)
  assert.equal(found.length, 1, 'the host application config is a scope')
  assert.equal(readJsonQuietly(found[0][1]).mcpServers.playwright.command, 'cmd')

  // An ENABLED plugin's servers load; a disabled one's do not.
  write(['.claude', 'settings.json'], { enabledPlugins: { 'ctx@market': true, 'off@market': false } })
  write(['.claude', 'plugins', 'marketplaces', 'market', 'external_plugins', 'ctx', '.mcp.json'],
    { mcpServers: { context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp@latest'] } } })
  write(['.claude', 'plugins', 'marketplaces', 'market', 'external_plugins', 'off', '.mcp.json'],
    { mcpServers: { nothing: { command: 'node', args: ['x.js'] } } })
  const plugins = pluginServers(home)
  assert.deepEqual(plugins.map(([n]) => n), ['ctx'], 'a disabled plugin loads nothing')
  assert.ok(plugins[0][1].context7, 'and an enabled one contributes its servers')

  // A malformed or absent config is not a finding — it is simply not a scope.
  writeFileSync(join(home, '.claude', 'settings.local.json'), '{ not json', 'utf8')
  assert.equal(readJsonQuietly(join(home, '.claude', 'settings.local.json')), null)
  assert.equal(readJsonQuietly(join(home, 'nope.json')), null)
  assert.deepEqual(hostConfigs(join(home, 'empty')), [], 'a home with no host config has no host scope')
})

test('nothing imports a SCRIPT — importing one runs it', () => {
  // doctor.mjs runs its checks top-level and ends with process.exit; run-tests.mjs runs the
  // whole suite. An import of either does not borrow a helper, it does the work — and in the
  // doctor's case kills the importing process. Shared helpers live in paths.mjs for exactly
  // this reason. Both landmines were found the same way: by stepping on one.
  const SCRIPTS = ['doctor.mjs', 'run-tests.mjs']
  for (const script of SCRIPTS) {
    assert.ok(existsSync(join(TOOLS, script)), `${script} exists`)
    for (const [dir, prefix] of [[TOOLS, '\\./'], [join(TOOLS, 'test'), '\\.\\./']]) {
      const re = new RegExp(`^\\s*import[^\\n]*from\\s+['"]${prefix}${script.replace('.', '\\.')}['"]`, 'm')
      for (const f of readdirSync(dir).filter((f) => f.endsWith('.mjs') && f !== script)) {
        assert.doesNotMatch(readFileSync(join(dir, f), 'utf8'), re,
          `${f} imports ${script} — that runs it as a side effect of the import; spawn it instead`)
      }
    }
  }
})

test('a plugin is found where it is INSTALLED, not where it is catalogued', (t) => {
  // The loaded copy lives at the installPath recorded in installed_plugins.json, under
  // plugins/cache/<market>/<plugin>/<version>. Guessing at the marketplace catalog layout
  // missed seven of eight enabled plugins on a real machine, so the plugin arm of the
  // duplicate check returned nothing at all — a reassuring blank, not a check.
  const home = mkdtempSync(join(tmpdir(), 'cgc-plug-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const w = (rel, obj) => {
    const p = join(home, ...rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(obj), 'utf8')
  }
  w(['.claude', 'settings.json'], { enabledPlugins: { 'ctx@market': true, 'off@market': false } })
  const inst = join(home, '.claude', 'plugins', 'cache', 'market', 'ctx', '1.2.3')
  mkdirSync(inst, { recursive: true })
  writeFileSync(join(inst, '.mcp.json'), JSON.stringify({ mcpServers: { context7: { type: 'http', url: 'https://mcp.context7.com/mcp' } } }), 'utf8')
  w(['.claude', 'plugins', 'installed_plugins.json'], { version: 2, plugins: { 'ctx@market': [{ scope: 'user', installPath: inst, version: '1.2.3' }] } })
  // Installed but DISABLED: it loads nothing, so it contributes nothing.
  const off = join(home, '.claude', 'plugins', 'cache', 'market', 'off', '1.0.0')
  mkdirSync(off, { recursive: true })
  writeFileSync(join(off, '.mcp.json'), JSON.stringify({ mcpServers: { nope: { command: 'node' } } }), 'utf8')

  const found = pluginServers(home)
  assert.deepEqual(found.map(([n]) => n), ['ctx'])
  assert.deepEqual(Object.keys(found[0][1]), ['context7'])

  // A single-plugin marketplace whose repository root IS the plugin still resolves, since
  // nothing records an installPath for it.
  const home2 = mkdtempSync(join(tmpdir(), 'cgc-plug2-'))
  t.after(() => rmSync(home2, { recursive: true, force: true }))
  mkdirSync(join(home2, '.claude', 'plugins', 'marketplaces', 'solo'), { recursive: true })
  writeFileSync(join(home2, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'solo@solo': true } }), 'utf8')
  writeFileSync(join(home2, '.claude', 'plugins', 'marketplaces', 'solo', '.mcp.json'), JSON.stringify({ mcpServers: { thing: { command: 'node' } } }), 'utf8')
  assert.deepEqual(pluginServers(home2).map(([n]) => n), ['solo'], 'a marketplace whose root is the plugin')
})
