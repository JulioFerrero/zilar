---
id: T-0620
title: "gate: when a changed source file has no same-name test, run the tests in its folder instead of none (roles/service.ts skipped roles.test.ts, so T-0608's gate ran no server tests)"
status: merged
milestone: M5
branch: task/T-0620-gate-folder-tests
model: auto
effort: low
depends_on: [T-0616]
estimate: 0.25 day
---

# T-0620: the gate runs folder tests when there is no same-name test

## Spec (written by Claude, do not edit)

### Why
On T-0608 the gate printed `SKIP tests @zilar/server (no nearby test files)`. The task changed `apps/server/src/roles/service.ts`, but its tests live in `apps/server/src/roles/roles.test.ts`, which the light gate did not pick. As a result, a merge can pass with no test run at all.

### Verified facts (do not re-derive)
- **`packages/devtools/src/gate/plan.ts:54-84`:** `selectTestFiles` selects, for a changed `dir/name.ts(x)`, only the tests in `dir` whose file name starts with `name.`. When none match, it selects nothing (comment at 48-53).
- **`plan.ts:133-141`:** a package with no selected file gets the `no nearby test files` skip step.
- **`packages/devtools/src/gate/gate.test.ts:100-102`:** `selects nothing for a source file with no sibling test` pins the old behaviour. `packages/a/src/lonely.ts` currently gets `[]` even though `packages/a/src` holds three tests.

### What to build
1. **The fallback.** In `selectTestFiles`, when a changed source file matches no `name.` test, select every test file that sits **directly** in the same folder (not in subfolders). A folder with no tests still selects nothing. Update the comment at 48-53.
2. **Tests** in `packages/devtools/src/gate/gate.test.ts`:
   - change the `lonely.ts` test to expect the three tests directly in `packages/a/src`, and rename it;
   - add one test where a source file in a folder with no tests (for example `packages/a/src/empty/x.ts`) still selects `[]`;
   - add one test proving `nested/deep.test.ts` is not picked for `packages/a/src/lonely.ts`.

   Keep every other test unchanged.

### Read first
`AGENTS.md`, `packages/devtools/src/gate/plan.ts`, `packages/devtools/src/gate/gate.test.ts` (lines 71-107).

### Allowed files
`packages/devtools/src/gate/plan.ts`, `packages/devtools/src/gate/gate.test.ts`, `work/T-0620-gate-folder-tests.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/gate
pnpm gate
```

### Acceptance
- A changed `roles/service.ts` selects `roles/roles.test.ts`.
- A folder with no tests still selects nothing.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status:** done.

### What I did
`selectTestFiles` in `packages/devtools/src/gate/plan.ts` now falls back to folder tests. For each changed source file it first looks for tests in the same folder whose name starts with the source stem; when it finds none, it selects every test file sitting directly in that folder (subfolders excluded). A folder with no tests still selects nothing. I factored the dir/base extraction into small `dirOf`/`baseOf` helpers and updated the comment above the function. No dependency, API or behaviour change other than the fallback.

In `packages/devtools/src/gate/gate.test.ts` I replaced the old `lonely.ts` test with `falls back to the tests directly in the source file folder` (expects `other.test.ts`, `service.effect.test.ts`, `service.test.ts`), added `still selects nothing for a source file in a folder with no tests` (`packages/a/src/empty/x.ts` → `[]`) and `does not pick tests from a subfolder for the folder fallback` (`packages/a/src/nested/deep.test.ts` not selected). Every other test is unchanged.

### Files changed
- `packages/devtools/src/gate/plan.ts` (fallback + helpers + comment)
- `packages/devtools/src/gate/gate.test.ts` (3 tests)
- `work/T-0620-gate-folder-tests.md` (this Report, status)

### Commands and results
- `pnpm install`: done, 13 workspace projects, no errors (one pre-existing peer warning from `@types/react-dom`).
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/gate`: 1 test file passed, 21 tests passed.
- `pnpm gate` (from repo root): summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (19.0s)
  PASS  lint  (1.7s)
  PASS  typecheck  (3.6s)
  PASS  tests @zilar/devtools  (0.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

`git status --porcelain` lists only the three Allowed files.

### Acceptance
- A changed `roles/service.ts` now selects `roles/roles.test.ts` (folder fallback; no `service.` test in `roles`).
- A folder with no tests still selects nothing (covered by the `empty/x.ts` test).
- `pnpm gate` ends with `GATE PASS` and no file outside the Allowed files.

### Problems / deviations / open questions
None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, no findings. The packet head is d63f55dd, the current HEAD.
- **Lead check:**
  - the diff touches only the three Allowed files;
  - same-name tests still win, and the fallback takes only tests directly in the same folder (`dirOf` equality);
  - a folder with no tests still selects nothing;
  - 21 gate tests pass.
