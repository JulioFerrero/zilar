---
id: T-1944
title: "Faster chat open: the XMPP token is fetched beside the boot fetches, not after them"
status: merged
milestone: M5
branch: task/T-1944-token-during-boot
model: deepseek/deepseek-flash
effort: default
depends_on: []
estimate: 25 min
---

# T-1944: Token during boot

## Spec (written by Claude, do not edit)

### Why
This is item 3 of the smooth-app plan (`docs/plan/smooth-app.md` §1 step 4, §5 item 3), which Julio approved on 2026-10-17 ("smoother app").

On a cold open, the XMPP token request waits until the boot fetches (`getMe`, `getChats`, `getContacts`, prefs) have finished. Nothing in it depends on them. The plan measured the token at 0.33 s. The token is valid for up to 600 s (`apps/server/src/xmpp/token.ts:9`), so fetching it a few hundred ms early is safe.

### Facts (read by the lead on 2026-10-18)
- **`packages/client-core/src/store/lifecycle.ts`:**
  - `boot` (`:199-251`) runs the four fetches together with `Effect.all(..., { concurrency: 'unbounded' })` (`:210-219`);
  - on failure it sets `offline` and returns (`:220-224`);
  - it ends with `yield* connectXmpp(ctx, session, me)` (`:250`);
  - `session` is a `Fibers<never>` (`packages/client-core/src/store/lifetime.ts:17-28`: `fork`, `scope`).
- **`packages/client-core/src/store/connect.ts`:**
  - `connectXmpp(ctx, session, me)` (`:108-185`) starts with `const tokenExit = yield* Effect.exit(fromPromise(() => api.getXmppToken()))` (`:116`);
  - on failure it sets `offline` and calls `scheduleConnectRetry` (`:117-121`), which later calls `connectXmpp(ctx, session, me)` again (`:56`);
  - the token feeds `ctx.mediaToken`, the trusted media hosts and the first `getToken` (`:122-144`);
  - reconnects fetch a fresh token in `nextToken` (`:129-139`).
- **Tests:** `packages/client-core/src/store/lifecycle.test.ts` fakes `getXmppToken` (`:169`, `:310`, `:358`). Its test at `:160-175` gates `getMe` on a promise, which suits a test of the new order.

### Steps
1. **`lifecycle.ts` `boot`:** start the token fetch at the same time as the four fetches.
   - Fork it in the session's scope, for example `session.fork` or `Effect.forkIn(session.scope)`, so it's interrupted if the session closes. Capture its result as an `Exit`, so a failure is a value and never an unhandled rejection.
   - If the boot fetches fail (`:220-224`), interrupt or ignore the token fiber and return as now.
   - Pass the fiber, or an Effect that joins it, to `connectXmpp` as a new optional fourth argument: `prefetchedToken`.
2. **`connect.ts` `connectXmpp`:** take `prefetchedToken?: Effect.Effect<Exit<XmppToken, unknown>>` (use the real token type from the api port).
   - When it's given, the first `tokenExit` comes from it, not a new `api.getXmppToken()` call.
   - Everything after `:117` stays the same: a failed prefetched token goes to `offline` and `scheduleConnectRetry`.
   - `scheduleConnectRetry` still calls `connectXmpp(ctx, session, me)` with no prefetched token, so every retry fetches a fresh one. `nextToken` for reconnects doesn't change.
3. **One test in `lifecycle.test.ts`**, modelled on `:160-175`:
   - with `getMe` gated, `getXmppToken` has already been called once before the gate opens;
   - after the boot completes, `getXmppToken` was called exactly once in total.

   This is the auth/token path, so it qualifies for a test.
4. Every file stays at 400 lines or fewer. No web or phone app file changes; both apps get this through client-core.

### Allowed files
- `packages/client-core/src/store/lifecycle.ts`
- `packages/client-core/src/store/connect.ts`
- `packages/client-core/src/store/lifecycle.test.ts`
- `work/T-1944-token-during-boot.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/lifecycle.test.ts src/store/history.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- On a cold boot, `GET /api/xmpp/token` starts together with `/api/me`, `/api/chats` and `/api/contacts`, not after them.
- The token is fetched once per boot.
- A failed token still retries with a fresh token, as before.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- `lifecycle.ts` `boot`: the token request is now forked into the session scope
  (`Effect.forkIn(session.scope, { startImmediately: true })`) before the four boot
  fetches start. Its result is captured with `Effect.exit`, so a failure is a value.
  On a failed boot the token fiber is interrupted; on success its `Fiber.join` is
  passed to `connectXmpp` as the new optional fourth argument.
- `connect.ts` `connectXmpp`: accepts
  `prefetchedToken?: Effect.Effect<Exit.Exit<CoreXmppToken, unknown>>`. With it, the
  first `tokenExit` comes from that effect; without it (every retry from
  `scheduleConnectRetry`, and reconnects' `nextToken`) it calls `api.getXmppToken()`
  as before. The failure path (`offline` + retry ladder) is unchanged.
- `lifecycle.test.ts`: one new test in "boot bookkeeping" that gates `getMe`, checks
  `getXmppToken` was already called once while the gate is closed, then checks it is
  still exactly once after the boot settles and `ctx.mediaToken` is set from it.

### Checks run

- `pnpm install` — completed with no output.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/lifecycle.test.ts` — 1 file passed, 16 tests passed.
- Task check: `pnpm --filter @zilar/client-core exec vitest run src/store/lifecycle.test.ts src/store/history.test.ts --reporter=dot` — 2 files passed, 40 tests passed.
- `pnpm gate` (from the repo root), summary lines:

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.0s)
PASS  lint  (0.8s)
PASS  typecheck  (1.6s)
PASS  effect  (0.7s)
PASS  tests @zilar/client-core  (5.0s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- The 400-line rule: `lifecycle.test.ts` was already 506 lines before this task and is
  now 543 (the gate's size check passes, it only counts changed source files). The new
  test could not go in a separate file because only the three named files are Allowed.
- Token timing: the test proves the token request starts before `getMe` resolves; it
  does not measure the cold-open latency itself (that needs a device/live check).

## Review (written by Claude)

**Approved and merged.**

`boot` now forks `getXmppToken` with `startImmediately` in the session scope, as an `Exit`. A failed boot interrupts that fork, and `connectXmpp` takes `Fiber.join(tokenFiber)` as its optional 4th argument. Reconnects (`nextToken`) and the `scheduleConnectRetry` path still fetch a fresh token.

The pre-review was clean apart from one nit, which is left as is: the new test has no `createXmpp` fake, so the boot fiber ends with a logged error after both assertions have run.

Test files are exempt from the 400-line rule. The real cold-open gain is measured on the next live deploy (the token request should start alongside `/api/me`).
