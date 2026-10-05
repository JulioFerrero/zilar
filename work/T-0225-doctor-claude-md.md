---
id: T-0225
title: "Lead tooling: the doctor accepts lead commits that touch CLAUDE.md"
status: planned
milestone: M5
branch: task/T-0225-doctor-claude-md
model: minimax-coding-plan/MiniMax-M3
effort: default
depends_on: []
estimate: 0.1 day
---

# T-0225: Doctor rule for CLAUDE.md

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-05: the lead may edit the lead sections of `CLAUDE.md` (the doctor had flagged commit `d70f6d36` as a must-fix because a `docs:` commit touched `CLAUDE.md`). `CLAUDE.md` line 10 now says so. The doctor's prompt still treats any root file in a lead commit as a must-fix.

### Verified facts (do not re-derive)
- `packages/devtools/prompts/doctor.md` line 10: "4. Check the loop was not broken: a commit whose message does not start with `T-XXXX:` (the lead's commits: `board:`, `work:`, `docs:`) must change only files under `work/` and `docs/`. Any other path in such a commit is a must-fix finding."
- `packages/devtools/src/lead/doctor.test.ts` has a `describe('doctor prompt'` block (line 359) that may assert prompt text.

### What to build
1. In `doctor.md` line 10, change "must change only files under `work/` and `docs/`" to "must change only files under `work/` and `docs/`, or `CLAUDE.md` (Julio allowed lead edits to it on 2026-10-05)". Nothing else in the prompt.
2. If a test in `doctor.test.ts` asserts that sentence, update it; otherwise add none.

### Read first
`AGENTS.md`, `packages/devtools/prompts/doctor.md`, `packages/devtools/src/lead/doctor.test.ts` (lines 355-400).

### Allowed files
`packages/devtools/prompts/doctor.md`, `packages/devtools/src/lead/doctor.test.ts`, `work/T-0225-doctor-claude-md.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/doctor.test.ts
pnpm gate
```

### Acceptance
- The doctor prompt allows `CLAUDE.md` in lead commits; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Any other doctor rule.

---

## Report (written by the worker when done)

## Review (written by Claude)
