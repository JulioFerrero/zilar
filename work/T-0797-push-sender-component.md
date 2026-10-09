---
id: T-0797
title: "S6: push component.ts and sender.ts on Effect (per-node send chain, web-push send and expiry check; same delivery order)"
status: merged
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

**Commits:** `ad843415` "T-0797: tests before" (new `sender.test.ts`, status in-progress); the conversion commit follows on this branch, message "T-0797: ...".

**Files changed:** `apps/server/src/push/sender.ts`, `apps/server/src/push/component.ts` (converted); `apps/server/src/push/sender.test.ts` (new). Public names, signatures, `PushComponentHandle`, `WebPushDelivery`, `isExpiredSubscription`, `createWebPushSender` and every log message, field and error text are unchanged.

**Tests**
- `sender.test.ts` written first, against the unconverted code: 7 passed (`pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/sender.test.ts`). `web-push` is mocked with `vi.mock` (`WebPushError` mirrored). It covers VAPID setup and the missing-key throw, a resolved send (`gone: false`, TTL/urgency args), 404 and 410 resolving `gone: true`, other statuses and a network error rejecting with the same object (`toBe`), and `isExpiredSubscription` on both shapes.
- After the conversion: `component.test.ts` + `sender.test.ts`: 10 passed.
- `pnpm --filter @zilar/server test --reporter=dot src/push`, 3 runs, each: 11 files passed, 1 skipped; 76 tests passed, 1 skipped (77). The pre-change full-push count was not measured; it is 69 + 1 skipped by subtraction.
- `pnpm exec tsc --noEmit` in `apps/server`: exit 0. `oxlint` on the three files: no output.

**effect:map kind:** `apps/server/src/push/component.ts` = effect; `apps/server/src/push/sender.ts` = effect. (`pnpm effect:map` writes `dist/`, which is gitignored; `sender.test.ts` is not listed.)

**Per-node chain now:** `chains` is a `Map<node, Fiber<void>>` holding the latest job. Each publish IQ runs `afterPrevious(previous, handleNotification(...))` with `Effect.runFork`: it waits for the previous fiber with `Fiber.join` (its exit ignored via `Effect.exit`), then runs the handler, which logs exactly as before and always answers `result`. A failing job is dropped quietly by `catchCause`, as the old `cleanup` did. A fiber observer removes the entry when it is still the latest job.
- Deviation from the spec's suggestion: I did not use a `Semaphore` or `Queue`. In effect 4.0.2 a released semaphore wakes its waiters through `setImmediate` (`node_modules/effect/dist/Semaphore.js`, `releaseUnsafe`), so a stanza that arrives in between can take the permit ahead of a queued publish, which breaks arrival order. Joining the previous fiber is strictly FIFO.

**Behaviour differences**
- The first handler for a node now starts synchronously inside the `stanza` listener (`runFork` evaluates synchronously). Before, it started one microtask later. Order across IQs and nodes is the same.
- Library `start`/`stop`/`send` throws are now caught: a sync throw from `xmpp.start()` is logged as `push component failed to start` instead of escaping `startPushComponent`, and a sync throw from `xmpp.stop()` now rejects the returned Promise instead of throwing. I did not verify that `@xmpp/component` can throw synchronously; its methods are async.
- A send that rejects with a non-expired error is re-raised with `Effect.die(error)`; `runPromise` rejects with the same object (tested). An expired one resolves `{ gone: true }`, as before.
- The disco and `result` replies are still sent synchronously from the listener, so their order is unchanged.

**Gate (final run, from the worktree root):**
```
gate: 4 changed file(s) against main
PASS  install (frozen)
PASS  format
PASS  lint
PASS  typecheck
PASS  effect
PASS  tests @zilar/server
scope: every changed file is inside the Allowed files
GATE PASS
```
The first gate run failed the scope check on a scratch output file I had written into the worktree (`.gate-out.tmp`). I deleted it and reran; the file was never committed.

**Open points:** none blocking. The per-node fiber chain differs from the spec's listed options (see above); Claude should confirm that is acceptable. Re-entrancy: a `stanza` event fired synchronously inside `runFork` would register its job after its predecessor; socket events cannot do that, so I left it as is.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the Report.
- **Tests first:** 7 sender tests were committed against the old code.
- **Both files** are Effect files.
- **The per-node chain** is a map of the latest job fiber; each job joins the previous one. This keeps the strict per-node order that a Semaphore wake-up (`setImmediate`) could break, so it is accepted.
- **Errors:** a non-expired send error is re-raised as the same object.
- **Results:** 76 tests pass 3 of 3 runs; the gate passed.
- **Live check:** Julio checks a push on live before the next deploy.
