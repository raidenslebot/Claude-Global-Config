// specimen writes a page that shows a pairing and a palette set for real. The generator is
// tested without a browser: the faces reach the font request with their axis specs intact, the
// roles land on the right colours, and nothing in the page depends on the network but the fonts
// themselves. The render is screen-render's, tested there.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { specimenHtml, main } from '../specimen.mjs'
import { REPO } from '../paths.mjs'

const TOOL = join(REPO, 'tools', 'specimen.mjs')

test('the font request carries both families with their axis specs, and the roles are assigned in order', () => {
  const html = specimenHtml({
    display: 'Fraunces:ital,opsz,wght@1,9..144,300', text: 'Archivo:wght@400;500', mono: 'JetBrains Mono', italic: true,
    palette: ['oklch(0.97 0.012 80)', 'oklch(0.22 0.02 60)', 'oklch(0.55 0.17 25)'], words: 'Handgloves',
  })
  assert.match(html, /family=Fraunces:ital,opsz,wght@1,9\.\.144,300&family=Archivo:wght@400;500&family=JetBrains\+Mono/)
  assert.match(html, /--display: "Fraunces", serif/)
  assert.match(html, /--text: "Archivo", sans-serif/)
  assert.match(html, /--mono: "JetBrains Mono", ui-monospace/)
  assert.match(html, /--surface: oklch\(0\.97 0\.012 80\)/)
  assert.match(html, /--ink: oklch\(0\.22 0\.02 60\)/)
  assert.match(html, /<span class="k">signal<\/span>/)
  assert.match(html, /font-style: italic/)
  assert.match(html, /Handgloves/)
  assert.equal((html.match(/class="sw"/g) || []).length, 3)
})

test('without a palette there is no swatch section, and a display line has a default', () => {
  const html = specimenHtml({ display: 'Syne', text: 'IBM Plex Mono' })
  assert.ok(!/class="sws"/.test(html))
  assert.match(html, /Handgloves &amp; Quartz/)
  assert.match(html, /--surface: #f7f4ee/)
})

test('the CLI writes the page beside the requested base and stops before rendering with --no-render', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'specimen-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const out = join(dir, 'proofs', 'pair')
  const code = await main(['--display', 'Fraunces', '--text', 'Archivo', '--palette', 'oklch(0.97 0.012 80), #1a1815', '--out', out, '--no-render'])
  assert.equal(code, 0)
  assert.ok(existsSync(`${out}.html`))
  const html = readFileSync(`${out}.html`, 'utf8')
  assert.equal((html.match(/class="sw"/g) || []).length, 2, 'a comma inside oklch() must not split the palette')
})

test('usage, not a crash, when a face is missing', async () => {
  assert.equal(await main(['--display', 'Fraunces']), 1)
})

test('a family Google does not serve is refused, because a fallback specimen is a specimen of nothing', async () => {
  // This tool exists because a face is chosen by looking at it set. Asked for two families that
  // are not real it rendered the pairing in the system fallback, said nothing, and exited 0.
  const bad = spawnSync(process.execPath, [TOOL, '--display', 'NoSuchFamilyAnywhere123',
    '--text', 'Source Serif 4', '--out', join(mkdtempSync(join(tmpdir(), 'spec-')), 'x')],
  { encoding: 'utf8', timeout: 120000 })
  assert.equal(bad.status, 1, `expected a refusal, got ${bad.status}`)
  assert.match(bad.stderr, /serves no face for "NoSuchFamilyAnywhere123"/)
  assert.match(bad.stderr, /specimen of nothing/)
  assert.doesNotMatch(bad.stderr, /Assertion failed/, 'exit by code, never by aborting libuv')
})

test('the served families are read from the stylesheet, and being offline is not being wrong', async () => {
  const { missingFamilies } = await import('../specimen.mjs')
  // A stylesheet that serves one of the two.
  const one = await missingFamilies(['Archivo', 'Ghost Face'], 'data:text/css,' + encodeURIComponent(
    "@font-face { font-family: 'Archivo'; src: url(x) format('woff2') }"))
  assert.deepEqual(one.missing, ['Ghost Face'])
  // Unreachable is reported as unreachable and blocks nothing: offline is not the same as wrong.
  const off = await missingFamilies(['Archivo'], 'http://127.0.0.1:1/none.css')
  assert.deepEqual(off.missing, [])
  assert.match(off.why, /could not reach|ECONN|fetch failed/i)
})
