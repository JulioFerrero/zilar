---
id: T-0509
title: "Effect lane F: runner-tunnel RunnerClient lifecycle on Effect — reconnect loop with Schedule backoff, handshake as an Effect with timeouts, heartbeat fiber; public API and every test unchanged"
status: todo
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
`packages/runner-tunnel/src/runner.ts`, `packages/runner-tunnel/src/runner.effect.test.ts`, `work/T-0509-effect-runner-client-lifecycle.md`.

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

## Review (written by Claude)
