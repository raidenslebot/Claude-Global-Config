// Behavioural tests for sync.mjs, run hermetically on BOTH sides.
//
// sync copies live -> repo, and derives REPO from paths.mjs's own location. Pointed at this
// checkout it would rewrite config/ with whatever the scratch home holds, so every test also
// gets a scratch REPO: tools/paths.mjs and tools/sync.mjs copied into <tmp>/tools/, the same
// fixture shape cli.test.mjs uses for scan-secrets. HOME and USERPROFILE go to a scratch
// home, as everywhere else.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, cpSync, utimesSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

/** A scratch directory, torn down after the test whether or not it passed. */
function scratch(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** A repo-shaped fixture with an empty config/. */
function fixtureRepo(t) {
  const repo = scratch(t, 'cgc-sync-repo-')
  mkdirSync(join(repo, 'tools'), { recursive: true })
  mkdirSync(join(repo, 'config'), { recursive: true })
  for (const name of ['paths.mjs', 'sync.mjs']) cpSync(join(TOOLS, name), join(repo, 'tools', name))
  return repo
}

/** A live ~/.claude with an empty hooks/ inside a scratch home. */
function fixtureHome(t) {
  const home = scratch(t, 'cgc-sync-home-')
  const cfg = join(home, '.claude')
  mkdirSync(join(cfg, 'hooks'), { recursive: true })
  return { home, cfg }
}

function runSync(repo, home, args = []) {
  const r = spawnSync(process.execPath, [join(repo, 'tools', 'sync.mjs'), ...args], {
    cwd: repo, encoding: 'utf8', timeout: 60000,
    env: scratchEnv(home),
  })
  const m = (r.stdout || '').match(/(\d+) tracked, (\d+) (?:updated|drifted)/)
  r.tracked = m ? Number(m[1]) : NaN
  r.changed = m ? Number(m[2]) : NaN
  return r
}

/** Either slash form of a token: forward-form paths templatize to {{KEY:url}}. */
const TOKEN = (key) => new RegExp(`\\{\\{${key}(?::url)?\\}\\}`)

test('live -> repo replaces this machine paths with tokens', (t) => {
  const repo = fixtureRepo(t)
  const { home, cfg } = fixtureHome(t)
  writeFileSync(join(cfg, 'CLAUDE.md'),
    `# rules\nhooks live in ${cfg}\nthe interpreter is ${process.execPath}\n`, 'utf8')

  const r = runSync(repo, home)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(r.changed >= 1, r.stdout)
  const out = readFileSync(join(repo, 'config', 'CLAUDE.md'), 'utf8')
  assert.match(out, TOKEN('CONFIG_ROOT'), out)
  assert.match(out, TOKEN('NODE'), out)
  assert.equal(out.includes(cfg), false, 'the live config root leaked into the repo copy')
  assert.equal(out.includes(home), false, 'the home path leaked into the repo copy')
  assert.equal(out.includes(process.execPath), false, 'the node path leaked into the repo copy')
})

test('a second sync finds nothing to update', (t) => {
  const repo = fixtureRepo(t)
  const { home, cfg } = fixtureHome(t)
  writeFileSync(join(cfg, 'CLAUDE.md'), `# rules\nhooks live in ${cfg}\n`, 'utf8')
  writeFileSync(join(cfg, 'hooks', 'repo-owned.js'), `const HOME = "${join(cfg, 'hooks').replace(/\\/g, '/')}"\n`, 'utf8')
  writeFileSync(join(cfg, 'settings.json'), JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: 'command', command: `"${process.execPath}" "${join(cfg, 'hooks', 'repo-owned.js')}"` }] }] },
  }), 'utf8')

  const first = runSync(repo, home)
  assert.equal(first.status, 0, first.stdout + first.stderr)
  assert.equal(first.changed, 3, `expected CLAUDE.md, the hook and hooks.json to sync:\n${first.stdout}`)
  const second = runSync(repo, home)
  assert.equal(second.status, 0, second.stdout + second.stderr)
  assert.equal(second.changed, 0, `a second sync still found drift:\n${second.stdout}`)
  assert.equal(second.tracked, first.tracked)
})

test('--check exits 1 on drift and writes nothing, then 0 once the repo is current', (t) => {
  const repo = fixtureRepo(t)
  const { home, cfg } = fixtureHome(t)
  writeFileSync(join(cfg, 'CLAUDE.md'), '# rules\n', 'utf8')
  writeFileSync(join(cfg, 'settings.json'), '{"hooks":{}}\n', 'utf8')

  const drift = runSync(repo, home, ['--check'])
  assert.equal(drift.status, 1, `--check passed a repo that is behind:\n${drift.stdout}`)
  assert.match(drift.stdout, /DRIFT/)
  assert.ok(drift.changed >= 1, drift.stdout)
  assert.deepEqual(readdirSync(join(repo, 'config')), [], '--check wrote into the repo')

  assert.equal(runSync(repo, home).status, 0)
  const clean = runSync(repo, home, ['--check'])
  assert.equal(clean.status, 0, clean.stdout + clean.stderr)
  assert.equal(clean.changed, 0)
})

