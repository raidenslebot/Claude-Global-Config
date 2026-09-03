#!/usr/bin/env node
// run-tests.mjs — discover test files and hand them to node's runner explicitly.
//
//   node tools/run-tests.mjs            all tests
//   node tools/run-tests.mjs paths      only files whose name contains "paths"
//
// Why this exists rather than `node --test tools/test/` in the npm script:
//
//   - `node --test <directory>` fails here, resolving the directory as a module
//     ("Cannot find module ...\tools\test"). It reproduces in argo/ too, so it is
//     environmental, not a property of these tests.
//   - `node --test "tools/test/**/*.test.mjs"` works on node 21+, which expands the
//     glob itself, but NOT on node 20 — and CI pins node 20.
//   - A shell glob in the npm script is not portable either: npm runs scripts through
//     sh on POSIX (expands) and cmd.exe on Windows (does not).
//
// Passing explicit absolute paths is the one form every supported version accepts.

import { readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { askedForHelp } from './paths.mjs'

// A request for help is never a request to run the suite.
if (askedForHelp(import.meta.url)) process.exit(0)

const HERE = dirname(fileURLToPath(import.meta.url))
const TEST_DIR = join(HERE, 'test')
const filter = process.argv[2]

if (!existsSync(TEST_DIR)) {
  console.error(`no test directory at ${TEST_DIR}`)
  process.exit(1)
}

const files = readdirSync(TEST_DIR)
  .filter((f) => /\.test\.m?js$/.test(f))
  .filter((f) => !filter || f.includes(filter))
  .map((f) => resolve(TEST_DIR, f))
  .sort()

if (!files.length) {
  console.error(filter ? `no test files matching "${filter}"` : 'no test files found')
  process.exit(1)
}

const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
process.exit(r.status ?? 1)
