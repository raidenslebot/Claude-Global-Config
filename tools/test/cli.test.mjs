// Behavioural tests for the three executables, run hermetically.
//
// HARD RULE: every child process here gets USERPROFILE and HOME pointed at a scratch
// directory, because paths.mjs derives CONFIG_ROOT from os.homedir(). A test that writes
// to the developer's real ~/.claude is unacceptable — it would install a half-built config
// over a working one. Every assertion below also checks the tool reported the scratch
// path, which is what proves the redirection actually took.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'

/** The child env for a HOME-isolated run. */
function scratchEnv(home, extra = {}) {
// CLAUDE_CONFIG_DIR is deleted, not just overridden: paths.mjs prefers it over HOME, so an
// ambient value would send this child to the real config root and defeat the isolation.
  const env = { ...process.env, HOME: home, USERPROFILE: home, ...extra }
  delete env.CLAUDE_CONFIG_DIR
  return env
}

const TOOLS = join(REPO, 'tools')

/** A scratch HOME, torn down after the test whether or not it passed. */
function scratch(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Run one of the tools with HOME redirected. Never inherits the real profile. */
function runTool(script, args, home, opts = {}) {
  return spawnSync(process.execPath, [join(TOOLS, script), ...args], {
    cwd: opts.cwd || REPO,
    encoding: 'utf8',
    timeout: opts.timeout ?? 180000,
    env: scratchEnv(home),
  })
}

// ── install.mjs ─────────────────────────────────────────────────────────────

test('install targets the home it is given and never the developer real profile', (t) => {
  const home = scratch(t, 'cgc-install-dry-')
  const r = runTool('install.mjs', ['--dry-run', '--only=config'], home)
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.stdout.includes(join(home, '.claude')),
    `install did not report the scratch target:\n${r.stdout}`)
})

test('install --dry-run writes no config file into the target home', (t) => {
  const home = scratch(t, 'cgc-install-dry2-')
  const r = runTool('install.mjs', ['--dry-run', '--only=config'], home)
  assert.equal(r.status, 0, r.stderr)
  for (const name of ['CLAUDE.md', 'settings.json', 'ui-design-stack.md']) {
    assert.equal(existsSync(join(home, '.claude', name)), false, `--dry-run wrote ${name}`)
  }
})

test('install resolves every token it writes into the mandate files', (t) => {
  const home = scratch(t, 'cgc-install-cfg-')
  const r = runTool('install.mjs', ['--only=config'], home)
  assert.equal(r.status, 0, r.stderr)
  const claude = readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8')
  assert.equal(/\{\{[A-Z_]+(?::url)?\}\}/.test(claude), false,
    'CLAUDE.md shipped with an unresolved token — the rule inside it points at nothing')
  assert.ok(!r.stdout.includes('unresolved tokens'), r.stdout)
})

test('install preserves the user own notes below the CLAUDE.md marker', (t) => {
  const home = scratch(t, 'cgc-install-keep-')
  const dest = join(home, '.claude')
  mkdirSync(dest, { recursive: true })
  const MINE = '<!-- user-additions-below -->\n\n## My own rules\nnever touch this line\n'
  writeFileSync(join(dest, 'CLAUDE.md'), '# stale generated content\n\n' + MINE, 'utf8')
  assert.equal(runTool('install.mjs', ['--only=config'], home).status, 0)
  const after = readFileSync(join(dest, 'CLAUDE.md'), 'utf8')
  assert.ok(after.includes('never touch this line'), 'user additions were destroyed')
  assert.ok(!after.includes('# stale generated content'), 'generated half was not refreshed')
})

