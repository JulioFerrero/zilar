---
id: T-0777
title: "X2b: xmpp-core requests on Deferred — joinRoom, loadHistory, requestUploadSlot, setPushEnabled become Effects (Deferred.await + timeoutOrElse with the X1 typed errors, map entry removed in ensuring); the pendingJoins/pendingQueries/pendingIqs maps hold Deferreds completed synchronously by the stanza handlers; Promise methods unchanged; every test unchanged"
status: merged
milestone: M5
branch: task/T-0777-xmpp-requests-deferred
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0777 (X2b): xmpp-core request/response on `Deferred`

## Spec (written by Claude, do not edit)

### Why
This continues the xmpp-core lane of `docs/audit/effect-100-plan.md` (§3.1, "Request/response as `Deferred`"), accepted by Julio on 2026-10-09. X1 (T-0763) added typed errors in `src/errors.ts`, and X2a (T-0769) moved every timer onto `src/timers.ts` fibers. This step makes the four request/response operations real Effects, which X6 and X7 will later expose.

### Verified facts (do not re-derive; line numbers are from main on 2026-10-09 15:00 UTC and move with merges, so find the code by name)
- **The maps** in `packages/xmpp-core/src/client.ts`: `pendingJoins`, `pendingQueries` and `pendingIqs` (around lines 269-271), whose entries hold `resolve`, `reject` and `cancel` (the `Cancel` from `timers.ts`).
- **The request functions:** `joinRoom` (around line 923), `loadHistory` (around 1026), `requestUploadSlot` (around 1066) and `setPushEnabled` (around 1109). Each one sets a map entry, schedules a timeout that rejects with a typed error (for example `JoinTimeout` or `HistoryTimeout`), sends the stanza, and rejects with `*SendFailed` when the send fails.
- **The stanza handlers** complete or fail the entries synchronously: around lines 758-766 (join presence), 788 (MAM results), 800-802 (IQ results) and 836-838 (the history fin). On disconnect, `rejectPendingIqs` fails every entry (around line 497).
- **The tests:** `core.test.ts`, `connection-resilience.test.ts`, `events.test.ts`, `presence.test.ts`, `stream-management.test.ts`, `mam.test.ts`, `errors.test.ts` and `timers.test.ts`. The integration tests run against local ejabberd with `ZILAR_XMPP_INTEGRATION=1`, which loads `infra/.env` (localhost only).
- **The rules:** `docs/EFFECT_GUIDE.md` (`timeoutOrElse`, line 165). Check the 4.0.2 `Deferred` API in `node_modules/effect/dist/Deferred.d.ts`, including how to complete a Deferred synchronously from a non-Effect callback (an unsafe or sync completion function).

### What to build
1. **The map entries become a `Deferred.Deferred<A, XmppCoreError>`**, plus whatever the handler needs (for example `messages` for MAM). The handlers complete or fail the Deferred synchronously. `rejectPendingIqs` fails them with the same typed errors as today.
2. **Each request becomes an Effect** (`joinRoomEffect`, `loadHistoryEffect`, `requestUploadSlotEffect`, `setPushEnabledEffect`): create the Deferred, put it in the map, send (`Effect.tryPromise`, mapping to the same `*SendFailed`), then `Deferred.await` with `Effect.timeoutOrElse` (the same timeout value and typed error). Remove the map entry with `Effect.ensuring`, on every path, including interruption. `timers.ts` is no longer needed for these four; keep it for the watchdog and keepalive.
3. **The Promise methods** run the Effects and reject with the **same error instances** (the typed errors from `errors.ts`, same message). Check how `Effect.runPromise` surfaces a failure in 4.0.2; existing tests assert the messages.
4. **The ordering is identical:** the entry is in the map before the stanza is sent, a result that arrives before the await is not lost (a Deferred keeps it), and a late result after a timeout is ignored as today.
5. **Tests:** every unit test passes unchanged; run the suite 3 times. Then run the four integration tests against the local dev ejabberd: `ZILAR_XMPP_INTEGRATION=1 ZILAR_XMPP_SM_DURATION_MS=15000 ZILAR_XMPP_SM_STANZAS=60 pnpm --filter @zilar/xmpp-core exec vitest run --reporter=dot src/integration.test.ts src/integration-edits.test.ts src/integration-invites.test.ts src/integration-sm.test.ts`. They passed 4 of 4 on main after X2a. Then run the consumers: the web store, the mobile store and the server gateway, with the commands in `work/T-0769-xmpp-timers-fibers.md`.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.1, `packages/xmpp-core/src/client.ts` (the whole file), `packages/xmpp-core/src/errors.ts`, `packages/xmpp-core/src/timers.ts`, `work/T-0769-xmpp-timers-fibers.md` (Report and Review).

