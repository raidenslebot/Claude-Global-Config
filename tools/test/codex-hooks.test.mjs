// Codex's hook surface — and the two ways it fails SILENTLY, which is what this file is for.
//
// Codex does have hooks, and a hooks.json written into $CODEX_HOME loads, reports enabled, and
// then does nothing at all unless its handlers are also TRUSTED in config.toml. So "the file was
// written" is not "the hook is installed", and every assertion here about installation is about
// what Codex says back, never about what we wrote.
//
// The other silent failure is on the way out: a DUPLICATE key in config.toml makes Codex answer
// hooks/list with ZERO hooks from every layer and put the reason in errors[] alone. That is the
// exact shape an append-based trust writer produces on its second run, and its symptom — "no
// hooks configured" — is indistinguishable from a clean machine. mergeTrust must refuse to
// create one, and that refusal is watched here rather than assumed.
//
// Most of this needs no Codex: the plan, the merge and the path compare are pure. The live
// applyHooks tests skip themselves when resolveCodexCli() finds nothing, because almost no
// machine has Codex and a suite that calls that a failure is permanently red for everyone.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO, IS_WIN, buildVars, resolveCodexCli } from '../paths.mjs'
import {
  PORTABLE_EVENTS, NOT_PORTABLE, program, hookPlan, mergeTrust, trustedKeys, samePath,
  applyHooks, programRuns,
} from '../codex-hooks.mjs'
import { discard } from './_teardown.mjs'

const CLI = resolveCodexCli()

function scratch(t, tag) {
  const dir = mkdtempSync(join(tmpdir(), `cgc-${tag}-`))
  t.after(() => discard(dir))
  return dir
}

/** How many times `needle` appears in `hay`. A replaced key appears once; an appended one twice. */
function occurrences(hay, needle) {
  return hay.split(needle).length - 1
}

/** Every handler across every group of a plan doc. */
function handlers(doc) {
  return Object.values(doc.hooks).flat().flatMap((g) => g.hooks)
}

// ---------------------------------------------------------------------------------------------
// 1. program() — the program token cannot be quoted, so it cannot contain a space
// ---------------------------------------------------------------------------------------------

test('a space-free absolute node path is handed to Codex verbatim', () => {
  const abs = IS_WIN ? 'C:\\nodejs\\node.exe' : '/usr/local/bin/node'
  const got = program(abs)
  assert.equal(got.token, abs)
  assert.ok(got.why.length > 0, 'the choice was made with no reason recorded')
})

test('a node path WITH a space falls back to the bare name, because a quoted program token fails', () => {
  const spaced = IS_WIN ? 'C:\\Program Files\\nodejs\\node.exe' : '/opt/node runtime/bin/node'
  const got = program(spaced)
  assert.notEqual(got.token, spaced, 'a path with a space was handed over as the program token')
  assert.ok(!/\s/.test(got.token), `the token still contains whitespace: ${JSON.stringify(got.token)}`)
  assert.ok(!/["']/.test(got.token), 'the token is quoted, and Codex does not honour quotes there')
  assert.ok(got.why.length > 0, 'the fallback was taken with no reason recorded')

  // WHY it must fall back, demonstrated rather than asserted about the source: Codex splits the
  // command string on whitespace, so the program it would actually try to run is the first
  // fragment — and that is not a program.
  assert.equal(programRuns(spaced.split(/\s/)[0]), null,
    `${spaced.split(/\s/)[0]} is runnable on this machine, so this no longer demonstrates anything`)
})

test('the token this machine would really be given runs on this machine', () => {
  const chosen = program(buildVars().NODE)
  const version = programRuns(chosen.token)
  assert.ok(version && /^v?\d+\./.test(version),
    `Codex would be told to run ${JSON.stringify(chosen.token)} and it does not run here (${version})`)
})

// ---------------------------------------------------------------------------------------------
// 2. hookPlan() — only the events whose payload means the same thing on both harnesses
// ---------------------------------------------------------------------------------------------

// A manifest of our own, so the rules can be watched deciding rather than merely agreeing with
// whatever config/hooks.json happens to contain today.
const FIXTURE = {
  hooks: {
    SessionStart: [
      {
        hooks: [
          { type: 'command', command: '"{{NODE}}" "{{CONFIG_ROOT:url}}/hooks/fixture-start.js"', timeout: 42 },
          { type: 'command', command: '"{{NODE}}" "{{CONFIG_ROOT:url}}/hooks/user-prompt-model-policy.js"', timeout: 10 },
        ],
      },
      // A group in which EVERY hook is skipped. It must not survive as an empty group.
      { hooks: [{ type: 'command', command: '"{{NODE}}" "{{CONFIG_ROOT:url}}/hooks/restore-dispatch.js"', timeout: 10 }] },
    ],
    // No timeout at all, to watch the default get applied.
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: '"{{NODE}}" "{{CONFIG_ROOT:url}}/hooks/fixture-prompt.js"' }] }],
    Stop: [{ hooks: [{ type: 'command', command: '"{{NODE}}" "{{CONFIG_ROOT:url}}/hooks/fixture-stop.js"', timeout: 7 }] }],
    PreToolUse: [{ matcher: 'Agent|Task', hooks: [{ type: 'command', command: '"{{NODE}}" "{{CONFIG_ROOT:url}}/hooks/fixture-pre.js"', timeout: 10 }] }],
    PostToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: '"{{NODE}}" "{{CONFIG_ROOT:url}}/hooks/fixture-post.js"', timeout: 10 }] }],
    Notification: [{ hooks: [{ type: 'command', command: '"{{NODE}}" "{{CONFIG_ROOT:url}}/hooks/fixture-notify.js"', timeout: 10 }] }],
  },
}

