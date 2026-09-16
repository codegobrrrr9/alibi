import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { summarize, fingerprint, verify, check, listReceipts, statusLine, TEST_CMD } from '../skills/alibi/scripts/alibi.js';

const here = dirname(fileURLToPath(import.meta.url));
const ALIBI = join(here, '..', 'skills', 'alibi', 'scripts', 'alibi.js');
const FIXTURE = join(here, 'fixtures', 'tiny-repo');

function freshRepo(git = true) {
  const dir = mkdtempSync(join(tmpdir(), 'alibi-t-'));
  cpSync(FIXTURE, dir, { recursive: true });
  if (git) {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    spawnSync('git', ['add', '-A'], { cwd: dir });
    spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: dir });
  }
  return dir;
}
function al(dir, ...args) {
  const r = spawnSync(process.execPath, [ALIBI, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, ALIBI_NO_SIGN: '' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// ---- summary parsing --------------------------------------------------------------------

test('summarize: node:test, jest, pytest, cargo, go, mocha, unittest, unknown', () => {
  assert.deepEqual(summarize('ℹ tests 23\nℹ pass 23\nℹ fail 0\n'), { runner: 'node:test', passed: 23, failed: 0 });
  assert.deepEqual(summarize('Tests:       2 failed, 1 skipped, 40 passed, 43 total\n'), { runner: 'jest', passed: 40, failed: 2 });
  assert.deepEqual(summarize('=========== 12 passed, 1 failed, 2 warnings in 0.42s ==========='), { runner: 'pytest', passed: 12, failed: 1 });
  assert.deepEqual(summarize('test result: ok. 7 passed; 0 failed; 0 ignored'), { runner: 'cargo', passed: 7, failed: 0 });
  assert.deepEqual(summarize('ok  \tgithub.com/x/y\t0.012s\nFAIL\tgithub.com/x/z\t0.020s\n'), { runner: 'go', passed: 1, failed: 1 });
  assert.deepEqual(summarize('  5 passing (120ms)\n  1 failing\n'), { runner: 'mocha', passed: 5, failed: 1 });
  assert.deepEqual(summarize('Ran 9 tests in 0.003s\n\nFAILED (failures=2)\n'), { runner: 'unittest', passed: 7, failed: 2 });
  assert.equal(summarize('built ok\n'), null);
});

test('TEST_CMD recognises common test commands and not others', () => {
  for (const c of ['npm test', 'npm run test:unit', 'pnpm test', 'yarn test', 'bun test', 'npx jest src/', 'pytest -q', 'python -m pytest', 'go test ./...', 'cargo test', 'node --test tests/a.test.js', 'make test', 'dotnet test']) assert.ok(TEST_CMD.test(c), c);
  for (const c of ['ls -la', 'npm install', 'git status', 'npm run build', 'node scripts/testdata.js', 'cat tests/a.js']) assert.ok(!TEST_CMD.test(c), c);
});

// ---- receipts on a real repo ------------------------------------------------------------

let dir;
before(() => { dir = freshRepo(); });
after(() => { rmSync(dir, { recursive: true, force: true }); });

test('MISSING before any run', () => {
  const v = verify('last', dir);
  assert.equal(v.verdict, 'MISSING');
  assert.match(statusLine(v), /^MISSING/);
});

test('run writes a receipt, exits with the command code, footer on stderr, stdout untouched', () => {
  const r = al(dir, 'run', '--', 'npm test');
  assert.equal(r.code, 0);
  assert.match(r.err, /alibi r-[0-9a-f]{8}\s+exit 0\s+3 passed, 0 failed\s+tree [0-9a-f]{8}/);
  assert.ok(!/alibi r-/.test(r.out), 'footer must not be on stdout');
  assert.ok(existsSync(join(dir, '.alibi', 'latest')));
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^\.alibi\/$/m);
});

test('VALID right after a passing run, even though .gitignore was just edited', () => {
  const v = verify('last', dir);
  assert.equal(v.verdict, 'VALID', JSON.stringify(v));
  assert.deepEqual(v.summary, { runner: 'node:test', passed: 3, failed: 0 });
  assert.match(statusLine(v), /^VALID r-[0-9a-f]{8} · npm test · 3 passed, 0 failed · \d+s ago · tree matches$/);
});

test('editing a file makes it STALE and names the file', () => {
  appendFileSync(join(dir, 'src', 'math.js'), '\n// edit\n');
  const v = verify('last', dir);
  assert.equal(v.verdict, 'STALE');
  assert.deepEqual(v.changed, ['src/math.js']);
  assert.match(statusLine(v), /STALE · 1 file changed since r-[0-9a-f]{8} \(src\/math\.js\)\. Re-run the tests\./);
});

test('a failing run is FAILED with the parsed summary', () => {
  const r = al(dir, 'run', '--b64', Buffer.from('npm run test:fail').toString('base64'));
  assert.equal(r.code, 1);
  const v = verify('last', dir);
  assert.equal(v.verdict, 'FAILED');
  assert.match(v.reason, /exited 1 \(0 passed, 1 failed\)/);
});

test('re-running the good command makes it VALID again; check fails on a dirty tree', () => {
  assert.equal(al(dir, 'run', '--', 'npm test').code, 0);
  assert.equal(verify('last', dir).verdict, 'VALID');
  const c = check(dir);
  assert.equal(c.ok, false);
  assert.equal(c.verdict, 'DIRTY');
});

test('check passes after committing and re-running', () => {
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '-qm', 'edit'], { cwd: dir });
  assert.equal(al(dir, 'run', '--', 'npm test').code, 0);
  const c = check(dir);
  assert.equal(c.ok, true, c.reason);
  assert.equal(al(dir, 'check').code, 0);
});

