---
id: T-0797
title: "S6: push component.ts and sender.ts on Effect (per-node send chain, web-push send and expiry check; same delivery order)"
status: todo
milestone: M5
branch: task/T-0797-push-sender-component
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0797: S6: push component.ts and sender.ts on Effect (per-node send chain, web-push send and expiry check; same delivery order)

## Spec (written by Claude, do not edit)

### Why
This is Phase 2 of `docs/audit/effect-100-plan.md` (task S6, plan line 345), accepted by Julio on 2026-10-09. The plan flags "Julio: push delivery is live": Julio checks a push live before the next deploy.

### Verified facts (do not re-derive)
- **`apps/server/src/push/component.ts`** (180, H1 W4), tested in `component.test.ts`. `startPushComponent(options): PushComponentHandle` is at line 36. Line 62 has `const tail = chains.get(notification.node) ?? Promise.resolve();`, a per-node Promise chain that serialises the deliveries for one node. `discoInfoHandler` is at line 167.
- **`apps/server/src/push/sender.ts`** (71, H1 W4), no test. `createWebPushSender(config): WebPushDelivery` is at line 29, with `send: async (subscription, payload) => …` at line 43; `isExpiredSubscription(error)` is at line 64.
- **The callers** are `apps/server/src/index.ts` (it starts the component) and `push/service.ts` and `push/api.ts`; find them with `git grep`. Keep `PushComponentHandle` and `WebPushDelivery` unchanged.
- **The per-node chain** becomes one serial queue per node: a `Semaphore` of 1 per node, or a `Queue` with one consumer fiber. It must keep the same order and the same "one failure does not block the next" behaviour. Read how the chain handles a rejection first and keep it.

### The server conversion pattern
- **The goal:** after this task each listed file imports Effect for its async work. Async control flow, try/catch, timers and fire-and-forget calls are written as Effects. A Promise edge stays where a caller outside this task still awaits a function (a Tier B edge, `docs/EFFECT_GUIDE.md:12-32`): implement it as an Effect and export `Effect.runPromise(...)`, or keep the Promise-typed method.
- **Fire-and-forget** (`void x().catch(log)`) becomes `Effect.runFork(effect.pipe(Effect.catchCause(logCause)))` with the same log message and fields; never swallow silently. Timers become forked `Effect.sleep` fibers that are interrupted instead of `clearTimeout`. The finished patterns are `apps/server/src/drafts/hub.ts` (T-0764), `packages/xmpp-core/src/timers.ts` (T-0769) and `apps/server/src/sandbox/host-fetch.ts` (T-0771).
- **Errors:** the same error classes and messages reach the same callers; logs keep the same messages, fields and redaction (no secrets, no message bodies).
- **The order of side effects and the timing are identical.** When in doubt, keep the structure and change only the mechanics.
- **Check APIs in `node_modules/effect/dist/*.d.ts`** (Effect 4.0.2), not from memory.

### What to build
1. Write `apps/server/src/push/sender.test.ts` first, against the current code: a send that resolves, a send that rejects with an expired status (`isExpiredSubscription` true for 404 and 410, read the code), and one that rejects otherwise. Inject or mock `web-push` the way `component.test.ts` mocks its dependencies. Commit it as "T-0797: tests before".
2. Convert both files with the pattern.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/server/src/push/component.ts`, `sender.ts`, `component.test.ts`, `service.ts`, and how `apps/server/src/index.ts` starts the component.

### Allowed files
`apps/server/src/push/component.ts`, `apps/server/src/push/sender.ts`, `apps/server/src/push/sender.test.ts`, `work/T-0797-push-sender-component.md`.

### Checks
```bash
pnpm --filter @zilar/server test --reporter=dot src/push
pnpm gate
```
Paste each test run's counts and each file's `pnpm effect:map` kind into the Report.

### Acceptance
- Each listed source file is an Effect file; its exported names, signatures and error messages are unchanged.
- The tests pass unchanged, 3 of 3 runs.
- The new sender tests pass both before and after the conversion.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
