// An icon SET is judged as a set. A single icon is almost never wrong; a set is wrong
// constantly, and always in ways that are invisible when the icons are looked at one at a time
// — which is how they are always looked at.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO } from '../paths.mjs'
import { icons, read, lintSet } from '../icon-lint.mjs'

const TOOL = join(REPO, 'tools', 'icon-lint.mjs')
const SHIPPED = join(REPO, 'skills', 'design-fields', 'examples', 'harbor-swim-club-icons')

const ok = (extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"${extra}><path d="M4 12h16"/></svg>`

function set(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'icons-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body, 'utf8')
  return dir
}
function lint(dir, args = []) {
  const r = spawnSync(process.execPath, [TOOL, dir, '--json', ...args], { encoding: 'utf8', timeout: 60000 })
  return { status: r.status, json: JSON.parse(r.stdout) }
}
const ids = (j) => j.findings.map((f) => f.id)

test('a sprite is read as its symbols, and a plain file as one icon', () => {
  const sprite = '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="a" viewBox="0 0 24 24"><path d="M0 0"/></symbol><symbol id="b" viewBox="0 0 24 24"><path d="M1 1"/></symbol></svg>'
  assert.equal(icons(sprite, 's.svg').length, 2)
  assert.deepEqual(icons(sprite, 's.svg').map((i) => i.name), ['s.svg#a', 's.svg#b'])
  assert.equal(icons(ok(), 'one.svg').length, 1)
  assert.equal(icons('not an svg at all', 'x.svg').length, 0)
})

test('the set that ships agrees with itself', () => {
  const r = lint(SHIPPED)
  assert.equal(r.json.ok, true, JSON.stringify(r.json.findings, null, 1))
  assert.equal(r.json.grid, '0 0 24 24')
  assert.equal(r.json.stroke, 2, 'a stroke width is a number, whatever unit it was written in')
  assert.ok(r.json.count >= 8)
})

test('the majority is the rule, and every icon that breaks it is named', (t) => {
  const dir = set(t, {
    'a.svg': ok(), 'b.svg': ok(), 'c.svg': ok(),
    'grid.svg': ok().replace('0 0 24 24', '0 0 20 20'),
    'weight.svg': ok().replace('stroke-width="2"', 'stroke-width="1.5"'),
  })
  const { json, status } = lint(dir)
  assert.ok(ids(json).includes('off-grid-set'), 'a different grid is named')
  assert.ok(ids(json).includes('stroke-weight'), 'a different weight is named')
  assert.equal(json.grid, '0 0 24 24', 'the majority sets the rule')
  assert.equal(status, 0, 'without --strict it reports rather than fails')
  assert.equal(lint(dir, ['--strict']).status, 1)
})

test('what is wrong at any size is wrong in a set of one', (t) => {
  const text = set(t, { 'a.svg': '<svg viewBox="0 0 24 24" stroke="currentColor"><text x="4" y="16">A</text></svg>' })
  assert.ok(ids(lint(text).json).includes('live-text'))

  const raster = set(t, { 'a.svg': '<svg viewBox="0 0 24 24"><image href="data:image/png;base64,iVBOR" width="24"/></svg>' })
  assert.ok(ids(lint(raster).json).includes('raster'))

  const pinned = set(t, { 'a.svg': ok().replace('stroke="currentColor"', 'stroke="#ff5a1f"') })
  assert.ok(ids(lint(pinned).json).includes('hardcoded-colour'))

  const noBox = set(t, { 'a.svg': '<svg xmlns="http://www.w3.org/2000/svg" stroke="currentColor"><path d="M0 0"/></svg>' })
  assert.ok(ids(lint(noBox).json).includes('no-viewbox'))
})

test('a stroke is judged at the size the set is actually used at', (t) => {
  const dir = set(t, { 'a.svg': ok().replace('0 0 24 24', '0 0 64 64') })
  assert.ok(ids(lint(dir, ['--size', '16']).json).includes('thin-at-size'),
    'stroke 2 on a 64 grid is half a pixel at 16px')
  assert.ok(!ids(lint(dir, ['--size', '64']).json).includes('thin-at-size'),
    'at the size it was drawn for it is fine')
})

test('drawn on the grid passes; traced off it is reported', () => {
  const drawn = read(icons(ok(), 'a.svg')[0])
  assert.equal(drawn.offGrid, 0)
  const traced = read(icons('<svg viewBox="0 0 64 64" stroke="currentColor" stroke-width="2"><path d="M8.137 32.482c3.229-1.884 7.913-4.221 11.664.918 2.774 3.117 5.331 1.006 8.42-.774"/></svg>', 'b.svg')[0])
  assert.ok(traced.offGrid >= 8)
  assert.ok(lintSet([traced], { size: 16 }).findings.some((f) => f.id === 'traced'))
  // Halves and quarters are drawing on the grid, not off it.
  const halves = read(icons('<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M4.5 12.5h15.5m-8-8.25v16.25M2.75 6.5h18.25m-9 .75v9.5"/></svg>', 'c.svg')[0])
  assert.equal(halves.offGrid, 0, 'a half or a quarter is on the grid')
})

test('--help exits 0 and a missing path is a failure', () => {
  const help = spawnSync(process.execPath, [TOOL, '--help'], { encoding: 'utf8', timeout: 30000 })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /cgc icons/)
  const missing = spawnSync(process.execPath, [TOOL, join(tmpdir(), 'no-icons-here-8812')], { encoding: 'utf8', timeout: 30000 })
  assert.equal(missing.status, 1)
})

