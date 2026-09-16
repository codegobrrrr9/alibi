# Verdicts

`alibi status` and `alibi verify` end in one of five words. What each means and what to do.

| Verdict | Meaning | What to do |
|---------|---------|------------|
| **VALID** | The newest receipt has exit code 0 and its tree fingerprint equals the working tree right now. The tests passed on exactly this code. | Quote it: `alibi: VALID r-3f9a2c1e · npm test · 23 passed · tree matches`. |
| **STALE** | The receipt was fine when written, but files changed since. It describes code that no longer exists. The line lists the changed files. | Run the tests again. Then quote the new receipt. |
| **FAILED** | The newest receipt records a non-zero exit code. The last run did not pass. | Fix, run again. Never describe a FAILED receipt as passing, even partially. |
| **MISSING** | No receipt in this repository. The tests have not been run through alibi here. | Run the test command. Under Claude Code the hook records it; elsewhere `alibi run -- <cmd>`. |
| **TAMPERED** | The receipt's content does not match its id, or its signature does not match this machine's key, or the file is not valid JSON. Someone or something edited it. | Say so plainly. Delete nothing. Run the tests again to get a real receipt. |

`alibi check` (the CI gate) adds two more:

| Result | Meaning |
|--------|---------|
| **DIRTY** | The receipt is VALID but the tree has uncommitted changes, so no commit corresponds to what was tested. Commit, run again. |
| **NOT_GIT** | `check` needs a git repository; `run`, `status` and `verify` do not. |

## What a receipt contains

```json
{
  "v": 1,
  "cmd": "npm test",
  "cwd": ".",
  "startedAt": "2026-09-16T10:41:03.120Z",
  "durationMs": 2140,
  "exitCode": 0,
  "summary": { "runner": "node:test", "passed": 23, "failed": 0 },
  "output": { "sha256": "…", "bytes": 4127, "tail": "last 40 lines" },
  "tree": { "mode": "git", "head": "8d1e2c…", "sha": "…", "files": { "src/a.js": "sha256…" } },
  "host": { "platform": "win32", "node": "v24.18.1" },
  "id": "r-3f9a2c1e",
  "sig": "hmac-sha256 with ~/.alibi/key"
}
```

The fingerprint is `HEAD` + the hash of `git diff HEAD` + a hash per modified or untracked file.
Any byte anywhere in a tracked or untracked file changes it. Outside git, it is every file's size
and mtime.

## Honest limits

- A receipt proves a command ran and what it returned. It does not prove the tests are good.
- An agent with file access could write a receipt by hand. The signature makes that a deliberate
  act (it would need to read the key), and the Stop hook only runs `alibi verify`, which detects
  it as TAMPERED. alibi catches mistakes and staleness, not a determined liar.
- `summary` is parsed from output of known runners (node:test, TAP, jest, vitest, pytest,
  unittest, go, cargo, mocha). Unknown runners still get exit code, output hash and tail.