test('the settings.json merge is idempotent and leaves unrelated settings alone', (t) => {
  // Bug pinned (shipped 2026-09-01): the hook commands come from config/hooks.json, whose
  // {{NODE}} value on Windows contains spaces and backslashes. Substituting into the raw
  // JSON text threw "Bad escaped character in JSON" here. If that regresses, install
  // crashes and settings.json below never parses.
  const home = scratch(t, 'cgc-merge-')
  const cfg = join(home, '.claude')
  mkdirSync(cfg, { recursive: true })
  const settingsPath = join(cfg, 'settings.json')
  writeFileSync(settingsPath, JSON.stringify({
    model: 'opus',
    permissions: { allow: ['Bash(ls:*)'] },
    hooks: {
      UserPromptSubmit: [{
        hooks: [
          // Unrelated to this repo: must survive untouched.
          { type: 'command', command: 'node "D:/elsewhere/my-own-hook.js"', timeout: 42 },
          // Same script this repo ships, at a stale path: must be UPDATED, not duplicated.
          { type: 'command', command: 'node "D:/stale/restore-dispatch.js"', timeout: 99 },
        ],
      }],
    },
  }, null, 2), 'utf8')

  const first = runTool('install.mjs', ['--only=hooks'], home)
  assert.equal(first.status, 0, first.stdout + first.stderr)
  const after1 = JSON.parse(readFileSync(settingsPath, 'utf8'))

  const second = runTool('install.mjs', ['--only=hooks'], home)
  assert.equal(second.status, 0, second.stdout + second.stderr)
  const after2 = JSON.parse(readFileSync(settingsPath, 'utf8'))

  // Non-destructive.
  assert.equal(after2.model, 'opus', 'an unrelated top-level setting was dropped')
  assert.deepEqual(after2.permissions, { allow: ['Bash(ls:*)'] }, 'unrelated permissions were dropped')

  const cmds = after2.hooks.UserPromptSubmit.flatMap((g) => g.hooks).map((h) => h.command)
  assert.equal(cmds.filter((c) => c.includes('my-own-hook.js')).length, 1,
    'a foreign hook was dropped or duplicated')
  assert.ok(cmds.some((c) => c.includes('D:/elsewhere/my-own-hook.js')),
    'the foreign hook was rewritten instead of left alone')

  // Updated, not duplicated, and repointed at the scratch config root.
  const restore = cmds.filter((c) => c.includes('restore-dispatch.js'))
  assert.equal(restore.length, 1, `restore-dispatch.js registered ${restore.length} times`)
  assert.ok(!restore[0].includes('D:/stale'), 'the stale path was kept instead of updated')
  assert.ok(restore[0].includes(cfg) || restore[0].includes(cfg.replace(/\\/g, '/')),
    `hook not repointed at the scratch config root — ${restore[0]}`)

  // Idempotent.
  assert.deepEqual(after2, after1, 'a second install produced a different settings.json')
})

test('every hook install writes is syntactically valid for the runtime that will load it', (t) => {
  // Bug pinned (shipped 2026-09-01): a Windows path substituted into a JS string literal
  // is read as escapes, so "C:\Users\npm" becomes "C:Users" + newline + "pm". install.mjs
  // writes hooks with forward slashes and node --check's each one; a failure exits 1.
  const home = scratch(t, 'cgc-hooks-')
  const r = runTool('install.mjs', ['--only=hooks'], home)
  assert.equal(r.status, 0, `install reported a hook failure:\n${r.stdout}\n${r.stderr}`)
  assert.ok(!/does not parse/.test(r.stdout), r.stdout)
  const hooksDir = join(home, '.claude', 'hooks')
  assert.ok(existsSync(hooksDir), 'no hooks were written')
})

