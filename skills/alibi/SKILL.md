---
name: alibi
description: Proof that the tests actually ran on the code that shipped. Every test run is recorded as a receipt tied to a fingerprint of the working tree; a receipt goes STALE the moment a file changes. The agent must quote a VALID receipt before it may say tests pass. Use for every coding task that has tests, and when the user says prove it, did the tests run, receipt, alibi, or /alibi.
license: MIT
metadata:
  author: codegobrrrr9
  version: "0.1.0"
  homepage: https://github.com/codegobrrrr9/alibi
---

# alibi

"Tests pass" is a claim. A receipt is evidence. The user cannot see your terminal, so the only
thing they can trust is a receipt that names the command, the exit code, and the exact state of
the tree it ran on. If you edit anything after the run, that receipt no longer describes the code.

## Rules

1. **Tests run through alibi.** Under Claude Code this is automatic: a hook rewrites any test
   command into `alibi run -- <command>` before it executes. On any other agent, run
   `alibi run -- npm test` (or whatever the test command is) yourself.
2. **Never say tests pass without a receipt id.** Run `alibi status` and quote its line. "I believe
   they pass" and "the tests should pass" are not claims you make. `VALID r-3f9a2c1e` is.
3. **An edit after a run makes the receipt STALE.** If you touched any file after the last test
   run, run the tests again before you say anything about them.
4. **Every done message ends with the status line**, copied from `alibi status`, for example:
   `alibi: VALID r-3f9a2c1e · npm test · 23 passed · tree matches`
5. **Never write into `.alibi/` by hand.** If the tests cannot run (missing dependency, no test
   script, environment broken), say exactly that and stop. Do not claim.
6. **If the Stop hook sends you back**, it means your last message claimed passing tests without a
   VALID receipt. Run the tests, read the footer, then finish with the status line. Do not argue
   with the hook and do not rephrase the claim to dodge it.

## Commands

```
alibi run -- <cmd…>      run a command, stream its output, write a receipt, exit with its code
alibi status             one line: VALID / STALE / FAILED / MISSING / TAMPERED, and why
alibi verify [id|last]   full verdict, --json for tooling, exit 0 only on VALID
alibi check              CI gate: VALID receipt and a clean tree at HEAD
alibi list · show <id>   receipts in this repo
```

Under Claude Code the plugin ships the hooks. Elsewhere, the rules still apply; run alibi by hand.

## Report shape

When asked whether the tests ran, or after finishing work that touched tests:

```
alibi: VALID r-3f9a2c1e · npm test · 23 passed, 0 failed · 2 min ago · tree matches
```

or

```
alibi: STALE · 3 files changed since r-3f9a2c1e (src/user.js, src/api.js, tests/user.test.js)
Re-running the tests now.
```

Verdict first. One line. Then act on it. `references/verdicts.md` explains each verdict and what
to do about it.

## Overrides

- The user says this is a throwaway prototype and to skip verification: say once that alibi is
  off for the session, and stop quoting receipts. Do not say tests pass either.
- The user asks what changed since the last receipt: run `alibi verify last` and list the files.
- A receipt is TAMPERED: say so plainly, do not use it, and run the tests again.
