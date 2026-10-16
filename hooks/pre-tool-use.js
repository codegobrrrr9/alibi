#!/usr/bin/env node
// Claude Code PreToolUse hook (matcher: Bash|PowerShell). If the command is a test run, rewrite it so it runs
// through `alibi run`, which streams the output unchanged and writes a receipt. Anything else is
// left alone. Must be fast: no filesystem walking, no git.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_CMD = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|tests|test:[\w:-]+|jest|vitest|mocha)\b|\bnpx\s+(jest|vitest|mocha|playwright test|cypress run)\b|\bpytest\b|\bpython3?\s+-m\s+(pytest|unittest)\b|\bjest\b|\bvitest\b|\bmocha\b|\bgo test\b|\bcargo test\b|\bnode\s+--test\b|\bphpunit\b|\brspec\b|\bmvn\s+(test|verify)\b|\bgradle(w)?\s+test\b|\bdotnet test\b|\bmix test\b|\bswift test\b|\bflutter test\b|\bmake\s+test\b/;

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
let raw = '';
if (isMain) process.stdin.setEncoding('utf8');
if (isMain) process.stdin.on('data', (d) => { raw += d; });
if (isMain) process.stdin.on('end', () => {
  let input; try { input = JSON.parse(raw); } catch { process.exit(0); }
  if (input.tool_name !== 'Bash' && input.tool_name !== 'PowerShell') process.exit(0);
  const cmd = String(input.tool_input?.command || '');
  if (!cmd || !TEST_CMD.test(cmd)) process.exit(0);
  if (/alibi(\.js)?["']?\s+run\b/.test(cmd)) process.exit(0);          // already wrapped
  if (/--help|--version/.test(cmd)) process.exit(0);
  const root = process.env.CLAUDE_PLUGIN_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const alibi = join(root, 'skills', 'alibi', 'scripts', 'alibi.js').split('\\').join('/');
  const b64 = Buffer.from(cmd, 'utf8').toString('base64');
  const rewritten = `node "${alibi}" run${input.tool_name === 'PowerShell' ? ' --shell powershell' : ''} --b64 ${b64}`;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: `alibi: recording test run "${cmd.slice(0, 60)}"`,
      updatedInput: { ...input.tool_input, command: rewritten },
    },
  }));
  process.exit(0);
});
