---
id: T-1920
title: "Deflake gateway-stop.test.ts 'does not fail a queued scheduled item on timeoutMs while it waits': its 50 ms cap left a slow CI runner too little time after release() (expected 'replied', got 'failed' on main 4a8da94)"
status: merged
milestone: M5
branch: task/T-1920-flaky-scheduled-wait-test
model: auto
effort: default
depends_on: []
estimate: 15 min
---

# T-1920: Deflake the queued scheduled-run test

## Spec (written by Claude, do not edit)

### Why
CI on `main` `4a8da9474` failed in `Test (server 3/3)` on:
```
src/agents/gateway-stop.test.ts > scheduled-run fixes (T-1657) > does not fail a queued scheduled item on timeoutMs while it waits
AssertionError: expected 'failed' to be 'replied'   (gateway-stop.test.ts:461)
```
The same server code passed on the three previous main runs; the commit only changed `pnpm-workspace.yaml`. So this is a timing flake, and it blocks a release check.

### Facts (read by the lead on 2026-10-17)
In `apps/server/src/agents/gateway-stop.test.ts:404-463`:
- the runner is built with `timeoutMs: 50` (`:434`);
- a first, gated turn holds the queue, and the scheduled run queues behind it;
- the test waits `await tick(120)` (`:455`) and asserts that the run is not settled;
- then `release()` (`:460`) lets the first turn finish. The scheduled turn must now complete within its own 50 ms cap, and on a slow runner it sometimes doesn't, giving `'failed'`.

### Steps
1. **Keep what the test proves** (waiting in the queue does not count toward the cap), but give the run itself room: `timeoutMs: 300`, and wait `await tick(500)` before the "not settled" assertion. The wait is still longer than the cap, so a cap that wrongly counted the waiting time would still fail the test.
2. **Nothing else changes** in the file. No source changes.

### Allowed files
- `apps/server/src/agents/gateway-stop.test.ts`
- `work/T-1920-flaky-scheduled-wait-test.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway-stop.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **The test still fails** if the cap counted the queue wait (500 ms wait > 300 ms cap).
- **It passes reliably.** Run the file 5 times in a row and report the results.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Read `AGENTS.md` and the whole task file, set `status: in-progress`, ran `pnpm install`.
- `apps/server/src/agents/gateway-stop.test.ts`, test `does not fail a queued scheduled item on timeoutMs while it waits`: exactly the two changes the Spec asks for — the runner's `timeoutMs` goes from `50` to `300` (line 433), and the wait before the "not settled" assertion goes from `await tick(120)` to `await tick(500)` (line 457). Nothing else in the file changed; no source changes.
- The 500 ms wait is still longer than the 300 ms cap, so a cap that wrongly counted queue waiting would still fail the test at `expect(settled).toBeUndefined()`.
- I also checked the tightness of the old value with a throwaway local edit (`timeoutMs: 100`, same 500 ms wait, reverted immediately afterwards, not committed): it failed with `AssertionError: expected 'failed' to be 'replied'` — i.e. 100 ms is already too short for the run after `release()` on this machine, which matches the reported CI flake at 50 ms.

### Checks run

- `pnpm install` — done, exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-stop.test.ts`, run 5 times in a row:
  - run 1: exit 0, 1 file passed, 10 tests passed
  - run 2: exit 0, 1 file passed, 10 tests passed
  - run 3: exit 0, 1 file passed, 10 tests passed
  - run 4: exit 0, 1 file passed, 10 tests passed
  - run 5: exit 0, 1 file passed, 10 tests passed
- `pnpm gate` from the repo root, exit 0, summary:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.3s)
  PASS  lint  (1.4s)
  PASS  typecheck  (3.5s)
  SKIP effect (no source files changed)
  PASS  tests @zilar/server  (6.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- Spec's acceptance item "the test still fails if the cap counted the queue wait" is verified by the numbers: the test now waits 500 ms before asserting the run has not settled, which is longer than the 300 ms cap, so a cap that counted queue waiting would settle the run as `'failed'` before that assertion.
- The exact Spec check command (`exec vitest run ... --reporter=dot`) was run once (during the throwaway `timeoutMs: 100` check); the 5 acceptance runs used the AGENTS form with `--maxWorkers=2`. Both run the same file.
- Only the two allowed files changed; the throwaway edit was reverted before the gate, and the committed diff is exactly the two-line test change plus this task file.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `576bd85c6`.
- **The fix:** `timeoutMs` goes from 50 to 300 and the wait from 120 to 500 ms. The wait still exceeds the cap, so a cap that counted queue time would still fail the test.
- **Reliability:** 5 of 5 runs pass.
- **Why:** this test was the only red on main `4a8da94` (CI and its rerun).