function fixturePlan(t) {
  const dir = scratch(t, 'codex-plan')
  const p = join(dir, 'hooks.json')
  writeFileSync(p, JSON.stringify(FIXTURE, null, 2), 'utf8')
  return hookPlan(buildVars(), p)
}

/** The assertions that must hold of ANY plan, whatever manifest produced it. */
function assertPlanShape(plan, where) {
  for (const event of Object.keys(plan.doc.hooks)) {
    assert.ok(PORTABLE_EVENTS.has(event), `${where}: ${event} is not a portable event and was installed anyway`)
  }
  // Named explicitly as well as covered by the set above: these two LOAD and TRUST on Codex and
  // then match nothing, because Codex's tools are exec/spawn_agent and ours match Write|Edit.
  assert.ok(!('PostToolUse' in plan.doc.hooks), `${where}: PostToolUse hooks would install, trust, and never fire`)
  assert.ok(!('PreToolUse' in plan.doc.hooks), `${where}: PreToolUse hooks would install, trust, and never fire`)
  assert.ok(!plan.installed.some((i) => i.event === 'PostToolUse' || i.event === 'PreToolUse'),
    `${where}: a tool hook was counted as installed`)

  for (const groups of Object.values(plan.doc.hooks)) {
    for (const g of groups) {
      assert.ok(Array.isArray(g.hooks) && g.hooks.length > 0, `${where}: a group was emitted with no handlers in it`)
    }
  }

  for (const h of handlers(plan.doc)) {
    assert.equal(h.type, 'command', `${where}: unknown handler type ${h.type}`)
    // `<token> "<path>"`: the PATH is an argument and may be quoted, which is what makes a script
    // under "C:\Program Files" usable at all. The TOKEN may not be.
    const m = /^(\S+) "([^"]+)"$/.exec(h.command)
    assert.ok(m, `${where}: command is not <token> "<path>": ${JSON.stringify(h.command)}`)
    assert.ok(!/["']/.test(m[1]), `${where}: the program token is quoted: ${JSON.stringify(h.command)}`)
    assert.equal(m[1], plan.program.token, `${where}: a handler used a token the plan did not choose`)
    assert.ok(/[\\/]hooks[\\/][^\\/]+$/.test(m[2]), `${where}: the quoted argument is not a hook script: ${m[2]}`)
    assert.equal(typeof h.timeout, 'number', `${where}: timeout is ${typeof h.timeout}, not a number`)
    assert.ok(h.timeout > 0, `${where}: a hook was given a timeout of ${h.timeout}`)
  }

  for (const s of plan.skipped) {
    assert.ok(typeof s.why === 'string' && s.why.trim().length > 0,
      `${where}: ${s.event}/${s.file} was skipped with no reason, which is indistinguishable from an oversight`)
  }

  // NOT_PORTABLE is a list of decisions, so every one of them has to be visible in the outcome.
  const installedFiles = plan.installed.map((i) => i.file)
  const skippedFiles = plan.skipped.map((s) => s.file)
  for (const file of Object.keys(NOT_PORTABLE)) {
    assert.ok(!installedFiles.includes(file), `${where}: ${file} is NOT_PORTABLE and was installed`)
    assert.ok(skippedFiles.includes(file), `${where}: ${file} is NOT_PORTABLE and was not reported skipped`)
  }
  assert.equal(plan.installed.length, handlers(plan.doc).length,
    `${where}: installed[] and the document disagree about how many hooks there are`)
}

