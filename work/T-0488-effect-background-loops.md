---
id: T-0488
title: "Effect convert: routines scheduler + approvals sweeper loops in Effect (Schedule.spaced, fiber stop), APIs unchanged"
status: merged
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

### What I did

Both background loops are now Effect fibers; the public API and behaviour are
unchanged.

**`apps/server/src/routines/scheduler.ts`** (`start`/`stop`/`tick` unchanged in shape):
- The self-rescheduling `setTimeout` (`schedule()`) is replaced by
  `Effect.sleep(tickMs).pipe(Effect.andThen(Effect.repeat(tickEffect, Schedule.spaced(tickMs))))`.
  First tick after one interval, then one per interval, measured from the end of
  the previous tick (same as before).
- The tick effect keeps today's catch-and-log: `Effect.promise(() => tick()).pipe(Effect.catchCause(...))`
  logs `'routines scheduler tick failed'` with `errorName(Cause.squash(cause))`.
- `start()` runs the loop with `Effect.runFork`; `stop()` calls `fiber.interruptUnsafe()`
  and clears the stored fiber. `tick()` is still a plain `Promise` function with
  the `running` boolean, so direct/concurrent calls never overlap.
- `runClaimed` now uses `Effect.forEach(claimed, ..., { concurrency: MAX_CONCURRENT_RUNS, discard: true })`.
  Per-row errors are still caught and logged (`'routine run failed'` with the id).
  No test asserts strict batch order, so the allowed "next run starts as soon as
  a slot frees" difference applies.

**`apps/server/src/approvals/sweeper.ts`** (`startApprovalsSweeper`/`close` unchanged in shape):
- Same `Effect.sleep -> Effect.repeat(Schedule.spaced)` loop, started at
  creation with `Effect.runFork`; `close()` interrupts the fiber.
