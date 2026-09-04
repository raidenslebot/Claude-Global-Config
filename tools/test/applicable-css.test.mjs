// The invariant that ends a class of bug, property-tested rather than argued.
//
// Deciding whether a stylesheet rule belongs to the page being judged is a heuristic: it reads
// selectors without a DOM, and it will keep being wrong at the edges. That is tolerable. What is
// not tolerable is what it used to do when wrong — it DELETED the rule, so a selector it misread
// removed a real 0.15pt hairline from a press report and the card came back clean.
//
// So the contract is narrow and absolute: the text comes back byte-identical, and applicability
// is expressed only as ranges the caller may use to lower a finding's weight. A misread selector
// then costs severity, never visibility. These tests fuzz that contract, because "I checked the
// cases I thought of" is exactly how the deletion bug shipped.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applicableCss } from '../paths.mjs'
import { lint } from '../print-lint.mjs'

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cgc-applicable-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** A deterministic pseudo-random generator: a failing seed can be replayed exactly. */
function rng(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

const PIECES = [
  '.a{color:red}', '.b .c{border-top:0.1pt solid}', '@media print{.d{font-size:2pt}}',
  '/* }{ a comment with braces */', 'body{margin:0}', '.e:not(.f){font-size:3pt}',
  '.g[data-x="}"]{color:blue}', '@supports (display:grid){@media print{.h{color:teal}}}',
  ':root{--x:1}', '.i,.j{padding:0}', 'a::before{content:"}"}', '.k\\[3pt\\]{font-size:1pt}',
  '\n', '  ', '@import "x.css";', '}', '{', '.l{', 'p{color:#000}\r\n',
]

test('the text comes back byte-identical, whatever the input', () => {
  // 20,000 assembled stylesheets, plus every hand-built pathological case. If this ever fails,
  // a measurement can vanish from a report — which is the failure this contract exists to make
  // impossible, not merely unlikely.
  for (let seed = 1; seed <= 20000; seed++) {
    const r = rng(seed)
    let css = ''
    const n = 1 + Math.floor(r() * 6)
    for (let i = 0; i < n; i++) css += PIECES[Math.floor(r() * PIECES.length)]
    const markup = r() < 0.5 ? '<p class="a">x</p>' : '<div class="b c" id="q">y</div>'
    const out = applicableCss(css, markup)
    assert.equal(out.css, css, `seed ${seed}: text changed\n--- in\n${css}\n--- out\n${out.css}`)
    for (const [a, b] of out.ranges) {
      assert.ok(Number.isInteger(a) && Number.isInteger(b) && a <= b, `seed ${seed}: bad range ${a},${b}`)
      assert.ok(a >= 0 && b <= css.length, `seed ${seed}: range ${a},${b} outside 0..${css.length}`)
    }
  }
})

test('a range only ever covers a rule body, never a selector or another rule', () => {
  const css = '.keep{font-size:9pt}\n.drop{font-size:2pt}\n.keep2{font-size:8pt}'
  const { css: out, ranges } = applicableCss(css, '<p class="keep keep2">x</p>')
  assert.equal(out, css)
  assert.equal(ranges.length, 1, 'exactly one rule names nothing on this page')
  const [a, b] = ranges[0]
  assert.equal(css.slice(a, b), 'font-size:2pt', 'the range is the body of the rule that does not apply')
})

test('every measurement that renders on the page is reported, whatever the selector looks like', (t) => {
  // The claim, end to end and from the outside. Each of these rules DOES apply; the scanner is
  // given every reason found so far to think otherwise.
  const d = scratch(t)
  const rules = [
    ['comment-above', '/* .some-other-page */\n.r1{border-top:0.11pt solid}', 'r1', /0\.11pt/],
    ['not-argument', '.r2:not(.never){font-size:2.1pt}', 'r2', /2\.1pt/],
    ['attribute', '.r3[data-x]{border-top:0.12pt solid}', 'r3', /0\.12pt/],
    ['inside-media', '@media print{.r4{font-size:2.2pt}}', 'r4', /2\.2pt/],
    ['escaped', '.r5\\[x\\]{border-top:0.13pt solid}', 'r5[x]', /0\.13pt/],
    ['comma-list', '.zz,.r6{font-size:2.3pt}', 'r6', /2\.3pt/],
    ['descendant', 'main .r7{border-top:0.14pt solid}', 'r7', /0\.14pt/],
  ]
  for (const [name, rule, cls, needle] of rules) {
    writeFileSync(join(d, `${name}.css`), `@page{size:3.5in 2in;margin:0}\nbody{font-family:Archivo;font-size:9pt}\n${rule}`, 'utf8')
    const p = join(d, `${name}.html`)
    writeFileSync(p, `<!doctype html><html><head><link href="${name}.css" rel="stylesheet"></head>`
      + `<body><main><div class="${cls}">x</div></main></body></html>`, 'utf8')
    const findings = lint(p, {}).findings
    assert.ok(findings.some((f) => needle.test(f.msg)), `${name}: the measurement must appear at all`)
    assert.ok(findings.some((f) => needle.test(f.msg) && f.level === 'fail'),
      `${name}: it applies, so it must FAIL — got ${findings.filter((f) => needle.test(f.msg)).map((f) => f.level).join(',') || 'nothing'}`)
  }
})

test('a rule that does not render is graded down, never removed, and the omission is named', (t) => {
  const d = scratch(t)
  writeFileSync(join(d, 'set.css'), '@page{size:3.5in 2in;margin:0}\nbody{font-family:Archivo;font-size:9pt}\n'
    + '.only-on-the-letterhead{font-size:2pt;border-top:0.05pt solid}', 'utf8')
  const p = join(d, 'card.html')
  writeFileSync(p, '<!doctype html><html><head><link href="set.css" rel="stylesheet"></head>'
    + '<body><p class="name">x</p></body></html>', 'utf8')
  const findings = lint(p, {}).findings

  assert.ok(findings.some((f) => /2pt/.test(f.msg)), 'the measurement is still in the report')
  assert.ok(!findings.some((f) => /2pt/.test(f.msg) && f.level === 'fail'), 'but it is not this page\'s failure')
  assert.ok(findings.some((f) => f.rule === 'scope'), 'and what was set aside is named')
})
