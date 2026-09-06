import { existsSync, readFileSync, writeFileSync, unlinkSync, openSync, writeSync, closeSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';

// CGC_HOOK_DEBUG=1 prints the reason for every early exit to stderr. Off by default: a hook's
// stdout is parsed as JSON and its stderr is shown to the user, so silence is the contract.
const dbg = (why) => { if (process.env.CGC_HOOK_DEBUG) process.stderr.write('react-doctor: ' + why + '\n'); };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --verbose scans on large diffs can exceed spawnSync's 1 MiB default.
const SPAWN_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

const EDIT_TOOL_NAMES = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'ApplyPatch']);

const readFileOrEmpty = (source) => {
  try {
    return readFileSync(source, 'utf8');
  } catch {
    return '';
  }
};

// react-doctor reads JavaScript and TypeScript. A write to a markdown file, an SVG, a stylesheet
// or a JSON config told it nothing about that file and reported the whole project — pages of
// pre-existing warnings about code the turn never touched, which is how a check gets switched
// off. So the gate is the written file's extension, and an event that names no file (a batch
// with no paths) still scans, as it did before.
const JS_LIKE = /\.(m?[jt]sx?|cjs|cts|mts)$/i;
const pathOf = (call) => String((call && (call.tool_input?.file_path || call.file_path || call.path)) || '');
const editsJs = (call) => {
  const p = pathOf(call);
  return p ? JS_LIKE.test(p) : true; // no path in the payload: cannot rule it out, so scan
};

const shouldScan = (input) => {
  const eventName = input.hook_event_name || input.eventName || input.event_name;
  if (eventName === 'PostToolBatch') {
    const toolCalls = Array.isArray(input.tool_calls) ? input.tool_calls : [];
    return toolCalls.some((toolCall) => EDIT_TOOL_NAMES.has(toolCall.tool_name) && editsJs(toolCall));
  }
  const toolName = input.tool_name || input.toolName || input.tool;
  if (toolName && !EDIT_TOOL_NAMES.has(toolName)) return false;
  return editsJs(input);
};

