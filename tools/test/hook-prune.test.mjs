// The installer's hook prune. Two properties, in opposite directions, and the second one is the
// one that matters: a hook the manifest dropped IS removed (or four folded into one leave all
// five registered and every prompt gets the mandates twice) — and an empty or misread manifest
// removes NOTHING. The first version of this prune read one level too deep, got an empty
// wanted-set, and pruned all twenty-three hooks and their files, twice. The doctor caught it
// both times; this is so the doctor never has to.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'

const INSTALL = join(REPO, 'tools', 'install.mjs')
const manifestHooks = () => Object.values(JSON.parse(readFileSync(join(REPO, 'config', 'hooks.json'), 'utf8')).hooks)
  .flat().reduce((n, g) => n + (g.hooks || []).length, 0)

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cgc-prune-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
function install(cfg) {
  return spawnSync(process.execPath, [INSTALL, '--only=hooks'], {
    cwd: REPO, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, HOME: cfg, USERPROFILE: cfg },
  })
}
const registered = (cfg) => {
  const s = JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8'))
  return Object.values(s.hooks || {}).flat().flatMap((g) => (g.hooks || []).map((h) => String(h.command)))
}

test('a hook this package RETIRED is pruned — registration and file — and a hook it never shipped is not, wherever it lives', (t) => {
  const cfg = scratch(t)
  mkdirSync(join(cfg, 'hooks'), { recursive: true })
  // A stale hook of OURS: one of the folded stack hooks, named in the manifest's retired list.
  const stale = join(cfg, 'hooks', 'user-prompt-ui-stack.js')
  writeFileSync(stale, 'process.stdout.write("{}\\n")', 'utf8')
  const cmd = `"${process.execPath}" "${stale.replace(/\\/g, '/')}"`
  // And the USER'S OWN hook, in the same directory — the conventional place for one — which the
  // first prune took as proof of ownership and would have deleted, file and registration, from
  // a detached process with its output discarded.
  const mine = join(cfg, 'hooks', 'my-guard.js')
  writeFileSync(mine, 'process.stdout.write("{}\\n")', 'utf8')
  const mineCmd = `"${process.execPath}" "${mine.replace(/\\/g, '/')}"`
  writeFileSync(join(cfg, 'settings.json'), JSON.stringify({
    hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: cmd }, { type: 'command', command: mineCmd }] }] },
  }), 'utf8')
  // And a hook that is NOT ours — a different directory — which must be left alone whatever
  // the manifest says, because pruning somebody else's hook is a different bug.
  const theirs = join(cfg, 'elsewhere', 'their-hook.js')
  mkdirSync(join(cfg, 'elsewhere'), { recursive: true })
  writeFileSync(theirs, '', 'utf8')
  const s = JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8'))
  s.hooks.UserPromptSubmit[0].hooks.push({ type: 'command', command: `"${process.execPath}" "${theirs.replace(/\\/g, '/')}"` })
  writeFileSync(join(cfg, 'settings.json'), JSON.stringify(s), 'utf8')

  const r = install(cfg)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const after = registered(cfg)
  assert.ok(!after.some((c) => c.includes('user-prompt-ui-stack.js')), 'the retired hook is unregistered')
  assert.equal(existsSync(stale), false, 'and its file is gone, so it cannot run by accident')
  assert.ok(after.some((c) => c.includes('my-guard.js')), "the user's own hook in CONFIG_ROOT/hooks stays registered")
  assert.equal(existsSync(mine), true, 'and its file is untouched')
  assert.ok(after.some((c) => c.includes('their-hook.js')), 'a hook outside CONFIG_ROOT/hooks is never touched')
  assert.equal(after.filter((c) => !/their-hook\.js|my-guard\.js/.test(c)).length, manifestHooks(),
    'every hook the manifest carries is registered, and only those')
  assert.match(r.stdout, /pruned 1 hook/)
})

test('the prune refuses an empty manifest, allows a real shrink, and never removes a hook this package still ships', () => {
  // No safe way to hand the real installer an empty manifest without breaking the real install,
  // so the invariant is asserted where it lives. Two rules, and the SHAPE of each matters:
  //   - "never more removed than kept" was the first rule, and it was wrong: a manifest that
  //     shrinks from 19 hooks to 3 must prune 16, and that rule refused it for ever. The bug it
  //     guards against is an EMPTY wanted-set — a manifest that could not be read.
  //   - a hook the manifest omits but the package still ships is a manifest bug, not a removal,
  //     and "ships" means every directory the copy reads from — the first version checked only
  //     config/hooks and pruned user-prompt-visual.js out of a skill's hooks/ directory.
  const src = readFileSync(INSTALL, 'utf8')
  assert.match(src, /const safeToPrune = wantedBases\.size > 0\r?\n/, 'the guard is an empty wanted-set, and nothing else')
  assert.doesNotMatch(src, /candidates\.length <= wantedBases\.size/, 'a legitimate shrink is never refused')
  assert.match(src, /if \(!safeToPrune\) break/, 'and the loop that removes is gated on it')
  assert.match(src, /refusing to prune/, 'and refusal is reported, not silent')
  assert.match(src, /const shipped = new Set\(hookSources\.flatMap/, 'shipped = every hook source directory, not config/hooks alone')
  assert.match(src, /if \(shipped\.has\(b\)\)[^\n]*return true/, 'a shipped hook is kept, and said so')
  assert.match(src, /if \(!retired\.has\(b\)\) return true/, 'ownership is the retired list, never the directory')
  // The retired list is real and names the folded hooks, so a machine updating from before the
  // fold still loses them; and no name in it is still shipped.
  const manifest = JSON.parse(readFileSync(join(REPO, 'config', 'hooks.json'), 'utf8'))
  assert.ok(Array.isArray(manifest.retired) && manifest.retired.includes('user-prompt-ui-stack.js'))
  for (const name of manifest.retired) assert.equal(existsSync(join(REPO, 'config', 'hooks', name)), false, `${name} is retired but still ships`)
  // The one-level bug itself, so it cannot come back under a different name.
  assert.doesNotMatch(src, /Object\.values\(parsed\.hooks/, '`parsed` is already the hooks map')
})
