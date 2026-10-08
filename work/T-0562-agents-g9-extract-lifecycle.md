---
id: T-0562
title: "Agents G9: move start/stop/reconcile and their state (started, timer, unsubscribes) out of createAgentGateway into agents/gateway/lifecycle.ts verbatim; isStarted becomes the factory's getter; zero behaviour change"
status: merged
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

### What I did
- Created `apps/server/src/agents/gateway/lifecycle.ts` with `createGatewayLifecycle(ctx)`.
  It owns the moved state (`started`, `timer`, `unsubscribes`) and returns
  `{ start, stop, reconcile, isStarted }`. Bodies of `reconcile`, `start` and
  `stop` are verbatim moves, with two mechanical adaptations: the moved state
  is read inside the factory, and `roomListener.clearAll()` became the
  injected `clearAllListeners` callback (the only textual substitution).
- In `createAgentGateway` (`apps/server/src/agents/gateway.ts`):
  - removed the moved state and the three functions;
  - removed the now-unused imports (`listActiveAisForGateway`, `onAiLifecycle`,
    `ActiveAiForGateway`, `onGroupAi`, `onTopicAi`, `loadActiveAi`); kept
    `type AiServiceDeps` (still used by `aiDeps()`);
  - `createSessionLifecycle`'s `isStarted` is now the lazy arrow
    `() => lifecycle.isStarted()`, and the lifecycle factory is created after
    the session/turn factories it calls into;
  - the returned object (`start`, `stop`, `reconcile`, `size`, `aiIds`,
    `postToChat`) is unchanged via destructuring.
- No test file touched.

### Ordering choice
Option 2 from the spec (lazy arrow, TDZ-safe): `createSessionLifecycle` is
still created before the lifecycle factory, so its `isStarted` reads
`lifecycle.isStarted()` lazily at event time (inside `connectAi`), after the
`const lifecycle` is initialized. This kept the session-factory call site
position unchanged and avoided reordering the DM/group-turn factories that
also close over `connectAi`/`disconnectAi`.

### Verbatim diffs (whitespace-insensitive, old = HEAD gateway.ts)
- `reconcile` (old lines 253-291) vs new: `diff -w` identical.
- `start` (old 331-440) + `stop` (old 442-465) vs new, after substituting
  `roomListener.clearAll()` -> `clearAllListeners()` in the old text:
  `diff -w` identical. The `stop` substitution is the only logic-text change,
  and it is behavior-identical (same call, injected because `roomListener`
  lives in gateway.ts).

### Checks
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/agents/gateway.test.ts`: 168 passed (includes the `lifecycle` describe
  block and the four pinning tests named in the spec). The full `src/agents`
  run timed out at the 120s tool cap, so I ran the pinning file with a 300s
  timeout instead; no other agents test file exists besides `gateway.test.ts`
  and unrelated suites (`context`, `rounds`, `stream`, `tools`, `reply`,
  `integration`).
- `pnpm gate` (repo root): GATE PASS. Summary lines:
  `2 changed file(s) against main` / `PASS install (frozen) (2.8s)` /
  `PASS format (41.3s)` / `PASS lint (1.6s)` / `PASS typecheck (34.8s)` /
  `PASS tests @zilar/server (90.3s)` /
  `scope: every changed file is inside the Allowed files` / `GATE PASS`.
  (First gate run failed only on Prettier line-wrapping in the new
  lifecycle.ts; fixed with `prettier --write` on that Allowed file, then
  re-ran the gate clean. That prettier pass only reflowed lines/imports, and
  the verbatim diffs above were re-verified afterwards.)

### Security checklist
No new routes, auth, secrets handling, deletes scoping, caps or audit rows:
pure code move. Log lines moved verbatim (ids only). No `any`, no
`@ts-ignore`.

### Files changed
- `apps/server/src/agents/gateway/lifecycle.ts` (new)
- `apps/server/src/agents/gateway.ts` (-189/+25 net)

## Review (written by Claude)

Approved (lead, 2026-10-08). G9: reconcile, start and stop, and their state (started, timer, unsubscribes), moved into agents/gateway/lifecycle.ts. Lead diff per function (whitespace-insensitive) against main: reconcile and start are identical; stop differs only in roomListener.clearAll() becoming the injected clearAllListeners(). The gateway object keys are unchanged. Every gateway extraction step (G1-G9) is now done; next come the Effect conversions C1 and C2. Nit accepted: the focused check ran gateway.test.ts only, but the gate ran the full server suite (GATE PASS).
