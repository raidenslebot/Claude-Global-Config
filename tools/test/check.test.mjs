// `cgc check` runs the loop in one command. The loop was four or five commands, which is
// exactly why it got run once and then remembered as having been run. What matters here is
// that it picks the right gates from the file itself, and that its exit code is usable.
//
// The browser gates (audit, motion) are skipped in most cases so the suite stays fast; gate
// SELECTION is asserted from the JSON, which is the part that can silently rot.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'

const TOOL = join(REPO, 'tools', 'check.mjs')

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cgc-check-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
function run(args, opts = {}) {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', timeout: 120000, ...opts })
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' }
}
function gates(file, extra = []) {
  const r = run([file, '--json', '--skip', 'audit,motion', ...extra])
  const j = JSON.parse(r.out)
  const map = {}
  for (const g of j.results[0].gates) map[g.gate] = g.level
  return { j, map, status: r.status }
}

const TEMPLATE = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Launch</title><style>',
  'body{background:#0b0f19;color:#94a3b8;font-family:Inter,sans-serif}',
  '.blob{position:absolute;border-radius:9999px;filter:blur(64px);background:#a855f7;width:24rem;height:24rem}',
  '.hero{text-align:center;padding:8rem 0}',
  '.hero h1{background:linear-gradient(90deg,#a855f7,#ec4899);-webkit-background-clip:text;color:transparent}',
  '.card{backdrop-filter:blur(12px);background:rgba(255,255,255,.1);border-radius:1rem;padding:1.5rem}',
  '.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1.5rem}',
  '</style></head><body><div class="blob"></div>',
  '<section class="hero"><h1>Supercharge your workflow</h1><p>Seamless, effortless, blazing fast.</p>',
  '<a class="btn">Get started</a><a class="btn">Book a demo</a></section>',
  '<div class="grid"><div class="card">🚀 Fast</div><div class="card">🔒 Secure</div><div class="card">⚡ Simple</div></div>',
  '<section class="pricing"><h2>Simple pricing</h2>',
  '<div class="grid"><div class="card"><h3>Starter</h3><p>For trying things out.</p><p>$0</p></div>',
  '<div class="card"><h3>Team</h3><p>For a growing team.</p><p>$29</p></div>',
  '<div class="card"><h3>Scale</h3><p>For everyone else.</p><p>Contact us</p></div></div></section>',
  '<footer><p>Trusted by thousands of teams worldwide. Built with love and modern tooling.</p>',
  '<nav><a href="#">Product</a><a href="#">Pricing</a><a href="#">Docs</a><a href="#">Blog</a>',
  '<a href="#">About</a><a href="#">Careers</a><a href="#">Contact</a><a href="#">Privacy</a></nav>',
  '<p>© 2026 Example Inc. All rights reserved. Everything you need, nothing you do not.</p></footer>',
  '</body></html>',
].join('\n')

test('--help lists the gates and exits 0; a path that does not exist is a failure', () => {
  const help = run(['--help'])
  assert.equal(help.status, 0)
  for (const gate of ['techniques', 'lint', 'audit', 'motion', 'print-lint']) {
    assert.match(help.out, new RegExp(gate), `--help names the ${gate} gate`)
  }
  assert.equal(run([join(tmpdir(), 'no-such-dir-41772')]).status, 1)
})

test('a template page fails the gates that apply to it, and --strict is usable as an exit code', (t) => {
  const dir = scratch(t)
  const file = join(dir, 'index.html')
  writeFileSync(file, TEMPLATE, 'utf8')

  const { map } = gates(file)
  assert.equal(map.lint, 'fail', 'the fingerprint gate must fail on the template')
  assert.ok(map.techniques === 'fail' || map.techniques === 'warn',
    'the ambition gate must not pass a page built from defaults, got ' + map.techniques)
  assert.ok(!('print-lint' in map), 'a screen page is not sent to the press gate')

  assert.equal(run([file, '--skip', 'audit,motion', '--strict']).status, 1)
  assert.equal(run([file, '--skip', 'audit,motion']).status, 0, 'without --strict it reports rather than fails')
})

