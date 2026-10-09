---
id: T-0796
title: "S5b: sandbox tool-worker.ts on Effect (the QuickJS worker-thread entry: message handling, timers and the run loop as Effects; same worker protocol)"
status: merged
milestone: M5
branch: task/T-0796-sandbox-tool-worker
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0796: S5b: sandbox tool-worker.ts on Effect (the QuickJS worker-thread entry: message handling, timers and the run loop as Effects; same worker protocol)

## Spec (written by Claude, do not edit)

### Why
This is Phase 2 of `docs/audit/effect-100-plan.md` (task S5, plan line 344; S5a, `host-fetch.ts`, merged as T-0771), accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **`apps/server/src/sandbox/tool-worker.ts`** (560 lines, H1 H3 H8 W4) is the worker-thread entry. Line 1 imports `parentPort, workerData` from `node:worker_threads`, and line 373 has the 'tool must default-export a function' message. It has no own test file.
- **It is tested through the host side:** `apps/server/src/sandbox/run-tool.test.ts` and `run-tool.effect.test.ts` start the real worker. `host-fetch.test.ts` covers the fetch bridge.
- **The worker protocol** (the messages exchanged with `run-tool.ts` through `parentPort`, and the types in `sandbox/types.ts` and `limits.ts`) must stay byte-identical, because `run-tool.ts` is not in this task.
- **Known flake (NOW.md, 13:55 UTC):** an intermittent QuickJS `Aborted(JS_FreeRuntime)` line in these tests (1 run in 3, all tests pass). Note in the Report whether it still shows.
- **The worker runs once per tool call** and exits. The top level of the file is the program: write it as one `Effect.gen` run with `Effect.runPromise` or `runFork` at the end, so the file's own async, try and timers are Effects. Node APIs stay as calls wrapped in `Effect.sync`, `Effect.try` or `Effect.callback` (H8 `node:worker_threads` is the platform edge and stays imported).

### The server conversion pattern
- **The goal:** after this task each listed file imports Effect for its async work. Async control flow, try/catch, timers and fire-and-forget calls are written as Effects. A Promise edge stays where a caller outside this task still awaits a function (a Tier B edge, `docs/EFFECT_GUIDE.md:12-32`): implement it as an Effect and export `Effect.runPromise(...)`, or keep the Promise-typed method.
- **Fire-and-forget** (`void x().catch(log)`) becomes `Effect.runFork(effect.pipe(Effect.catchCause(logCause)))` with the same log message and fields; never swallow silently. Timers become forked `Effect.sleep` fibers that are interrupted instead of `clearTimeout`. The finished patterns are `apps/server/src/drafts/hub.ts` (T-0764), `packages/xmpp-core/src/timers.ts` (T-0769) and `apps/server/src/sandbox/host-fetch.ts` (T-0771).
- **Errors:** the same error classes and messages reach the same callers; logs keep the same messages, fields and redaction (no secrets, no message bodies).
- **The order of side effects and the timing are identical.** When in doubt, keep the structure and change only the mechanics.
- **Check APIs in `node_modules/effect/dist/*.d.ts`** (Effect 4.0.2), not from memory.

