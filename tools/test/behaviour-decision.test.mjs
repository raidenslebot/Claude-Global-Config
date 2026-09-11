// The screen that exposes its machinery instead of delivering a decision.
//
// The negative half is the important half here. Every signal this check reads — `section`,
// `card`, `panel`, `group` — is a word that appears constantly in markup that is doing nothing
// wrong: Tailwind's bare `group` is a hover scope, `card-body` is part of a card and not another
// one, a component module holds six panels that are never on screen together, and `useState<Card>`
// is TypeScript. A detector that counts those fires on every React project ever written, which
// is the same as not existing. So most of what follows asserts silence.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'
import { buildContext } from '../behaviour.mjs'
import { run, census, widest, surfaceWordIn, statedSurfaces } from '../behaviour/decision.mjs'
import { discard } from './_teardown.mjs'

const TOOL = join(REPO, 'tools', 'behaviour.mjs')

function tree(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'cgc-decision-'))
  t.after(() => discard(dir))
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, body, 'utf8')
  }
  return dir
}

const check = (dir) => run(buildContext([dir]))
const whats = (r) => r.findings.map((f) => f.what)
const hit = (r, re) => r.findings.filter((f) => re.test(f.what))

/** n differently-named surfaces inside one root, plus two controls so it counts as a screen. */
const page = (n, { primaries = 0, sameClass = false } = {}) => `<!doctype html>
<html><body><main>
${Array.from({ length: n }, (_, i) => `  <section class="${sameClass ? 'card' : `card-${i}-panel`}"><h2>Thing ${i}</h2><p>text</p></section>`).join('\n')}
${Array.from({ length: primaries }, (_, i) => `  <button class="btn primary" id="go-${i}">Go</button>`).join('\n')}
  <button id="cancel">Cancel</button>
  <select id="mode"><option>a</option></select>
</main></body></html>`

// ── the positive: a screen that is all machinery ─────────────────────────────────────────────

test('a screen with many surfaces and no single primary is reported, with the surfaces as evidence', (t) => {
  const r = check(tree(t, { 'app.html': page(12) }))
  const f = hit(r, /top-level surfaces/)[0]
  assert.ok(f, `expected a surface-count finding, got ${JSON.stringify(whats(r))}`)
  assert.match(f.what, /^12 top-level surfaces and no primary action$/)
  assert.match(f.evidence, /class="card-0-panel"/, 'evidence names surfaces actually extracted from the file')
  assert.match(f.evidence, /\+6 more/)
  assert.ok(f.line > 1, 'the finding points at a line')
  assert.equal(r.scanned, 1)
})

test('many surfaces and MANY primaries is the same defect as none', (t) => {
  const r = check(tree(t, { 'app.html': page(12, { primaries: 4 }) }))
  assert.match(hit(r, /top-level surfaces/)[0].what, /12 top-level surfaces and 4 primary actions/)
})

test('exactly one primary is the shape of a decision delivered, and is not reported', (t) => {
  const r = check(tree(t, { 'app.html': page(12, { primaries: 1 }), 'docs/design.md': '# Design\n\nTwelve surfaces, deliberately.\n' }))
  assert.deepEqual(hit(r, /top-level surfaces/), [], 'one primary over twelve surfaces is a dense screen with a decision on it')
})

test('a folded screen — three surfaces, one primary — says nothing at all', (t) => {
  const r = check(tree(t, { 'app.html': page(3, { primaries: 1 }) }))
  assert.deepEqual(r.findings, [], JSON.stringify(whats(r)))
  assert.equal(r.scanned, 1, 'it was examined, not skipped')
})

test('flat weight: one class signature and one heading level across every surface', (t) => {
  const flat = check(tree(t, { 'app.html': page(12, { primaries: 1, sameClass: true }) }))
  const f = hit(flat, /one class signature/)[0]
  assert.ok(f, `expected a flat-weight finding, got ${JSON.stringify(whats(flat))}`)
  assert.match(f.evidence, /section\.card/)
  assert.match(f.evidence, /<h2>/)

  const varied = check(tree(t, { 'app.html': page(12, { primaries: 1 }) }))
  assert.deepEqual(hit(varied, /one class signature/), [], 'surfaces that differ are not flat')
})