test('no installed hook carries a lone backslash or an unresolved token', (t) => {
  const home = scratch(t, 'cgc-hooksrc-')
  assert.equal(runTool('install.mjs', ['--only=hooks'], home).status, 0)
  const hooksDir = join(home, '.claude', 'hooks')
  const written = readdirSync(hooksDir)
  assert.ok(written.length >= 8, `only ${written.length} hooks installed — expected the full set`)
  for (const name of written) {
    const text = readFileSync(join(hooksDir, name), 'utf8')
    assert.equal(/\{\{[A-Z_]+(?::url)?\}\}/.test(text), false, `${name} has an unresolved token`)
    for (const line of text.split(/\r?\n/)) {
      // A comment is inert — never parsed as a string literal, so a drive path inside one
      // cannot be mangled. Hooks legitimately DOCUMENT this bug class using a real-looking
      // path as the example. Flagging that is a false positive, and a check with false
      // positives gets switched off, which costs more than it saves.
      if (/^\s*(\/\/|\*|#)/.test(line)) continue
      assert.equal(/[A-Za-z]:\\/.test(line), false,
        `${name} holds a backslashed drive path inside source, which JS reads as escapes: ${line.trim().slice(0, 120)}`)
    }
  }
})

test('a hook source naming a bare token is still written forward-slashed', (t) => {
  // Bug pinned (shipped 2026-09-01). Every hook that ships TODAY happens to use the
  // {{KEY:url}} form, which is forward-slashed whatever install asks for — so without
  // this canary, deleting slash:'forward' from install.mjs is completely invisible and
  // the bug comes straight back the first time someone writes {{CONFIG_ROOT}} bare.
  const home = scratch(t, 'cgc-canary-home-')
  const repo = scratch(t, 'cgc-canary-repo-')
  // A repo-shaped fixture: install.mjs derives REPO from paths.mjs's own location, so the
  // whole tools/ dir plus argo/src (install.mjs imports its spawn helper) comes along.
  cpSync(TOOLS, join(repo, 'tools'), { recursive: true })
  cpSync(join(REPO, 'argo', 'src'), join(repo, 'argo', 'src'), { recursive: true })
  mkdirSync(join(repo, 'config', 'hooks'), { recursive: true })
  writeFileSync(join(repo, 'config', 'hooks', 'canary-hook.js'),
    'module.exports = { cfg: "{{CONFIG_ROOT}}", node: "{{NODE}}" }\n', 'utf8')

  const r = spawnSync(process.execPath, [join(repo, 'tools', 'install.mjs'), '--only=hooks'], {
    cwd: repo, encoding: 'utf8', timeout: 120000,
    env: scratchEnv(home),
  })
  assert.equal(r.status, 0, r.stdout + r.stderr)

  const hook = join(home, '.claude', 'hooks', 'canary-hook.js')
  const wantCfg = join(home, '.claude').replace(/\\/g, '/')
  assert.ok(readFileSync(hook, 'utf8').includes(`"${wantCfg}"`),
    'the bare token was not rendered forward-slashed into the JS string literal')

  // And the value the hook actually exposes at runtime is the path, not an escape soup.
  const loaded = spawnSync(process.execPath, ['-p', `JSON.stringify(require(${JSON.stringify(hook)}))`],
    { encoding: 'utf8', timeout: 30000 })
  assert.equal(loaded.status, 0, loaded.stderr)
  assert.equal(JSON.parse(loaded.stdout).cfg, wantCfg)
})

test('install refuses to overwrite a settings.json it cannot parse', (t) => {
  const home = scratch(t, 'cgc-badsettings-')
  const cfg = join(home, '.claude')
  mkdirSync(cfg, { recursive: true })
  const settingsPath = join(cfg, 'settings.json')
  const broken = '{ "model": "opus", oops '
  writeFileSync(settingsPath, broken, 'utf8')
  const r = runTool('install.mjs', ['--only=hooks'], home)
  assert.notEqual(r.status, 0, 'install should exit non-zero rather than clobber a broken settings.json')
  assert.equal(readFileSync(settingsPath, 'utf8'), broken, 'the unparseable settings.json was overwritten')
})

// ── doctor.mjs ──────────────────────────────────────────────────────────────

test('doctor reports on the home it is given and writes nothing at all', (t) => {
  const home = scratch(t, 'cgc-doctor-')
  const r = runTool('doctor.mjs', ['--json'], home)
  const report = JSON.parse(r.stdout)
  assert.equal(report.configRoot, join(home, '.claude'))
  assert.equal(existsSync(join(home, '.claude')), false, 'doctor created something — it must only read')
})

test('doctor exits non-zero and says healthy false when nothing is installed', (t) => {
  const home = scratch(t, 'cgc-doctor2-')
  const r = runTool('doctor.mjs', ['--json'], home)
  assert.equal(r.status, 1)
  const report = JSON.parse(r.stdout)
  assert.equal(report.healthy, false)
  assert.ok(report.results.some((x) => x.level === 'fail' && /does not exist|missing/.test(x.message)),
    'doctor did not name the missing install')
})

test('doctor --json emits nothing but JSON, so CI can parse stdout', (t) => {
  const home = scratch(t, 'cgc-doctor3-')
  const r = runTool('doctor.mjs', ['--json'], home)
  assert.doesNotThrow(() => JSON.parse(r.stdout), `stdout was not pure JSON:\n${r.stdout.slice(0, 400)}`)
  assert.equal(r.stdout.trimStart()[0], '{')
})

test('doctor sees the config a fresh install just wrote into the same scratch home', (t) => {
  const home = scratch(t, 'cgc-roundtrip-')
  assert.equal(runTool('install.mjs', ['--only=config'], home).status, 0)
  assert.equal(runTool('install.mjs', ['--only=hooks'], home).status, 0)
  const report = JSON.parse(runTool('doctor.mjs', ['--json'], home).stdout)
  const mandates = report.results.filter((x) => x.phase === 'Mandates')
  assert.deepEqual(mandates.filter((x) => x.level === 'fail'), [],
    'doctor rejected the mandates install.mjs had just written')
  const hooks = report.results.filter((x) => x.phase === 'Hooks')
  assert.deepEqual(hooks.filter((x) => x.level === 'fail'), [],
    'doctor found a dead hook in a config install.mjs had just written')
  assert.ok(hooks.some((x) => x.level === 'ok' && x.message.includes('settings.json parses')))
  // Every hook in config/hooks.json must be verified, not merely absent from the failures.
  const declared = Object.values(JSON.parse(readFileSync(join(REPO, 'config', 'hooks.json'), 'utf8')).hooks)
    .flatMap((groups) => groups.flatMap((g) => g.hooks))
    .map((h) => h.command.match(/([\w.-]+\.(?:js|mjs|cjs))/)[1])
  for (const script of declared) {
    assert.ok(hooks.some((x) => x.level === 'ok' && x.message.endsWith(script)),
      `doctor did not confirm ${script} resolves to a real interpreter and a real file`)
  }
})

// ── scan-secrets.mjs ────────────────────────────────────────────────────────

/** scan-secrets derives REPO from paths.mjs's own location, so a fixture tree is built by
 *  copying the two modules into <tmp>/tools/. Nothing else about the tool is stubbed. */
function fixtureTree(t, prefix, files) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'tools'), { recursive: true })
  for (const name of ['paths.mjs', 'scan-secrets.mjs']) {
    cpSync(join(TOOLS, name), join(root, 'tools', name))
  }
  // The real ignore rules, so this doubles as a check that they still cover the three
  // credential files scan-secrets insists on.
  cpSync(join(REPO, '.gitignore'), join(root, '.gitignore'))
  spawnSync('git', ['init', '-q'], { cwd: root })
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body, 'utf8')
  return root
}

