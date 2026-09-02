// "This config wins" — and nothing of the user's is lost in the winning. These run the real
// installer into a scratch CLAUDE_CONFIG_DIR (config and skills phases only, so nothing touches
// settings.json, npm or the plugin) and hold the cases an adversarial review found broken: a
// hand-written CLAUDE.md with no marker was overwritten with no backup; a dangling junction under
// a skill name crashed the installer natively; a dry run created directories.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync, symlinkSync, realpathSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO, IS_WIN } from '../paths.mjs'

const MARK = '<!-- user-additions-below -->'
const OWNED = readdirSync(join(REPO, 'skills')).filter((n) => existsSync(join(REPO, 'skills', n, 'SKILL.md')))

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'install-override-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
function install(root, ...args) {
  const r = spawnSync(process.execPath, [join(REPO, 'tools', 'install.mjs'), '--only=config,skills', ...args], {
    cwd: REPO, encoding: 'utf8', timeout: 180000, env: { ...process.env, CLAUDE_CONFIG_DIR: root },
  })
  r.plain = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '')
  return r
}
const same = (a, b) => (IS_WIN ? realpathSync(a).toLowerCase() === realpathSync(b).toLowerCase() : realpathSync(a) === realpathSync(b))

test("a hand-written CLAUDE.md with no marker is kept aside, never overwritten; additions below the marker survive the next install", (t) => {
  const root = scratch(t)
  writeFileSync(join(root, 'CLAUDE.md'), '# MY OWN NOTES ABOVE\n\nkeep me\n', 'utf8')
  const r1 = install(root)
  assert.equal(r1.status, 0, r1.plain)
  const asideDir = join(root, '.cgc-replaced')
  const kept = readdirSync(asideDir).find((f) => f.startsWith('CLAUDE.md-'))
  assert.ok(kept, 'the old file is kept under .cgc-replaced')
  assert.equal(readFileSync(join(asideDir, kept), 'utf8'), '# MY OWN NOTES ABOVE\n\nkeep me\n')
  const written = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
  assert.ok(written.trimEnd().endsWith(MARK), 'the shipped file ends with the marker')
  assert.equal((written.match(/user-additions-below/g) || []).length, 1)

  writeFileSync(join(root, 'CLAUDE.md'), written + '\n## Mine\n\nmy own rule\n', 'utf8')
  const r2 = install(root)
  assert.equal(r2.status, 0, r2.plain)
  const again = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
  assert.match(again, /## Mine\n\nmy own rule/)
  assert.equal((again.match(/user-additions-below/g) || []).length, 1, 'one marker, however many installs')
  assert.equal(readdirSync(asideDir).filter((f) => f.startsWith('CLAUDE.md-')).length, 1, 'no second backup once the marker exists')
})

test('a dangling junction under a skill name is replaced and the install completes', (t) => {
  const root = scratch(t)
  const skills = join(root, 'skills')
  mkdirSync(skills, { recursive: true })
  const gone = join(root, 'was-here', OWNED[0])
  mkdirSync(gone, { recursive: true })
  symlinkSync(gone, join(skills, OWNED[0]), IS_WIN ? 'junction' : 'dir')
  rmSync(join(root, 'was-here'), { recursive: true, force: true })
  assert.ok(lstatSync(join(skills, OWNED[0])).isSymbolicLink() || IS_WIN, 'the fixture is a dangling link')

  const r = install(root)
  assert.equal(r.status, 0, r.plain)
  assert.match(r.plain, /Summary/, 'the installer reached its summary — it did not die on the link')
  for (const name of OWNED) assert.ok(same(join(skills, name), join(REPO, 'skills', name)), `${name} is linked to the repo`)
})

test("a real directory under a skill name is moved aside, not deleted, and the message names where", (t) => {
  const root = scratch(t)
  const skills = join(root, 'skills')
  mkdirSync(join(skills, OWNED[1]), { recursive: true })
  writeFileSync(join(skills, OWNED[1], 'SKILL.md'), '# the user\'s own\n', 'utf8')
  const r = install(root)
  assert.equal(r.status, 0, r.plain)
  assert.match(r.plain, new RegExp(`${OWNED[1]} \\(linked — replaced; the previous copy is at`))
  const moved = readdirSync(join(root, '.cgc-replaced')).find((f) => f.startsWith(`${OWNED[1]}-`))
  assert.ok(moved, 'the copy is under .cgc-replaced')
  assert.equal(readFileSync(join(root, '.cgc-replaced', moved, 'SKILL.md'), 'utf8'), '# the user\'s own\n')
  assert.ok(same(join(skills, OWNED[1]), join(REPO, 'skills', OWNED[1])))
})

test('--dry-run on a fresh root writes nothing, not even a directory', (t) => {
  const root = join(scratch(t), 'fresh')
  const r = spawnSync(process.execPath, [join(REPO, 'tools', 'install.mjs'), '--dry-run'], {
    cwd: REPO, encoding: 'utf8', timeout: 180000, env: { ...process.env, CLAUDE_CONFIG_DIR: root },
  })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(!existsSync(root), `a dry run created ${root}`)
})