### What to build
Convert `tool-worker.ts` with the pattern. Keep every limit (timeouts, memory, output size), every message sent to the parent and its order, and every error text.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/server/src/sandbox/tool-worker.ts`, `run-tool.ts`, `host-fetch.ts`, `types.ts`, `limits.ts`, and the two `run-tool` tests.

### Allowed files
`apps/server/src/sandbox/tool-worker.ts`, `work/T-0796-sandbox-tool-worker.md`.

### Checks
```bash
pnpm --filter @zilar/server test --reporter=dot src/sandbox
pnpm gate
```
Paste each test run's counts and each file's `pnpm effect:map` kind into the Report.

### Acceptance
- Each listed source file is an Effect file; its exported names, signatures and error messages are unchanged.
- The tests pass unchanged, 3 of 3 runs.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Changed:** `apps/server/src/sandbox/tool-worker.ts` only (plus this file).

**What I did**
- `run()` is now one `Effect.gen` program (`run`), started at the end with `void Effect.runPromise(run)`. `getQuickJS()` is `Effect.promise`; the old `try/catch/finally` is `execute.pipe(Effect.catchCause(post 'tool failed'), Effect.ensuring(disposeVm))`, with the same order (message first, then dispose handles in reverse, context, runtime). A failed handle dispose still stops the handle loop; a failed context or runtime dispose is still ignored (`disposeQuietly` = `Effect.match(Effect.try(...))`).
- `waitForFetchResponse` is an `Effect.callback` (listener added on start, removed in the finalizer and before resuming) with `Effect.timeoutOrElse` for the `fetchTimeoutMs + 1000` timer (same `Error('fetch timeout')`). The `setTimeout`/`clearTimeout` pair is gone.
- The `await new Promise(setImmediate)` in the run loop is `nextImmediate`, an `Effect.callback` over `setImmediate` (finalizer `clearImmediate`), so the loop still yields one macrotask per turn.
- The fetch fire-and-forget async IIFE is `fetchEffect`, started with `void Effect.runPromise(...)`. I checked in `node_modules/effect/dist/internal/effect.js` that `runForkWith` calls `fiber.evaluate` synchronously, so the early "too many fetches" rejection and the `fetch` postMessage still happen before `fetchImpl` returns, as before. The init-dump `try/catch` is `Effect.match(Effect.try(...))` with the same partial-mutation behaviour (`headers = {}` on failure only). The catch-all is `Effect.catchCause` + `Cause.squash`, so a thrown value gives the same message (`Error.message`, else `fetch failed`).
- The `settled` flag, which was set by `asPromise.then(...)`, is set by a forked `Effect.exit(Effect.promise(() => asPromise))`; `await asPromise` is `yield* Effect.promise(() => asPromise)`.
- I used `runPromise` and not `runFork` + `catchCause(log)` for the two fire-and-forget starts on purpose: the worker has no logger, and the old code never logged. A throw that escaped the old `void run()` or the old IIFE became an unhandled rejection that killed the worker (the parent sees `error` and answers `sandbox_failure`). `runPromise` rejects with the same squashed original error, so that path is unchanged.

**Stayed plain (sync, called from QuickJS host callbacks or VM brackets):** `dumpVmError`, `enterVm`/`exitVm` and the `try/finally` in `pumpJobs`, `evalInVm`, `callInVm`, `settleVm`, the `json` host function, `logImpl`, and the `getString` try/catch in `fetchImpl`. They cannot be Effects because QuickJS calls them synchronously.

**Behaviour differences:** none intended. Messages, their order, limits and error texts are unchanged. One timing detail: the fetch continuation now runs synchronously inside the `message` listener (Effect `resume`) and not in the following microtask; nothing runs between the two.

**Commands and results**
- Before (untouched code): `pnpm --filter @zilar/server test --reporter=dot src/sandbox`: 4 files passed, 110 tests passed; the QuickJS `Aborted(...JS_FreeRuntime)` line appeared.
- After, 3 runs: 4 files passed, 110 tests passed each time; the `Aborted` line did not appear in any of the 3 runs (it was 1 in 3 before, so this is not proof it is fixed).
- `pnpm effect:map`: `tool-worker.ts` kind is `effect` (tier B stays because of the `node:worker_threads` edge and `setImmediate`; signals H3, H8, W4).
- `pnpm gate`: `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server (25.1s)`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.

**Unsure:** the three tests I could find for the fetch paths (`too many fetches`, `fetch timeout`, success) pass, but none asserts the exact tick when the continuation runs, so the synchronous-resume detail above is argued from the Effect source, not tested.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Sonnet 5.5. The lead reviewed the Report.
- **`tool-worker.ts`** is an Effect file (tier B: the worker_threads entry). `run()` is one `Effect.gen` program; the fetch timer and the yield are Effects.
- **Unchanged:** the protocol, the limits and the texts. The QuickJS-called sync helpers stay plain.
- **Results:** 110 tests pass before and 3 of 3 runs after; the gate passed. The QuickJS Aborted line showed on the old code only, which is not proof of a fix.