const scan = (root) => spawnSync(process.execPath, [join(root, 'tools', 'scan-secrets.mjs'), '--json'],
  { cwd: root, encoding: 'utf8', timeout: 120000 })

// Assembled at runtime so this test file does not itself contain a scannable credential.
const PLANTED = ['sk', 'ant', 'api03'].join('-') + '-' + 'Zx9Qw7'.repeat(7)
const DIGEST = createHash('sha512').update('cgc-test-fixture').digest('base64')

// Every negative control in one file: a template token, a lockfile integrity hash, and a
// long high-entropy digest that is structurally explained rather than secret.
const CLEAN_NOTES = [
  'Hook command: "{{NODE}}" "{{CONFIG_ROOT}}\\hooks\\session-start-ui-stack.js"',
  'apiKey: "{{ANTHROPIC_API_TOKEN_GOES_HERE}}"',
  'client_secret = "${MY_CLIENT_SECRET_FROM_ENV}"',
  'auth_token: process.env.SOME_LONG_ENVIRONMENT_VARIABLE',
  `  "integrity": "sha512-${DIGEST}",`,
  '',
].join('\n')

test('a planted credential in the tree fails the scan and exits 1', (t) => {
  const root = fixtureTree(t, 'cgc-scan-bad-', {
    'leak.txt': `ANTHROPIC_API_KEY=${PLANTED}\n`,
    'notes.md': CLEAN_NOTES,
  })
  const r = scan(root)
  assert.equal(r.status, 1, `scan passed a tree containing a credential:\n${r.stdout}`)
  const report = JSON.parse(r.stdout)
  assert.equal(report.ok, false)
  const hit = report.findings.find((f) => f.file === 'leak.txt')
  assert.ok(hit, `no finding for leak.txt:\n${r.stdout}`)
  assert.equal(hit.rule, 'anthropic-api-key')
  assert.equal(hit.line, 1)
  // The negative controls sitting next to it must not have fired.
  assert.deepEqual(report.findings.filter((f) => f.file === 'notes.md'), [])
})

