---
id: T-0497
title: "Effect convert: action gateway recovery-stuck loop as an Effect fiber (same pattern as T-0488), API unchanged"
status: merged
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

### What I did

`startRecoveryStuckTimer` now runs its tick as an Effect fiber, following the
T-0488 sweeper shape. The API is unchanged.

In `apps/server/src/actions/gateway.ts`:
- The tick (`today's catch and log`) is a plain async function: `await
  gateway.recoverStuck()`, catch → `logger.error({ err: errorName(error) },
  'recoverStuck tick failed')`.
- The loop is `Effect.sleep(intervalMs).pipe(Effect.andThen(Effect.repeat(
  Effect.uninterruptible(Effect.promise(() => tick())), Schedule.spaced(
  intervalMs))))`: first run after one interval, then one per interval.
- `fiber = Effect.runFork(loop())`; `close()` calls `fiber.interruptUnsafe()`
  and clears the stored fiber.
- Same shutdown behaviour as the sweeper: the tick runs **uninterruptibly**, so
  an in-flight `recoverStuck` finishes after `close()`, and only the sleep
  between ticks is interruptible, so an idle loop stops immediately.
- Added `import { Effect, Schedule, type Fiber } from 'effect'`.
- `RecoveryStuckHandle`, `StartRecoveryStuckTimerOptions` and
  `startRecoveryStuckTimer` keep their exact names, types and signatures. Only
  the body and the doc comment above them changed.

New test `apps/server/src/actions/recovery-loop.effect.test.ts` (fake timers):
- the tick does not run before one interval, then runs once;
- a rejected tick logs `{ err: 'Error' }` + `'recoverStuck tick failed'` exactly
  once and the loop survives to the next tick;
- `close()` stops further ticks.

### Files changed

- `apps/server/src/actions/gateway.ts`
- `apps/server/src/actions/recovery-loop.effect.test.ts` (new)
- `work/T-0497-effect-recovery-loop.md`

### Commands and results

- `pnpm install` → `Done in 21.1s`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot actions/gateway actions/recovery-loop`
  → `Test Files 2 passed (2)`, `Tests 48 passed (48)`. The existing
  `actions/gateway.test.ts` (including its `recovery timer` case) is unchanged
  and green.
- `pnpm gate` → ended with `GATE PASS`:

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (4.5s)
PASS  format  (76.6s)
PASS  lint  (1.3s)
PASS  typecheck  (1.2s)
PASS  tests @zilar/server  (997.8s)
scope: every changed file is inside the Allowed files
GATE PASS
```

The 3 changed files are the source, the new test and this task file — all
inside the Allowed files.

### Deviations / open questions

None. No existing test was changed.

### Notes

- The gate's `tests @zilar/server` step took 997.8s because several other
  worktrees were running `pnpm gate` at the same time on the shared machine.
  The step reports `PASS`; the explicit test counts above come from the direct
  single-file run.
- No new Effect 4 surprises: `Effect.andThen`, `Schedule.spaced` and
  `Fiber.interruptUnsafe` behaved exactly as in T-0488.

## Review (written by Claude)

Approved (lead, 2026-10-07). startRecoveryStuckTimer runs as an Effect fiber (Schedule.spaced after an initial delay of one interval, catchDefect with a log, close interrupts it), following T-0488. Nothing else in gateway.ts changed, and the existing tests are untouched. Pre-review clean.
