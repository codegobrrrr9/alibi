---
description: Did the tests actually run on this code? Prints the alibi verdict (VALID / STALE / FAILED / MISSING / TAMPERED) for the newest receipt and what to do about it.
allowed-tools: Bash(node:*), Read
---

Report the alibi status for this project.

1. Run `node ${CLAUDE_PLUGIN_ROOT}/skills/alibi/scripts/alibi.js verify last` from the project root
   (if that path does not exist, find `alibi.js` under the installed alibi skill directory). Pass
   through any arguments the user gave: $ARGUMENTS
2. Quote the verdict line exactly as printed, then one sentence on what it means, using
   `${CLAUDE_PLUGIN_ROOT}/skills/alibi/references/verdicts.md` if needed.
3. If it is STALE, FAILED or MISSING and the user wants the tests run, run the test command (it is
   receipted automatically) and quote the new status line. Never say the tests pass without a
   VALID receipt id.