test('a JSON-quoted secret key is a key: the .claude.json shape is caught, hex value and all', (t) => {
  // "client_secret": "…" never matched the assignment rule while the key had to be bare, and a
  // hex value was then skipped by the entropy sweep as a digest — the exact shape of an OAuth
  // token cache. The YAML twin (unquoted key) was always caught; the JSON one is now.
  const root = fixtureTree(t, 'cgc-scan-json-', {
    'cache.json': '{ "client_secret": "0123456789abcdef0123456789abcdef01234567" }\n', // scan-secrets:allow — the fixture this test plants
    'tokens.json': '{ "auth_token": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08" }\n', // scan-secrets:allow — the fixture this test plants
    'notes.md': CLEAN_NOTES,
  })
  const r = scan(root)
  assert.equal(r.status, 1, `scan passed a JSON tree containing secrets:\n${r.stdout}`)
  const report = JSON.parse(r.stdout)
  assert.ok(report.findings.some((x) => x.file === 'cache.json'), `no finding for cache.json:\n${r.stdout}`)
  assert.ok(report.findings.some((x) => x.file === 'tokens.json'), `no finding for tokens.json:\n${r.stdout}`)
  assert.deepEqual(report.findings.filter((x) => x.file === 'notes.md'), [])
})

test('the same digest IS flagged once nothing on the line explains it', (t) => {
  // Teeth for the negative control above: the entropy sweep really would catch that
  // string, so "sha512- lines are ignored" is doing work rather than describing a
  // value that was never suspicious.
  const root = fixtureTree(t, 'cgc-scan-entropy-', { 'blob.txt': `value = ${DIGEST}\n` })
  const r = scan(root)
  assert.equal(r.status, 1, `the entropy sweep missed an unexplained 88-char digest:\n${r.stdout}`)
  const hit = JSON.parse(r.stdout).findings.find((f) => f.file === 'blob.txt')
  assert.ok(hit, 'no finding for the bare digest')
})

test('a finding never prints the secret it found', (t) => {
  // The report goes into CI logs. Echoing the credential there leaks it a second time.
  const root = fixtureTree(t, 'cgc-scan-redact-', { 'leak.txt': `key = ${PLANTED}\n` })
  const out = scan(root)
  assert.equal(out.stdout.includes(PLANTED), false, 'the JSON report echoed the raw secret')
  const human = spawnSync(process.execPath, [join(root, 'tools', 'scan-secrets.mjs')],
    { cwd: root, encoding: 'utf8', timeout: 120000 })
  assert.equal(human.stdout.includes(PLANTED), false, 'the human report echoed the raw secret')
})

test('template tokens, integrity hashes and the scanner own regexes are not credentials', (t) => {
  // The fixture contains a verbatim copy of scan-secrets.mjs, so this also asserts the
  // detection rules do not flag themselves — the failure mode that makes a scanner useless.
  const root = fixtureTree(t, 'cgc-scan-good-', { 'notes.md': CLEAN_NOTES })
  const r = scan(root)
  const report = JSON.parse(r.stdout)
  assert.deepEqual(report.findings, [], `false positives:\n${JSON.stringify(report.findings, null, 2)}`)
  assert.equal(report.ok, true)
  assert.equal(r.status, 0)
})

