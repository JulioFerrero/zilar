---
id: T-0796
title: "S5b: sandbox tool-worker.ts on Effect (the QuickJS worker-thread entry: message handling, timers and the run loop as Effects; same worker protocol)"
status: todo
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

## Review (written by Claude)