### Allowed files
`packages/xmpp-core/src/client.ts`, `work/T-0777-xmpp-requests-deferred.md`.

### Checks
```bash
pnpm --filter @zilar/xmpp-core test --reporter=dot
pnpm gate
```
Also run the integration and consumer suites from step 5 and paste every count into the Report.

### Acceptance
- The four requests are Effects on Deferreds; no request uses `new Promise`, `schedule` or resolve/reject callbacks.
- Every unit, integration and consumer suite passes unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What changed (`packages/xmpp-core/src/client.ts` only)

- `PendingJoin`, `PendingQuery` and `PendingIq` now hold a `Deferred.Deferred<A, XmppCoreError>` (plus `iqId` and `messages` for MAM). `resolve`, `reject` and `cancel` are gone.
- **Handlers complete the Deferreds synchronously.** The join presence handler, the IQ handler (result and error), the history fin and `rejectPendingIqs` still delete the map entry first and then call `Deferred.doneUnsafe(entry.deferred, Effect.succeed(x) | Effect.fail(typedError) | Effect.void)`. `doneUnsafe` mutates the Deferred in the same call stack and returns `false` if it was already done, so a second reply is a no-op. A reply that arrives before the request awaits is kept by the Deferred.
- **Four Effects** (`joinRoomEffect`, `loadHistoryEffect`, `requestUploadSlotEffect`, `setPushEnabledEffect`, all `Effect.fnUntraced` with `Effect.fn.Return<_, XmppCoreError>`). Each does the same steps in the same order as before: online check (`requireOnlineEffect` fails with `NotOnline`), `NoIdentity` check, ids and stanza, `Deferred.makeUnsafe`, map entry set, then a shared `request(...)` helper.
- `request` forks the send as a child fiber with `Effect.forkChild({ startImmediately: true })` (`Effect.tryPromise` mapping to the same `*SendFailed`; `tapError` fails the Deferred), then `Deferred.await` under `Effect.timeoutOrElse` (same timeout constants, same typed timeout errors), wrapped in `Effect.ensuring` that removes the map entry only if it is still the same entry object.
- The Promise methods are `Effect.runPromise(xEffect(...))`. `requestUploadSlot` parses the slot after the await and fails `UploadSlotInvalid` (before, the handler did it); `setPushEnabled` ignores the stanza.
- `timers.ts` (`schedule`) is still used by the watchdog, keepalive and connect timeout; none of the four requests uses it.

### How error identity is kept through `runPromise`

In 4.0.2 `Effect.runPromise` rejects with `causeSquash(exit.cause)` (`internal/effect.js`), which returns the `Fail` reason's error as is. So the typed error instance created in the handler or the timeout (`JoinRejected`, `IqFailed`, `Disconnected`, `ConnectionFailed`, `*Timeout`, `*SendFailed`, `NotOnline`, `NoIdentity`, `UploadSlotInvalid`) reaches the caller unwrapped, same class, same `_tag`, same message. A thrown defect would also come out as the raw value.

### Deviations and judgement calls