test('the plan built from the real config/hooks.json installs only what fires on Codex', () => {
  const plan = hookPlan()
  assertPlanShape(plan, 'real manifest')
  assert.ok(plan.installed.length > 0, 'the real manifest produced no Codex hooks at all')
  assert.ok(plan.skipped.length > 0, 'nothing was skipped, so the skip rules were never exercised')

  // A command naming a script that is not there is a dead hook that reports healthy, so when this
  // machine has the hooks installed, every path in the plan must resolve.
  for (const h of handlers(plan.doc)) {
    const script = /"([^"]+)"/.exec(h.command)[1]
    if (!existsSync(join(script, '..'))) continue   // CGC not installed here; nothing to check
    assert.ok(existsSync(script), `the plan points Codex at ${script}, which does not exist`)
  }
})

test('a fixture manifest is filtered by event, by file, and by whether a group has anything left', (t) => {
  const plan = fixturePlan(t)
  assertPlanShape(plan, 'fixture')

  assert.deepEqual(Object.keys(plan.doc.hooks).sort(), ['SessionStart', 'Stop', 'UserPromptSubmit'])
  assert.deepEqual(plan.installed.map((i) => i.file).sort(),
    ['fixture-prompt.js', 'fixture-start.js', 'fixture-stop.js'])

  // The all-skipped SessionStart group must vanish, not arrive empty.
  assert.equal(plan.doc.hooks.SessionStart.length, 1, 'a group whose every hook was skipped was emitted anyway')

  const skipped = Object.fromEntries(plan.skipped.map((s) => [s.file, s]))
  assert.deepEqual(Object.keys(skipped).sort(),
    ['fixture-notify.js', 'fixture-post.js', 'fixture-pre.js', 'restore-dispatch.js', 'user-prompt-model-policy.js'])
  // The two NOT_PORTABLE ones are skipped for their OWN reason, not for their event's.
  assert.equal(skipped['restore-dispatch.js'].why, NOT_PORTABLE['restore-dispatch.js'])
  assert.equal(skipped['user-prompt-model-policy.js'].why, NOT_PORTABLE['user-prompt-model-policy.js'])

  const byFile = Object.fromEntries(handlers(plan.doc).map((h) => [/([\w.-]+\.js)/.exec(h.command)[1], h]))
  assert.equal(byFile['fixture-start.js'].timeout, 42, "the manifest's timeout was not carried over")
  assert.equal(byFile['fixture-stop.js'].timeout, 7)
  assert.equal(byFile['fixture-prompt.js'].timeout, 30, 'a hook with no timeout got no default either')
})

// ---------------------------------------------------------------------------------------------
// 3. mergeTrust() — config.toml belonged to the user first, and a duplicate key kills every hook
// ---------------------------------------------------------------------------------------------

const USER_TOML = [
  'model = "gpt-5-codex"',
  'model_reasoning_effort = "high"',
  '',
  String.raw`[projects.'C:\Users\me\work']`,
  'trust_level = "trusted"',
  '',
  '[mcp_servers.context7]',
  'command = "npx"',
  'args = ["-y", "@upstash/context7-mcp"]',
  '',
].join('\n')

