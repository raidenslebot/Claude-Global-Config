#!/usr/bin/env node
// run.js — hand every test file to node's runner by explicit absolute path.
//
//   node test/run.js            all tests
//   node test/run.js graph      only files whose name contains "graph"
//
// Why this exists instead of a glob in package.json: `node --test "test/**/*.test.js"` only
// works where node expands the glob itself (21+); on the Node 20 that CI pins, and on a
// Windows npm that runs scripts through cmd.exe (which expands nothing), the pattern is taken
// literally and the run fails on "pattern not found" rather than on a test. Explicit paths are
// the one form every supported version accepts. Same reasoning as tools/run-tests.mjs.

import { readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const filter = process.argv[2]

const files = readdirSync(HERE, { recursive: true })
  .map(String)
  .filter((f) => /\.test\.js$/.test(f))
  .filter((f) => !filter || f.includes(filter))
  .map((f) => resolve(HERE, f))
  .sort()

if (files.length === 0) {
  console.error(filter ? `no test files matching "${filter}"` : `no test files under ${HERE}`)
  process.exit(1)
}

const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
process.exit(r.status ?? 1)
