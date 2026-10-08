---
id: T-0562
title: "Agents G9: move start/stop/reconcile and their state (started, timer, unsubscribes) out of createAgentGateway into agents/gateway/lifecycle.ts verbatim; isStarted becomes the factory's getter; zero behaviour change"
status: todo
milestone: M5
branch: task/T-0562-agents-g9-extract-lifecycle
model: auto
effort: low
depends_on: [T-0556]
estimate: 0.5 day
---

# T-0562: agents G9, extract the lifecycle

## Spec (written by Claude, do not edit)

### Why
Plan `docs/audit/effect-agents-plan.md` §3, "G9". This is the last extraction before the Effect conversions C1 and C2. The models to copy are `agents/gateway/tool-exec.ts` (G4), `group-ingest.ts` (G8b) and `sessions.ts` (G5b). **This is a pure extraction: no logic change and no Effect.**

**One deviation from the plan:** no `gateway/index.ts` and no re-export shim yet. `gateway.ts` stays the composition root, and that move is a later, separate task.

### Verified facts (do not re-derive; find each by name inside `createAgentGateway` in `apps/server/src/agents/gateway.ts`, since lines move)
- **The state to move:** `let started = false`, `let timer` and `let unsubscribes` (around lines 102-104 after G4). These are read or written only by `start`, `stop` and the callbacks inside `start`, **plus** `isStarted: () => started` passed to `createSessionLifecycle` (around line 120). Check every reference with grep.
- **The functions to move verbatim:**
  - `async function reconcile()` (around 253);
  - `async function start()` (around 331), including the subscription callbacks that check `started`;
  - `async function stop()` (around 442).
  
  `handleIncoming` (around 293) **stays** in `gateway.ts`. Pass it into the factory as a ctx callback if `start` uses it.
- **The order problem:** `createSessionLifecycle` is created **before** these functions and reads `started` lazily. After the move, `started` lives inside the lifecycle factory. So either:
  - create the lifecycle factory first and pass `isStarted: () => lifecycle.isStarted()`; or
  - keep `createSessionLifecycle`'s `isStarted` as a lazy arrow that reads the lifecycle factory created later (TDZ-safe, because it runs only at event time).
  
  Explain the choice in the Report.
- **The returned gateway object** (around 467) exposes `start` and `stop`, and possibly `reconcile`. Keep its keys and call text unchanged by destructuring from the factory.
- **The pinning tests** (`apps/server/src/agents/gateway.test.ts`, by name): everything in the `lifecycle` describe block, "disconnects an AI disabled after start on the next reconcile", "retries a failed join on reconcile", "resets the superseded set on restart" and "a 'restart' … leaves a stopped AI offline".

### What to build
1. **Create `apps/server/src/agents/gateway/lifecycle.ts`** exporting `createGatewayLifecycle(ctx)`. It owns the moved state and returns `{ start, stop, reconcile, isStarted }`, or only what callers use plus `isStarted`.
2. **In `createAgentGateway`:**
   - create it once, in a safe order;
   - destructure;
   - remove the moved state and functions, and drop the imports that only they used.
3. **Move the bodies verbatim:** no logic edits and no renames, except reading the moved state inside the factory and calling injected callbacks. Put a whitespace-insensitive diff of the old block against the new one in the Report.
4. **Tests:** every `apps/server/src/agents/**/*.test.ts` passes **unchanged**.

### Read first
`AGENTS.md`, `docs/audit/effect-agents-plan.md` §3 "G9", `apps/server/src/agents/gateway/sessions.ts`, `apps/server/src/agents/gateway/tool-exec.ts`, `apps/server/src/agents/gateway.ts`.

### Allowed files
`apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway/lifecycle.ts`, `work/T-0562-agents-g9-extract-lifecycle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents
pnpm gate
```

### Acceptance
- start, stop, reconcile and their state live in `agents/gateway/lifecycle.ts`, moved verbatim, with the diff in the Report.
- The agents tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