test('a moved HEAD is STALE and lists files from the commit diff', () => {
  appendFileSync(join(dir, 'src', 'math.js'), '\n// commit me\n');
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '-qm', 'more'], { cwd: dir });
  const v = verify('last', dir);
  assert.equal(v.verdict, 'STALE');
  assert.ok(v.changed.includes('src/math.js'), v.changed.join(','));
});

test('an edited receipt is TAMPERED', () => {
  assert.equal(al(dir, 'run', '--', 'npm test').code, 0);
  const id = readFileSync(join(dir, '.alibi', 'latest'), 'utf8').trim();
  const p = join(dir, '.alibi', id + '.json');
  writeFileSync(p, readFileSync(p, 'utf8').replace(/"durationMs": \d+/, '"durationMs": 1'));
  const v = verify(id, dir);
  assert.equal(v.verdict, 'TAMPERED');
  writeFileSync(p, '{not json');
  assert.equal(verify(id, dir).verdict, 'TAMPERED');
});

test('list and show', () => {
  assert.equal(al(dir, 'run', '--', 'npm test').code, 0); // fresh receipt; the tamper test corrupted the previous one
  const rs = listReceipts(dir);
  assert.ok(rs.length >= 4);
  const r = al(dir, 'list');
  assert.equal(r.code, 0);
  assert.match(r.out, /r-[0-9a-f]{8}\s+\d{4}-\d{2}-\d{2}/);
  assert.match(al(dir, 'show', 'last').out, /"cmd": "npm test"/);
});

test('fingerprint changes on any byte, including an untracked file', () => {
  const a = fingerprint(dir).tree;
  writeFileSync(join(dir, 'new.txt'), 'hello');
  const b = fingerprint(dir).tree;
  assert.notEqual(a, b);
  rmSync(join(dir, 'new.txt'));
  assert.equal(fingerprint(dir).tree, a);
});

test('works outside git (size+mtime fingerprint)', () => {
  const nd = freshRepo(false);
  try {
    assert.equal(al(nd, 'run', '--', 'npm test').code, 0);
    assert.equal(verify('last', nd).verdict, 'VALID');
    assert.equal(fingerprint(nd).mode, 'files');
    assert.equal(check(nd).verdict, 'NOT_GIT');
    appendFileSync(join(nd, 'src', 'math.js'), '\n// x\n');
    const v = verify('last', nd);
    assert.equal(v.verdict, 'STALE');
    assert.deepEqual(v.changed, ['src/math.js']);
  } finally { rmSync(nd, { recursive: true, force: true }); }
});
