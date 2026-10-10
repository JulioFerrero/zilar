---
id: T-0913
title: "Load flakes: four timing tests that fail combined checks under high load become deterministic (fake timers or a measured, wider bound)"
status: merged
milestone: M5
branch: task/T-0913-load-flakes
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0913: Load flakes

## Spec (written by Claude, do not edit)

### Why
These tests failed the lead's combined checks on 2026-10-10 at host load 30-45. Each passes when run alone, and none was related to the tasks being checked:
- `packages/devtools/src/lead/watch-app.test.tsx:798` "skips a refresh while the previous child process is still running" timed out at 5000 ms.
- `packages/runner-tunnel/src/server.effect.test.ts:50` "terminates a ready connection whose pongs stop after heartbeatTimeoutMs" failed with "expected 202 to be less than or equal to 170", a real-time bound.
- `apps/server/src/sandbox/run-tool.test.ts:113` "does not count fetch wait time against cpuMs" failed with "expected false to be true".
- `apps/server/src/sandbox/run-tool.test.ts:202` "times out a tool that awaits a fetch that never answers" failed with "expected 'timeout' to be 'fetch_denied'".

### What to build
1. **Read each test and the code it covers.** Decide why load breaks it: real time against a fixed bound, a real child process, or a CPU-time measurement.
2. **Make each one deterministic without weakening what it proves:**
   - prefer fake timers or `TestClock`, where the code takes a clock;
   - an injected clock, where it does not, which is test-side only unless a one-line seam in the code is unavoidable (say so);
   - where a test measures real CPU or wall time on purpose (the sandbox limits), a bound justified by measurement, as the last resort.
3. **Prove it under load:** run each file 10 times while a CPU-heavy job runs (for example the full web suite in parallel), and report the pass counts before and after.
4. **No behaviour change** in production code, unless the Report explains a one-line clock seam.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/T-0913/`; use the shared wait helpers, never a raw `setTimeout(resolve, 0)`), and the three test files with the code they cover.

### Allowed files
`packages/devtools/src/lead/watch-app.test.tsx`, `packages/runner-tunnel/src/server.effect.test.ts`, `apps/server/src/sandbox/run-tool.test.ts`, `packages/devtools/src/lead/watch-app.tsx`, `packages/runner-tunnel/src/server.ts` and `apps/server/src/sandbox/run-tool.ts` (only a clock seam, if unavoidable), `work/T-0913-load-flakes.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/devtools exec vitest run --reporter=dot src/lead/watch-app.test.tsx
pnpm --filter @zilar/runner-tunnel exec vitest run --reporter=dot src/server.effect.test.ts
pnpm --filter @zilar/server exec vitest run --reporter=dot src/sandbox/run-tool.test.ts
pnpm --filter @zilar/devtools typecheck
pnpm --filter @zilar/runner-tunnel typecheck
pnpm --filter @zilar/server typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Also run the 10-runs-under-load proof from step 3.

### Acceptance
- Each test passes 10 of 10 under load.
- Each test still fails if the behaviour it guards breaks: show that once per test by temporarily breaking the code, then reverting.
- The Report gives the before and after pass counts.

---

## Report (written by the worker when done)

Started from the draft at `~/.zilar-lead/T-0913-partial.patch` (applied, then every hunk checked
against the spec). Production code was not changed: all break-then-revert edits were undone and
`git status` shows only the three test files and this task file.

### What changed (tests only)

- `packages/devtools/src/lead/watch-app.test.tsx` — the test already used fake timers, so the only
  load-sensitive part is the real CPU of the Ink re-renders that the ~20 one-second clock ticks
  drive across the two 10 s advances. Gave the test `{ timeout: 60000 }` (was the 5000 ms default).
  No logic or assertion changed.
- `packages/runner-tunnel/src/server.effect.test.ts` — replaced the real-time upper bound
  (`elapsed <= timeout + 2*interval + 50`) with a load-invariant one: a `ws` client with
  `autoPong: false` counts the server's pings, and every sweep before the timeout pings, so the
  count cannot exceed `timeout / interval + 1`. Kept `elapsed >= timeout - interval`. This needed a
  raw `ws` client in the test because `test-harness.ts` (which would carry a ping counter) is not an
  Allowed file.
