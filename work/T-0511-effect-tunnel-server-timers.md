---
id: T-0511
title: "Effect lane F: runner-tunnel TunnelServer timers on Effect — heartbeat sweep fiber and per-connection handshake deadline fiber, interrupted on ready/drop/close; public API and tests unchanged"
status: merged
milestone: M5
branch: task/T-0511-effect-tunnel-server-timers
model: auto
effort: low
depends_on: [T-0500]
estimate: 0.5 day
---

# T-0511: TunnelServer timers on Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4. T-0509 moves the runner side's loops (`runner.ts`); **this task does the server side's two timers** in `server.ts`. The two tasks touch different files and can run in parallel.

### Verified facts (do not re-derive)
- **`packages/runner-tunnel/src/server.ts`, `export class TunnelServer`** (line 88):
  - the fields include `heartbeatIntervalMs`, `heartbeatTimeoutMs`, `handshakeTimeoutMs`, `conns: Set<ServerConn>`, `live: Map`, `private readonly heartbeatTimer: NodeJS.Timeout` (line 102) and `closed`.
  - **The constructor** (from line 107) creates the ws server, then **`this.heartbeatTimer = setInterval(() => this.checkHeartbeats(), this.heartbeatIntervalMs)` with `unref()`** (lines 135-138), then subscribes to key revoke.
  - **`close()`** (line 281) is idempotent through `closed`. It clears the interval, unsubscribes revoke, terminates every conn, closes the ws server and awaits the http server close.
  - **`handleConnection(ws)`** (line 299) builds a `ServerConn` with `handshakeTimer: null`, then **`conn.handshakeTimer = setTimeout(...)`**: if the state is not `'ready'` by `handshakeTimeoutMs`, it calls `ws.close(CLOSE_AUTH, 'handshake timeout')` (errors ignored) and is `unref`'d (lines 311-320).
  - **The handshake timer is cleared** in `dropConn` (line 341, the first lines) and when the connection becomes ready (around line 445: `conn.state = 'ready'`, then a `clearTimeout`).
  - **`checkHeartbeats()`** (line 514): for each conn in state `ready`, if `now - lastPongAt > heartbeatTimeoutMs` it terminates the conn; otherwise it pings it (errors ignored).
- **Tests:** `auth.test.ts`, `resilience.test.ts`, `engine.test.ts`, `model.test.ts`, `preview.test.ts`, `mux.test.ts`, `protocol*.test.ts`, `runner.test.ts` (all in `packages/runner-tunnel/src/`). The server user is `apps/server/src/machines/hub.ts` (T-0486 runs its loops on Effect; read it as the pattern).
- **The idioms:** `docs/EFFECT_GUIDE.md` "Effect 4 facts":
  - a loop is `Effect.repeat` with `Schedule.spaced`, and runs once immediately, so put a first `Effect.sleep` of one interval before it, as `setInterval` does;
  - `catchDefect` (not `catchCause`);
  - `Effect.runFork` plus `Fiber.interrupt`;
  - Effect's sleep is **not** `unref`'d, so `close()` must interrupt everything.

### What to build
1. **The heartbeat sweep as one fiber,** forked in the constructor: a first wait of one interval, then `checkHeartbeats()` every `heartbeatIntervalMs`, with `catchDefect` so one bad conn never kills the sweep. `close()` interrupts it. Replace the `heartbeatTimer` field with the fiber.
2. **The handshake deadline as one fiber per connection:** `Effect.sleep(handshakeTimeoutMs)`, then the same check and close. It is interrupted in `dropConn` and when the conn becomes ready, exactly where `clearTimeout` runs today. Rename the `ServerConn` field if needed, but keep the type private.
3. **`close()`** stays idempotent and also interrupts every pending handshake fiber. No test may hang; if one relied on `unref` to let the process exit, report it.
4. **The public API stays the same:** `start`, `close`, `openEngineStream`, the preview methods, and the error classes and messages. `apps/server` typechecks and tests unchanged.
5. **Tests:** every `packages/runner-tunnel` test and `apps/server/src/machines/*.test.ts` pass **unchanged**. If one cannot, stop and report BLOCKED with the line. Add `packages/runner-tunnel/src/server.effect.test.ts` covering:
   - a connection that never sends `hello` is closed with `CLOSE_AUTH` after the timeout;
   - after `close()`, no fiber keeps running (for example, a short-interval server closes and the test ends with no open handles);
   - a ready conn whose pongs stop is terminated after `heartbeatTimeoutMs`.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `packages/runner-tunnel/src/server.ts` (all), `packages/runner-tunnel/src/resilience.test.ts`, `packages/runner-tunnel/src/auth.test.ts`, `apps/server/src/machines/hub.ts`.

