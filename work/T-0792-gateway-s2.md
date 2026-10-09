---
id: T-0792
title: "S2: AI gateway part 2 on Effect — gateway/sessions.ts, gateway/lifecycle.ts, gateway/listener.ts (retry/room timers as interruptible fibers, reconcile and pumps as Effects behind the same factory interfaces); gateway suite unchanged"
status: merged
milestone: M5
branch: task/T-0792-gateway-s2
model: auto
effort: default
depends_on: [T-0791]
estimate: 0.5 day
---

# T-0792 (S2): AI gateway part 2 on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 2 of `docs/audit/effect-100-plan.md` (task S2), accepted by Julio on 2026-10-09. It merges after S1 (T-0791).

### Verified facts (do not re-derive)
- **The files** (`apps/server/src/agents/gateway/`), with their lines, signals and first non-Effect line from `pnpm effect:map` on main:
  - `sessions.ts` (287, H1 H3 W4): `createSessionLifecycle(ctx)` at line 34; first hit `session.retryTimer = setTimeout(...)`;
  - `lifecycle.ts` (232, H1 H3 W4): `createGatewayLifecycle(ctx)` at line 31; first hit `async function reconcile()`;
  - `listener.ts` (249, H1 H3 W4): `createRoomListener(ctx)` at line 35; first hit `state.timer = setTimeout(...)`.
- **The callers** are `apps/server/src/agents/gateway.ts` and the other gateway modules (S3 and S4 convert them later), so keep the factory return types unchanged. `session.retryTimer` and `state.timer` are fields of shared state types (check `gateway/contracts.ts`); store a cancel function or a fiber there instead, and update the type only if it is defined in an Allowed file. Otherwise keep the field shape and say what you did.

### The server conversion pattern
- **The goal:** after this task each listed file imports Effect for its async work. Async control flow, try/catch, timers and fire-and-forget calls are written as Effects. A Promise edge stays where a caller outside this task still awaits a function (a Tier B edge, `docs/EFFECT_GUIDE.md:12-32`): implement it as an Effect and export `Effect.runPromise(...)` or keep the Promise-typed factory method.
- **Fire-and-forget** (`void x().catch(log)`) becomes `Effect.runFork(effect.pipe(Effect.catchCause(logCause)))` with the same log message and fields; never swallow silently. Timers become forked `Effect.sleep` fibers that are interrupted instead of `clearTimeout`. See the finished pattern in `apps/server/src/drafts/hub.ts` (T-0764) and `packages/xmpp-core/src/timers.ts` (T-0769).
- **Errors:** the same error classes and messages reach the same callers; logs keep the same messages, fields and redaction (no secrets, no message bodies). Check how `runPromise` surfaces failures in 4.0.2 (it rejects with the squashed cause, so a failed typed error reaches the caller as the same instance).
- **The order of side effects and the timing are identical.** The gateway runs AI turns in live chats: when in doubt, keep the structure and change only the mechanics.
- **Tests:** the gateway suite must pass unchanged: `apps/server/src/agents/gateway.test.ts` (7,242 lines) plus `rounds.test.ts`, `context.test.ts`, `reply.test.ts`, `reply.effect.test.ts`, `stream.test.ts` and `tools.test.ts`. `integration.test.ts` is gated and is not run. Run `pnpm --filter @zilar/server test --maxWorkers=4 --reporter=dot src/agents` three times to catch flakiness.
- **Check APIs in `node_modules/effect/dist/*.d.ts`** (Effect 4.0.2), not from memory.

