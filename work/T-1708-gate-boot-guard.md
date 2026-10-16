---
id: T-1708
title: "Gate always runs the server's boot-guard test (actions/args-example.test.ts, which builds the real action registry) whenever a server source file changes — T-1704 passed the nearest-tests gate yet crashed prod at start with an over-long adapter description (2026-10-16, ~26 min down)"
status: merged
milestone: M5
branch: task/T-1708-gate-boot-guard
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1708: The gate always checks that the server's action registry builds

## Spec (written by Claude, do not edit)

### Why
On 2026-10-16, T-1704 changed only `apps/server/src/tools/routine-adapters.ts`. The gate ran just the nearest tests (the `tools/` folder), so `apps/server/src/actions/args-example.test.ts` didn't run. That test builds the real registry and would have failed: the new description was over `ADAPTER_DESCRIPTION_MAX_LENGTH = 200` (`apps/server/src/actions/registry.ts:146`). The server threw `AdapterRegistryError` at start, and prod was down from 07:54 to 08:20 UTC until a revert.

### Facts (the lead read them on 2026-10-16)
- **`packages/devtools/src/gate/plan.ts`** (263 lines):
  - `selectTestFiles(changedFiles, testFiles, exists)` (`:82-109`) returns the nearest tests: the changed tests, plus the tests in the same folder as each changed source;
  - `:140`: `const selected = full ? [] : selectTestFiles(changedFiles, options.testFiles ?? [], exists);`;
  - per package, the tests step runs `near = selected.filter(inPackage)` (`:170` on).
- **`packages/devtools/src/gate/gate.test.ts:256` on** has the `selectTestFiles` tests, with a fake `testFiles` list.
- **`apps/server/src/actions/args-example.test.ts`** (18 tests, about 1 s) builds the registry from `buildWebToolsAdapters()` and `buildToolAdapters(…)` and checks that every example decodes. It needs no database.

### Steps
1. **`plan.ts`:**
   - add an exported `BOOT_GUARD_TESTS` list, holding one entry: `{ when: 'apps/server/src/', test: 'apps/server/src/actions/args-example.test.ts' }`, with a comment naming this incident;
   - in `selectTestFiles`, after the loop: for each guard, when any changed **source** file (not a test) starts with `when` and `testFiles` includes `test` and `exists(test)`, add `test`;
   - keep the `--full` path unchanged;
   - keep the file under 400 lines.
2. **`gate.test.ts`:** add two cases to the `selectTestFiles` block:
   - a changed `apps/server/src/tools/x.ts` (with the guard path in `testFiles`) selects the guard test;
   - a change outside `apps/server/src/` doesn't.

### Allowed files
- `packages/devtools/src/gate/plan.ts`
- `packages/devtools/src/gate/gate.test.ts`
- `work/T-1708-gate-boot-guard.md`

### Checks
```bash
pnpm --filter @zilar/devtools exec vitest run src/gate/gate.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **Any server source change runs the boot guard:** the plan includes `apps/server/src/actions/args-example.test.ts`.
- **The new cases pass.**

---

## Report (written by the worker when done)

### What I did
- `packages/devtools/src/gate/plan.ts`:
  - Added the exported `BOOT_GUARD_TESTS` list (with a `BootGuardTest` interface) holding one entry: `{ when: 'apps/server/src/', test: 'apps/server/src/actions/args-example.test.ts' }`, with a comment naming the T-1704 incident (over-long adapter description, prod down ~26 min on 2026-10-16).
  - In `selectTestFiles`, after the nearest-test loop, added a guard loop: when a changed **non-test** file starts with `when`, and `testFiles` contains the guard's `test`, and `exists(test)` is true, the test is added to the selection.
  - Updated the file header comment to mention the boot guards.
  - The `--full` path is unchanged: `gateSteps` still passes an empty selection when `full` is set, so guards only apply to the default nearest-test path.
- `packages/devtools/src/gate/gate.test.ts`: added two cases to the `selectTestFiles` block:
  - a changed `apps/server/src/tools/x.ts` selects the guard test;
  - a change outside `apps/server/src/` (`packages/a/src/service.ts`) does not.

### Checks run
- `pnpm install` — done, 12.3s.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/gate/gate.test.ts` — 49 passed (49), 1 file passed, 579ms.
- `pnpm gate` (repo root) — summary:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (1.3s)
  PASS  lint  (1.4s)
  PASS  typecheck  (2.6s)
  PASS  effect  (1.6s)
  PASS  tests @zilar/devtools  (0.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- The guard condition excludes test files (`!isTestFile`) as the spec says ("any changed source file (not a test)"). I did not additionally require a `.ts`/`.tsx` extension, so a non-code file under `apps/server/src/` would also trigger the guard test; that is harmless and matches the spec wording. Say the word if you'd rather restrict it to code sources.
- `plan.ts` is 290 lines, under the 400-line cap.
- Only the three Allowed files are modified; no files outside scope.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 1 nit, accepted as it is. The guard also fires on a non-code file under `apps/server/src/`, which only costs about 1 s.
- **The change:** `BOOT_GUARD_TESTS` adds `actions/args-example.test.ts` to the nearest-test plan whenever a server source file changes, so an adapter that breaks the registry fails the gate instead of prod.
- **The tests:** the lead ran `gate.test.ts` in the worktree: 49 tests passed.
