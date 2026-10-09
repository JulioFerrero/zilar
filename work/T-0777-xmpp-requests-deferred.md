---
id: T-0777
title: "X2b: xmpp-core requests on Deferred — joinRoom, loadHistory, requestUploadSlot, setPushEnabled become Effects (Deferred.await + timeoutOrElse with the X1 typed errors, map entry removed in ensuring); the pendingJoins/pendingQueries/pendingIqs maps hold Deferreds completed synchronously by the stanza handlers; Promise methods unchanged; every test unchanged"
status: todo
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

## Review (written by Claude)
