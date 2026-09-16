#!/usr/bin/env node
// alibi — receipts that prove the tests actually ran, on the code that shipped. Zero dependencies.
//
//   alibi run -- <cmd…>        run a command, stream its output, write a receipt, exit with its code
//   alibi run --b64 <base64>   same, command passed base64-encoded (what the hook uses; quote-safe)
//   alibi status               one line: VALID / STALE / FAILED / MISSING / TAMPERED, and why
//   alibi verify [id|last]     full verdict; --json for tooling; exit 0 only on VALID
//   alibi check                CI gate: VALID receipt, clean tree, receipt HEAD == current HEAD
//   alibi list · alibi show <id>
//
// Receipts live in .alibi/ (added to .gitignore). A receipt is bound to a fingerprint of the working
// tree; any change to any file makes it STALE. Receipts are signed with a per-machine key in
// ~/.alibi/key so a hand-written receipt shows as TAMPERED. Set ALIBI_NO_SIGN=1 to disable signing.

import { spawn, spawnSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, appendFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const TEST_CMD = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|tests|test:[\w:-]+|jest|vitest|mocha)\b|\bnpx\s+(jest|vitest|mocha|playwright test|cypress run)\b|\bpytest\b|\bpython3?\s+-m\s+(pytest|unittest)\b|\bjest\b|\bvitest\b|\bmocha\b|\bgo test\b|\bcargo test\b|\bnode\s+--test\b|\bphpunit\b|\brspec\b|\bmvn\s+(test|verify)\b|\bgradle(w)?\s+test\b|\bdotnet test\b|\bmix test\b|\bswift test\b|\bflutter test\b|\bmake\s+test\b/;
const SKIP_DIRS = new Set(['node_modules', '.git', '.alibi', 'dist', 'build', '.next', 'coverage', '.venv', 'venv', '__pycache__', 'target', '.turbo', '.cache', 'vendor']);
const DIR = '.alibi';
const TAIL_LINES = 40;
const MAX_HASH_BYTES = 5 * 1024 * 1024;

const sha = (s) => createHash('sha256').update(s).digest('hex');
function git(args, cwd) { const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); return r.status === 0 ? r.stdout : null; }
function fileSha(p) { try { const st = statSync(p); if (!st.isFile()) return null; if (st.size > MAX_HASH_BYTES) return 'big:' + st.size + ':' + Math.round(st.mtimeMs); return sha(readFileSync(p)); } catch { return null; } }
function toPosix(p) { return p.split(sep).join('/'); }

export function repoRoot(cwd = process.cwd()) {
  const top = git(['rev-parse', '--show-toplevel'], cwd);
  return top ? top.trim() : resolve(cwd);
}

// Fingerprint of the working tree: what the tests actually ran against.
export function fingerprint(cwd = process.cwd()) {
  const root = repoRoot(cwd);
  const isGit = !!git(['rev-parse', '--show-toplevel'], cwd);
  const files = {};
  if (isGit) {
    const head = (git(['rev-parse', 'HEAD'], root) || 'none').trim();
    const status = git(['status', '--porcelain', '--untracked-files=all'], root) || '';
    for (const line of status.split('\n')) {
      if (!line.trim()) continue;
      let p = line.slice(3).trim();
      if (p.includes(' -> ')) p = p.split(' -> ').pop();
      if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
      if (p.startsWith(DIR + '/') || p === DIR) continue;
      files[p] = fileSha(join(root, p)) ?? 'deleted';
    }
    const diff = head === 'none' ? '' : (git(['diff', 'HEAD', '--binary', '--', '.', `:(exclude)${DIR}`], root) || '');
    const tree = sha(head + '\n' + sha(diff) + '\n' + JSON.stringify(Object.entries(files).sort()));
    return { mode: 'git', root, head, tree, files };
  }
  const walk = (dir) => {
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name)); continue; }
      if (!e.isFile()) continue;
      const full = join(dir, e.name);
      try { const st = statSync(full); files[toPosix(relative(root, full))] = st.size + ':' + Math.round(st.mtimeMs); } catch { /* skip */ }
    }
  };
  walk(root);
  const tree = sha(JSON.stringify(Object.entries(files).sort()));
  return { mode: 'files', root, head: null, tree, files };
}