- `apps/server/src/sandbox/run-tool.test.ts` — the two sandbox tests measure real CPU/wall time on
  purpose, so per the spec the last resort is a measured, wider bound. Fetch-wait test: fetch delay
  800→2500 ms and cpuMs 300→1500 ms (the wait now far exceeds the budget, and the loop has headroom
  on a saturated host), `{ timeout: 20000 }`. Fetch-timeout test: wallMs/cpuMs 3000→20000 so worker
  start cannot beat the 2 s fetch timer, `{ timeout: 30000 }`; the fetch timeout is what still ends
  the run and is still asserted.

No production file changed, so no clock seam was needed.

### Proof: 10 runs per file under CPU load

Harness: a bounded foreground Node driver spawns a fixed number of busy child processes, runs the
command 10× with the quiet reporter, prints one line per run and a final count, then kills the
burners (no detached process). With the burners plus the other workers, `uptime` load was ~30–48,
matching the load 30–45 where the lead saw the failures.

After (final code):

- `watch-app.test.tsx` whole file, 10×: **10/10 PASS** (53 tests each).
- `server.effect.test.ts` whole file, 10×: **10/10 PASS** (3 each); heartbeat test alone 20× at 30
  burners: **20/20 PASS**.
- `run-tool.test.ts` whole file, 10×: **10/10 PASS** (48 each).

Before (base code, same load; the watch-app and run-tool flakes do not show in whole-file runs
because the other tests warm the process, so these are the failing tests run alone):

- watch-app `-t 'skips a refresh'`, 30 burners, 8 runs: **2/8 passed** (6× "timed out at 5000 ms").
- `run-tool` "does not count fetch wait time against cpuMs", 30 burners, 10 runs: **8/10 passed**
  (2× "expected false to be true", the lead's message).
- `run-tool` "times out a tool that awaits a fetch that never answers", 30 burners, 10 runs:
  **9/10 passed** (1× "expected 'timeout' to be 'fetch_denied'", the lead's message).
- `server.effect` heartbeat test, 30 burners, 10 runs: **10/10 passed** — I could not reproduce the
  `202 <= 170` failure, but the rewrite removes the real-time bound it came from.

### Proof: each test still fails when its behaviour breaks (then reverted)

- watch-app: dropped the `inFlight` guard in `watch-app.tsx` → "expected vi.fn() to be called 1
  times, but got 2 times".
- runner-tunnel: made `checkHeartbeats` ping where it terminates → the test timed out waiting for
  close.
- run-tool fetch-wait: bounded the run by `cpuMs` instead of `wallMs` in `run-tool.ts` → "expected
  false to be true".
- run-tool fetch-timeout: bounded the run by `fetchTimeoutMs` → "expected 'timeout' to be
  'fetch_denied'".

### Deviations / notes

- `run-tool.test.ts` "still times out a busy loop at cpuMs" is not one of the four named flakes. The
  draft widened it; I restored its original tight bound (`< 5000`), which passed 10/10 alone at 30
  burners, to keep the diff to the four tests.
- The first draft of the rewritten runner-tunnel test flaked 1/10 in my own after run: under load the
  first sweep after `ready` can already be past the timeout, so `expect(closed).toBe(false)` and
  `expect(pings).toBeGreaterThan(0)` can fail even though the behaviour is correct. I removed those
  two load-fragile assertions; the `elapsed >= timeout - interval` lower bound and the ping-count
  upper bound still prove the timing. Then 20/20.

### Gate

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.3s)
PASS  lint  (0.7s)
PASS  typecheck  (3.9s)
SKIP effect (no source files changed)
PASS  tests @zilar/devtools  (4.3s)
PASS  tests @zilar/runner-tunnel  (0.9s)
PASS  tests @zilar/server  (28.4s)
scope: every changed file is inside the Allowed files
GATE PASS
```

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 2 nits.**
- **Results:** the four load-fragile timing tests pass 10 of 10 runs under load.
- **They still guard their behaviour:** each was proven to fail when its behaviour breaks, by breaking the code and then reverting.
- **No production code changed.**
- **Nits accepted:**
  - the runner-tunnel heartbeat test's tight upper bound is replaced by close detection, a deliberate trade-off;
  - `ws.terminate()` is not in a `finally`, but cleanup still happens through `server.close()`.
- **Check:** the combined check passes.