// ── the negatives: everything that looks like this and is not ────────────────────────────────

test('a document is not a screen — a poster with twelve sections and no controls is silent', (t) => {
  const poster = `<!doctype html><html><body><main>
${Array.from({ length: 12 }, (_, i) => `<section class="panel-${i}"><h2>${i}</h2></section>`).join('\n')}
</main></body></html>`
  const r = check(tree(t, { 'poster.html': poster }))
  assert.deepEqual(r.findings, [])
  assert.match(r.note, /none of them a screen/)
  assert.equal(r.scanned, 1, 'scanned reports the markup it looked at, so "clean" is not confused with "empty"')
})

test('an empty tree says why it is empty rather than passing quietly', (t) => {
  const r = check(tree(t, { 'readme.md': '# nothing here' }))
  assert.deepEqual(r.findings, [])
  assert.equal(r.scanned, 0)
  assert.match(r.note, /no markup in this tree/)
})

test("Tailwind's bare `group` is a hover scope, not a surface", () => {
  assert.equal(surfaceWordIn('group relative flex'), '')
  assert.equal(surfaceWordIn('group/item peer'), '')
  assert.equal(surfaceWordIn('form-group'), '', 'a field wrapper is not a surface')
  assert.equal(surfaceWordIn('input-group mb-3'), '')
  assert.equal(surfaceWordIn('settings-group'), 'settings-group', 'a real group still counts')
  assert.equal(surfaceWordIn('hero-section'), 'hero-section')
  assert.equal(surfaceWordIn('card-body'), '', 'part of a card, not another card')
  assert.equal(surfaceWordIn('panel-heading'), '')
})

test('a component module is not one screen — surfaces are counted per root', (t) => {
  // Six panel components in one file. They are six screens' worth of parts, and never on screen
  // together; the widest single root holds one surface.
  const mod = Array.from({ length: 6 }, (_, i) => `
export function Panel${i}({ onPick }) {
  const [sel, setSel] = useState<Card | null>(null)
  return (
    <aside className="side-panel">
      <h2>Panel ${i}</h2>
      <button onClick={onPick}>pick</button>
    </aside>
  )
}`).join('\n')
  const c = census(mod)
  assert.equal(c.roots.length, 6, 'six returned trees are six roots')
  assert.equal(widest(c).surfaces.length, 1)
  assert.deepEqual(check(tree(t, { 'src/Panels.tsx': mod })).findings, [])
})

test('`useState<Card>` is TypeScript, not a card on the screen', () => {
  const c = census('const [x, setX] = useState<Card>(null)\nconst m = new Map<string, Panel>()\n')
  assert.deepEqual(c.roots, [], 'a generic argument never opens a root')
})

test('a nested surface belongs to the surface it is inside', () => {
  const c = census(`<main>
    <section class="summary-panel"><div class="card">a</div><div class="card">b</div></section>
    <section class="detail-panel"><div class="card">c</div></section>
  </main>`)
  assert.equal(widest(c).surfaces.length, 2, 'two sections, not five things')
  assert.deepEqual(widest(c).surfaces.map((s) => s.why), ['<section class="summary-panel">', '<section class="detail-panel">'],
    'a surface is named by the attribute that made it count, not as a bare tag')
})

test('markup inside a comment or a script block is not on the screen', () => {
  const live = census('<main><section class="a">x</section></main>')
  const dead = census(`<main>
    <section class="a">x</section>
    <!-- <section class="b">old</section> -->
    <script>const t = '<section class="c">tpl</section>'</script>
  </main>`)
  assert.equal(widest(dead).surfaces.length, widest(live).surfaces.length)
})

// ── the design document ──────────────────────────────────────────────────────────────────────

