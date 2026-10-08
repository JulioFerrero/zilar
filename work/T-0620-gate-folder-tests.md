---
id: T-0620
title: "gate: when a changed source file has no same-name test, run the tests in its folder instead of none (roles/service.ts skipped roles.test.ts, so T-0608's gate ran no server tests)"
status: todo
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

## Review (written by Claude)