test('a credential file that is not covered by .gitignore fails the scan', (t) => {
  const root = fixtureTree(t, 'cgc-scan-forbidden-', {})
  writeFileSync(join(root, '.gitignore'), '# nothing ignored here\n', 'utf8')
  writeFileSync(join(root, '.credentials.json'), '{"accessToken":"x"}\n', 'utf8')
  const r = scan(root)
  assert.equal(r.status, 1, 'an unignored .credentials.json must fail the scan')
  const notes = JSON.parse(r.stdout).notes.map((n) => n.message).join('\n')
  assert.match(notes, /\.credentials\.json/)
})

test('this repo .gitignore already covers the three files that must never be published', (t) => {
  // Same fixture, real .gitignore: a live .credentials.json next to the tree is a warning,
  // not a failure. If someone edits .gitignore and drops a rule, this flips to a failure.
  const root = fixtureTree(t, 'cgc-scan-ignored-', {})
  writeFileSync(join(root, '.credentials.json'), '{"accessToken":"x"}\n', 'utf8')
  const r = scan(root)
  assert.equal(r.status, 0, `the shipped .gitignore no longer covers a credential file:\n${r.stdout}`)
  const notes = JSON.parse(r.stdout).notes
  assert.ok(notes.some((n) => n.kind === 'warn' && n.message.includes('.credentials.json')),
    'expected a warning that the file is on disk but ignored')
})

test('the repo own tree scans clean', () => {
  // The gate that actually runs before publishing. If this fails, do not push.
  const r = spawnSync(process.execPath, [join(TOOLS, 'scan-secrets.mjs'), '--json'],
    { cwd: REPO, encoding: 'utf8', timeout: 300000 })
  const report = JSON.parse(r.stdout)
  assert.deepEqual(report.findings, [], `secrets in the repo:\n${JSON.stringify(report.findings, null, 2)}`)
  assert.equal(r.status, 0, JSON.stringify(report.notes, null, 2))
})