test('a document that enumerates surfaces is read, one that does not is not invented', () => {
  assert.deepEqual(statedSurfaces('# Design\n\n## Surfaces\n\n- Answer\n- Why\n- Inputs\n- Everything else\n'),
    { count: 4, how: '4 items listed under "## Surfaces"' })
  assert.equal(statedSurfaces('# Design\n\nfour coordinated surfaces carry the whole thing.\n').count, 4)
  assert.equal(statedSurfaces('# Design\n\nUse a warm ground and a single accent.\n'), null)
  // Measured on a real tree: "one or two views" read as a stated count of one, and a scraped
  // 57-surface page was then reported as disagreeing with a document that named no number.
  assert.equal(statedSurfaces('# Design\n\nStoryboard one or two views per beat.\n'), null, 'a range is a refusal to state a count')
  assert.equal(statedSurfaces('# Design\n\nStoryboard one or two views per beat. The app is three screens.\n').count, 3,
    'and a real statement later in the same document is still read')
  // Also measured on real trees: "§1 surfaces" (a section reference) and "Update 41 panels" (a
  // version) were both read as documents stating a surface count. Digits in prose are references
  // more often than counts, so the sentence form reads spelled-out numbers only.
  assert.equal(statedSurfaces('# Spec\n\nDepth comes from the hairline. §1 surfaces.\n'), null, 'a section reference is not a count')
  assert.equal(statedSurfaces("# Spec\n\nWarframe's Update 41 panels are plain.\n"), null, 'a version number is not a count')
  assert.equal(statedSurfaces('# Spec\n\nThe shell is 3 surfaces.\n'), null,
    'the documented blind spot: a count written in digits in a sentence is NOT read — write the list')
  assert.equal(statedSurfaces('# Design\n\n## Colour\n\n- cream\n- orange\n'), null, 'a list about colour is not a list of surfaces')
  // Measured on a real project: two bullets of advice about Motion's `layout` prop were read as a
  // document describing two surfaces. A heading that is a sentence is not an enumeration.
  assert.equal(statedSurfaces('# Spec\n\n### 4.5 Layout transitions between panels\n\n- rule one\n- rule two\n'), null)
  assert.deepEqual(statedSurfaces('# Spec\n\n### 4.5 Surfaces\n\n- a\n- b\n- c\n'),
    { count: 3, how: '3 items listed under "### 4.5 Surfaces"' }, 'a numbered section heading is still a name')
})

// Three real headings off this machine, each of which was fabricating a count through the
// enumeration path: every one is short enough to pass the three-word rule and every one heads a
// list of RULES. "## CLI surface" put a CLI's five commands against a scraped page's 57 panels.
test('a heading that merely contains a surface word does not enumerate surfaces', () => {
  assert.equal(statedSurfaces('# Plan\n\n## CLI surface\n\n- init\n- render\n- lint\n- watch\n'), null,
    "a CLI's surface is not a screen's surfaces")
  assert.equal(statedSurfaces('# Plan\n\n# Layout\n\n- grid\n- rhythm\n- scale\n- air\n'), null,
    'a list of layout rules is not a list of surfaces')
  assert.equal(statedSurfaces('# Spec\n\n### 2. Root Screen Containment\n\n- a\n- b\n- c\n- d\n'), null,
    'a heading ending in a rule is a rule, whatever words precede it')
})

// The comparison takes the MOST GENEROUS count any design document states, and nothing asserted
// that until now: flipping it back to the minimum — the adversarial-selection bug it was changed
// to fix — passed all 22 tests. A project is only disagreeing with ITSELF once the implementation
// exceeds every count it states; disagreeing with the smallest is disagreeing with one sentence.
test('the most generous stated count wins, so one loose sentence cannot convict a project', (t) => {
  const r = check(tree(t, {
    'app.html': page(9, { primaries: 1 }),
    'docs/design-onboarding.md': '# Onboarding\n\nThe onboarding strip is three panels.\n',
    'docs/design-app.md': '# App\n\nThe app is nine screens.\n',
  }))
  assert.deepEqual(hit(r, /design document describes/), [],
    `9 surfaces against a documented nine is agreement; the three-panel sentence is about one strip: ${JSON.stringify(whats(r))}`)
})