const FOREIGN_KEY = String.raw`C:\Users\me\.codex\hooks.json:session_start:0:0`
const OUR_KEY = String.raw`C:\scratch\hooks.json:session_start:0:0`

function block(key, hash, enabled = 'true') {
  return `[hooks.state.'${key}']\nenabled = ${enabled}\ntrusted_hash = "${hash}"\n`
}

test("merging trust replaces our own entry, keeps a stranger's, and leaves the user's TOML alone", () => {
  const before = `${USER_TOML}\n${block(FOREIGN_KEY, 'sha256:foreign')}\n${block(OUR_KEY, 'sha256:old')}`
  const after = mergeTrust(before, [{ key: OUR_KEY, currentHash: 'sha256:new' }])

  // Their file, byte for byte. Not "contains a line of it".
  assert.ok(after.startsWith(USER_TOML), 'the TOML above the trust entries was altered')
  assert.equal(occurrences(after, 'model = "gpt-5-codex"'), 1, 'the model line was duplicated or lost')
  assert.equal(occurrences(after, String.raw`[projects.'C:\Users\me\work']`), 1, 'the projects table was duplicated or lost')
  assert.equal(occurrences(after, '[mcp_servers.context7]'), 1, 'the mcp_servers table was duplicated or lost')

  // A hook the user trusted themselves is none of our business.
  assert.equal(occurrences(after, `[hooks.state.'${FOREIGN_KEY}']`), 1, "the stranger's entry was dropped or duplicated")
  assert.ok(after.includes('sha256:foreign'), "the stranger's hash was rewritten")

  // Ours is REPLACED, not appended beside itself.
  assert.equal(occurrences(after, `[hooks.state.'${OUR_KEY}']`), 1, 'restating our own key produced a second copy of it')
  assert.ok(after.includes('sha256:new'), 'the new hash never made it in')
  assert.ok(!after.includes('sha256:old'), 'the stale hash survived beside the new one')

  // And the result still reads back as both keys trusted.
  assert.deepEqual([...trustedKeys(after)].sort(), [FOREIGN_KEY, OUR_KEY].sort())
})

test('a table BELOW the trust entries survives the merge too', () => {
  const trailing = '[mcp_servers.after]\ncommand = "node"\n'
  const before = `${USER_TOML}\n${block(OUR_KEY, 'sha256:old')}\n${trailing}`
  const after = mergeTrust(before, [{ key: OUR_KEY, currentHash: 'sha256:new' }])
  assert.equal(occurrences(after, '[mcp_servers.after]'), 1, 'the table below the trust block was eaten')
  assert.ok(after.includes('command = "node"'), "that table's body was eaten")
})

test('mergeTrust THROWS on a config.toml that already holds a duplicate key, rather than writing another', () => {
  // This is the whole reason the check exists: with a duplicate key, Codex answers hooks/list
  // with zero hooks from EVERY layer and reports why in errors[] alone, so every hook on the
  // machine stops firing and the surface that would tell you says "none configured".
  const dupe = block(FOREIGN_KEY, 'sha256:foreign')
  const before = `${USER_TOML}\n${dupe}\n${dupe}`
  assert.throws(
    () => mergeTrust(before, [{ key: OUR_KEY, currentHash: 'sha256:new' }]),
    (e) => /duplicate/i.test(e.message) && e.message.includes(FOREIGN_KEY),
    'a duplicate key was carried forward, which silences every Codex hook on the machine',
  )
})

test('restating a key that was duplicated collapses it to one entry instead of throwing', () => {
  const dupe = block(OUR_KEY, 'sha256:old')
  const after = mergeTrust(`${USER_TOML}\n${dupe}\n${dupe}`, [{ key: OUR_KEY, currentHash: 'sha256:new' }])
  assert.equal(occurrences(after, `[hooks.state.'${OUR_KEY}']`), 1, 'both copies were not removed before restating')
  assert.ok(!after.includes('sha256:old'))
  assert.deepEqual([...trustedKeys(after)], [OUR_KEY])
})

