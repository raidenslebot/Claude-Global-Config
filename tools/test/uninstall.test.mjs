// Behavioural tests for uninstall.mjs — the one tool that DELETES — run hermetically.
//
// HARD RULE, as in cli.test.mjs: every child gets USERPROFILE and HOME pointed at a scratch
// directory, because paths.mjs derives CONFIG_ROOT from os.homedir(). Here it is stricter
// still: PATH points at an empty directory too. uninstall shells out to `claude plugin
// uninstall` and `npm unlink -g`, and run for real those remove the developer's ACTUAL
// plugin and CLI link. Every live run proves the isolation took before it spawns.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync,
  lstatSync, symlinkSync, readlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { REPO, IS_WIN } from '../paths.mjs'
import { onPath } from '../../argo/src/spawn.js'

const TOOLS = join(REPO, 'tools')
const WHICH = IS_WIN ? 'where' : 'which'

// What uninstall.mjs derives its removal list from, read the same way it does, so the
// fixture follows the repo instead of naming files that may be renamed later.
const MANDATES = readdirSync(join(REPO, 'config')).filter((f) => f.endsWith('.md'))
const OWNED_HOOKS = readdirSync(join(REPO, 'config', 'hooks')).filter((f) => /\.(js|mjs|cjs)$/.test(f))
const OWNED_SKILLS = readdirSync(join(REPO, 'skills')).filter((n) => existsSync(join(REPO, 'skills', n, 'SKILL.md')))

const MARK = '<!-- user-additions-below -->'
const MINE = `${MARK}\n\n## My own rules\nnever touch this line\n`
const FOREIGN_HOOK = 'my-own-hook.js'
const FOREIGN_SKILL = 'my-own-skill'
const FOREIGN_MCP = 'my-own-server'
const LINK_TARGET_BODY = '# the source repo behind the link\n'

/** A scratch HOME, torn down after the test whether or not it passed. */
function scratch(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** The child env: HOME redirected AND PATH pointing at nothing. Filter rather than delete
 *  the key: on Windows it is spelled "Path", and a second "PATH" beside it is ambiguous. An
 *  empty directory rather than no key at all: libuv copies the parent's PATH into a child
 *  env that lacks one, which would silently undo the isolation. */
function isolatedEnv(home) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^path$/i.test(k)))
  return { ...env, HOME: home, USERPROFILE: home, PATH: join(home, 'empty-path') }
}

/** Proof the isolation holds, via the two lookups uninstall.mjs actually performs. */
function assertIsolated(env) {
  assert.equal(onPath('npm', env), null, 'npm is still reachable through the child PATH')
  const w = spawnSync(WHICH, ['node'], { encoding: 'utf8', env, cwd: REPO })
  assert.notEqual(w.status, 0, `${WHICH} still resolves through the child PATH`)
}

function runUninstall(args, home) {
  const env = isolatedEnv(home)
  if (args.includes('--yes')) assertIsolated(env)
  const r = spawnSync(process.execPath, [join(TOOLS, 'uninstall.mjs'), ...args], {
    cwd: REPO, encoding: 'utf8', timeout: 180000, env,
  })
  r.plain = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '')
  return r
}

/** A home that looks like install.mjs ran on it, plus one foreign item of every kind
 *  uninstall touches, plus the files it must never touch. */