// A tree is not always one project. Measured on this machine: a memory note about one project
// ("four surfaces") read against another project's report template, in a directory tree that
// merely contains both. A document governs markup it shares a top directory with, or one that
// sits as near the root as the markup does — otherwise the two numbers are unrelated.
test('a document that cannot be governing this markup is not read against it', (t) => {
  const r = check(tree(t, {
    'plugins/marketplace/app/ui/template.html': page(12, { primaries: 1 }),
    'projects/other/memory/notes-design.md': '# Notes\n\nThat project is four surfaces.\n',
  }))
  assert.deepEqual(r.findings, [],
    `a note four directories away, under a different top-level directory, is not this screen's design document: ${JSON.stringify(whats(r))}`)
})

test('the implementation is reported against its own design document, with both numbers', (t) => {
  const r = check(tree(t, {
    'app.html': page(12, { primaries: 1 }),
    'docs/design.md': '# Design\n\n## Surfaces\n\n- The answer\n- The reasoning\n- The inputs\n- Everything else\n',
  }))
  const f = hit(r, /design document describes/)[0]
  assert.ok(f, `expected a document-disagreement finding, got ${JSON.stringify(whats(r))}`)
  assert.match(f.what, /presents 12 surfaces where the design document describes 4/)
  assert.match(f.evidence, /docs\/design\.md/, 'the document that disagrees is named by path')
  assert.deepEqual(hit(r, /no design document/), [], 'a document exists, so the missing-document finding stays quiet')
})

test('an implementation that matches its document is not reported', (t) => {
  const r = check(tree(t, {
    'app.html': page(12, { primaries: 1 }),
    'docs/design.md': `# Design\n\n## Surfaces\n\n${Array.from({ length: 11 }, (_, i) => `- surface ${i}`).join('\n')}\n`,
  }))
  assert.deepEqual(hit(r, /design document describes/), [], '12 against a documented 11 is agreement, not drift')
})

// ── the founding instance ────────────────────────────────────────────────────────────────────
// "The intended experience is one actionable instruction with deeper explanation available. The
// implemented structure still contains 15 panels across six groups, while the design document
// describes four coordinated surfaces."
//
// This went unreported for one reason, and it was not the census: the dashboard carries no
// interactive control at all, so `controls < MIN_CONTROLS` classified it as a poster and dropped
// it before the two numbers met. A screen that asks you to do nothing IS this class — the screen
// heuristic was excluding the defect it was named for. The comparison now runs on any markup root
// once a design document states a count, and the two tests below are both halves of that: the
// instance fires, and a control-less tree with no stated count stays exactly as silent as before.

test('the founding instance: 15 panels, no controls, against a document naming four surfaces', (t) => {
  const panels = Array.from({ length: 15 }, (_, i) =>
    `    <section class="panel"><h3>Panel ${i + 1}</h3><p>value</p></section>`).join('\n')
  const r = check(tree(t, {
    'design/directions.md':
      '# Direction\n\nThe screen is four coordinated surfaces: the answer, the evidence, the\n'
      + 'controls, and the history. One actionable instruction, with the explanation a click away.\n',
    'src/dashboard.html': `<main>\n  <div class="group">\n${panels}\n  </div>\n</main>\n`,
  }))
  const f = hit(r, /design document describes/)[0]
  assert.ok(f, `the instance that named this class was not reported: ${JSON.stringify(whats(r))}`)
  assert.match(f.what, /presents 15 surfaces where the design document describes 4/)
  assert.match(f.evidence, /design\/directions\.md: "four coordinated surfaces"/, 'the count is read from a sentence, not only from a list')
  assert.match(f.evidence, /0 interactive controls/, 'no control at all is the point, so the count is in the evidence')
  assert.equal(f.file, 'src/dashboard.html')
  assert.equal(r.findings.length, 1, `one finding, not a pile: ${JSON.stringify(whats(r))}`)
  assert.match(r.note, /none of them a screen/, 'it still reports honestly that nothing here passes the screen heuristic')
})