// Parse the summary line of common test runners. Returns null when nothing recognisable.
export function summarize(output) {
  const o = output;
  let m;
  if ((m = /ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/.exec(o))) return { runner: 'node:test', passed: +m[1], failed: +m[2] };
  if ((m = /^# pass (\d+)[\s\S]*?^# fail (\d+)/m.exec(o))) return { runner: 'tap', passed: +m[1], failed: +m[2] };
  if ((m = /^\s*Tests:\s+(.+)$/m.exec(o))) { const p = /(\d+) passed/.exec(m[1]), f = /(\d+) failed/.exec(m[1]); return { runner: 'jest', passed: p ? +p[1] : 0, failed: f ? +f[1] : 0 }; }
  if ((m = /^=+ .*?(\d+) passed.*? =+$/m.exec(o)) || (m = /^=+ .*?(\d+) failed.*? =+$/m.exec(o))) { const line = m[0]; const p = /(\d+) passed/.exec(line), f = /(\d+) failed/.exec(line), e = /(\d+) error/.exec(line); return { runner: 'pytest', passed: p ? +p[1] : 0, failed: (f ? +f[1] : 0) + (e ? +e[1] : 0) }; }
  if ((m = /test result: (ok|FAILED)\. (\d+) passed; (\d+) failed/.exec(o))) return { runner: 'cargo', passed: +m[2], failed: +m[3] };
  if (/^(ok|FAIL|---\s+FAIL)\s+\S+/m.test(o) && /^(ok|FAIL)\s+[\w./-]+\s/m.test(o)) { const ok = (o.match(/^ok\s+[\w./-]+/mg) || []).length, fail = (o.match(/^FAIL\s+[\w./-]+/mg) || []).length; return { runner: 'go', passed: ok, failed: fail }; }
  if ((m = /(\d+) passing/.exec(o))) { const f = /(\d+) failing/.exec(o); return { runner: 'mocha', passed: +m[1], failed: f ? +f[1] : 0 }; }
  if ((m = /Ran (\d+) tests?[\s\S]*?^(OK|FAILED)( \(.*?\))?$/m.exec(o))) { const f = /failures=(\d+)/.exec(m[0]), e = /errors=(\d+)/.exec(m[0]); const failed = (f ? +f[1] : 0) + (e ? +e[1] : 0); return { runner: 'unittest', passed: +m[1] - failed, failed }; }
  return null;
}
const summaryText = (s, code) => s ? `${s.passed} passed, ${s.failed} failed` : (code === 0 ? 'exit 0' : `exit ${code}`);

function keyPath() { return join(homedir(), '.alibi', 'key'); }
function loadKey(create) {
  if (process.env.ALIBI_NO_SIGN) return null;
  const p = keyPath();
  try { return readFileSync(p, 'utf8').trim(); } catch { /* absent */ }
  if (!create) return null;
  try { mkdirSync(join(homedir(), '.alibi'), { recursive: true }); const k = randomBytes(32).toString('hex'); writeFileSync(p, k, { mode: 0o600 }); return k; } catch { return null; }
}
function ensureIgnored(root) {
  const gi = join(root, '.gitignore');
  try {
    const cur = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
    if (!/^\s*\.alibi\/?\s*$/m.test(cur)) appendFileSync(gi, (cur && !cur.endsWith('\n') ? '\n' : '') + '.alibi/\n');
  } catch { /* not fatal */ }
}
function receiptDir(root) { return join(root, DIR); }
function canonical(r) { const { id, sig, ...rest } = r; return JSON.stringify(rest); }

export function writeReceipt(partial, root) {
  const key = loadKey(true);
  const body = { v: 1, ...partial };
  const content = sha(canonical(body));
  body.id = 'r-' + content.slice(0, 8);
  body.sig = key ? createHmac('sha256', key).update(content).digest('hex') : null;
  mkdirSync(receiptDir(root), { recursive: true });
  writeFileSync(join(receiptDir(root), body.id + '.json'), JSON.stringify(body, null, 2) + '\n');
  writeFileSync(join(receiptDir(root), 'latest'), body.id + '\n');
  ensureIgnored(root);
  return body;
}

export function loadReceipt(idOrLast, cwd = process.cwd()) {
  const root = repoRoot(cwd);
  const dir = receiptDir(root);
  if (!existsSync(dir)) return null;
  let id = idOrLast;
  if (!id || id === 'last' || id === 'latest') { try { id = readFileSync(join(dir, 'latest'), 'utf8').trim(); } catch { return null; } }
  if (!id.startsWith('r-')) id = 'r-' + id;
  const p = join(dir, id + '.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { id, corrupt: true }; }
}

export function listReceipts(cwd = process.cwd()) {
  const dir = receiptDir(repoRoot(cwd));
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.startsWith('r-') && f.endsWith('.json'))
    .map(f => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; } })
    .filter(Boolean).sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
}

