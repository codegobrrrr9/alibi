import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CLAIM } from '../hooks/stop.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const PRE = join(ROOT, 'hooks', 'pre-tool-use.js');
const STOP = join(ROOT, 'hooks', 'stop.js');
const ALIBI = join(ROOT, 'skills', 'alibi', 'scripts', 'alibi.js');

function hook(script, input, extraEnv = {}) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [script], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...extraEnv } });
  return { code: r.status, out: r.stdout, err: r.stderr, ms: Date.now() - t0 };
}

// ---- PreToolUse -----------------------------------------------------------------------

test('rewrites a test command into alibi run --b64, keeping other input fields', () => {
  const r = hook(PRE, { tool_name: 'Bash', tool_input: { command: 'npm test -- --grep "a b"', description: 'run tests' } });
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out);
  assert.equal(o.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(o.hookSpecificOutput.permissionDecision, 'allow');
  const cmd = o.hookSpecificOutput.updatedInput.command;
  assert.match(cmd, /^node ".*alibi\.js" run --shell bash --b64 [A-Za-z0-9+/=]+$/);
  assert.equal(Buffer.from(cmd.split('--b64 ')[1], 'base64').toString(), 'npm test -- --grep "a b"');
  assert.equal(o.hookSpecificOutput.updatedInput.description, 'run tests');
});

test('rewrites a test command sent through the PowerShell tool too (Windows agents use it)', () => {
  const r = hook(PRE, { tool_name: 'PowerShell', tool_input: { command: 'npx vitest run src/a.test.ts 2>&1 | Select-String "Tests"' } });
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out);
  assert.match(o.hookSpecificOutput.updatedInput.command, /^node ".*alibi.js" run --shell powershell --b64 /);
});

test('uses CLAUDE_PLUGIN_ROOT for the alibi path when set', () => {
  const r = hook(PRE, { tool_name: 'Bash', tool_input: { command: 'pytest -q' } }, { CLAUDE_PLUGIN_ROOT: 'C:\\plugins\\alibi' });
  assert.match(JSON.parse(r.out).hookSpecificOutput.updatedInput.command, /^node "C:\/plugins\/alibi\/skills\/alibi\/scripts\/alibi\.js" run --shell bash --b64 /);
});

test('leaves non-test commands, other tools and already-wrapped commands alone', () => {
  for (const input of [
    { tool_name: 'Bash', tool_input: { command: 'ls -la' } },
    { tool_name: 'Bash', tool_input: { command: 'npm install' } },
    { tool_name: 'Read', tool_input: { file_path: 'x' } },
    { tool_name: 'Bash', tool_input: { command: 'node "/x/alibi.js" run --b64 bnBtIHRlc3Q=' } },
    { tool_name: 'Bash', tool_input: { command: 'npm test --help' } },
  ]) {
    const r = hook(PRE, input);
    assert.equal(r.code, 0);
    assert.equal(r.out, '', JSON.stringify(input));
  }
});

test('garbage stdin does not break the tool call', () => {
  const r = spawnSync(process.execPath, [PRE], { input: 'not json', encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('pre hook is fast', () => {
  const r = hook(PRE, { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.ok(r.ms < 1500, `took ${r.ms}ms`); // node startup dominates; the script itself does no IO
});

// ---- Stop ---------------------------------------------------------------------------------

test('claim regex catches the ways agents say tests pass, and not neutral prose', () => {
  for (const s of ['All tests pass.', 'Tests are passing now', 'the test suite is green', '23 tests passed', 'Done, tests pass ✅', 'ran npm test: 12 passed', 'All 5 specs pass.', 'Tests passed successfully']) assert.ok(CLAIM.test(s), s);
  for (const s of ['I refactored the parser.', 'Added a test for the edge case.', 'The build succeeded.', 'Passing the config through the constructor.', 'Let me run the tests.']) assert.ok(!CLAIM.test(s), s);
});

test('stop hook: a partial-run report ("I did not run the full suite") is still a claim, not an exemption', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alibi-stop-'));
  const r = hook(STOP, { cwd: dir, last_assistant_message: 'Shortlist selected 7 of 137 files. 232 of 243 tests passed, and 11 failed. I did not run the full suite.' });
  assert.equal(r.code, 2);
  assert.match(r.err, /MISSING/);
  assert.equal(hook(STOP, { cwd: dir, last_assistant_message: 'The tests were not run; the runner is missing.' }).code, 0);
});

test('stop hook: allows when no claim, allows when stop_hook_active, blocks MISSING, allows VALID, blocks STALE', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alibi-h-'));
  cpSync(join(here, 'fixtures', 'tiny-repo'), dir, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: dir });
  try {
    assert.equal(hook(STOP, { last_assistant_message: 'Refactored the parser.', cwd: dir }).code, 0);
    assert.equal(hook(STOP, { last_assistant_message: 'All tests pass.', cwd: dir, stop_hook_active: true }).code, 0);
    let r = hook(STOP, { last_assistant_message: 'All tests pass.', cwd: dir });
    assert.equal(r.code, 2);
    assert.match(r.err, /alibi: MISSING/);
    assert.equal(spawnSync(process.execPath, [ALIBI, 'run', '--', 'npm test'], { cwd: dir, encoding: 'utf8' }).status, 0);
    assert.equal(hook(STOP, { last_assistant_message: 'Done. All 3 tests pass.', cwd: dir }).code, 0);
    appendFileSync(join(dir, 'src', 'math.js'), '\n// after\n');
    r = hook(STOP, { last_assistant_message: 'Done. All 3 tests pass.', cwd: dir });
    assert.equal(r.code, 2);
    assert.match(r.err, /STALE · 1 file changed since r-[0-9a-f]{8} \(src\/math\.js\)/);
    assert.match(r.err, /finish with the alibi status line/);
    // an honest message that reports a non-passing state is not blocked
    assert.equal(hook(STOP, { last_assistant_message: 'alibi: STALE · re-running. The tests do not pass yet.', cwd: dir }).code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
