---
id: T-0497
title: "Effect convert: action gateway recovery-stuck loop as an Effect fiber (same pattern as T-0488), API unchanged"
status: todo
milestone: M5
branch: task/T-0497-effect-recovery-loop
model: auto
effort: low
depends_on: [T-0488]
estimate: 0.2 day
---

# T-0497: the recovery-stuck loop in Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4. Plan `docs/audit/effect-everywhere-plan.md` §4.4 lists the action gateway's recovery loop among the background loops.

T-0488 converted the routines scheduler and the approvals sweeper, the same self-rescheduling `setTimeout` pattern. Follow its approach.

### Verified facts (do not re-derive)
- **`apps/server/src/actions/gateway.ts`:** `startRecoveryStuckTimer({ gateway, logger, intervalMs = 5 min }): RecoveryStuckHandle` (from line 155).
  - **`schedule()`** sets a `setTimeout(intervalMs)` with `unref`. It calls `gateway.recoverStuck()`, logs a failure as `{ err: errorName(error) }` "recoverStuck tick failed", and re-arms in `.finally`.
  - **The first run** is after one interval; it is scheduled at creation.
  - **`close()`** sets `closed` and clears the timer.
- **Importers:** `apps/server/src/index.ts` (line 450). **Tests:** `apps/server/src/actions/gateway.test.ts`.
- **The pattern to copy:** `apps/server/src/approvals/sweeper.ts` and `apps/server/src/routines/scheduler.ts` (T-0488, merged), with `Schedule.spaced`, `Effect.runFork`, and interrupting the fiber on close.

### What to build
1. **`startRecoveryStuckTimer`** runs the tick (with today's catch and log) as an Effect program, repeated with `Schedule.spaced(intervalMs)` after an initial delay of one interval, through `Effect.runFork`. `close()` interrupts the fiber. Use the same shutdown behaviour T-0488 chose for the sweeper.
2. **Exports:** every export keeps its name, type and signature. **Nothing else in `gateway.ts` changes.**
3. **Tests:** the existing tests pass **unchanged**. You may add `apps/server/src/actions/recovery-loop.effect.test.ts`: the tick runs after one interval, a failure is logged and the loop survives, and close stops it.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/server/src/approvals/sweeper.ts`, `apps/server/src/actions/gateway.ts:140-200`.

### Allowed files
`apps/server/src/actions/gateway.ts`, `apps/server/src/actions/recovery-loop.effect.test.ts`, `work/T-0497-effect-recovery-loop.md`.

**If an existing test must change, stop and report BLOCKED.**

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot actions/gateway actions/recovery-loop
pnpm gate
```

### Acceptance
- The recovery loop runs as an Effect fiber that stops cleanly, with an identical API.
- The existing tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
