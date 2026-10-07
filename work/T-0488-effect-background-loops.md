---
id: T-0488
title: "Effect convert: routines scheduler + approvals sweeper loops in Effect (Schedule.spaced, fiber stop), APIs unchanged"
status: todo
milestone: M5
branch: task/T-0488-effect-background-loops
model: auto
effort: low
depends_on: [T-0173]
estimate: 0.35 day
---

# T-0488: the scheduler and sweeper loops in Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: "continue with the effect conversion, nothing of new features". This is a convert task under `docs/ROADMAP_EFFECT.md` and `docs/EFFECT_GUIDE.md`. Background loops are a core Effect fit:
- the API stays the same at the edge;
- **behaviour stays the same, and existing tests pass unchanged**;
- no features.

### Verified facts (do not re-derive)
- **`apps/server/src/routines/scheduler.ts`** (200 lines):
  - **Exports:** `MAX_CONCURRENT_RUNS = 2`, `RoutineLogger`, `CreateRoutineSchedulerOptions`, `RoutineSchedulerHandle` (`start`, `stop`, `tick`), `createRoutineScheduler` (line 43) and `ClaimedRoutine`.
  - **`tick()`** (lines 53-67) never overlaps: it skips when `running`. It calls `claimDue` then `runClaimed`.
  - **`schedule()`** (lines 69-83) is a self-rescheduling `setTimeout(tickMs)` with `unref`. It logs a tick failure and re-arms in `.finally`.
  - **`start()`** runs the first tick after one interval; **`stop()`** sets `closed` and clears the timer.
  - **`runClaimed`** (lines 168-191) runs batches of `MAX_CONCURRENT_RUNS` with `Promise.all`, catching and logging per row.
  - Importer: `apps/server/src/routines/wiring.ts`. Tests: `apps/server/src/routines/scheduler.test.ts`.
- **`apps/server/src/approvals/sweeper.ts`** (116 lines):
  - **Exports:** `SweeperLogger`, `StartApprovalsSweeperOptions`, `ApprovalsSweeperHandle` (`close`) and `startApprovalsSweeper` (line 36).
  - **`tick()`** expires stale approvals and writes one audit row each. Failures are logged with `serializeError` only (no ids).
  - **`schedule()`** (lines 77-87) has the same self-rescheduling pattern. It is scheduled at creation, with the first run after `intervalMs`.
  - **`close()`** stops the timer, and an in-flight tick finishes (comment at lines 95-99).
  - Tests: `apps/server/src/approvals/sweeper.test.ts`. It is started from `apps/server/src/index.ts`.

### What to build
1. **Each loop** becomes an Effect program (the tick, with today's catch and log), repeated with `Schedule.spaced(interval)` after an initial delay of one interval. Run it with `Effect.runFork`; `stop` / `close` interrupt the fiber.
   - **Keep the scheduler's public `tick()`** as a Promise function that still skips while a tick runs. Tests call it directly.
   - **The sweeper's in-flight tick:** today it finishes after `close()`. Keep that, for example by running the tick uninterruptibly, and say how in the Report.
2. **`runClaimed`:** use `Effect.forEach(..., { concurrency: MAX_CONCURRENT_RUNS })`. This allowed difference is not visible in results: the next run starts as soon as a slot frees, instead of waiting for the whole batch. Per-row errors are still caught and logged.
   - **If a test asserts strict batch order, keep batches instead and say so.**
3. **Process exit:** the process must still exit when it is stopped (today's `unref`). If the Effect timer blocks exit in tests, report how you solved it. If a test must change, stop and report BLOCKED.
4. **Exports:** every export keeps its name, type and signature.
5. **Tests:** the existing tests pass **unchanged**. You may add `apps/server/src/routines/scheduler.effect.test.ts` and `apps/server/src/approvals/sweeper.effect.test.ts`.
6. **Report:** give the line counts before and after, and note any Effect 4 surprises.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/effect-reference/LLMS.md` (Schedule, Fiber, runFork), `apps/server/src/voice-transcription/pipeline.ts`, both source files and both test files.

### Allowed files
`apps/server/src/routines/scheduler.ts`, `apps/server/src/routines/scheduler.effect.test.ts`, `apps/server/src/approvals/sweeper.ts`, `apps/server/src/approvals/sweeper.effect.test.ts`, `work/T-0488-effect-background-loops.md`.

**If an existing test must change, stop and report BLOCKED.**

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot routines/scheduler approvals/sweeper
pnpm gate
```

### Acceptance
- Both loops run as Effect fibers that stop cleanly.
- The scheduler's `tick()` still never overlaps.
- Exports and behaviour are identical.
- The existing tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