export function verify(idOrLast = 'last', cwd = process.cwd()) {
  const r = loadReceipt(idOrLast, cwd);
  if (!r) return { verdict: 'MISSING', reason: 'no receipt in this repo. Run the tests through alibi first.' };
  if (r.corrupt) return { verdict: 'TAMPERED', id: r.id, reason: 'receipt file is not valid JSON.' };
  const content = sha(canonical(r));
  if ('r-' + content.slice(0, 8) !== r.id) return { verdict: 'TAMPERED', id: r.id, reason: 'receipt content does not match its id. It was edited after it was written.' };
  const key = loadKey(false);
  if (key && r.sig && createHmac('sha256', key).update(content).digest('hex') !== r.sig) return { verdict: 'TAMPERED', id: r.id, reason: 'signature does not match this machine\'s key.' };
  if (key && !r.sig && !process.env.ALIBI_NO_SIGN) return { verdict: 'TAMPERED', id: r.id, reason: 'receipt is unsigned but this machine signs receipts.' };
  const base = { id: r.id, cmd: r.cmd, summary: r.summary, exitCode: r.exitCode, startedAt: r.startedAt, ageMs: Date.now() - Date.parse(r.startedAt) };
  if (r.exitCode !== 0) return { ...base, verdict: 'FAILED', reason: `the command exited ${r.exitCode}${r.summary ? ` (${summaryText(r.summary)})` : ''}.` };
  const now = fingerprint(cwd);
  if (now.tree === r.tree.sha) return { ...base, verdict: 'VALID', reason: 'tree matches' };
  const changed = new Set();
  const a = r.tree.files || {}, b = now.files || {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) changed.add(k);
  if (now.mode === 'git' && r.tree.head && now.head && r.tree.head !== now.head) {
    const names = git(['diff', '--name-only', r.tree.head, now.head], now.root);
    if (names) for (const n of names.split('\n')) if (n.trim()) changed.add(n.trim());
    if (!names) changed.add(`(HEAD moved ${r.tree.head.slice(0, 7)} → ${now.head.slice(0, 7)})`);
  }
  const list = [...changed].filter(x => !x.startsWith(DIR));
  return { ...base, verdict: 'STALE', changed: list, reason: `${list.length} file${list.length === 1 ? '' : 's'} changed since ${r.id}${list.length ? ` (${list.slice(0, 5).join(', ')}${list.length > 5 ? ', …' : ''})` : ''}. Re-run the tests.` };
}

export function statusLine(v) {
  const age = v.ageMs != null ? ago(v.ageMs) : '';
  switch (v.verdict) {
    case 'VALID': return `VALID ${v.id} · ${v.cmd} · ${summaryText(v.summary, v.exitCode)} · ${age} · tree matches`;
    case 'STALE': return `STALE · ${v.reason}`;
    case 'FAILED': return `FAILED ${v.id} · ${v.cmd} · ${v.reason}`;
    case 'MISSING': return `MISSING · ${v.reason}`;
    case 'TAMPERED': return `TAMPERED ${v.id || ''} · ${v.reason}`;
    default: return `${v.verdict} · ${v.reason || ''}`;
  }
}
function ago(ms) { const s = Math.round(ms / 1000); if (s < 60) return `${s}s ago`; const m = Math.round(s / 60); if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 48) return `${h} h ago`; return `${Math.round(h / 24)} d ago`; }

export function check(cwd = process.cwd()) {
  const v = verify('last', cwd);
  if (v.verdict !== 'VALID') return { ok: false, verdict: v.verdict, reason: statusLine(v) };
  const fp = fingerprint(cwd);
  if (fp.mode !== 'git') return { ok: false, verdict: 'NOT_GIT', reason: 'alibi check needs a git repository.' };
  const dirty = Object.keys(fp.files).length > 0;
  if (dirty) return { ok: false, verdict: 'DIRTY', reason: `working tree has ${Object.keys(fp.files).length} uncommitted change(s); commit them and re-run the tests so the receipt matches a commit.` };
  return { ok: true, verdict: 'VALID', reason: `${v.id} matches commit ${fp.head.slice(0, 7)} with a clean tree.` };
}

