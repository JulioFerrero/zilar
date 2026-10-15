---
id: T-1487
title: "Stop the CI flake in the sandbox test 'truncates 100 KB of console.log output': it runs on the default 2 s CPU limit and failed on a saturated runner (main, T-1486 push); give it the wide limits its sibling tests already use"
status: merged
milestone: M5
branch: task/T-1487-sandbox-log-test-flake
model: auto
effort: default
depends_on: []
estimate: 0.05 day
---

# T-1487: Sandbox log test flake

## Spec (written by Claude, do not edit)

### Why
CI on main failed once for the T-1486 push (run 38689622829, "Test (server 1/3)"). It was the first failure in 30 main runs.
- **The failing test:** `apps/server/src/sandbox/run-tool.test.ts` › runTool limits › truncates 100 KB of console.log output. The assertion `expected false to be true` is `result.ok`.
- **Timing on the runner:** the test took 1,650 ms, and the whole file took 80 s.
- **Locally,** the full server suite passes (720 tests).
- **The cause:** the test runs on the default limits, so a slow worker start on a saturated runner can trip them.
- **The impact:** the failed CI skipped "Production images", so that push did not deploy.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/server/src/sandbox/run-tool.test.ts:241-254`:** the test calls `runTool` with no `limits`. It logs 2,000 lines and expects `ok` true, logs of at most 4 KB plus 64 bytes, and a trailing `…`.
- **`apps/server/src/sandbox/limits.ts:6-8`:** `DEFAULT_LIMITS` sets `wallMs: 10_000` and `cpuMs: 2_000`.
- **Sibling tests already widen their limits for this reason.** `run-tool.test.ts:203-205`: "wallMs and cpuMs are wide so a slow worker start on a saturated host cannot trip the wall clock first". See also `:181` (`cpuMs: 5000, wallMs: 15000`) and `:218` (`wallMs: 20000, cpuMs: 20000`).

### What to build
1. In that one test, pass `limits: { cpuMs: 20000, wallMs: 20000 }`, and set the test's own timeout to `{ timeout: 30000 }` like `:207`.
2. Add one short comment saying why (the same reason as `:203-205`).
3. The assertions stay exactly as they are. No source file changes.

### Tests
This is the test change itself, nothing else.

### Allowed files
`apps/server/src/sandbox/run-tool.test.ts`, `work/T-1487-sandbox-log-test-flake.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/sandbox/run-tool.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- The changed test passes, and its assertions are unchanged.

---

## Report (written by the worker when done)

### What I did
- In `apps/server/src/sandbox/run-tool.test.ts`, the test `truncates 100 KB of console.log output` now passes `limits: { cpuMs: 20000, wallMs: 20000 }` and its own timeout `{ timeout: 30000 }`, matching the sibling tests at `:181`, `:207` and `:218`.
- Added a two-line comment above it saying why: a slow worker start on a saturated host cannot trip the wall clock first. The assertions are unchanged.
- No source files changed.

### Files changed
- `apps/server/src/sandbox/run-tool.test.ts` (test limits + timeout + comment)
- `work/T-1487-sandbox-log-test-flake.md` (status/report)

### Commands run and results
- `pnpm install`: Done in 10.7s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/sandbox/run-tool.test.ts`: 1 file passed, 48 tests passed (34.40s).
- `pnpm gate`: GATE PASS.
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.3s)
  SKIP effect (no source files changed)
  PASS  tests @zilar/server  (27.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Deviations from the spec
None.

### Blocked / needs a decision
None.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 0.
- **The change:** test-only. The one test gets `cpuMs`/`wallMs` of 20,000 and a 30 s timeout, and its assertions are unchanged.
- **Results:** `run-tool.test.ts` passes 48 of 48 in the worktree. The failed CI run on main (38689622829) passed on rerun, confirming the flake.