// The written file's own project — the nearest ancestor holding a package.json — not the
// session's working directory. Editing a file in one repo used to scan whichever project the
// session happened to be started in, so the report named code the edit never touched.
const projectRootFor = (file) => {
  let dir = file ? dirname(file) : '';
  while (dir && dir !== dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  return null;
};

const editedPath = (input) => {
  const calls = Array.isArray(input.tool_calls) ? input.tool_calls : [input];
  for (const call of calls) {
    const p = pathOf(call);
    if (p && JS_LIKE.test(p)) return p;
  }
  return '';
};

/** Does anything here actually use a framework react-doctor knows? Walk up from the written
 *  file to the nearest package.json and read its dependencies. This costs one file read; the
 *  alternative is an npm resolution plus a full-project scan that reaches the same conclusion
 *  after ~1.2 GB and forty seconds. A project with no package.json at all is not a JS project. */
const FRAMEWORKS = /^(react|react-dom|react-native|next|remix|@remix-run\/|preact|expo|@tanstack\/react-|gatsby|vue|nuxt|svelte|@sveltejs\/|solid-js|astro)/
const usesFramework = (from) => {
  // `from` may be a file or a directory. The first version took dirname() of whatever it was
  // given and was handed the PROJECT ROOT, so it began one level above the project and never
  // read the project's own package.json — the 16-scan fix "worked" by scanning nothing at all.
  let dir
  try { dir = statSync(from).isDirectory() ? resolve(from) : dirname(resolve(from)) } catch { dir = process.cwd() }
  // Every package.json up to the root, not the first one: a monorepo keeps react at the
  // workspace root with the app in packages/web, and the inverse layout exists too.
  let sawAny = false
  for (let i = 0; i < 12; i++) {
    const pkg = join(dir, 'package.json')
    if (existsSync(pkg)) {
      sawAny = true
      try {
        const j = JSON.parse(readFileSync(pkg, 'utf8'))
        const deps = Object.keys({ ...j.dependencies, ...j.devDependencies, ...j.peerDependencies, ...j.optionalDependencies })
        if (deps.some((d) => FRAMEWORKS.test(d))) return true
      } catch { return true }          // unreadable package.json: scan rather than skip silently
    }
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return false && sawAny
}

/** One scan at a time, machine-wide. A hook that fires on every write, in every session, with no
 *  mutual exclusion, stacks: each scan holds its own copy of the project. Sixteen of them is not
 *  sixteen times the information, it is the same answer sixteen times and a machine that stops.
 *  A scan that cannot get the slot is SKIPPED, never queued — the next write starts another one
 *  anyway, so queueing only guarantees the pile-up arrives later. */
const SCAN_LOCK = join(tmpdir(), 'cgc-react-doctor.lock')
const SCAN_LOCK_STALE_MS = 90000
const takeScanSlot = () => {
  try {
    const fd = openSync(SCAN_LOCK, 'wx')
    writeSync(fd, String(process.pid))
    closeSync(fd)
    return true
  } catch (e) {
    if (e.code !== 'EEXIST') return true            // cannot lock: scan rather than skip in silence
    try {
      if (Date.now() - statSync(SCAN_LOCK).mtimeMs > SCAN_LOCK_STALE_MS) {
        rmSync(SCAN_LOCK, { force: true })
        const fd = openSync(SCAN_LOCK, 'wx')
        writeSync(fd, String(process.pid))
        closeSync(fd)
        return true
      }
    } catch { /* another process took it first */ }
    return false
  }
}
const releaseScanSlot = () => { try { rmSync(SCAN_LOCK, { force: true }) } catch { /* already gone */ } }

const runReactDoctor = async (outputPath) => {
  // Each candidate is a single shell command string (not an args array):
  // `shell: true` is required to run the Windows `.cmd` shims, and an args
  // array with `shell: true` trips Node's DEP0190. A missing command exits
  // 127 via a POSIX shell (no ENOENT error) and 9009 via cmd.exe, so fall
  // through on those. The local bin is probed with existsSync (its `./`
  // prefix form is not runnable by cmd.exe at all). With no runner found,
  // exit 0 silently — stdout is parsed as the hook's JSON.
  const localBin = process.platform === 'win32'
    ? 'node_modules\\.bin\\react-doctor.cmd'
    : './node_modules/.bin/react-doctor';
  const commands = [
    ...(existsSync(localBin)
      ? [localBin + ' --verbose --scope changed --blocking warning --no-score']
      : []),
    'react-doctor --verbose --scope changed --blocking warning --no-score',
    'pnpm dlx react-doctor@latest --verbose --scope changed --blocking warning --no-score',
    'npx --yes react-doctor@latest --verbose --scope changed --blocking warning --no-score',
  ];

  for (const command of commands) {
    const result = await runWithTreeKill(command, 40000);
    if (result.error?.code === 'ENOENT' || result.status === 127 || result.status === 9009) continue;
    try {
      writeFileSync(outputPath, (result.stdout || '') + (result.stderr || ''));
    } catch {}
    return result.status;
  }

  return 0;
};

/** spawnSync with a timeout kills the shell and nothing under it: on Windows the job object has
 *  SILENT_BREAKAWAY, so the react-doctor grandchild outlives both the timeout and this hook. A
 *  scan that takes minutes — the case that held 16.3 GB — was therefore only rate-limited by
 *  the slot to one orphan per forty seconds. Kill the TREE on timeout, and hold the slot until
 *  that has happened. */
const runWithTreeKill = (command, timeoutMs) => new Promise((resolveRun) => {
  const child = spawn(command, { shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  let stdout = '', stderr = '', timedOut = false, settled = false;
  child.stdout.on('data', (d) => { if (stdout.length < SPAWN_MAX_BUFFER_BYTES) stdout += d; });
  child.stderr.on('data', (d) => { if (stderr.length < SPAWN_MAX_BUFFER_BYTES) stderr += d; });
  const finish = (result) => { if (!settled) { settled = true; clearTimeout(timer); resolveRun({ ...result, stdout, stderr }); } };
  const killTree = () => {
    timedOut = true;
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      else process.kill(-child.pid, 'SIGKILL');
    } catch {}
    // If the tree refuses to die, do not hang the hook on it: report the timeout and move on.
    setTimeout(() => finish({ status: null, error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) }), 2000).unref();
  };
  const timer = setTimeout(killTree, timeoutMs);
  child.on('error', (e) => finish({ status: null, error: e }));
  child.on('close', (code) => finish(timedOut
    ? { status: null, error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) }
    : { status: code, error: null }));
});

const cleanup = (...paths) => {
  for (const path of paths) {
    try { unlinkSync(path); } catch {}
  }
};

const main = async () => {
  let input;
  try {
    input = JSON.parse(readFileOrEmpty(0) || '{}') || {};
  } catch {
    input = {};
  }

  if (!shouldScan(input)) {
    dbg("not an edit of a JS/TS file, or no payload");
    process.exit(0);
  }

  // The written file's project, or — only when the event named no file at all — the session's.
  // Falling back to the session for a file that HAS a path is what made an edit in one
  // repository report another: a scratch script would be scanned as whatever project the
  // session happened to start in.
  const written = editedPath(input);
  const projectRoot = written ? projectRootFor(written) : process.env.CLAUDE_PROJECT_DIR;
  // A JavaScript file with no package.json above it is not a project react-doctor can read.
  if (!projectRoot) { dbg("no package.json above the written file (not a JS project)"); process.exit(0); }
  const outputPath = join(tmpdir(), `react-doctor-agent-hook-output-${process.pid}.txt`);

  try {
    process.chdir(projectRoot);
  } catch {
    dbg("could not chdir to the project root");
    process.exit(0);
  }

  // Is there a framework here at all? One file read, against an npm resolution plus a
  // full-project scan that reaches the same verdict after about a gigabyte and forty seconds.
  // This repository has no React, and every write to it was paying that price to be told so.
  if (!usesFramework(projectRoot)) { dbg("no framework react-doctor knows in any package.json up the tree"); process.exit(0); }

  // One scan at a time, machine-wide. Sixteen concurrent scans holding 16.3 GB were measured
  // here; they are the same answer sixteen times. Skipped rather than queued — the next write
  // starts another anyway, so queueing only delays the pile-up.
  if (!takeScanSlot()) { dbg("another scan holds the slot"); process.exit(0); }

  let scanResult;
  try {
    scanResult = await runReactDoctor(outputPath);
  } finally {
    releaseScanSlot();
  }
  if (scanResult === 0) {
    cleanup(outputPath);
    dbg("scan returned 0 (nothing blocking)");
    process.exit(0);
  }

  // The write above is best-effort (unwritable tmpdir), so the read is too
  // — a hook must never crash the agent loop with a stack trace.
  const scanOutput = readFileOrEmpty(outputPath).trim();
  cleanup(outputPath);

  if (!scanOutput) {
    dbg("scan produced no readable output");
    process.exit(0);
  }

  const message = `React Doctor found issues in the changed files. Review this output and fix the regressions before finishing. For confirmed issues that cannot be fixed now, create GitHub issues with the rule, file/line, confidence, impact, and proposed fix.\n\n${scanOutput}`;

  if (input.hook_event_name === 'PostToolBatch') {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message } }));
  } else {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message } }));
  }
};

// An async main must not leave a rejection unhandled: a hook that dies loudly breaks the loop.
main().catch(() => process.exit(0));