### What to build
Convert the three files with the pattern. The retry and room timers become forked fibers that are interrupted on stop, reconnect or leave, wherever `clearTimeout` runs today. `reconcile` and any pump become Effects.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/server/src/drafts/hub.ts`, `packages/xmpp-core/src/timers.ts`, the three files, `apps/server/src/agents/gateway/contracts.ts`, `apps/server/src/agents/gateway.ts`.

### Allowed files
`apps/server/src/agents/gateway/sessions.ts`, `apps/server/src/agents/gateway/lifecycle.ts`, `apps/server/src/agents/gateway/listener.ts`, `apps/server/src/agents/gateway/contracts.ts`, `work/T-0792-gateway-s2.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=4 --reporter=dot src/agents
pnpm --filter @zilar/server typecheck
```
Wave mode (`docs/EFFECT_BRIEF.md`): no whole suite and no `pnpm gate`, because the lead checks the wave. Paste the three `src/agents` run counts and each file's kind into the Report.

### Acceptance
- The three files are Effect files with no `setTimeout` or `clearTimeout`; their factory interfaces are unchanged.
- The gateway suite passes unchanged, 3 of 3 runs, and the server typecheck is clean.
- Only Allowed files change.

---

## Report (written by the worker when done)

- **effect:map kinds:** `sessions.ts`, `lifecycle.ts`, `listener.ts` and `contracts.ts` are all `effect`. None has `setTimeout`, `setInterval`, `clearTimeout`, `async`, `await`, `.then(` or `try`/`catch` left.
- **What changed:**
  - `contracts.ts`: `AiSession.retryTimer` and `RoomListenerState.timer` are now `Fiber.Fiber<void> | undefined`. Two small helpers were added: `cancelTimer` (`interruptUnsafe`, like `clearTimeout`) and `attempt` (`Effect.tryPromise` that keeps the thrown value as the error).
  - `sessions.ts`: the retry timer is a forked `sleep` fiber, cancelled in `scheduleRetry` and `disconnectAi`. `connectAi`, `disconnectAi`, `syncAiRooms` and `leaveRoomQuietly` are Effects, exported as Promise functions through `Effect.runPromise`; the factory return shape is unchanged. The `getToken` callback given to the core is also `Effect.runPromise`. `handleReplaced` forks the disconnect.
  - `lifecycle.ts`: `reconcile`, `start` and `stop` are Effects behind Promise wrappers. The reconcile `setInterval` is a forked `sleep` + `Effect.forever` fiber, interrupted in `stop`. The three event handlers' `void load().then().catch(log)` became `Effect.runFork`; the group and topic handlers now share one local helper (`syncRoomsOnEvent`) with the same logic.
  - `listener.ts`: the debounce is a forked `sleep` fiber, cancelled by `clearListenerTimer`. `fireRoomListener` is a fork of an Effect; `wakeListenerAis` had no `await`, so it is a plain sync function; the room pump is `Effect.runFork` with the same warn text.
- **Tests:** `pnpm --filter @zilar/server test --maxWorkers=4 --reporter=dot src/agents`:
  - Before: 430 passed, 1 failed, 1 skipped (I do not know which test: the run was in progress while I started editing and I kept only the tail of the output).
  - After: 431 passed, 1 skipped, 0 failed, three runs out of three.
  - `pnpm --filter @zilar/server exec tsc --noEmit -p .`: clean. Prettier was run on the four files. No test file was changed. I did not run `pnpm gate` or lint (wave mode).
- **Behaviour differences:**
  - A synchronous throw from `session.core.connect()` inside the retry timer used to be an uncaught exception; it is now treated as a failed reconnect (logged and retried). `connect` is async, so this cannot happen in practice.
  - The interval is now `sleep` then tick in a loop, so its period is the interval plus a negligible drift (the tick only forks); `setInterval` had a fixed rate.
  - Otherwise none: the same log texts, fields and order of side effects. Errors still reach Promise callers as the same instances (checked with a small script).
- **Unsure:** the one failure in the baseline run. It did not come back in 3 runs on the new code.

## Review (written by Claude)

**2026-10-09, lead (wave 1):** approved. The lead reviewed the Report. The wave 1 combined check (all 12 branches on one tree, by hand) passed the whole-repo typecheck and every package suite: web 1916, server 2279, mobile 2222, xmpp-core 245, runner 63, runner-tunnel 71, devtools 796 after the T-0799 fix, chat-core 174, protocol 174.
- Worker: Sonnet 5.5. sessions, lifecycle, listener and contracts are Effect files; timers are fibers; 431 agents tests pass 3 of 3 runs. Accepted: a sync throw in the retry connect now counts as a failed reconnect, and the reconcile loop is sleep-then-tick.