- **The send is not awaited in sequence.** The spec says "send, then `Deferred.await`". Awaiting the send first would change behaviour in two ways: the timeout would not start until the send settled (a send that never settles would hang the request for ever), and a reply that arrived while the send promise was still pending would have to wait for it. So the send runs on a child fiber (started immediately, so the stanza still goes out before the caller's first await) and a send failure fails the Deferred, exactly like the old `.catch` handler. A send failure after a reply or a timeout is ignored as before.
- **Map entry removal checks identity.** The old timer did `pendingJoins.delete(key)` by key, so two joins of the same room and nick could remove each other's entry. The new `ensuring` deletes only when the map still holds that request's own entry. The handlers still delete synchronously, so a duplicate reply is ignored at once.
- If `current.send` throws synchronously (not a rejected promise), `Effect.tryPromise` now maps it to the `*SendFailed` error; before, it escaped the Promise executor as the raw error and left the entry and timer behind. The fake and real clients return promises, so no test exercises this.
- No existing test was changed, and no test was added (Allowed files are `client.ts` and this file). `requestUploadSlot` and the typed send-failure and timeout paths have no unit test in this package; I checked them with a throwaway script outside the repo (see below).

### Throwaway check (not committed, outside the worktree)

A script drove `createCore` with a fake client and checked `_tag` and exact message for: `NotOnline` (join, upload, history), a join that resolves while the send never settles, `JoinRejected`, `JoinSendFailed`, history ok / `HistoryFailed` / `HistorySendFailed`, upload ok / `UploadSlotInvalid` / `IqFailed` / `UploadSlotFailed`, push `Disconnected` (via `disconnect()`) / `PushToggleFailed`, the stanza sent synchronously during the call, and all four real timeouts (15 s, 30 s, 15 s, 15 s; elapsed 30008 ms for the longest) followed by late replies being ignored. All checks printed `ok`.

### Test counts (before on main, after this change)

| Suite | Before | After |
| --- | --- | --- |
| xmpp-core unit (`pnpm --filter @zilar/xmpp-core test --reporter=dot`) | 9 files + 4 skipped; 222 passed, 4 skipped | the same in all 3 runs |
| xmpp-core integration (4 files, local dev ejabberd, `ZILAR_XMPP_INTEGRATION=1`, SM 15000 ms / 60 stanzas) | 4 files, 4 tests passed | 4 files, 4 tests passed |
| web store (`pnpm --filter @zilar/web test --reporter=dot src/store`) | 10 files, 196 passed | 10 files, 196 passed |
| mobile store (`pnpm --filter @zilar/mobile test --reporter=dot src/store`) | 24 files + 1 skipped; 293 passed, 1 skipped | the same |
| server gateway (`pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway`) | 1 file, 168 passed | 1 file, 168 passed |

The integration tests need `infra/.env`, which is not in the worktree; I copied the local dev one from the main checkout (git-ignored, never printed, never committed).

### `pnpm gate`

```
gate: 1 changed file(s) against main
PASS  install (frozen)
PASS  format
PASS  lint
PASS  typecheck
PASS  effect
PASS  tests @zilar/xmpp-core
scope: every changed file is inside the Allowed files
GATE PASS
```

(The gate ran with `client.ts` as the only changed file; this task file was edited after and is an Allowed file.) `pnpm exec prettier --write` was run on `client.ts`.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Sonnet 5.5. The lead reviewed the Report and the diff.
- **The requests:** the four are Effects on Deferreds. Handlers complete them synchronously with `Deferred.doneUnsafe`, and `runPromise` rejects with the same typed error.
- **Deviations accepted:** the send runs on a child fiber, as the old Promise executor did; an entry is removed only if it is still the request's own; a synchronous send throw becomes `*SendFailed`.
- **All suites pass unchanged:** xmpp-core 3 runs, integration on local ejabberd 4 of 4, web store, mobile store, gateway.
- **The lead deleted the worker's copy of `infra/.env`.**
- **Follow-up:** unit tests for `requestUploadSlot` and the typed send-failure and timeout paths.
- **Before deploy:** Julio's live messaging check.