- The tick effect is wrapped in `Effect.uninterruptible`: an in-flight sweep
  finishes after `close()` (today's behaviour). Only the sleep between ticks is
  interruptible, so an idle loop stops immediately.

### Process exit

The Effect `Clock.sleep` registers `setTimeout`/`clearTimeout` and its
interrupt finalizer clears the timer. `Fiber.interruptUnsafe()` runs
synchronously when the fiber is parked in the sleep (`evaluate(failCause(...))`
in the runtime), so `stop()`/`close()` clear the pending timer before the event
loop checks handles — the process still exits on shutdown. While running, the
loop keeps the process alive (Effect does not `unref`), which is fine because
both handles are stopped in `index.ts` before the database closes. No `unref`
was re-added; no test changes were needed.

### Exports

Every export keeps its name, type and signature:
`MAX_CONCURRENT_RUNS`, `RoutineLogger`, `CreateRoutineSchedulerOptions`,
`RoutineSchedulerHandle`, `createRoutineScheduler`, `ClaimedRoutine`;
`SweeperLogger`, `StartApprovalsSweeperOptions`, `ApprovalsSweeperHandle`,
`startApprovalsSweeper`.

### Effect 4 surprise

`Effect.zipRight` does not exist in Effect 4.0.0 (the type error surfaced only
at test runtime as `TypeError: Effect.zipRight is not a function`); the v4
equivalent is `Effect.andThen(effect)`.

### Line counts

- `routines/scheduler.ts`: 200 -> 219 lines.
- `approvals/sweeper.ts`: 116 -> 113 lines.
- New `routines/scheduler.effect.test.ts`: 151 lines.
- New `approvals/sweeper.effect.test.ts`: 156 lines.

### Tests

Existing tests unchanged and green. New tests:
- `scheduler.effect.test.ts`: `start()` runs the first tick only after one
  interval, repeats, and `stop()` interrupts (no further ticks).
- `sweeper.effect.test.ts`: an in-flight sweep parked in `audit.record` still
  writes its audit row after `close()`, and no later tick fires.

Command run while working (single test files, quiet reporter):
`pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot routines/scheduler approvals/sweeper`
-> `Test Files 4 passed (4)`, `Tests 29 passed (29)` (27 existing + 2 new).

### Gate

```
$ pnpm gate
gate: 5 changed file(s) against main
PASS  install (frozen)  (6.0s)
PASS  format  (93.0s)
PASS  lint  (2.2s)
PASS  typecheck  (44.7s)
PASS  tests @zilar/server  (55.3s)
scope: every changed file is inside the Allowed files
GATE PASS
```

The 5 changed files are the two sources, the two new test files and this task
file — all inside the Allowed files.

### Deviations / open questions

None. No existing test was changed.

### Round 2 (fix round)

PREREVIEW findings: must-fix=1, should-fix=0, nit=1.

- **Finding 1 (must-fix, `scheduler.ts` stop-mid-tick interrupt): not applied.**
  I could not reproduce the claimed failure against the installed
  `effect@4.0.0`; see Disagreements for the evidence. I did add the
  stop-during-tick test the finding asks for, and it passes against the
  **unmodified** `scheduler.ts`, which is further evidence the loop already
  stops correctly.
- **Finding 2 (nit, double `start()` guard): left untouched.** It is outside
  any line I changed and the review marks it benign and untested.

Test added (one), `apps/server/src/routines/scheduler.effect.test.ts`:
`lets an in-flight tick finish after stop() without logging a failure, then
stops firing`.

Checks (single test files, quiet reporter):
`pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot routines/scheduler approvals/sweeper`
-> `Test Files 4 passed (4)`, `Tests 30 passed (30)` (27 existing + 3
effect-loop tests).

Gate (Round 2):
```
$ pnpm gate
gate: 5 changed file(s) against main
PASS  install (frozen)  (5.9s)
PASS  format  (78.1s)
PASS  lint  (1.5s)
PASS  typecheck  (47.8s)
PASS  tests @zilar/server  (56.4s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Disagreements

**Finding 1 is not reproducible in `effect@4.0.0`.** The finding states that
`Effect.catchCause` recovers from external fiber interruptions, so a `stop()`
during a tick would be logged as a success and `Effect.repeat(Schedule.spaced)`
would keep ticking. The docs do claim `catchCause` handles interruptions, but
the installed runtime does not route a plain external interrupt into an
`OnFailure` (the primitive behind `catchCause`: `internal/effect.ts:2598` —
`catchCause` builds `OnFailureImpl`, nothing more). I verified the finding's
exact scenario with standalone probes using the repo's own
`apps/server/node_modules/effect@4.0.0`:

- `Effect.catchCause(Effect.never, handler)` + `fiber.interruptUnsafe()`: the
  handler never runs.
- `Effect.catchCause(Effect.sleep(100), handler)` interrupted at 10 ms: handler
  never runs.
- `Effect.repeat(Effect.catchCause(Effect.promise(park), handler),
  Schedule.spaced(30))` interrupted mid-iteration: handler never runs and the
  repeat does not continue.
- `Effect.catchCause(Effect.failCause(Cause.interrupt()), handler)` and
  `Effect.catchCause(Effect.interrupt, handler)`: handler never runs.

The new stop-during-tick integration test confirms the same: against the
unmodified `scheduler.ts` the loop stops, does not post again after a re-arm,
and logs no `'routines scheduler tick failed'` — exactly the behaviour the
finding expects from the fix. An in-flight `tick()` is a plain JS async
function, so it always runs to completion regardless of the fiber; the
observable behaviour (in-flight tick finishes, then no reschedule) already
holds both before and after the Effect conversion.

I therefore left `scheduler.ts` unchanged, per AGENTS.md ("If you believe a
finding is wrong, do not skip it silently: write the reason in the Report
under 'Disagreements' and leave that code as it is"). If the lead still wants
the sweeper's `Effect.uninterruptible(tick)` shape for consistency, it is a
one-line change and I can apply it on request, but no observed bug requires it.

## Review (written by Claude)

Approved (lead, 2026-10-07). The routines scheduler and the approvals sweeper loops run as Effect fibers; tick() still never overlaps; the sweeper lets an in-flight tick finish after close; the existing tests are untouched. Nit accepted: start() is now idempotent (better than the old double-timer leak).