### Allowed files
`packages/runner-tunnel/src/server.ts`, `packages/runner-tunnel/src/server.effect.test.ts`, `work/T-0511-effect-tunnel-server-timers.md`.

### Checks
```bash
pnpm --filter @zilar/runner-tunnel test --reporter=dot
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot machines
pnpm gate
```

### Acceptance
- The heartbeat sweep and the handshake deadlines are Effect fibers with identical behaviour, interrupted on ready, drop and close.
- The existing tests are untouched and green, and the new test passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Both `TunnelServer` timers in `packages/runner-tunnel/src/server.ts` are now Effect
fibers, with the same public API and behaviour.

- **Heartbeat sweep** (constructor): replaced `heartbeatTimer: NodeJS.Timeout`
  (`setInterval` + `unref`) with `heartbeatFiber: Fiber.Fiber<number, never>`.
  It is `Effect.repeat(checkHeartbeats, Schedule.spaced(heartbeatIntervalMs))`
  wrapped in one `Effect.delay(heartbeatIntervalMs)` so the first run comes after
  one interval, and the inner effect uses `Effect.catchDefect` so a throwing
  connection cannot kill the sweep. `close()` awaits `Fiber.interrupt` on it.
- **Handshake deadline** (per connection): replaced
  `ServerConn.handshakeTimer: NodeJS.Timeout | null` with the private
  `handshakeFiber: Fiber.Fiber<void, never> | null`, started in
  `handleConnection` as `Effect.sleep(handshakeTimeoutMs)` then the same
  `state !== 'ready'` check and `closeWith(conn, CLOSE_AUTH, 'handshake timeout')`.
  A new private `takeHandshakeFiber(conn)` helper detaches it; it is interrupted
  in `dropConn`, in `handleAuth` when the connection becomes ready, and in
  `close()` (the three places `clearTimeout` ran before). `close()` stays
  idempotent through `closed` and now awaits interrupting every pending handshake
  fiber before terminating the sockets.
- **New test** `packages/runner-tunnel/src/server.effect.test.ts`:
  1. a connection that never sends `hello` is closed with `CLOSE_AUTH` after
     `handshakeTimeoutMs`;
  2. a ready raw connection that ignores pings is terminated at/after
     `heartbeatTimeoutMs`;
  3. after `close()` (called twice to prove idempotency) no `Timeout` resource
     remains above the pre-start baseline, proving the sleep timers were
     interrupted and no fiber keeps the process alive.

No `unref` workaround is needed; `close()` interrupts every fiber. No existing
test relied on `unref` to exit, so nothing else changed.

### Files changed

- `packages/runner-tunnel/src/server.ts`
- `packages/runner-tunnel/src/server.effect.test.ts` (new)
- `work/T-0511-effect-tunnel-server-timers.md` (this file)

`git status --porcelain`: only those three.

### Commands run (real results)

- `pnpm install` — done in 18.3s (exit 0).
- `pnpm --filter @zilar/runner-tunnel test --maxWorkers=2 --reporter=dot src/server.effect.test.ts`
  — 1 file passed, **3 tests passed**.
- `pnpm --filter @zilar/runner-tunnel test --maxWorkers=2 --reporter=dot`
  — 11 files passed, **68 tests passed** (existing tests unchanged).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot machines`
  — 5 files passed, **62 tests passed** (existing tests unchanged).
- `pnpm gate` from the repo root — summary:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (20.0s)
  PASS  lint  (0.9s)
  PASS  typecheck  (2.4s)
  PASS  tests @zilar/runner-tunnel  (20.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes

- No logger exists in `TunnelServer` (unlike `hub.ts`), so the heartbeat
  `catchDefect` recovers silently instead of logging; `checkHeartbeats` already
  try/catches each socket call, so this is belt-and-suspenders only. Adding a
  logger would change the public constructor/options, which the spec forbids.
- Test 3 asserts on `process.getActiveResourcesInfo()` counting `Timeout`
  resources; the vitest per-test timer is active for both the baseline and the
  final measurement, so only fiber-owned timers affect the delta.

### Blocked / needs a decision

None.

## Review (written by Claude)

Approved (lead, 2026-10-07). The TunnelServer heartbeat sweep is one fiber (Effect.delay of one interval, then Schedule.spaced, with catchDefect). The handshake deadline is a fiber per connection, interrupted on ready, drop and close. close() stays idempotent and interrupts everything. The existing tests are untouched and the new test covers the timeout close, the pong timeout and shutdown. Pre-review clean.