function seedInstall(home) {
  const cfg = join(home, '.claude')
  const hooks = join(cfg, 'hooks'), skills = join(cfg, 'skills')
  for (const d of [hooks, skills, join(cfg, 'projects', 'p1'), join(cfg, 'todos')]) mkdirSync(d, { recursive: true })

  for (const name of MANDATES) writeFileSync(join(cfg, name), `# generated ${name}\n`, 'utf8')
  writeFileSync(join(cfg, 'CLAUDE.md'), `# generated CLAUDE.md\n\n${MINE}`, 'utf8')

  for (const f of [...OWNED_HOOKS, FOREIGN_HOOK]) writeFileSync(join(hooks, f), `// ${f}\n`, 'utf8')

  const cmd = (f) => `"${process.execPath}" "${cfg.replace(/\\/g, '/')}/hooks/${f}"`
  writeFileSync(join(cfg, 'settings.json'), JSON.stringify({
    model: 'opus',
    permissions: { allow: ['Bash(ls:*)'] },
    hooks: {
      UserPromptSubmit: [{ hooks: [
        { type: 'command', command: cmd(OWNED_HOOKS[0]), timeout: 10 },
        { type: 'command', command: `node "D:/elsewhere/${FOREIGN_HOOK}"`, timeout: 42 },
      ] }],
      // A group holding only our hook: emptied by us, so it must be pruned, not left a husk.
      Stop: [{ hooks: [{ type: 'command', command: cmd(OWNED_HOOKS[1]), timeout: 15 }] }],
    },
  }, null, 2) + '\n', 'utf8')
  writeFileSync(join(cfg, 'settings.local.json'), '{ "permissions": { "allow": ["Bash(git:*)"] } }\n', 'utf8')

  writeFileSync(join(cfg, '.credentials.json'), '{"accessToken":"x"}\n', 'utf8')
  writeFileSync(join(cfg, 'history.jsonl'), '{"display":"hello"}\n', 'utf8')
  writeFileSync(join(cfg, 'projects', 'p1', 'session.jsonl'), '{"type":"user"}\n', 'utf8')
  writeFileSync(join(cfg, 'todos', 'list.json'), '[]\n', 'utf8')

  // Skills: one of ours as a LINK (what install.mjs makes), one of ours as a REAL directory
  // (the copy fallback — or a skill the user wrote under the same name), one foreign directory.
  const target = join(home, 'skill-source', OWNED_SKILLS[0])
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'SKILL.md'), LINK_TARGET_BODY, 'utf8')
  symlinkSync(target, join(skills, OWNED_SKILLS[0]), IS_WIN ? 'junction' : 'dir')
  for (const name of [OWNED_SKILLS[1], FOREIGN_SKILL]) {
    mkdirSync(join(skills, name))
    writeFileSync(join(skills, name, 'SKILL.md'), `# ${name}, a real directory\n`, 'utf8')
  }

  // MCP identity is WHERE the entry lives, so the owned one points into the repo.
  writeFileSync(join(home, '.claude.json'), JSON.stringify({
    numStartups: 7,
    mcpServers: {
      playwright: {
        command: process.execPath,
        args: [join(REPO, 'library', 'mcp-servers', 'node_modules', '@playwright', 'mcp', 'cli.js')],
        env: {},
      },
      [FOREIGN_MCP]: { command: 'node', args: ['D:/elsewhere/server.js'], env: {} },
    },
  }, null, 2) + '\n', 'utf8')

  return { cfg, hooks, skills, target }
}

/** Content-addressed listing of a tree. A link records its target, never its contents. */
function snapshot(root) {
  const out = []
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name), r = `${rel}${name}`
      const st = lstatSync(p)
      if (st.isSymbolicLink()) out.push(`${r} -> ${readlinkSync(p)}`)
      else if (st.isDirectory()) { out.push(`${r}/`); walk(p, `${r}/`) }
      else out.push(`${r} ${createHash('sha256').update(readFileSync(p)).digest('hex')}`)
    }
  }
  if (existsSync(root)) walk(root, '')
  return out
}

test('the fixture has what it needs from the repo', () => {
  assert.ok(OWNED_HOOKS.length >= 2, 'need two hooks in config/hooks')
  assert.ok(OWNED_SKILLS.length >= 2, 'need two skills with a SKILL.md in skills/')
})

test('the child env hides npm and the claude CLI, so no run here can reach the real plugin', (t) => {
  assertIsolated(isolatedEnv(scratch(t, 'cgc-uninstall-iso-')))
})

