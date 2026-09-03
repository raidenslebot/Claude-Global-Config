// screen-render is the loop's eyes: a page at the widths people use, or a canvas at the exact
// pixels a platform wants, and the faces that failed to load named. These check the pixels are
// exact (the PNG header is read), that a preset captures the viewport and nothing more, that a
// failed @font-face is reported, and that the tool refuses cleanly without a browser.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { main, PRESETS, DESKTOP, MOBILE } from '../screen-render.mjs'
import { findPlaywright } from '../print-render.mjs'
import { REPO } from '../paths.mjs'

const BROWSER = Boolean(findPlaywright())
const skip = BROWSER ? false : 'no browser available (install the Playwright MCP server)'

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'screen-render-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
/** Width and height from a PNG's IHDR — no image library needed. */
function pngSize(file) {
  const b = readFileSync(file)
  assert.equal(b.toString('latin1', 1, 4), 'PNG')
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  @font-face { font-family: "Ghost Face"; src: url(does-not-exist.woff2) format("woff2"); }
  body { margin: 0; font-family: "Ghost Face", serif; background: #f4f1ea; color: #222; }
  .tall { height: 2400px; }
</style></head><body><h1>Handgloves</h1><div class="tall"></div></body></html>`

test('the presets are exact canvases and the defaults are the widths people use', () => {
  assert.deepEqual([PRESETS['ig-post'].width, PRESETS['ig-post'].height], [1080, 1350])
  assert.deepEqual([PRESETS.story.width, PRESETS.story.height], [1080, 1920])
  assert.deepEqual([PRESETS.slide.width, PRESETS.slide.height], [1920, 1080])
  assert.deepEqual([PRESETS['app-icon'].width, PRESETS['app-icon'].height], [1024, 1024])
  assert.equal(DESKTOP.width, 1440)
  assert.equal(MOBILE.width, 390)
  for (const [k, p] of Object.entries(PRESETS)) assert.ok(p.width > 0 && p.height > 0, k)
})

test('desktop and phone renders are the viewport size; --full captures the whole page; a failed face is named', { skip }, async (t) => {
  const d = scratch(t)
  const f = join(d, 'page.html'); writeFileSync(f, PAGE)
  const out = join(d, 'shot')
  // PAGE asks for a face that cannot load, and a render in the wrong face is not a render of
  // this design: the exit code says so now, as the JSON always did.
  assert.equal(await main([f, '--mobile', '--out', out]), 1)
  assert.deepEqual(pngSize(`${out}-1440.png`), { width: 1440, height: 900 })
  assert.deepEqual(pngSize(`${out}-390.png`), { width: 390, height: 844 })
  assert.equal(await main([f, '--full', '--out', join(d, 'full')]), 1)
  assert.ok(pngSize(join(d, 'full-1440.png')).height > 2000, 'full page is taller than the viewport')
  const r = spawnSync(process.execPath, [join(REPO, 'tools', 'screen-render.mjs'), f, '--json', '--out', join(d, 'j')], { encoding: 'utf8', timeout: 120000 })
  assert.equal(r.status, 1, r.stderr)
  const j = JSON.parse(r.stdout)
  assert.equal(j.ok, false, 'a failed face makes the run not ok')
  assert.ok(j.shots[0].fontsFailed.includes('Ghost Face'), JSON.stringify(j.shots[0]))
})

test('a preset captures exactly its pixels, never the full page', { skip }, async (t) => {
  const d = scratch(t)
  const f = join(d, 'post.html'); writeFileSync(f, PAGE)
  const out = join(d, 'post')
  assert.equal(await main([f, '--preset', 'ig-post', '--full', '--out', out]), 1, 'the fixture face still cannot load')
  assert.deepEqual(pngSize(`${out}-ig-post.png`), { width: 1080, height: 1350 })
  assert.ok(!existsSync(`${out}-1440.png`), 'a preset replaces the desktop viewport')
})

test('usage on a bad viewport or an unknown preset, and no stack trace on a missing file', async () => {
  assert.equal(await main(['nope-' + process.pid + '.html']), 1)
  if (!BROWSER) return
  const d = mkdtempSync(join(tmpdir(), 'screen-render-'))
  const f = join(d, 'p.html'); writeFileSync(f, PAGE)
  assert.equal(await main([f, '--viewport', 'wide']), 1)
  assert.equal(await main([f, '--preset', 'billboard']), 1)
  rmSync(d, { recursive: true, force: true })
})

test('no browser: exit 2 with the install hint', { skip: BROWSER ? 'a browser is available' : false }, () => {
  const r = spawnSync(process.execPath, [join(REPO, 'tools', 'screen-render.mjs'), join(REPO, 'README.md')], { encoding: 'utf8', timeout: 60000 })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /playwright-core not found/)
})

test('a family that was never served is caught, though nothing declared it and nothing failed', { skip }, async (t) => {
  // document.fonts only knows faces the page DECLARED. A stylesheet that was never served —
  // a misspelled Google family answers 400 — declares nothing, so nothing can fail to load and
  // the render came back in the system serif with no word said about it.
  const d = scratch(t)
  const f = join(d, 'ghost.html')
  writeFileSync(f, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>G</title>
    <style>body{margin:0;padding:40px;font-family:"NoSuchFamilyAnywhere123",serif;background:#fff;color:#111;font-size:28px}</style>
    </head><body><p>A face nothing ever declared</p></body></html>`)
  const r = spawnSync(process.execPath, [join(REPO, 'tools', 'screen-render.mjs'), f, '--json', '--out', join(d, 'g')],
    { encoding: 'utf8', timeout: 120000 })
  const j = JSON.parse(r.stdout)
  assert.equal(j.ok, false)
  assert.ok(j.shots[0].fontsFellBack.includes('NoSuchFamilyAnywhere123'), JSON.stringify(j.shots[0]))
  assert.equal(j.shots[0].fontsFailed.length, 0, 'nothing was declared, so nothing could fail to load')
  assert.equal(r.status, 1)

  // A page that asks only for generics is not accused of anything.
  const plain = join(d, 'plain.html')
  writeFileSync(plain, '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>P</title>'
    + '<style>body{font-family:Georgia,serif;font-size:20px}</style></head><body><p>Set in a face that exists.</p></body></html>')
  const ok = spawnSync(process.execPath, [join(REPO, 'tools', 'screen-render.mjs'), plain, '--json', '--out', join(d, 'p')],
    { encoding: 'utf8', timeout: 120000 })
  assert.equal(ok.status, 0, ok.stdout + ok.stderr)
})
