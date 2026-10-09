---
id: T-0798
title: "H1: runner-tunnel mux.ts on Effect (StreamMux stream lifecycle, socket attach and timers as Effects with Scope; same wire protocol)"
status: merged
milestone: M5
branch: task/T-0798-runner-tunnel-mux
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0798: H1: runner-tunnel mux.ts on Effect (StreamMux stream lifecycle, socket attach and timers as Effects with Scope; same wire protocol)

## Spec (written by Claude, do not edit)

### Why
This is Phase 2 of `docs/audit/effect-100-plan.md` (task H1, plan line 353), accepted by Julio on 2026-10-09. The plan flags "Julio: runner traffic (AI desks)": Julio checks an AI desk session live before the next deploy.

### Verified facts (do not re-derive)
- **`packages/runner-tunnel/src/mux.ts`** (428, H1 H3 H8 W4), tested in `mux.test.ts`. Line 1 has `import net from 'node:net'`. Exports: `TunnelClosedError` (line 15), `StreamSink` (line 26), `StreamMuxOptions` (line 37), `class StreamMux` (line 51) and `attachSocketToStream(...)` (line 359).
- **The other tests** in the package also drive the mux: `resilience.test.ts`, `engine.test.ts`, `runner.test.ts`, `runner.effect.test.ts`, `server.effect.test.ts` and `auth.test.ts`. Run the whole package suite.
- **The callers** are `runner.ts` and `server.ts` in the same package (already partly Effect, see `runner.effect.test.ts`), `apps/runner` and `apps/server`. Keep the public class and function shapes (methods and Promise return types) unchanged; they are Tier B edges.
- **The wire format** (frames and the order of open, data, close and error) must stay byte-identical.
- **`node:net` (H8) is the platform edge** and stays imported. Its sockets are wrapped with `Effect.callback` and `Effect.acquireRelease`, so closing a scope removes the listeners and ends the socket, wherever the old code did so by hand.

### The server conversion pattern
- **The goal:** after this task each listed file imports Effect for its async work. Async control flow, try/catch, timers and fire-and-forget calls are written as Effects. A Promise edge stays where a caller outside this task still awaits a function (a Tier B edge, `docs/EFFECT_GUIDE.md:12-32`): implement it as an Effect and export `Effect.runPromise(...)`, or keep the Promise-typed method.
- **Fire-and-forget** (`void x().catch(log)`) becomes `Effect.runFork(effect.pipe(Effect.catchCause(logCause)))` with the same log message and fields; never swallow silently. Timers become forked `Effect.sleep` fibers that are interrupted instead of `clearTimeout`. The finished patterns are `apps/server/src/drafts/hub.ts` (T-0764), `packages/xmpp-core/src/timers.ts` (T-0769) and `apps/server/src/sandbox/host-fetch.ts` (T-0771).
- **Errors:** the same error classes and messages reach the same callers; logs keep the same messages, fields and redaction (no secrets, no message bodies).
- **The order of side effects and the timing are identical.** When in doubt, keep the structure and change only the mechanics.
- **Check APIs in `node_modules/effect/dist/*.d.ts`** (Effect 4.0.2), not from memory.

### What to build
Convert `mux.ts` with the pattern. Timers (idle, keepalive, open timeout; read which exist) become forked fibers that are interrupted on close. Promise-based waits become `Deferred`, as `packages/xmpp-core/src/client.ts` does since T-0777.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `packages/runner-tunnel/src/mux.ts`, `runner.ts`, `server.ts`, `protocol.ts`, `mux.test.ts`, `resilience.test.ts`, and `packages/xmpp-core/src/client.ts` (the Deferred pattern).

### Allowed files
`packages/runner-tunnel/src/mux.ts`, `work/T-0798-runner-tunnel-mux.md`.

### Checks
```bash
pnpm --filter @zilar/runner-tunnel test --reporter=dot
pnpm gate
```
Paste each test run's counts and each file's `pnpm effect:map` kind into the Report.

### Acceptance
- Each listed source file is an Effect file; its exported names, signatures and error messages are unchanged.
- The tests pass unchanged, 3 of 3 runs.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What changed
Only `packages/runner-tunnel/src/mux.ts`. It now imports `effect` (`Cause`, `Deferred`, `Duration`, `Effect`). `pnpm effect:map` kind: before `needs-effect` (H1 H3 H8 W4), after `effect` (signals left: H1, H8, W4: the Promise-returning edges, `node:net` and sync best-effort try/catch).

