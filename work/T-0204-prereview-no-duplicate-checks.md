---
id: T-0204
title: Lead tooling: the pre-review stops re-running checks the merge gate runs anyway, and spends its effort on the diff (token saving)
status: merged
milestone: M5
branch: task/T-0204-prereview-no-duplicate-checks
model: minimax-coding-plan/MiniMax-M3
effort: default
depends_on: [T-0203]
estimate: 0.2 day
---

# T-0204: Pre-review: no duplicate checks

## Spec (written by Claude, do not edit)

### Why
Measured on 2026-10-05: 29 pre-review sessions read about 33M tokens. Each pre-review re-runs format, lint, typecheck and tests, although the worker already ran `pnpm gate` (its summary is in the Report) and `lead merge` runs `pnpm gate` again after the rebase and refuses to merge on red (`packages/devtools/src/lead/merge.ts`, the gate call after the rebase). Those reruns add nothing a reviewer can judge; reading the diff is the pre-review's real value. Julio asked to cut this waste.

### Verified facts (do not re-derive)
- `packages/devtools/prompts/prereview.md` line 6 is step 2: "Re-run the cheap Checks from the spec: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, and ONLY the tests of the files the diff touches ... Record the real results."
- Line 17 asks PREREVIEW.md for "the Checks with real results (pass/fail plus counts);".
- `packages/devtools/src/lead/prompts.test.ts` lines 90-95 assert the rendered pre-review prompt contains `PREREVIEW.md`, `Verdict:`, `60 lines`, `file:line`, `Counts: must-fix=N, should-fix=N, nit=N, follow-up=N` and `Follow-ups`. Keep all of them true.

### What to build
1. Replace step 2 (line 6) of `packages/devtools/prompts/prereview.md` with exactly:

   ```
   2. Do NOT run install, format, lint, typecheck, `pnpm gate` or whole test suites: the worker's Report has its gate result, and `lead merge` runs the gate again before anything reaches main. Run ONLY the test files the diff adds or changes, with `pnpm --filter <package> test --maxWorkers=2 --reporter=dot <paths>`, to confirm they pass. Spend your effort on reading the diff (step 3). Read only the files and line ranges you need; never print a whole log.
   ```
2. Replace line 17 with: `- the tests you ran with their real results (pass/fail plus counts), and the gate summary line from the worker's Report;`
3. In `packages/devtools/src/lead/prompts.test.ts`, in the pre-review prompt test, add assertions that the rendered prompt contains `--reporter=dot` and `Do NOT run install`.

### Read first
`AGENTS.md`, `packages/devtools/prompts/prereview.md`, `packages/devtools/src/lead/prompts.test.ts` (lines 78-98).

### Allowed files
`packages/devtools/prompts/prereview.md`, `packages/devtools/src/lead/prompts.test.ts`, `work/T-0204-prereview-no-duplicate-checks.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/prompts.test.ts
pnpm gate
```

### Acceptance
- Step 2 and the line-17 bullet read exactly as above; every existing assertion still passes and the two new ones pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
The doctor prompt (the doctor audits main and must run the full checks), the autofix prompt, the gate, `decide.ts`.

---

## Report (written by the worker when done)

### What I did

1. Replaced step 2 of `packages/devtools/prompts/prereview.md` with the exact wording from the spec (no install, format, lint, typecheck, `pnpm gate`, or whole test suites; only the test files the diff adds or changes with `pnpm --filter <package> test --maxWorkers=2 --reporter=dot <paths>`; spend the effort on reading the diff).
2. Replaced the line-17 bullet with `- the tests you ran with their real results (pass/fail plus counts), and the gate summary line from the worker's Report;`.
3. Added two new assertions in the "keeps the pre-review short-format contract" test in `packages/devtools/src/lead/prompts.test.ts`: `expect(rendered).toContain('--reporter=dot')` and `expect(rendered).toContain('Do NOT run install')`.

### Files changed

- `packages/devtools/prompts/prereview.md` (allowed)
- `packages/devtools/src/lead/prompts.test.ts` (allowed)
- `work/T-0204-prereview-no-duplicate-checks.md` (task file, status + this Report)
- `pnpm-lock.yaml` (lockfile bump from `pnpm install`; always allowed by the gate)

### Commands run with real results

- `pnpm install`: `Done in 10.5s`, peer warning about `@types/react-dom 19.3.0` vs `@types/react 19.2.18` (pre-existing on `main`, not introduced by this task).
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/prompts.test.ts`: `Test Files 1 passed (1) / Tests 11 passed (11) / Duration 189ms`. All assertions, old and the two new ones, pass.
- `pnpm gate` (from repo root):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (11.7s)
  PASS  lint  (1.3s)
  PASS  typecheck  (2.8s)
  PASS  tests @zilar/devtools  (0.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations

None. Spec was small and unambiguous.

### Open questions

None.

## Review (written by Claude)

**Verdict:** Approved, clean on the first pre-review (MiniMax, easy task). Step 2 of `packages/devtools/prompts/prereview.md` now tells the pre-reviewer not to run install, format, lint, typecheck, the gate or whole suites, only the changed test files with `--reporter=dot`, and the packet lists the worker's gate line instead; `prompts.test.ts` asserts the new text. The lead read the diff. The `pnpm-lock.yaml` change removes the two peer entries T-0203 added: `pnpm install` flips them between worktrees, so the net effect on main is nil; the flip-flop is noted in `work/NOW.md` for a later fix. The autopilot is restarted after the merge.