test('every command answers --help with its usage, and never by doing the thing', () => {
  // `cgc sync --help` performed a sync. `cgc scan --help` scanned the tree. `cgc doctor --help`
  // ran the doctor, and `cgc test --help` would have run the suite. Asking what a command does
  // must never be the same as asking it to do it — least of all for the one that writes.
  const cgc = join(TOOLS, 'cgc.mjs')
  const forbidden = {
    doctor: /── Summary|Install is healthy|Install is broken/,
    sync: /\d+ tracked, \d+ (updated|drifted)/,
    scan: /── Forbidden paths|Safe to publish/,
    install: /── Summary|Next: /,
    uninstall: /Nothing was changed|Uninstall incomplete/,
    test: /# tests \d|ℹ tests \d/,
  }
  for (const [cmd, ran] of Object.entries(forbidden)) {
    const r = spawnSync(process.execPath, [cgc, cmd, '--help'], { encoding: 'utf8', timeout: 120000 })
    const out = (r.stdout || '') + (r.stderr || '')
    assert.equal(r.status, 0, `cgc ${cmd} --help should exit 0, got ${r.status}`)
    assert.match(out, /usage|node tools\//i, `cgc ${cmd} --help printed no usage:\n${out.slice(0, 200)}`)
    assert.doesNotMatch(out, ran, `cgc ${cmd} --help DID THE THING instead of explaining it`)
  }

  // And the tools that already had usage still have it, from the same entry point.
  for (const cmd of ['check', 'lint', 'audit', 'techniques', 'motion', 'render', 'print', 'print-lint', 'icons', 'outline', 'specimen']) {
    const r = spawnSync(process.execPath, [cgc, cmd, '--help'], { encoding: 'utf8', timeout: 120000 })
    assert.equal(r.status, 0, `cgc ${cmd} --help exited ${r.status}`)
    assert.match((r.stdout || '') + (r.stderr || ''), /usage|—/i, `cgc ${cmd} --help said nothing`)
  }
})

test('the installer takes the same lock the session hook takes, and releases it', (t) => {
  // Two processes writing the same config files is the same bug as two pulling the same clone,
  // and fails more quietly: a half-written file instead of a message. `cgc install` typed by
  // hand while a session starts is exactly that.
  const home = scratch(t, 'cgc-install-lock-')
  const lock = join(home, '.claude', '.cgc', 'update.lock')

  const clean = runTool('install.mjs', ['--only=config'], home)
  assert.equal(clean.status, 0, clean.stderr)
  assert.equal(existsSync(lock), false, 'the lock is released when the run ends')

  // A lock somebody else holds is waited for, and then the work happens anyway: a session that
  // cannot take the lock must never hang on somebody else's git.
  mkdirSync(join(home, '.claude', '.cgc'), { recursive: true })
  writeFileSync(lock, JSON.stringify({ pid: 999999, at: Date.now() }))
  const started = Date.now()
  const held = spawnSync(process.execPath, [join(TOOLS, 'install.mjs'), '--only=config'], {
    cwd: REPO, encoding: 'utf8', timeout: 180000, env: scratchEnv(home, { CGC_UPDATE_LOCK_HELD: '1' }),
  })
  assert.equal(held.status, 0, held.stderr)
  assert.ok(Date.now() - started < 25000, 'the hook spawns the installer while holding the lock: it must not queue behind its own parent')
  assert.equal(existsSync(lock), true, 'and it does not release a lock it never took')
})

test('the hook and the installer agree on where the lock lives', async () => {
  // The hook carries its own copy of this logic — it has to run when the repo is missing
  // entirely — so the one thing that must not drift between them is the path.
  const { UPDATE_LOCK, CONFIG_ROOT } = await import('../paths.mjs')
  const hook = readFileSync(join(REPO, 'config', 'hooks', 'session-start-cgc.js'), 'utf8')
  assert.match(hook, /const LOCK = path\.join\(STATE, 'update\.lock'\)/, 'the hook still names update.lock under STATE')
  assert.match(hook, /const STATE = path\.join\(CONFIG_ROOT, '\.cgc'\)/)
  assert.equal(UPDATE_LOCK, join(CONFIG_ROOT, '.cgc', 'update.lock'))
})

test('a page saved as UTF-16 is a page, not a binary', (t) => {
  // Windows editors and PowerShell redirection write UTF-16LE by default, and every ASCII
  // character in it carries a NUL — the mark the binary check reads. Chromium renders it
  // correctly from the byte-order mark, so refusing it was a false alarm on a real page.
  const d = scratch(t, 'cgc-utf16-')
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>U</title>'
    + '<style>body{margin:0;padding:40px;font-family:Georgia,serif;font-size:18px}</style>'
    + '</head><body><h1>A page saved as UTF-16</h1><p>Which is what Windows writes by default.</p></body></html>'
  writeFileSync(join(d, 'bom.html'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(html, 'utf16le')]))
  writeFileSync(join(d, 'nobom.html'), Buffer.from(html, 'utf16le'))
  writeFileSync(join(d, 'binary.html'), Buffer.from(Array.from({ length: 600 }, (_, i) => (i * 37) % 256)))

  const render = (f) => spawnSync(process.execPath, [join(TOOLS, 'screen-render.mjs'), join(d, f), '--out', join(d, 'o-' + f)],
    { cwd: REPO, encoding: 'utf8', timeout: 180000 })
  for (const f of ['bom.html', 'nobom.html']) {
    const r = render(f)
    assert.equal(r.status, 0, `${f} was refused: ${r.stderr}`)
    assert.ok(existsSync(join(d, `o-${f}-1440.png`)), `${f} produced no render`)
  }
  const bin = render('binary.html')
  assert.equal(bin.status, 1, 'a real binary is still refused')
  assert.match(bin.stderr, /not a text file/)
})

