#!/usr/bin/env node
// split.mjs — one file per icon, from the sprite. Run from this directory: node split.mjs
// Each file is a standalone 24-grid SVG in currentColor, named after its symbol, so a shop or a
// developer who cannot use a sprite gets the same drawing. The sprite is the master; edit it,
// then split again.

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))
const sprite = readFileSync(join(DIR, 'sprite.svg'), 'utf8')
let n = 0
for (const m of sprite.matchAll(/<symbol id="([a-z-]+)"([^>]*)>([\s\S]*?)<\/symbol>/g)) {
  const [, id, attrs, body] = m
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"${attrs}>\n  <!-- ${id}: Harbor Swim Club icon set, 24 grid, stroke 2. The waterline at y=14 is the set's rule. Master: sprite.svg -->${body.replace(/\n  /g, '\n')}</svg>\n`
  writeFileSync(join(DIR, `${id}.svg`), svg, 'utf8')
  n++
}
console.log(`${n} icons written from sprite.svg`)
