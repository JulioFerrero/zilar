---
id: T-0486
title: "Effect convert: runner hub background loops (key-registry refresh, last-seen poll) in Effect, API unchanged"
status: todo
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

## Review (written by Claude)
