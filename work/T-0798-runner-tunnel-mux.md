---
id: T-0798
title: "H1: runner-tunnel mux.ts on Effect (StreamMux stream lifecycle, socket attach and timers as Effects with Scope; same wire protocol)"
status: todo
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

## Review (written by Claude)