test('the widening is only the comparison — a control-less tree with no stated count is as silent as before', (t) => {
  const sections = Array.from({ length: 15 }, (_, i) => `  <section class="panel-${i}"><h3>${i}</h3></section>`).join('\n')
  const r = check(tree(t, {
    'design/directions.md': '# Direction\n\nA warm ground, one accent, and generous air.\n',
    'report.html': `<main>\n${sections}\n</main>\n`,
  }))
  assert.deepEqual(r.findings, [], `a rendered report is still a document: ${JSON.stringify(whats(r))}`)
  assert.deepEqual(hit(r, /no design document/), [], 'the "write it down" advice still needs a real screen in front of it')
})

test('with no design document the finding is one per tree, not one per file', (t) => {
  const r = check(tree(t, { 'a.html': page(12), 'b.html': page(14), 'c.html': page(11) }))
  const missing = hit(r, /no design document/)
  assert.equal(missing.length, 1)
  assert.match(missing[0].evidence, /b\.html has 14 top-level surfaces/, 'it names the widest screen it found')
  assert.match(missing[0].evidence, /no design\/direction\/spec document/, 'with none in the tree it may say so plainly')
  assert.equal(hit(r, /top-level surfaces and/).length, 3, 'the per-screen finding is still per screen')
})

// "No design document states how many surfaces" and "there is no design document" are different
// claims, and this check can only make the first: a document that writes its count in digits is
// read and not understood. Reporting that as an absence is the claims class, inside the gate.
test('a design document this cannot read is not reported as no document at all', (t) => {
  const r = check(tree(t, {
    'a.html': page(12),
    'docs/design.md': '# Design\n\nThe shell is 3 surfaces, and the tone is warm.\n',
  }))
  const missing = hit(r, /no design document/)
  assert.equal(missing.length, 1, JSON.stringify(whats(r)))
  assert.match(missing[0].evidence, /1 design\/direction\/spec document\(s\) in this tree/,
    'the evidence says a document was read and not understood, rather than claiming none exists')
})

test('a tidy tree with no document is silent — the missing document is only interesting once a screen is growing', (t) => {
  const r = check(tree(t, { 'a.html': page(4, { primaries: 1 }), 'b.html': page(3, { primaries: 1 }) }))
  assert.deepEqual(r.findings, [], JSON.stringify(whats(r)))
})

// ── the threshold has an author ──────────────────────────────────────────────────────────────

test('the surface ceiling is overridable, and the note states the number in force', (t) => {
  const dir = tree(t, { 'app.html': page(6) })
  const cli = (env) => {
    const r = spawnSync(process.execPath, [TOOL, dir, '--only=decision', '--json'], {
      encoding: 'utf8', timeout: 60000, env: { ...process.env, ...env },
    })
    return JSON.parse(r.stdout).checks[0]
  }
  assert.equal(cli({}).findings.length, 0, 'six surfaces is under the default ceiling of eight')
  const tight = cli({ CGC_BEHAVIOUR_SURFACE_MAX: '4' })
  assert.equal(tight.findings.length, 2, 'a ceiling of four makes the same screen a finding')
  assert.match(tight.note, /more than 4 top-level surfaces/, 'the note reports the threshold actually applied')
})

test('the shape the driver expects comes back from every finding', (t) => {
  const r = check(tree(t, { 'app.html': page(12) }))
  assert.ok(r.findings.length)
  for (const f of r.findings) {
    assert.equal(typeof f.file, 'string')
    assert.ok(f.line === null || Number.isInteger(f.line))
    for (const k of ['what', 'evidence', 'fix']) assert.ok(f.what && typeof f[k] === 'string' && f[k].length, `${k} is missing`)
  }
  assert.ok(typeof r.note === 'string' && r.note.length)
})

test('CGC itself: every markup file it ships is a document, and the check says so rather than passing silently', () => {
  const r = run(buildContext([REPO]))
  assert.deepEqual(r.findings, [], JSON.stringify(whats(r)))
  assert.match(r.note, /none of them a screen/)
  assert.ok(r.scanned > 0, 'files were read')
})