// ── Not finding something is never the same as it not being there ────────────────────────────
// Every case below used to end in a green verdict, which is the worst way for a gate to be
// wrong: the author is told their work is fine when it is not.

test('a sprite inherits the root attributes and the document stylesheet', (t) => {
  // Everything outside <symbol> was discarded, so a set hard-pinned to two hex colours and
  // stroking at a quarter of a pixel was declared clean.
  const dir = set(t, {
    'sprite.svg': [
      '<svg xmlns="http://www.w3.org/2000/svg" fill="#e11d48" stroke="#0f172a">',
      '<style>svg symbol path { stroke-width: 0.25; }</style>',
      '<defs>',
      '<symbol id="a" viewBox="0 0 24 24"><path d="M4 12h16"/></symbol>',
      '<symbol id="b" viewBox="0 0 24 24"><path d="M4 6h16"/></symbol>',
      '</defs></svg>',
    ].join('\n'),
  })
  const { json } = lint(dir)
  assert.equal(json.ok, false, 'a pinned, hairline sprite is not clean')
  assert.ok(ids(json).includes('hardcoded-colour'), 'the root colours apply to every symbol')
  assert.ok(ids(json).includes('thin-at-size'), 'the stylesheet stroke applies to every symbol')
  assert.equal(json.stroke, 0.25)
})

test('a comment is not read as artwork, in either direction', (t) => {
  // A comment mentioning <symbol> turned a plain icon into a sprite of one empty symbol and
  // the real document — live text, a raster and a pinned colour — was thrown away.
  const disguised = set(t, {
    'a.svg': [
      '<svg viewBox="0 0 24 24" fill="#ff0000">',
      '<!-- in the sprite this becomes <symbol id="x" viewBox="0 0 24 24"></symbol> -->',
      '<text x="2" y="20">LIVE</text>',
      '<image href="data:image/png;base64,iVBORw0KGgo="/>',
      '</svg>',
    ].join('\n'),
  })
  const found = ids(lint(disguised).json)
  for (const id of ['live-text', 'raster', 'hardcoded-colour']) {
    assert.ok(found.includes(id), `${id} must survive a comment that mentions <symbol>`)
  }
  // And the other way: a rejected variant inside a comment is not a live declaration.
  const commented = set(t, {
    'b.svg': '<svg viewBox="0 0 24 24" stroke="currentColor">\n<!-- rejected: stroke-width="0.5" -->\n<path d="M4 12h16" stroke-width="2"/>\n</svg>',
  })
  assert.deepEqual(ids(lint(commented).json), [], 'a commented-out hairline is not a hairline')
})

test('the thinnest stroke in an icon is the one that has to survive the size', (t) => {
  const dir = set(t, {
    'a.svg': ok(), 'b.svg': ok(), 'c.svg': ok(),
    'hair.svg': '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M4 12h16"/><path d="M4 6h16" stroke-width="0.4"/></svg>',
  })
  const found = ids(lint(dir).json)
  assert.ok(found.includes('thin-at-size'), 'a 0.4 stroke on a 24 grid is a quarter pixel at 16px')
  assert.ok(found.includes('stroke-weight'), 'and it is not the weight the set uses')
})

