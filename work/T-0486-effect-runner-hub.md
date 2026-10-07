---
id: T-0486
title: "Effect convert: runner hub background loops (key-registry refresh, last-seen poll) in Effect, API unchanged"
status: merged
milestone: M5
branch: task/T-0486-effect-runner-hub
model: auto
effort: low
depends_on: [T-0173]
estimate: 0.35 day
---

# T-0486: the runner hub loops in Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: "continue with the effect conversion, nothing of new features". This is a convert task under `docs/ROADMAP_EFFECT.md` (the candidate "Agent gateway and runner hub") and `docs/EFFECT_GUIDE.md`:
- Effect inside, the same plain API at the edge;
- **behaviour stays the same, and existing tests pass unchanged**;
- no features.

### Verified facts (do not re-derive)
- **The file:** `apps/server/src/machines/hub.ts` (376 lines).
- **Exports:**
  - `HubLogger`, `CreateHubKeyRegistryOptions`, `HubRegistrySource`, `HubMachineLookup`, `HubKeyRegistry`;
  - `createHubKeyRegistry` (line 49);
  - `StartRunnerHubOptions`, `RunnerHub` (line 220), `startRunnerHub` (async, line 231);
  - `class HubConfigError` (line 346), `assertRunnerHubConfig` (line 356).
- **Loop 1:** `createHubKeyRegistry` has a `refresh()` and a self-rescheduling `scheduleRefresh()`:
  - it is a `setTimeout` with `unref` (lines 114-124), started when `autoStartTimer`;
  - each run re-arms in `.finally`;
  - a `closed` flag stops it.
- **Loop 2:** `startRunnerHub` has `pollOnce()` and `schedulePoll()`:
  - the same pattern, with a `pollTimer` (lines 309-320) and a `stopped` flag;
  - `pollOnce` flushes last-seen for live runners.
- **Importers:** `apps/server/src/index.ts`, `apps/server/src/drafts/routes.ts`, `apps/server/src/agents/gateway.ts`. **Do not touch them.** **Tests:** `apps/server/src/machines/hub.test.ts`.
- **The reference:** `apps/server/src/voice-transcription/pipeline.ts` and `docs/EFFECT_GUIDE.md`. Look in `docs/effect-reference/` for `Effect.repeat` / `Schedule.spaced` and running a fiber with `Effect.runFork` plus `Fiber.interrupt` for stop.

### What to build
1. **Each loop** becomes one Effect program: `refresh` / `pollOnce` with its errors caught and logged as today, repeated with `Schedule.spaced(interval)`. The **first run comes after one interval**, as today.
2. **Running and stopping:** run the program with `Effect.runFork`. `close` / `stop` interrupt the fiber. That replaces the `timer`, `closed` and `stopped` flags.
3. **Shutdown:** the process must still be able to exit (today's `unref`).
   - If the Effect timer keeps the process alive, keep the shutdown path (`index.ts` calls stop) working, and say how in the Report.
   - If a test relies on `unref`, stop and report BLOCKED.
4. **Exports:** every export keeps its name, type and signature. `startRunnerHub` stays `async` and returns the same `RunnerHub`.
5. **Tests:** the existing tests pass **unchanged**. You may add `apps/server/src/machines/hub.effect.test.ts`, for example: stop interrupts the loop, so no refresh runs after stop.
6. **Report:** give the line counts before and after, and note any Effect 4 surprises.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/effect-reference/LLMS.md`, `apps/server/src/voice-transcription/pipeline.ts`, `apps/server/src/machines/hub.ts`, `apps/server/src/machines/hub.test.ts`.

### Allowed files
`apps/server/src/machines/hub.ts`, `apps/server/src/machines/hub.effect.test.ts`, `work/T-0486-effect-runner-hub.md`.

**If an existing test must change, stop and report BLOCKED.**

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot machines
pnpm gate
```

### Acceptance
- Both hub loops run as Effect fibers that stop cleanly, with identical exports and behaviour.
- The existing tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Converted both runner-hub background loops in `apps/server/src/machines/hub.ts` to Effect fibers,
with no change to exports, signatures or behaviour.

- **Loop 1 (key-registry refresh).** The `timer`/`closed` flags and `scheduleRefresh` are gone. The
  loop is one program:
  `Effect.repeat(Effect.promise(() => refresh()), Schedule.spaced(Duration.millis(refreshMs)))`
  wrapped in `.pipe(Effect.delay(Duration.millis(refreshMs)))`. `refresh` still catches its own DB
  errors and logs them. With `autoStartTimer`, the program is started with `Effect.runFork` and the
  fiber is held in `refreshFiber`. `close()` interrupts it (`Effect.runFork(Fiber.interrupt(fiber))`,
  because `close(): void` is synchronous).
- **Loop 2 (last-seen poll).** The `pollTimer`/`stopped` flags and `schedulePoll` are gone, and the
  `stopped` guard inside `pollOnce` is removed (interruption replaces it). The same shape runs
  `pollOnce` repeated with `Schedule.spaced(pollIntervalMs)` plus one initial `Effect.delay`, forked
  into `pollFiber`. `RunnerHub.close` (async) interrupts it with
  `await Effect.runPromise(Fiber.interrupt(pollFiber))`, then closes the cache and the tunnel as
  before.
- Both loops therefore keep the old cadence: the first run comes after one interval, and each next
  run comes one interval after the previous run finished (which is what the old re-arm-in-`finally`
  did).

### Line counts

- `apps/server/src/machines/hub.ts`: **376 -> 359** lines.
- `apps/server/src/machines/hub.effect.test.ts`: **new, 103** lines.
- Exports unchanged: `createHubKeyRegistry`, `startRunnerHub` (still `async`, same `RunnerHub`),
  `HubConfigError`, `assertRunnerHubConfig` and all interfaces/types keep their names and signatures.

### Tests

- Existing `apps/server/src/machines/hub.test.ts` passes **unchanged** (not edited), 19/19.
- Added `apps/server/src/machines/hub.effect.test.ts` (1 test): the first refresh happens only after
  one interval (cache empty immediately after construction), the loop repeats (a later approval
  appears on a later run), and after `close()` a revoke event is never observed and the cached key
  stays, proving the fiber is interrupted. It uses the real PGlite test context and a directly
  inserted owner row; no external services or keys.

### Shutdown / `unref`

Effect's `Clock` sleep uses a plain `setTimeout` and does **not** `unref` it (I checked
`effect/dist/internal/effect.js`; the handle is cleared by a finalizer). So a sleeping loop fiber
would keep the process alive while it sleeps. The shutdown path stays correct: `index.ts` calls
`runnerHub.close()` (`apps/server/src/index.ts:521-522`), which interrupts the poll fiber and then
`cache.close()`, which interrupts the refresh fiber; the sleep finalizer then clears the timer. The
existing test `close stops the refresh timer so it does not leak between tests` still passes and the
process exits promptly, and no test relied on the old `unref` behaviour (every test closes its cache
or hub), so no BLOCKED.