test('dry run is the default: no flag prints the plan and writes nothing', (t) => {
  const home = scratch(t, 'cgc-uninstall-dry-')
  const { cfg, hooks, skills } = seedInstall(home)
  const settingsBefore = readFileSync(join(cfg, 'settings.json'))
  const before = snapshot(home)

  const r = runUninstall([], home)
  assert.equal(r.status, 0, r.plain)
  assert.ok(r.plain.includes('DRY RUN'), r.plain)
  assert.ok(r.plain.includes(cfg), 'uninstall did not report the scratch target')
  // The plan names what a live run would remove — the opt-in is only meaningful if it does.
  assert.ok(r.plain.includes(`would hooks/${OWNED_HOOKS[0]}`), r.plain)
  assert.ok(r.plain.includes('would mcp server playwright'), r.plain)

  assert.ok(readFileSync(join(cfg, 'settings.json')).equals(settingsBefore), 'dry run rewrote settings.json')
  assert.deepEqual(readdirSync(hooks).sort(), [...OWNED_HOOKS, FOREIGN_HOOK].sort())
  assert.deepEqual(readdirSync(skills).sort(), [OWNED_SKILLS[0], OWNED_SKILLS[1], FOREIGN_SKILL].sort())
  assert.deepEqual(snapshot(home), before, 'dry run changed something under the scratch home')
  assert.equal(existsSync(join(home, '.claude-uninstall-backup')), false, 'dry run wrote a backup')
})

test('--yes removes only what the repo installed and leaves every foreign item in place', (t) => {
  const home = scratch(t, 'cgc-uninstall-yes-')
  const { cfg, hooks, skills, target } = seedInstall(home)
  const local = readFileSync(join(cfg, 'settings.local.json'))

  const r = runUninstall(['--yes'], home)
  assert.equal(r.status, 0, r.plain)
  assert.ok(r.plain.includes('LIVE RUN'), r.plain)

  // Hooks: ours gone; the foreign file, and therefore the directory, kept.
  assert.deepEqual(readdirSync(hooks), [FOREIGN_HOOK])

  // settings.json: only our registrations removed.
  const s = JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8'))
  assert.equal(s.model, 'opus', 'an unrelated top-level setting was dropped')
  assert.deepEqual(s.permissions, { allow: ['Bash(ls:*)'] }, 'unrelated permissions were dropped')
  assert.deepEqual(s.hooks.UserPromptSubmit,
    [{ hooks: [{ type: 'command', command: `node "D:/elsewhere/${FOREIGN_HOOK}"`, timeout: 42 }] }])
  assert.equal('Stop' in s.hooks, false, 'a group we emptied was left as a husk')
  assert.ok(readFileSync(join(cfg, 'settings.local.json')).equals(local), 'settings.local.json was touched')

  // Mandates: ours gone; CLAUDE.md cut back to the user's own section, not deleted.
  for (const name of MANDATES.filter((n) => n !== 'CLAUDE.md')) {
    assert.equal(existsSync(join(cfg, name)), false, `${name} survived`)
  }
  assert.equal(readFileSync(join(cfg, 'CLAUDE.md'), 'utf8'), MINE)

  // Skills: our link removed WITHOUT following it; the foreign directory untouched.
  assert.equal(existsSync(join(skills, OWNED_SKILLS[0])), false, 'our skill link survived')
  assert.equal(readFileSync(join(target, 'SKILL.md'), 'utf8'), LINK_TARGET_BODY,
    'removing the link destroyed its target')
  assert.equal(readFileSync(join(skills, FOREIGN_SKILL, 'SKILL.md'), 'utf8'), `# ${FOREIGN_SKILL}, a real directory\n`)

  // MCP: matched on location, not name — the foreign server and every other key survive.
  const mcp = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'))
  assert.equal(mcp.numStartups, 7)
  assert.deepEqual(Object.keys(mcp.mcpServers), [FOREIGN_MCP])

  // The two steps that would reach outside the scratch home were skipped, not run.
  assert.match(r.plain, /^\s+warn\s+claude CLI not found/m)
  assert.match(r.plain, /^\s+warn\s+npm unlink -g \S+ failed/m)
  assert.doesNotMatch(r.plain, /^\s+ok\s+(?:plugin|marketplace|global npm link) /m)
})

