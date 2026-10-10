---
id: T-0913
title: "Load flakes: four timing tests that fail combined checks under high load become deterministic (fake timers or a measured, wider bound)"
status: todo
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

## Review (written by Claude)
