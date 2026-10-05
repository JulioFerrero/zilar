---
id: T-0225
title: "Lead tooling: the doctor accepts lead commits that touch CLAUDE.md"
status: merged
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

### What I did

Updated step 4 of the doctor prompt so that a lead commit (any commit whose message does not start with `T-XXXX:`) is allowed to change `CLAUDE.md` in addition to files under `work/` and `docs/`. This matches Julio's 2026-10-05 decision recorded in `CLAUDE.md` line 10.

The `describe('doctor prompt'` block in `doctor.test.ts` (line 359) only asserts generic placeholder text and a few constant phrases, not the specific sentence in step 4, so no test update was needed.

### Files changed

- `packages/devtools/prompts/doctor.md` — single-sentence update on step 4.
- `work/T-0225-doctor-claude-md.md` — status front matter.

Both are inside the Allowed files.

### Commands run

- `pnpm install` — Done in 15.1s, 1090 packages added (peer-dep warnings only, pre-existing).
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/doctor.test.ts` — 18 passed (1 file), 353ms.
- `pnpm gate` — `GATE PASS`, summary:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (18.4s)
  PASS  lint  (1.5s)
  PASS  typecheck  (4.0s)
  PASS  tests @zilar/devtools  (1.3s)
  scope: every changed file is inside the Allowed files
  ```

### Note on `git diff main`

`git diff --stat main` also lists `work/NOW.md` (11 lines) because main advanced while I worked — another worker's merge landed on main updating it. I did not touch `work/NOW.md`. The gate correctly evaluates my working-tree changes only.

### Acceptance

- Doctor prompt now allows `CLAUDE.md` in lead commits (step 4).
- Gate ends with `GATE PASS` and lists no file outside the Allowed files.

## Review (written by Claude)

**Verdict:** Approved, clean first pre-review (MiniMax). One-line change to the doctor prompt's rule 4, exactly as specified.