test('a physical design goes to the press gate and not to the fingerprint gate', (t) => {
  const dir = scratch(t)
  const file = join(dir, 'card.html')
  writeFileSync(file, [
    '<style>@page{size:3.5in 2in;margin:0}',
    'body{font-family:Archivo,sans-serif}',
    '.name{font-size:11pt;letter-spacing:.02em}',
    '.rule{border-top:.5pt solid}',
    '</style><div class="name">Harbour Swim Club</div><div class="rule"></div>',
  ].join('\n'), 'utf8')
  const { map } = gates(file)
  assert.ok('print-lint' in map, 'physical units send it to the press gate')
  assert.ok(!('lint' in map), 'the screen fingerprints do not apply to paper')
})

test('a file in no recognised medium contributes no gates', (t) => {
  const dir = scratch(t)
  const file = join(dir, 'build.mjs')
  writeFileSync(file, 'import { readFileSync } from "node:fs"\n' + 'const x = readFileSync("a.json")\n'.repeat(40), 'utf8')
  const r = run([file, '--json', '--skip', 'audit,motion'])
  const j = JSON.parse(r.out)
  assert.equal(j.results[0].gates.length, 0, 'a build script is not a design')
  assert.equal(r.status, 0)
})

test('a directory is walked, and the summary covers every file in it', (t) => {
  const dir = scratch(t)
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'a.html'), TEMPLATE, 'utf8')
  writeFileSync(join(dir, 'src', 'b.css'), '.x{color:#333}', 'utf8')
  writeFileSync(join(dir, 'src', 'notes.txt'), 'not a design', 'utf8')
  const j = JSON.parse(run([dir, '--json', '--skip', 'audit,motion']).out)
  const names = j.results.map((r) => basename(r.file)).sort()
  assert.deepEqual(names, ['a.html', 'b.css'], 'design files only')
  assert.ok(j.failed > 0)
})

test('--skip removes a gate rather than failing it', (t) => {
  const dir = scratch(t)
  const file = join(dir, 'index.html')
  writeFileSync(file, TEMPLATE, 'utf8')
  const withLint = gates(file).map
  assert.ok('lint' in withLint)
  const without = gates(file, ['--skip', 'audit,motion,lint']).map
  assert.ok(!('lint' in without), '--skip drops the gate entirely')
})

test('a gate that cannot run is reported, never silently dropped', (t) => {
  // This is the defect that made the tool lie: with no browser, the audit and motion rows
  // vanished and the summary said "every gate clean" about a page it had never rendered.
  // An absent gate reads as a gate that passed.
  const dir = scratch(t)
  const empty = join(dir, 'no-browsers-here')
  mkdirSync(empty, { recursive: true })
  const file = join(dir, 'moves.html')
  writeFileSync(file, [
    '<!doctype html><style>',
    'body{margin:0;background:#101318;color:#e8dcc8;font-family:Georgia,serif}',
    '.b{width:12rem;height:12rem;background:#c4552a;animation:rise 600ms cubic-bezier(.2,.8,.2,1) both}',
    '@keyframes rise{from{opacity:0;transform:translateY(2rem)}to{opacity:1;transform:none}}',
    '@media (prefers-reduced-motion:reduce){.b{animation:none}}',
    '</style><div class="b"></div>',
    '<p>' + 'A page with an animation on it, long enough to be judged. '.repeat(20) + '</p>',
  ].join('\n'), 'utf8')

  const r = spawnSync(process.execPath, [TOOL, file, '--json'], {
    encoding: 'utf8', timeout: 180000,
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: empty },
  })
  const j = JSON.parse(r.out ?? r.stdout)
  const gates = Object.fromEntries(j.results[0].gates.map((g) => [g.gate, g]))

  for (const gate of ['audit', 'motion']) {
    assert.ok(gates[gate], `the ${gate} gate must still appear when it cannot run`)
    assert.equal(gates[gate].level, 'skip', `${gate} must be reported as unable to run, not as passing`)
    assert.match(gates[gate].line, /could not run/)
  }
  assert.equal(j.skipped, 2, 'the summary counts what could not run')
  assert.ok(gates.lint && gates.lint.level !== 'skip', 'the gates that need no browser still ran')
})