test('merging into a config.toml that does not exist yet produces one Codex reads back as trusted', () => {
  const after = mergeTrust('', [
    { key: 'A:session_start:0:0', currentHash: 'sha256:a' },
    { key: 'B:stop:0:0', currentHash: 'sha256:b' },
  ])
  assert.deepEqual([...trustedKeys(after)].sort(), ['A:session_start:0:0', 'B:stop:0:0'])
  assert.equal(occurrences(after, '[hooks.state.'), 2)
})

// ---------------------------------------------------------------------------------------------
// 4. trustedKeys() — enabled AND hashed, or it is not trust
// ---------------------------------------------------------------------------------------------

test('only an entry with BOTH enabled = true and a trusted_hash counts as trusted', () => {
  const toml = [
    block('both', 'sha256:1'),
    "[hooks.state.'no-hash']\nenabled = true\n",
    "[hooks.state.'no-enabled']\ntrusted_hash = \"sha256:3\"\n",
    block('disabled', 'sha256:4', 'false'),
    "[hooks.state.'neither']\nsomething_else = 1\n",
    '[hooks.state."double-quoted"]\nenabled = true\ntrusted_hash = "sha256:6"\n',
  ].join('\n')

  assert.deepEqual([...trustedKeys(toml)].sort(), ['both', 'double-quoted'])
  assert.deepEqual([...trustedKeys('')], [], 'an empty config claimed to trust something')
  assert.deepEqual([...trustedKeys(USER_TOML)], [], 'a config with no hook state at all claimed to trust something')
})

// ---------------------------------------------------------------------------------------------
// 5. samePath() — the 8.3 short name that made the first filter match nothing
// ---------------------------------------------------------------------------------------------

test('a path through a Windows 8.3 short name is the same path as its long form', (t) => {
  const dir = scratch(t, 'codex-short')
  const long = realpathSync.native(dir)
  if (long === dir) {
    t.skip(`no 8.3 short name is reachable here: tmpdir() already hands back the long form (${dir})`)
    return
  }

  // The regression this guards: realpathSync PRESERVES the short name, so the two never compared
  // equal, every row was filtered out, and the installer trusted nothing while reporting success.
  assert.notEqual(realpathSync(dir), long,
    'realpathSync already collapses the short name here, so this can no longer watch the bug')

  assert.ok(samePath(dir, long), `${dir} and ${long} are the same directory and did not compare equal`)

  // The shape applyHooks actually compares: our hooks.json path against the one Codex reports.
  const ours = join(dir, 'hooks.json')
  writeFileSync(ours, '{}\n', 'utf8')
  assert.ok(samePath(ours, join(long, 'hooks.json')),
    'the file Codex reports by its long path was not recognised as the file we just wrote')

  // And it is a comparison, not a constant: a different directory is a different path.
  assert.ok(!samePath(ours, join(long, 'config.toml')), 'samePath equates two different files')
  assert.ok(!samePath(dir, tmpdir()), 'samePath equates a directory with its parent')
})

test('samePath normalises separators, and on Windows case, for a path not on disk', () => {
  const missing = join(tmpdir(), 'cgc-absent-dir', 'hooks.json')
  assert.ok(samePath(missing, missing.replace(/[\\/]/g, '/')), 'separator style alone defeated the compare')
  assert.ok(samePath(missing, missing.replace(/[\\/]/g, '//')), 'a doubled separator defeated the compare')
  if (IS_WIN) assert.ok(samePath(missing, missing.toUpperCase()), 'Windows paths are case-insensitive')
  assert.ok(!samePath(missing, `${missing}x`), 'two different missing paths compared equal')
})

// ---------------------------------------------------------------------------------------------
// 6. applyHooks() against a real Codex — the only statement worth making is the one Codex agrees
//    with. Skipped, not failed, where there is no Codex.
// ---------------------------------------------------------------------------------------------

const NO_CODEX = 'no Codex on this machine — resolveCodexCli() found no CLI, so there is nothing to register hooks with'

