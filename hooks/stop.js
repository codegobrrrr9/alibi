#!/usr/bin/env node
// Claude Code Stop hook. If the agent's last message claims the tests pass and there is no VALID
// receipt for the current tree, block the stop (exit 2) and hand the reason back so the agent
// runs the tests for real before finishing.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLAIM = /\b(tests?|suite|specs?|test suite|unit tests|e2e)\b[^.\n]{0,40}\b(pass|passes|passed|passing|green|succeed|succeeds|succeeded|successful)\b|\b(all|every|the)\b[^.\n]{0,30}\btests?\b[^.\n]{0,20}\b(pass|passes|passing|passed)\b|\b\d+\s+(tests?|specs?)\s+(pass|passed|passing)\b|\bpass(?:ed|ing)?\s*[:(]\s*\d+|✅.{0,40}\btests?\b|\btests?\b.{0,40}✅|\ball green\b/i;
const EXEMPT = /\balibi:\s*(STALE|FAILED|MISSING|TAMPERED)\b|\bcannot run the tests\b|\bcould not run the tests\b|\btests? (do not|don't|did not|didn't|cannot|can't) (run|pass)\b|\bnot (yet )?(run|verified)\b/i;

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
let raw = '';
if (isMain) process.stdin.setEncoding('utf8');
if (isMain) process.stdin.on('data', (d) => { raw += d; });
if (isMain) process.stdin.on('end', () => {
  let input; try { input = JSON.parse(raw); } catch { process.exit(0); }
  if (input.stop_hook_active) process.exit(0);
  const msg = String(input.last_assistant_message || '');
  if (!msg || !CLAIM.test(msg) || EXEMPT.test(msg)) process.exit(0);
  const root = process.env.CLAUDE_PLUGIN_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const alibi = join(root, 'skills', 'alibi', 'scripts', 'alibi.js');
  const cwd = input.cwd && existsSync(input.cwd) ? input.cwd : process.cwd();
  const r = spawnSync(process.execPath, [alibi, 'verify', 'last', '--json'], { cwd, encoding: 'utf8', timeout: 20000 });
  let v = null; try { v = JSON.parse(r.stdout); } catch { /* fallthrough */ }
  if (v && v.verdict === 'VALID') process.exit(0);
  const line = v ? (v.verdict === 'STALE' ? `STALE · ${v.reason}` : `${v.verdict} · ${v.reason || ''}`) : `could not verify (${r.error ? r.error.message : (r.stderr || '').trim().slice(0, 200) || 'alibi failed to run'})`;
  process.stderr.write(`alibi: ${line}\nYour last message says the tests pass, but there is no VALID receipt for the current tree. Run the test command now (it is receipted automatically), read the alibi footer, then finish with the alibi status line. Do not restate the claim without a receipt.\n`);
  process.exit(2);
});