### Sites
- **Timer** (`delay(2)` poll in `waitSendable`): now `Effect.sleep(Duration.millis(2))` inside the same polling loop. It is the only timer in the file (no idle, keepalive or open timeout). The `delay` helper is gone.
- **Resume waiters** (`waitResume`, `handleResume`, `failAll`): `Promise` with stored `resolve/reject` became `Deferred<void, Error>`; `handleResume` completes it with `Deferred.doneUnsafe(w, Effect.void)`, `failAll` with `Effect.fail(err)`.
- **Per-stream FIFO tails**: `Promise<void>` became `Deferred<void>`. `sendStreamData` is still `(streamId, chunk): Promise<void>` and is `Effect.runPromise(sendStreamDataEffect(...))`. `enqueueTeardown` is still sync `void`; its chain runs on a forked fiber (`Effect.runFork`) and swallows every cause like the old `.catch(() => undefined)`.
- **`sendNow`, `waitSendable`, `sendRaw`**: Effects (`Effect.gen`, `Effect.callback` around `ws.send`, same `TunnelClosedError` texts: `websocket is not open`, `websocket send failed`, the ws callback error message).
- **Socket (`attachSocketToStream`)**: same signature (`void`). The listeners stay plain event listeners (the function returns nothing a Scope could hang on, and the old code never removed them by hand; the 'close' handler already does the teardown). The `'data'` handler's `void send.then().catch()` became `Effect.runFork(sendStreamDataEffect(...).pipe(Effect.matchCause(...)))`: on success resume the socket if not destroyed; on any failure or defect `socket.destroy(Cause.squash(cause))` when it is an `Error`, else `new TunnelClosedError('send failed')`.
- Wire format, frame order, `highWaterMark`, error classes and texts are untouched. `sendControl`, `sendFin`, `handleBinary` and the other sync methods are unchanged (`throwIfDead` now reads a new `deadError()` helper, same errors).

### Added surface
`StreamMux.sendStreamDataEffect(streamId, chunk): Effect<void, Error>` (additive, used by `attachSocketToStream` and by `sendStreamData`). No existing export changed.

### Behaviour differences
1. Start timing: the old `sendStreamData` and `enqueueTeardown` always waited a few microtasks before doing work (`await previous.catch()`). A fiber starts synchronously, so with nothing queued the first frame, FIN or `tunnel.closed` now goes out in the same tick instead of a few microtasks later. The queue slot is still taken synchronously and per-stream order is unchanged (a FIN never overtakes data; `mux.test.ts` passes).
2. Wake-ups: a parked sender is now resumed synchronously inside `handleResume`/`failAll` (`Deferred.doneUnsafe`) rather than a microtask later. In `failAll` the sender's failure handler (`socket.destroy(err)` with the same error) can therefore run just before the sink loop; the sinks still get the same `err` and the same `onStreamFailed` hook.
3. A teardown whose finaliser runs deletes the tail entry even if its callback had thrown (it cannot throw).
No change to bytes on the wire, frame order per stream, timeouts or error texts.

### Commands and results
- `pnpm --filter @zilar/runner-tunnel test --reporter=dot` before (untouched code): 12 files passed, 71 tests passed.
- After: run 1 12 files / 71 tests passed; run 2 12 / 71 passed; run 3 12 / 71 passed. Tests unchanged.
- `pnpm gate`: `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/runner-tunnel`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.
- Not tested: a live AI desk session (needs Julio's check before deploy as the spec says); `apps/runner` and `apps/server` suites were not run by me beyond what the gate selected.

### Unsure
Whether the Effect.runFork in `attachSocketToStream` should instead own a Scope with `acquireRelease` for the listeners; I kept the listeners imperative because the function returns `void` and nothing removed them before.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Sonnet 5.5. The lead reviewed the Report.
- **`mux.ts`** is an Effect file. Resume waiters and FIFO tails are `Deferred`, the 2 ms poll is `Effect.sleep`, and sends are Effects.
- **Kept the same:** the wire bytes, the frame order and the error texts.
- **Socket listeners stay imperative:** the old code never removed them and the function returns void, which is accepted.
- **Timing:** the first frame now goes out in the same tick, and the FIN-after-data test passes.
- **Results:** 71 tests pass 3 of 3 runs; the gate passed.
- **Live check:** Julio checks an AI desk session live before the next deploy.