test('a first apply gets every planned hook LISTED and TRUSTED, and keeps the files it found', async (t) => {
  if (!CLI) { t.skip(NO_CODEX); return }
  const home = scratch(t, 'codex-apply')

  // Both files belonged to somebody else first.
  const ownToml = 'model = "gpt-5-codex"\n\n[mcp_servers.mine]\ncommand = "npx"\nargs = ["-y", "mine"]\n'
  const ownHooks = '{\n  "hooks": {}\n}\n'
  writeFileSync(join(home, 'config.toml'), ownToml, 'utf8')
  writeFileSync(join(home, 'hooks.json'), ownHooks, 'utf8')

  const r = await applyHooks({ cli: CLI, home, cwd: REPO })
  assert.equal(r.configError, undefined, `Codex could not read its config: ${(r.notes || []).join('; ')}`)
  assert.equal(r.wrote, true, 'nothing was written over a hooks.json that held no hooks')
  assert.ok(r.listed > 0, `Codex listed none of our hooks: ${(r.notes || []).join('; ')}`)

  // The claim that matters. An untrusted hook is loaded and silently skipped, so "listed" alone
  // is exactly the false green this module exists to prevent.
  assert.deepEqual(r.untrusted, [], 'a hook was installed untrusted, which means loaded and silently skipped')
  assert.equal(r.trusted, r.listed)
  assert.equal(r.listed, handlers(r.plan.doc).length, 'Codex and the plan disagree about how many hooks there are')

  // Their files: backed up once, and the trust write appended rather than replaced.
  assert.equal(readFileSync(join(home, 'hooks.json.cgc-backup'), 'utf8'), ownHooks,
    'the hooks.json this package did not write was overwritten with no copy kept')
  const toml = readFileSync(join(home, 'config.toml'), 'utf8')
  assert.ok(toml.startsWith(ownToml), "the user's config.toml did not survive the trust write byte for byte")
  assert.equal(readFileSync(join(home, 'config.toml.cgc-backup'), 'utf8'), ownToml,
    'config.toml was rewritten with no copy of the original kept')

  // Running it again has nothing to do — neither file is touched, and trust still holds.
  const again = await applyHooks({ cli: CLI, home, cwd: REPO })
  assert.equal(again.wrote, false, 'the second apply rewrote hooks.json')
  assert.equal(readFileSync(join(home, 'config.toml'), 'utf8'), toml, 'the second apply rewrote config.toml')
  assert.equal(again.listed, r.listed)
  assert.equal(again.trusted, again.listed, 'trust did not survive a second apply')
  assert.deepEqual(again.untrusted, [])
})

test('a dry run writes NOTHING and still reports the trust state Codex holds right now', async (t) => {
  if (!CLI) { t.skip(NO_CODEX); return }
  const home = scratch(t, 'codex-dry')

  const live = await applyHooks({ cli: CLI, home, cwd: REPO })
  assert.equal(live.configError, undefined, `Codex could not read its config: ${(live.notes || []).join('; ')}`)
  assert.ok(live.listed > 0 && live.trusted === live.listed, 'the setup apply did not establish trust to report on')

  // Reformat hooks.json: the FILE is now out of date while the handlers are identical, so trust
  // still holds and the dry run has something real to decline to write.
  const target = join(home, 'hooks.json')
  const stale = JSON.stringify(JSON.parse(readFileSync(target, 'utf8')))
  writeFileSync(target, stale, 'utf8')
  const tomlBefore = readFileSync(join(home, 'config.toml'), 'utf8')

  const dry = await applyHooks({ cli: CLI, home, cwd: REPO, dryRun: true })
  assert.equal(dry.wrote, true, 'the dry run did not notice hooks.json was out of date')
  assert.equal(readFileSync(target, 'utf8'), stale, 'the dry run wrote hooks.json')
  assert.equal(readFileSync(join(home, 'config.toml'), 'utf8'), tomlBefore, 'the dry run wrote config.toml')

  // A dry run that reported zeros would make a machine enforcing nothing look like a machine with
  // nothing to report, and the doctor reads exactly these numbers.
  assert.equal(dry.listed, live.listed, 'the dry run reported nothing listed, so the doctor would see a clean machine')
  assert.equal(dry.trusted, live.trusted, 'the dry run did not read back the live trust state')
  assert.deepEqual(dry.untrusted, [])
  assert.ok(dry.notes.some((n) => /out of date/i.test(n)), 'the dry run said nothing about the stale file it declined to write')
})