// ── A gate that produced nothing has not passed ──────────────────────────────────────────────
// Every case here used to end in a green verdict. These are the decision functions themselves,
// so the contract holds without needing a child process that misbehaves on cue.
import { fromJson, unavailable, PAGE_SIZE, MOVES, withoutQuotedCode } from '../check.mjs'

test('a child that says nothing readable becomes a visible row, never silence', () => {
  const build = () => ({ gate: 'x', level: 'ok', line: 'fine', next: '' })
  for (const [label, r] of [
    ['crashed with no output', { status: 1, stdout: '', stderr: 'Error: boom', json: null }],
    ['printed something unparseable', { status: 0, stdout: 'not json', stderr: '', json: null }],
    ['is not installed', { status: 127, stdout: '', stderr: 'slop-lint.mjs is not installed', json: null }],
    ['timed out', { status: 1, stdout: '', stderr: '', json: null, timedOut: true }],
  ]) {
    const row = fromJson('lint', r, build)
    assert.equal(row.level, 'skip', `a child that ${label} must produce a skip row`)
    assert.match(row.line, /could not run/)
  }
})

test('a child that reports nothing wrong and then fails is not trusted', () => {
  // A tool that crashes after emitting a clean-looking partial result was indistinguishable
  // from success.
  const clean = () => ({ gate: 'audit', level: 'ok', line: 'no failures', next: '' })
  const row = fromJson('audit', { status: 1, stdout: '{}', stderr: '', json: {} }, clean)
  assert.equal(row.level, 'skip')
  assert.match(row.line, /exited 1/)
  // And a tool that reports failures and exits non-zero is behaving exactly as it should.
  const fails = () => ({ gate: 'audit', level: 'fail', line: '2 failures', next: '' })
  assert.equal(fromJson('audit', { status: 1, stdout: '{}', stderr: '', json: {} }, fails).level, 'fail')
})

test('a result missing a field it assumed does not abort the whole run', () => {
  const row = fromJson('techniques', { status: 0, stdout: '{}', stderr: '', json: {} }, (t) => ({
    gate: 'techniques', level: 'ok', line: t.media.map((m) => m.label).join(''), next: '',
  }))
  assert.equal(row.level, 'skip', 'one malformed child must not take every remaining file with it')
  assert.match(row.line, /could not be read/)
})

test('a page that only talks about print is not a print piece', () => {
  const docs = '<h1>Printing</h1><pre><code>@page { size: 8.5in 11in }</code></pre>'
  assert.equal(PAGE_SIZE.test(withoutQuotedCode(docs)), false, 'a code sample is not a stylesheet')
  const script = '<script>const CSS = "@page { size: 210mm 297mm }"</script>'
  assert.equal(PAGE_SIZE.test(withoutQuotedCode(script)), false, 'a JS string is not a stylesheet')
  const real = '<style>@page { size: 3.5in 2in; margin: 0 }</style>'
  assert.equal(PAGE_SIZE.test(withoutQuotedCode(real)), true)
  assert.equal(PAGE_SIZE.test('@page { size: A4 }'), true, 'a named size is the commonest form there is')
  assert.equal(PAGE_SIZE.test('@page { size: letter }'), true)
})

test('the ways a page actually animates are all recognised', () => {
  for (const src of [
    'animate(".box", { x: [0, 300] }, { duration: 0.4 })',      // motion.dev, the default library
    '.x { transition-property: transform; transition-duration: 240ms }',
    '.x { transition: transform var(--dur) ease }',
    'new Animation(new KeyframeEffect(el, [{ opacity: 0 }]))',
    '@keyframes rise { to { opacity: 1 } }',
    'gsap.to(el, { x: 100 })',
  ]) {
    assert.ok(MOVES.test(src), `this animates and must be captured: ${src.slice(0, 46)}`)
  }
  assert.ok(!MOVES.test('const transitions = rows.map((r) => r.id)'), 'a variable named transitions is not motion')
})