test('a repo file newer than the live one is refused, not overwritten', (t) => {
  const repo = fixtureRepo(t)
  const { home, cfg } = fixtureHome(t)
  const authored = '# authored in the repo, not yet installed\n'
  writeFileSync(join(cfg, 'CLAUDE.md'), '# edited live, earlier\n', 'utf8')
  const old = (Date.now() - 3600_000) / 1000
  utimesSync(join(cfg, 'CLAUDE.md'), old, old)
  writeFileSync(join(repo, 'config', 'CLAUDE.md'), authored, 'utf8')

  const r = runSync(repo, home)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /NEWER than the live file/)
  assert.equal(readFileSync(join(repo, 'config', 'CLAUDE.md'), 'utf8'), authored, 'the authored repo edit was reverted')
  assert.equal(r.changed, 0)
})

test('hooks whose canonical home is argo/ or a skill are not copied into config/hooks', (t) => {
  const repo = fixtureRepo(t)
  const { home, cfg } = fixtureHome(t)
  const pluginDir = join(repo, 'argo', 'plugin', 'hooks')
  const skillDir = join(repo, 'skills', 'visual-design-mastery', 'hooks')
  mkdirSync(pluginDir, { recursive: true })
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(pluginDir, 'plugin-owned.js'), '// canonical copy\n', 'utf8')
  writeFileSync(join(skillDir, 'skill-owned.js'), '// canonical copy\n', 'utf8')
  // install.mjs gathered all three into the one live directory.
  for (const f of ['plugin-owned.js', 'skill-owned.js', 'repo-owned.js']) {
    writeFileSync(join(cfg, 'hooks', f), `// live ${f}\n`, 'utf8')
  }

  const r = runSync(repo, home)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(readdirSync(join(repo, 'config', 'hooks')), ['repo-owned.js'],
    'a hook with a home elsewhere in the repo was given a second one')
})

test('an absolute hook path from any platform normalises to {{CONFIG_ROOT:url}}/hooks/', (t) => {
  const repo = fixtureRepo(t)
  const { home, cfg } = fixtureHome(t)
  writeFileSync(join(cfg, 'settings.json'), JSON.stringify({
    model: 'opus',
    permissions: { allow: ['Bash(ls:*)'] },
    hooks: {
      UserPromptSubmit: [{ hooks: [
        { type: 'command', command: '"C:\\Users\\someone\\.claude\\hooks\\win-hook.js"', timeout: 10 },
        { type: 'command', command: '"C:/Users/someone/plugins/fwd-hook.js"', timeout: 10 },
        { type: 'command', command: '"/home/someone/.claude/hooks/posix-hook.js"', timeout: 10 },
        { type: 'command', command: `"${process.execPath}" "${join(cfg, 'hooks', 'local-hook.js')}"`, timeout: 10 },
      ] }],
      PostToolUse: [{ matcher: 'Write|Edit', hooks: [
        { type: 'command', command: '"/Users/someone/Library/scoped-hook.mjs"' },
      ] }],
    },
  }, null, 2), 'utf8')

  const r = runSync(repo, home)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const text = readFileSync(join(repo, 'config', 'hooks.json'), 'utf8')
  const doc = JSON.parse(text)
  assert.deepEqual(Object.keys(doc), ['hooks'], 'settings other than hooks leaked into the repo')

  const [win, fwd, posix, local] = doc.hooks.UserPromptSubmit[0].hooks.map((h) => h.command)
  assert.equal(win, '"{{CONFIG_ROOT:url}}/hooks/win-hook.js"')
  assert.equal(fwd, '"{{CONFIG_ROOT:url}}/hooks/fwd-hook.js"')
  assert.equal(posix, '"{{CONFIG_ROOT:url}}/hooks/posix-hook.js"')
  assert.match(local, /^"\{\{NODE(?::url)?\}\}" "\{\{CONFIG_ROOT:url\}\}\/hooks\/local-hook\.js"$/)
  assert.deepEqual(doc.hooks.PostToolUse[0],
    { matcher: 'Write|Edit', hooks: [{ type: 'command', command: '"{{CONFIG_ROOT:url}}/hooks/scoped-hook.mjs"' }] })
  assert.equal(doc.hooks.UserPromptSubmit[0].hooks[0].timeout, 10, 'hook fields other than command were dropped')
  assert.equal(/someone/.test(text), false, `a machine path survived into hooks.json:\n${text}`)
})