export function run(cmd, cwd = process.cwd()) {
  return new Promise((resolveP) => {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    ensureIgnored(repoRoot(cwd)); // before the fingerprint, so the .gitignore edit is part of the tree we record
    const chunks = []; let bytes = 0; const hasher = createHash('sha256');
    // A clean env: if alibi itself was started from inside a test runner (node --test sets
    // NODE_TEST_CONTEXT), the nested runner would otherwise refuse to run the real tests.
    const env = { ...process.env, ALIBI_CHILD: '1' };
    delete env.NODE_TEST_CONTEXT; delete env.NODE_TEST_WORKER_ID;
    const child = spawn(cmd, { cwd, shell: true, stdio: ['inherit', 'pipe', 'pipe'], env });
    const tap = (stream, out) => stream.on('data', (d) => { out.write(d); hasher.update(d); bytes += d.length; if (bytes < 2 * 1024 * 1024) chunks.push(d); });
    tap(child.stdout, process.stdout); tap(child.stderr, process.stderr);
    child.on('close', (code) => {
      const exitCode = code ?? 1;
      const output = Buffer.concat(chunks).toString('utf8');
      const fp = fingerprint(cwd);
      const receipt = writeReceipt({
        cmd, cwd: toPosix(relative(fp.root, resolve(cwd))) || '.', startedAt, durationMs: Date.now() - t0, exitCode,
        summary: summarize(output),
        output: { sha256: hasher.digest('hex'), bytes, tail: output.split('\n').slice(-TAIL_LINES).join('\n') },
        tree: { mode: fp.mode, head: fp.head, sha: fp.tree, files: fp.files },
        host: { platform: process.platform, node: process.version },
      }, fp.root);
      process.stderr.write(`\nalibi ${receipt.id}  exit ${exitCode}  ${summaryText(receipt.summary, exitCode)}  tree ${fp.tree.slice(0, 8)}\n`);
      resolveP({ receipt, exitCode });
    });
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const sub = args[0] || 'status';
  const json = args.includes('--json');
  (async () => {
    if (sub === 'run') {
      let cmd;
      const b = args.indexOf('--b64');
      if (b >= 0) cmd = Buffer.from(args[b + 1] || '', 'base64').toString('utf8');
      else { const d = args.indexOf('--'); cmd = (d >= 0 ? args.slice(d + 1) : args.slice(1)).join(' '); }
      if (!cmd.trim()) { console.error('alibi run: nothing to run. Usage: alibi run -- <command>'); process.exit(2); }
      const { exitCode } = await run(cmd);
      process.exit(exitCode);
    }
    if (sub === 'verify') {
      const v = verify(args.find((a, i) => i > 0 && !a.startsWith('--')) || 'last');
      console.log(json ? JSON.stringify(v, null, 2) : statusLine(v));
      process.exit(v.verdict === 'VALID' ? 0 : 1);
    }
    if (sub === 'status') { const v = verify('last'); console.log(json ? JSON.stringify(v) : statusLine(v)); process.exit(v.verdict === 'VALID' ? 0 : 1); }
    if (sub === 'check') { const c = check(); console.log(json ? JSON.stringify(c) : `${c.ok ? 'PASS' : 'FAIL'} · ${c.reason}`); process.exit(c.ok ? 0 : 1); }
    if (sub === 'list') {
      const rs = listReceipts();
      if (!rs.length) { console.log('no receipts in this repo'); process.exit(1); }
      for (const r of rs) console.log(`${r.id}  ${r.startedAt.slice(0, 19).replace('T', ' ')}  exit ${r.exitCode}  ${summaryText(r.summary, r.exitCode).padEnd(22)}  ${r.cmd}`);
      process.exit(0);
    }
    if (sub === 'show') { const r = loadReceipt(args[1] || 'last'); if (!r) { console.error('no such receipt'); process.exit(1); } console.log(JSON.stringify(r, null, 2)); process.exit(0); }
    if (sub === 'fingerprint') { const fp = fingerprint(); console.log(json ? JSON.stringify(fp, null, 2) : `${fp.mode} ${fp.tree} head=${fp.head} changed=${Object.keys(fp.files).length}`); process.exit(0); }
    console.error('alibi: unknown command. Try: run, status, verify, check, list, show');
    process.exit(2);
  })();
}