test('a skills entry that is a real directory is refused, never deleted', (t) => {
  const home = scratch(t, 'cgc-uninstall-realdir-')
  const { skills } = seedInstall(home)
  const r = runUninstall(['--yes'], home)
  assert.equal(r.status, 0, r.plain)
  assert.ok(r.plain.includes(`${OWNED_SKILLS[1]}: a real directory, not one of our links`), r.plain)
  assert.equal(readFileSync(join(skills, OWNED_SKILLS[1], 'SKILL.md'), 'utf8'),
    `# ${OWNED_SKILLS[1]}, a real directory\n`)
  assert.equal(existsSync(skills), true, 'skills/ was removed while it still held user data')
})

test('protected files survive --yes byte for byte', (t) => {
  const home = scratch(t, 'cgc-uninstall-protected-')
  const { cfg } = seedInstall(home)
  const PROTECTED = ['.credentials.json', 'history.jsonl', join('projects', 'p1', 'session.jsonl'), join('todos', 'list.json')]
  const before = PROTECTED.map((p) => readFileSync(join(cfg, p)))
  const r = runUninstall(['--yes'], home)
  assert.equal(r.status, 0, r.plain)
  PROTECTED.forEach((p, i) => {
    assert.ok(existsSync(join(cfg, p)), `${p} was removed`)
    assert.ok(readFileSync(join(cfg, p)).equals(before[i]), `${p} was modified`)
  })
})

test('a second --yes changes nothing and exits 0', (t) => {
  const home = scratch(t, 'cgc-uninstall-idem-')
  seedInstall(home)
  assert.equal(runUninstall(['--yes'], home).status, 0)
  const before = snapshot(join(home, '.claude'))
  const claudeJson = readFileSync(join(home, '.claude.json'))

  const r = runUninstall(['--yes'], home)
  assert.equal(r.status, 0, r.plain)
  assert.doesNotMatch(r.plain, /^\s+FAIL/m)
  assert.ok(r.plain.includes('Removed (0)'), r.plain)
  assert.deepEqual(snapshot(join(home, '.claude')), before, 'the second run changed ~/.claude')
  assert.ok(readFileSync(join(home, '.claude.json')).equals(claudeJson), 'the second run rewrote .claude.json')
})

test('backups land outside both ~/.claude and the repo, and hold the pre-run bytes', (t) => {
  const home = scratch(t, 'cgc-uninstall-backup-')
  const { cfg } = seedInstall(home)
  const settingsBefore = readFileSync(join(cfg, 'settings.json'))
  const r = runUninstall(['--yes'], home)
  assert.equal(r.status, 0, r.plain)

  const dir = join(home, '.claude-uninstall-backup')
  assert.ok(existsSync(dir), 'no backup directory was written')
  assert.ok(r.plain.includes(dir), 'the summary does not name the backup directory')
  for (const root of [cfg, REPO]) {
    assert.equal(dir.startsWith(root + sep), false, `backups sit under ${root}, where rm -rf would take them`)
  }
  const files = readdirSync(dir)
  const settingsBak = files.find((f) => /^settings\.json\..*\.bak$/.test(f))
  assert.ok(settingsBak, `no settings.json backup among: ${files.join(', ')}`)
  assert.ok(readFileSync(join(dir, settingsBak)).equals(settingsBefore), 'the backup is not the pre-run settings.json')
  assert.ok(files.some((f) => f.startsWith('.claude.json.')), 'no .claude.json backup')
  assert.ok(files.some((f) => f.startsWith('CLAUDE.md.')), 'no CLAUDE.md backup')
})
