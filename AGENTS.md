# alibi — instructions for coding agents

You are reading this because a user pasted something like:

> Install the alibi skill from https://github.com/codegobrrrr9/alibi, refer to the repo's AGENTS.md.

Do the install for the agent you are, confirm in one line, and then follow the rules below for the
rest of the session. Do not explain what alibi is unless asked.

## Install

`<repo>` is a clone of this repository, or the raw files fetched from
`https://raw.githubusercontent.com/codegobrrrr9/alibi/main/`.

| Agent | Do this |
|-------|---------|
| Claude Code | Run `/plugin marketplace add codegobrrrr9/alibi` then `/plugin install alibi@alibi`. The plugin ships the hooks: test commands are receipted automatically and a "tests pass" claim without a VALID receipt is sent back. If plugins are unavailable, copy `<repo>/skills/alibi/` to `~/.claude/skills/alibi/` and add the hooks block below to `~/.claude/settings.json`. |
| Codex | Copy `<repo>/skills/alibi/` to `~/.codex/skills/alibi/`, or run `npx skills add codegobrrrr9/alibi`. Append the **Rules** below to the project's `AGENTS.md`. Run tests as `node <path>/alibi.js run -- <cmd>`. |
| Cursor | Copy `<repo>/.cursor/rules/alibi.mdc` to `.cursor/rules/alibi.mdc` and `<repo>/skills/alibi/scripts/alibi.js` to `scripts/alibi.js` in the project. |
| Gemini CLI | Run `gemini extensions install https://github.com/codegobrrrr9/alibi`. |
| GitHub Copilot | Copy `<repo>/.github/copilot-instructions.md` into the project's `.github/` (merge if one exists). |
| Anything else | Append the **Rules** below to the instruction file the agent reads, keep `alibi.js` in the project, and run tests through it. |

Hooks block for a non-plugin Claude Code install (`~/.claude/settings.json`), with `<skill>` being the
absolute path of the copied `skills/alibi` directory and `<repo>` the cloned repo:

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash|PowerShell", "hooks": [{ "type": "command", "command": "node \"<repo>/hooks/pre-tool-use.js\"", "timeout": 10 }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node \"<repo>/hooks/stop.js\"", "timeout": 30 }] }]
  }
}
```

After installing, say: `alibi on. Test runs are receipted; I will quote the receipt before saying tests pass.`

## Rules

"Tests pass" is a claim. A receipt is evidence. The user cannot see your terminal.

1. **Tests run through alibi.** Under Claude Code this is automatic. Elsewhere: `alibi run -- <cmd>`.
2. **Never say tests pass without a receipt id.** Run `alibi status` and quote the line.
   `VALID r-3f9a2c1e · npm test · 23 passed · tree matches` is a claim. "They should pass" is not.
3. **Any edit after a run makes the receipt STALE.** Run again before you say anything about tests.
4. **Every done message ends with the status line** from `alibi status`.
5. **Never write into `.alibi/`.** If the tests cannot run, say exactly that and stop. Do not claim.
6. **If the Stop hook sends you back**, run the tests, read the footer, finish with the status line.
   Do not rephrase the claim to get past it.

## Commands

```
alibi run -- <cmd…>     run, stream output, write a receipt, exit with the command's code
alibi status            VALID / STALE (lists changed files) / FAILED / MISSING / TAMPERED
alibi verify [id|last]  full verdict, --json for tooling, exit 0 only on VALID
alibi check             CI gate: VALID receipt, clean tree, receipt HEAD == current HEAD
alibi list · show <id>
```

## Overrides

- Throwaway prototype, user says skip verification: say once that alibi is off. Still do not
  say tests pass.
- Receipt is TAMPERED: say so, do not use it, run the tests again.
