# alibi

Rules from https://github.com/codegobrrrr9/alibi. "Tests pass" is a claim. A receipt is evidence.

1. Run tests through alibi: `node scripts/alibi.js run -- <test command>` (copy `skills/alibi/scripts/alibi.js` from the repo to `scripts/alibi.js`). It writes a receipt tied to a fingerprint of the working tree.
2. Never say tests pass without quoting `node scripts/alibi.js status`, for example `VALID r-3f9a2c1e · npm test · 23 passed · tree matches`.
3. Any edit after a run makes the receipt STALE. Run again before saying anything about tests.
4. End every done message with the status line.
5. Never write into `.alibi/`. If the tests cannot run, say exactly that and stop. Do not claim.
