// Removing a scratch directory is hygiene. It is not an assertion, and it must never be the
// thing that fails a test.
//
// This exists because it failed three times. A test would pass every assertion it makes and then
// raise `EPERM` in `t.after`, and the package would report itself DEGRADED — over a temp folder.
// On Windows a directory cannot be deleted while it is any process's current directory, and this
// suite deliberately starts processes that outlive the test body: the updater under test is
// detached BY DESIGN, and the render tests drive a real browser. So losing that race is the
// system behaving correctly, and the test's verdict must not depend on it.
//
// The first fix retried harder, and the next run lost the same race in a different test — there
// are forty-odd of these teardowns and patching whichever one lost was always going to leave the
// next. This one tries for ten seconds and then leaves the operating system its own temp folder
// to clean, which is what it is for.

import { rmSync } from 'node:fs'

/** Best-effort removal of a test's scratch directory. Never throws. */
export function discard(root) {
  for (let i = 0; i < 40; i++) {
    try {
      rmSync(root, { recursive: true, force: true })
      return
    } catch { /* a process still holds it; give it a moment */ }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
  }
}
