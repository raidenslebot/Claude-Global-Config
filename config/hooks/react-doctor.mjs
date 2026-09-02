import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

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

const runReactDoctor = (outputPath) => {
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
    const result = spawnSync(command, { encoding: 'utf8', shell: true, maxBuffer: SPAWN_MAX_BUFFER_BYTES, timeout: 40000 });
    if (result.error?.code === 'ENOENT' || result.status === 127 || result.status === 9009) continue;
    try {
      writeFileSync(outputPath, (result.stdout || '') + (result.stderr || ''));
    } catch {}
    return result.status;
  }

  return 0;
};

const cleanup = (...paths) => {
  for (const path of paths) {
    try { unlinkSync(path); } catch {}
  }
};

const main = () => {
  let input;
  try {
    input = JSON.parse(readFileOrEmpty(0) || '{}') || {};
  } catch {
    input = {};
  }

  if (!shouldScan(input)) {
    process.exit(0);
  }

  const projectRoot = projectRootFor(editedPath(input)) || process.env.CLAUDE_PROJECT_DIR;
  // A JavaScript file with no package.json above it is not a project react-doctor can read.
  if (!projectRoot) process.exit(0);
  const outputPath = join(tmpdir(), `react-doctor-agent-hook-output-${process.pid}.txt`);

  try {
    process.chdir(projectRoot);
  } catch {
    process.exit(0);
  }

  const scanResult = runReactDoctor(outputPath);
  if (scanResult === 0) {
    cleanup(outputPath);
    process.exit(0);
  }

  // The write above is best-effort (unwritable tmpdir), so the read is too
  // — a hook must never crash the agent loop with a stack trace.
  const scanOutput = readFileOrEmpty(outputPath).trim();
  cleanup(outputPath);

  if (!scanOutput) {
    process.exit(0);
  }

  const message = `React Doctor found issues in the changed files. Review this output and fix the regressions before finishing. For confirmed issues that cannot be fixed now, create GitHub issues with the rule, file/line, confidence, impact, and proposed fix.\n\n${scanOutput}`;

  if (input.hook_event_name === 'PostToolBatch') {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message } }));
  } else {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message } }));
  }
};

main();