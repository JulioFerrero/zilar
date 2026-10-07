---
id: T-0509
title: "Effect lane F: runner-tunnel RunnerClient lifecycle on Effect — reconnect loop with Schedule backoff, handshake as an Effect with timeouts, heartbeat fiber; public API and every test unchanged"
status: merged
milestone: M5
branch: task/T-0509-effect-runner-client-lifecycle
model: auto
effort: low
depends_on: [T-0500]
estimate: 1 day
---

# T-0509: RunnerClient lifecycle on Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4. T-0500 moved the `runner-tunnel` schemas to Effect Schema. This task moves the runner side's **timers and loops** to Effect: the reconnect loop, the handshake timeouts and the heartbeat.

The stream multiplexer (`mux.ts`) and the server side (`server.ts`) are later tasks.

### Verified facts (do not re-derive; line numbers moved slightly with T-0500, so find them by name)
- **`packages/runner-tunnel/src/runner.ts`, `export class RunnerClient`:**
  - **`start()`** throws `'runner already started'` if already running. It optionally starts the model listener, then resolves on the first `ready` or rejects on the first `failed` (`err ?? new TunnelClosedError('runner failed')`). It stores `this.runPromise = this.run()`.
  - **`stop()`** sets `stopped`, clears the heartbeat, terminates the ws, closes the model server, resolves every `closeResolvers` entry and awaits `runPromise`.
  - **`run()`** loops until `stopped`:
    - `connectOnce()` (on success: `attempt = 0`, `emitReady()`, `lastCloseCode = null`);
    - `waitForClose()`. If `lastCloseCode` is in `FATAL_CLOSE_CODES` (`CLOSE_AUTH`, `CLOSE_VERSION`, `CLOSE_REVOKED`, `CLOSE_MALFORMED`, …), it throws `TunnelClosedError('connection closed (<code>): rejected by the server')`;
    - a fatal error (`isFatalError`) calls `emitFailed` and stops;
    - otherwise it waits `computeBackoff(attempt, reconnectBaseMs, reconnectMaxMs)` (exported: `min(max, base * 2^attempt)`), increments `attempt` and `reconnectAttemptsValue`, and waits through `delayOrStopped` (an unref'd timer that `stop()` cuts short).
  - **`connectOnce()`:**
    - opens the ws with a `handshakeTimeoutMs` timer (`'connection timeout'`) or an error (`'connection failed: <msg>'`);
    - sends `hello`, `waitForType('challenge')`, sends `auth` with `signNonce`, `waitForType('ready')`;
    - throws `'runner stopped'` if stopped between steps;
    - `installReadyConnection(ws)`;
    - on any throw it terminates the ws.
  - **`waitForType(ws, expected)`:** a `handshakeTimeoutMs` timer (`'timeout waiting for <expected>'`). A binary frame closes the ws with `CLOSE_MALFORMED`. A parse failure gives `'handshake failed: <reason>'`, a wrong type `'expected X, got Y'`, a close `'handshake connection closed (<code>): <reason|no reason>'`. Listeners are removed on finish.
  - **`installReadyConnection`** starts a `setInterval` of **10000 ms** that sends `heartbeat { at: Date.now() }` (send errors are ignored) and is `unref`'d. **`teardownConnection`** clears it, records `lastCloseCode`, fails the mux and notifies closed.
  - **The getters** `readyCount` and `reconnectAttempts` and the `on('ready' | 'failed', …)` listeners are public.
- **Tests:** `runner.test.ts`, `resilience.test.ts`, `auth.test.ts`, `engine.test.ts`, `model.test.ts`, `mux.test.ts` (all in `packages/runner-tunnel/src/`). The importers of `RunnerClient` are `apps/runner/src/connect.ts` and `apps/runner/src/e2e.test.ts`.
- **The idioms to copy:**
  - `docs/EFFECT_GUIDE.md` "Effect 4 facts": `Effect.callback` with a finalizer, `timeoutOrElse`, `Schedule`, `catchDefect`, interrupting on stop, and timers that keep the process alive;
  - `apps/server/src/machines/hub.ts` (T-0486, loops as fibers);
  - `apps/server/src/web-tools/guarded-fetch.ts` (T-0484, a socket in `Effect.callback` with a destroy finalizer).

### What to build
1. **The handshake as Effects:**
   - `waitForType` becomes an `Effect.callback` that registers the three listeners and **removes them in its finalizer**, wrapped in `Effect.timeoutOrElse` with the same timeout error;
   - the ws open becomes the same pattern;
   - `connectOnce` is an `Effect.gen`, and the ws is terminated on failure **or interruption** (`Effect.onExit` or `acquireRelease`).
   
   **Keep every error message and close code exactly.**
2. **The reconnect loop as one fiber,** started by `start()` with `Effect.runFork` and interrupted by `stop()`:
   - the backoff uses the existing `computeBackoff` values (a `Schedule` or an explicit `Effect.sleep(computeBackoff(...))`; your choice, but the waits must be identical);
   - the fatal and non-fatal split and `emitReady`/`emitFailed` stay as they are;
   - `reconnectAttempts` and `readyCount` count exactly as today.
   - **Timers:** Effect's sleep is not `unref`'d (guide). Today's timers are, so the loop **must** stop on `stop()`, and no test may hang. If a test relied on the unref (the process exiting without `stop()`), report it.
3. **The heartbeat as a fiber** (`Effect.repeat` with `Schedule.spaced(10000)`, after a first wait of one interval, as today's `setInterval`). It is forked per ready connection and interrupted in `teardownConnection` and `stop()`; a send failure is ignored.
4. **The public API stays the same:** `RunnerClient`'s constructor, `start`, `stop`, `on`, the getters, the exported `computeBackoff`, and the error classes and messages. `apps/runner` must typecheck and test unchanged.
5. **Tests:** every `packages/runner-tunnel` and `apps/runner` test passes **unchanged**. If one cannot, stop and report BLOCKED with the line. Add `packages/runner-tunnel/src/runner.effect.test.ts` covering:
   - `stop()` during a backoff wait returns promptly;
   - a handshake timeout removes its listeners (the ws listener count is back to its baseline);
   - the heartbeat stops after teardown.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `packages/runner-tunnel/src/runner.ts` (all), `packages/runner-tunnel/src/runner.test.ts`, `packages/runner-tunnel/src/resilience.test.ts`, `apps/server/src/web-tools/guarded-fetch.ts`, `apps/server/src/machines/hub.ts`.

### Allowed files
`packages/runner-tunnel/src/runner.ts`, `packages/runner-tunnel/src/runner.effect.test.ts`, `packages/runner-tunnel/src/server.effect.test.ts` (lead-approved, 2026-10-07), `work/T-0509-effect-runner-client-lifecycle.md`.

### Checks
```bash
pnpm --filter @zilar/runner-tunnel test --reporter=dot
pnpm --filter @zilar/runner test --reporter=dot
pnpm gate
```

### Acceptance
- The `RunnerClient` reconnect loop, handshake and heartbeat run on Effect, with identical behaviour, messages and public API.
- `stop()` interrupts everything.
- All existing tests are untouched and green, and the new test passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Status: done. The `RunnerClient` reconnect loop, handshake and heartbeat now run on Effect; the public API, error messages and close codes are unchanged, and every existing test passes untouched.

**Round:** review fixes — (1) `startHeartbeat` now interrupts a previous `heartbeatFiber` before forking a new one (an orphaned fiber would ping a dead mux and keep the process alive, since Effect timers are not unref'd); (2) the handshake-timeout test asserts the three listeners are registered above the baseline before the timeout fires, then back to 0 after.

**Merge fix (lead-approved, 2026-10-07):** the rebase-run gate surfaced a flaky T-0511 assertion in `packages/runner-tunnel/src/server.effect.test.ts` ("terminates a ready connection whose pongs stop after heartbeatTimeoutMs", `expected 74 to be >= 80`): the old clock started after the ready frame was observed, i.e. after the server's `lastPongAt`. The clock now starts right after auth is sent — at or before the server marks the connection ready — and the elapsed time is bounded to `heartbeatTimeoutMs - heartbeatIntervalMs` … `heartbeatTimeoutMs + 2 * heartbeatIntervalMs + 50`. The test still proves the connection is terminated, not before the pong timeout and not much after. Ran 20 times: all passed. That file was added to Allowed files.

### Files changed (all inside Allowed files)
- `packages/runner-tunnel/src/runner.ts` — lifecycle moved to Effect.
- `packages/runner-tunnel/src/runner.effect.test.ts` — new test (3 cases).
- `work/T-0509-effect-runner-client-lifecycle.md` — front matter + this Report.

### What changed
- **Reconnect loop as one fiber.** `run()` became `runEffect()`, an `Effect.gen` forked by `start()` with `Effect.runFork` (stored in `runFiber`) and interrupted by `stop()` via `Effect.runPromise(Fiber.interrupt(fiber))`. Each cycle is wrapped in `Effect.exit`; on failure/defect `Cause.squash` yields the same `Error` the old `try/catch` produced. The fatal/non-fatal split, `emitReady`/`emitFailed`, `lastCloseCode`, `FATAL_CLOSE_CODES`, `computeBackoff`, and both counters are unchanged. `waitForClose` is an `Effect.callback` that resolves through the existing `closeResolvers`.
- **Backoff wait.** `Effect.sleep(Duration.millis(computeBackoff(...)))` replaces the unref'd `setTimeout`; `stop()` interrupts it.
- **Handshake.** `openSocket` and `waitForType` are `Effect.callback`s that register their listeners and remove them in a finalizer, wrapped in `Effect.timeoutOrElse` with the same timeout errors. `connectOnce` is an `Effect.gen`; `Effect.onExit` terminates the ws on failure **or interruption**. All error strings and `CLOSE_MALFORMED` on a binary frame are byte-for-byte the old ones.
- **Heartbeat.** Per-connection fiber: `Effect.repeat(..., Schedule.spaced(10000)).pipe(Effect.delay(10000))` (first send after one interval, like `setInterval`), send errors ignored (try/catch + `Effect.catchDefect`). Forked in `installReadyConnection`, interrupted in `teardownConnection` and `stop()`.
- **`start()` guard** is a `started` flag, preserved because `runFiber` is nulled on `stop()`.

### Timer note (spec item 2)
Effect's sleep is not `unref`'d. The old backoff timer was, so a process with no other pending work could exit during a backoff wait; now the loop keeps it alive until `stop()`. **No test relied on the unref:** every `runner-tunnel` test calls `stop()`/`closeTunnelPair`, and `apps/runner`'s `runRunner` awaits `client.stop()` in a `finally`; no suite hung. Nothing outside the Allowed files changed.

### Commands run (real results)
- `pnpm --filter @zilar/runner-tunnel test --maxWorkers=2 --reporter=dot src/runner.effect.test.ts` → 3 passed.
- `pnpm --filter @zilar/runner-tunnel test --maxWorkers=2 --reporter=dot src/runner.test.ts src/auth.test.ts` → 25 passed.
- `pnpm --filter @zilar/runner-tunnel test --maxWorkers=2 --reporter=dot src/resilience.test.ts` → 6 passed.
- `pnpm --filter @zilar/runner-tunnel test --maxWorkers=2 --reporter=dot src/engine.test.ts src/model.test.ts src/mux.test.ts` → 11 passed.
- `pnpm --filter @zilar/runner test --maxWorkers=2 --reporter=dot` → 6 files, 63 passed.
- `pnpm gate` from the repo root:
  ```
  PASS  install (frozen)  (1.4s)
  PASS  format  (29.1s)
  PASS  lint  (0.7s)
  PASS  typecheck  (3.2s)
  PASS  tests @zilar/runner-tunnel  (21.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes
- None from the spec. The new test file white-boxes two private members (`waitForType` via a typed cast, and the `heartbeatFiber` field) so the timeout-listener and heartbeat-stop cases are deterministic and fast; no public API was added.

## Review (written by Claude)

Approved (lead, 2026-10-07). The RunnerClient reconnect loop is one fiber with the same computeBackoff waits. The handshake is Effect.callback with listener-removing finalizers and timeoutOrElse, with the same messages and close codes. The heartbeat is a fiber per ready connection. stop() interrupts everything. Lead round: a previous heartbeat fiber is interrupted before a new one starts, and the listener test asserts registration first. The existing tests are untouched.