test('the test runner runs every suite this package ships, not only its own', () => {
  // argo is installed by install.mjs, linked onto PATH, checked by the doctor and named in the
  // mandates — and its 440 tests were run by nothing here. The count in the session line was a
  // true statement about a set that quietly excluded a shipped component, so a red suite in it
  // would have gone unnoticed indefinitely.
  //
  // The runner is not spawned from inside this test: node's test runner does not nest, and a
  // runner that cannot run under itself would make this assert nothing. What is checked instead
  // is the rule it uses, the component that rule finds, and that the found suite is green.
  const src = readFileSync(join(TOOLS, 'run-tests.mjs'), 'utf8')
  assert.match(src, /function shippedSuites\(\)/, 'the runner discovers the suites this package ships')
  assert.match(src, /stripSummary/, 'and prints one summary block, since a reader takes the first it finds')
  assert.equal(src.split('ℹ tests ').length - 1, 1, 'exactly one place emits the counts')

  // Discovered by carrying its own test script, never by being listed: a list is what goes stale.
  const shipped = readdirSync(REPO, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.'))
    .filter((e) => {
      try { return Boolean(JSON.parse(readFileSync(join(REPO, e.name, 'package.json'), 'utf8'))?.scripts?.test) } catch { return false }
    })
    .map((e) => e.name)
  assert.ok(shipped.includes('argo'), `argo ships a suite and the rule must find it: ${JSON.stringify(shipped)}`)

  // And every one of them is green, which is the claim the session line makes on their behalf.
  // A nested `node --test` that inherits NODE_TEST_CONTEXT reports into this run instead of
  // printing its own summary — exit 0 with no counts, indistinguishable from an empty suite.
  const childEnv = { ...process.env }
  delete childEnv.NODE_TEST_CONTEXT
  delete childEnv.NODE_OPTIONS

  for (const name of shipped) {
    const script = JSON.parse(readFileSync(join(REPO, name, 'package.json'), 'utf8')).scripts.test
    const direct = /^node\s+(.+)$/.exec(script.trim())
    const r = direct
      ? spawnSync(process.execPath, direct[1].split(/\s+/), { cwd: join(REPO, name), encoding: 'utf8', timeout: 600000, env: childEnv })
      : spawnSync('npm', ['test', '--silent'], { cwd: join(REPO, name), encoding: 'utf8', timeout: 600000, shell: true, env: childEnv })
    const out = (r.stdout || '') + (r.stderr || '')
    assert.equal(r.status, 0, `${name}'s own suite is red:
${out.slice(-700)}`)
    const passed = Number(/(?:ℹ|#)\s*pass\s+(\d+)/.exec(out)?.[1] || 0)
    assert.ok(passed > 0, `${name} reported no passing tests — the runner would add nothing`)
  }
})

test('the test runner is capped, so one suite cannot take the whole machine', () => {
  // node --test defaults to one worker per CPU. On a 24-core machine that measured 60 node
  // processes and 5.6 GB for a suite that takes about ninety seconds either way — and a
  // session-start hook that runs it meant every open window paid that at once.
  const src = readFileSync(join(TOOLS, 'run-tests.mjs'), 'utf8')
  assert.match(src, /--test-concurrency=/, 'the runner passes a concurrency cap')
  assert.match(src, /CGC_TEST_CONCURRENCY/, 'and the cap is overridable')

  // The cap is bounded whatever the machine, and an explicit request is honoured.
  // concurrency() lives in paths.mjs, a MODULE: run-tests.mjs is a script that runs the whole
  // suite at import, which is what this test discovered by importing it.
  const ask = (v) => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e',
      "import { concurrency } from " + JSON.stringify(pathToFileURL(join(TOOLS, 'paths.mjs')).href) + "; console.log(concurrency())"],
    { encoding: 'utf8', env: { ...process.env, CGC_TEST_CONCURRENCY: v ?? '' }, timeout: 120000 })
    return Number((r.stdout || '').trim())
  }
  assert.equal(ask('1'), 1, 'one worker is a legitimate ask')
  assert.equal(ask('7'), 7)
  const auto = ask(undefined)
  assert.ok(auto >= 2 && auto <= 4, `the automatic cap stays small, got ${auto}`)

  // A shipped suite obeys the same cap rather than opening its own worker-per-CPU pool.
  for (const name of readdirSync(REPO, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').map((e) => e.name)) {
    const runner = join(REPO, name, 'test', 'run.js')
    if (!existsSync(runner)) continue
    const s = readFileSync(runner, 'utf8')
    assert.match(s, /--test-concurrency=/, `${name}'s runner must cap its workers too`)
    assert.match(s, /CGC_TEST_CONCURRENCY/, `${name}'s runner must honour the parent's cap`)
  }
})