test('a deferred colour is the opposite of a pinned one', (t) => {
  const token = set(t, { 'a.svg': ok().replace('stroke="currentColor"', 'stroke="var(--icon)"') })
  assert.ok(!ids(lint(token).json).includes('hardcoded-colour'), 'a var() is handed its colour')
  // But the stops inside a gradient are a real pin, and were being missed entirely.
  const grad = set(t, {
    'b.svg': '<svg viewBox="0 0 24 24" stroke-width="2"><defs><linearGradient id="g"><stop stop-color="#ff0000"/></linearGradient></defs><path d="M4 12h16" fill="url(#g)"/></svg>',
  })
  const f = lint(grad).json.findings.find((x) => x.id === 'hardcoded-colour')
  assert.ok(f, 'a gradient pinned to a hex is pinned')
  assert.match(f.note, /#ff0000/, 'and the note names the colour, not the url()')
})

test('a self-closing symbol does not swallow the next one', (t) => {
  const dir = set(t, {
    'sprite.svg': '<svg stroke="currentColor" stroke-width="2"><symbol id="placeholder" viewBox="0 0 24 24"/>'
      + '<symbol id="real-one" viewBox="0 0 20 20"><text x="2" y="16">A</text></symbol>'
      + '<symbol id="real-two" viewBox="0 0 24 24"><path d="M4 12h16"/></symbol></svg>',
  })
  const { json } = lint(dir)
  assert.equal(json.count, 3, 'all three symbols are read')
  const live = json.findings.find((f) => f.id === 'live-text')
  assert.ok(live && live.icon.endsWith('#real-one'), `the finding belongs to the icon that has the text, got ${live && live.icon}`)
  assert.ok(ids(json).includes('off-grid-set'), 'and the 20 grid is still caught')
})

test('a length is a number whatever unit it is written in', (t) => {
  const dir = set(t, {
    'a.svg': ok(), 'b.svg': ok(),
    'c.svg': '<svg viewBox="0 0 24 24" stroke="currentColor" style="stroke-width:2px"><path d="M4 12h16"/></svg>',
  })
  assert.deepEqual(ids(lint(dir).json), [], '2px and 2 are the same weight')
})

test('only path coordinates count as coordinates', (t) => {
  const paths = Array.from({ length: 8 }, (_, i) => `<path d="M${i} ${i}h4" opacity="0.87"/>`).join('')
  const dir = set(t, { 'a.svg': `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">${paths}</svg>` })
  assert.ok(!ids(lint(dir).json).includes('traced'), 'eight opacity values are not eight traced coordinates')
})

test('an attribute value containing a bracket does not truncate the tag', (t) => {
  const dir = set(t, { 'a.svg': '<svg aria-label="a > b" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M4 12h16"/></svg>' })
  assert.ok(!ids(lint(dir).json).includes('no-viewbox'), 'the viewBox is in the tag and must be found')
})

test('a file in the set that cannot be read is reported, not dropped', (t) => {
  const dir = set(t, { 'a.svg': ok(), 'b.svg': ok(), 'c.svg': ok(), 'broken.svg': 'not an svg at all' })
  const { json, status } = lint(dir, ['--strict'])
  assert.equal(json.count, 3)
  const f = json.findings.find((x) => x.id === 'unreadable')
  assert.ok(f, 'a hole in the report reads as a pass')
  assert.match(f.note, /has not been judged/)
  assert.equal(status, 1, 'and it is a failure, because nothing verified it')
})

test('fill="none" is not a filled icon, and --size wants a real size', (t) => {
  const dir = set(t, { 'a.svg': '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M4 12h16" fill="none"/></svg>' })
  assert.deepEqual(ids(lint(dir).json), [], 'a stroked icon that says fill="none" is not mixed')
  for (const bad of [['--size', 'abc'], ['--size', '-5'], ['--size']]) {
    const r = spawnSync(process.execPath, [TOOL, dir, ...bad], { encoding: 'utf8', timeout: 30000 })
    assert.equal(r.status, 1, `--size ${bad[1] ?? '(nothing)'} must be refused, not silently defaulted`)
  }
})

test('a folder of drawings that share no grid is not judged as an icon set', () => {
  // An identity system: a favicon at 32, a mark at 350, a lockup at 469×166, a wordmark at 287×49.
  const svg = (box, stroke, colour) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}"><path d="M1.7 2.3 L9.1 4.4" fill="none" stroke="${colour}" stroke-width="${stroke}"/></svg>`
  const set = [
    { name: 'favicon.svg', text: svg('0 0 32 32', 7, '#1f2a44') },
    { name: 'mark.svg', text: svg('0 0 350 350', 16, '#1f2a44') },
    { name: 'lockup.svg', text: svg('-13 -13 468.77 166', 9, '#1f2a44') },
    { name: 'wordmark.svg', text: svg('0 13.63 286.77 48.71', 9, '#1f2a44') },
  ].flatMap((f) => icons(f.text, f.name)).map(read)
  const r = lintSet(set, { size: 16 })
  const ids = new Set(r.findings.map((f) => f.id))
  for (const rule of ['off-grid-set', 'stroke-weight', 'hardcoded-colour', 'thin-at-size', 'traced']) {
    assert.equal(ids.has(rule), false, `${rule} is a question about a set, and these are not one`)
  }
  assert.ok(ids.has('not-a-set'), 'and it has to SAY the set rules did not run')

  // A real set still answers to all of them.
  const real = ['a', 'b', 'c', 'd'].map((n, i) =>
    icons(svg('0 0 24 24', i === 3 ? 1 : 2, i === 2 ? '#f00' : 'currentColor'), n + '.svg')).flat().map(read)
  const rr = lintSet(real, { size: 16 })
  const rids = new Set(rr.findings.map((f) => f.id))
  assert.ok(rids.has('stroke-weight'), 'one icon at a different weight is still the point of this tool')
  assert.ok(rids.has('hardcoded-colour'))
  assert.equal(rids.has('not-a-set'), false)
})