### Effect 4 surprises

- `Effect.repeat(effect, Schedule.spaced(interval))` runs the effect **immediately**, then spaces
  repetitions. To keep "first run after one interval" I wrapped the whole repeated program in a
  single `Effect.delay(interval)`; putting the delay on the inner effect would have added the
  interval twice per cycle (the source delay plus the schedule delay).
- `Fiber.interrupt` returns an `Effect`, not a `Promise`, so `close(): void` starts it with
  `Effect.runFork` and the async `RunnerHub.close` awaits it with `Effect.runPromise`.

### Commands (real results)

- `pnpm install`: done (13 projects, 1170 packages).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/machines/hub.effect.test.ts`:
  1 file passed, 1 test passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/machines/hub.test.ts`:
  1 file passed, 19 tests passed.
- `pnpm gate` (from repo root):

  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (9.1s)
  PASS  format  (90.0s)
  PASS  lint  (2.7s)
  PASS  typecheck  (73.1s)
  PASS  tests @zilar/server  (42.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Files changed

- `apps/server/src/machines/hub.ts` (Allowed)
- `apps/server/src/machines/hub.effect.test.ts` (Allowed, new)
- `work/T-0486-effect-runner-hub.md` (Allowed)

No importers (`index.ts`, `drafts/routes.ts`, `agents/gateway.ts`) were touched. No deviations.

### Round 2: fix review findings

Fixed the single should-fix finding from `PREREVIEW.md` (finding 1). Left nit 2 untouched
(pre-existing and not in a line this round changes).

- **Finding 1 (should-fix):** both loops used a bare
  `Effect.repeat(inner, Schedule.spaced(...))`, which stops the fiber on the first defect with no log
  and no reschedule, unlike the old `void x().finally(scheduleX)` re-arm. Each inner effect is now
  wrapped with `Effect.catchDefect((defect) => logger.error({ err: serializeError(defect) }, …))`, so
  an unexpected throw is logged and the loop reschedules. Messages: `runner hub key refresh loop
  failed` and `runner hub last-seen poll failed`.
- **Tests added** (both verified to fail without the guards: I temporarily reverted them and got
  "2 failed | 1 passed", then restored):
  - `survives an unexpected throw from the refresh loop and keeps running` — the first DB read
    throws and the logger throws from inside `refresh`'s own catch, so the refresh promise rejects;
    the test waits for the key to appear on a later run and for the loop-level log.
  - `survives an unexpected throw from the last-seen poll and logs it` — a live runner plus a
    `warn` that throws inside `flushLastSeen`'s catch makes `pollOnce` reject; the test waits for the
    loop-level log.
- **Line counts after round 2:** `hub.ts` 377 (was 359 after round 1); `hub.effect.test.ts` 238
  (was 103).
- **Commands (real results):**
  - `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot machines`: 5 files passed,
    62 tests passed (includes the untouched `hub.test.ts`).
  - `pnpm gate` (repo root):

    ```
    gate: 3 changed file(s) against main
    PASS  install (frozen)  (4.7s)
    PASS  format  (81.2s)
    PASS  lint  (1.5s)
    PASS  typecheck  (76.5s)
    PASS  tests @zilar/server  (39.3s)
    scope: every changed file is inside the Allowed files
    GATE PASS
    ```

### Disagreements

- The finding suggested `Effect.catchAllCause`. That name does not exist in Effect 4
  (`docs/effect-reference/README.md`: "`Effect.catch` (not `catchAll`)"); the v4 all-cause
  combinator is `Effect.catchCause`. I used `Effect.catchDefect` instead: `Effect.promise` has no
  typed error channel, so a rejection is a defect, and `catchCause` would additionally observe
  interruptions, which would log a spurious error on the normal `close()` / `stop` path. `catchDefect`
  is the precise equivalent of "survive unexpected throws" that the finding asks for; this is a
  mechanism deviation, not a skipped finding.

## Review (written by Claude)

Approved (lead, 2026-10-07). Both hub loops (registry refresh, last-seen poll) run as Effect fibers with Schedule.spaced, and interrupting the fiber stops them; the existing tests are untouched. Nits accepted: close() lets the poll walk finish (harmless last_seen writes); the poll-survival test proves the error is logged rather than the rescheduling.
