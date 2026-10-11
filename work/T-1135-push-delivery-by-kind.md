---
id: T-1135
title: "Native push 3/6: delivery branches by device kind — a native (fcm) device gets a data-only, ids-only wake through an injected FcmSender; Web Push unchanged; row columns typed nullable"
status: merged
milestone: M5
branch: task/T-1135-push-delivery-by-kind
model: auto
effort: default
depends_on: [T-1132, T-1133]
estimate: 0.3 day
---

# T-1135: Delivery by device kind

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11: Android push through FCM, with no text in the push. This is Task 3 of `docs/audit/native-push-plan.md` §7 (read §3). T-1132 added the device kind (`kind`, `token`, `openNativeDevice`) and T-1133 added `createFcmSender` (`apps/server/src/push/fcm.ts`). The server wiring (`main.ts`) is Task 4, so **nothing changes live with this task**.

**What the lead read:**
- **`apps/server/src/push/delivery.ts`:**
  - `handleIncomingPush` (`:50-93`);
  - `openDeviceEffect` (`:95-103`), which maps any throw to `Undecryptable`;
  - `resolveAndSendEffect` (`:105-147`): open, then scan, then `showPreviewsForUser`, then `buildPushPayload`, then `sendPayloadEffect`, then `markNotified`;
  - `sendPayloadEffect` (`:149-182`): on `gone` it calls `removeDeviceByNode`, and on a throw `markDeviceFailed` then `SendFailed`.
- **`apps/server/src/push/service.ts:20-36`:** `PushServiceDeps` holds `config: ServerConfig` and `sender: WebPushDelivery`.
- **`apps/server/src/push/payload.ts`:** `ResolvedPushMessage` (`:21-31`, with `chatJid` and an optional `messageId`), and `buildPushPayload` (`:45-60`) with the mute and visibility guard at `:49-51`.
- **`apps/server/src/push/fcm.ts`:** `FcmWakeData { chatId, messageId, serverId }` and `FcmSender.send(token, data)`.
- **T-1132 follow-ups:**
  - **F1:** `apps/server/src/db/rows.ts:237-239` keeps `endpoint`, `p256dh` and `auth` typed `string`, although the DB now allows null.
  - **F2:** a native row would hit `openDevice` and be dropped as `undecryptable`.

### What to build
1. **`payload.ts`:** add `buildNativeWakePayload(message, input, serverId): FcmWakeData | undefined`.
   - It reuses the **same** mute and visibility guard as `buildPushPayload`: extract that guard into one small function both call.
   - It returns `{ chatId: message.chatJid, messageId, serverId }` and **never any text or sender name**.
   - If `message.messageId` is undefined, leave `messageId` out of the data. Make `messageId` optional in `FcmWakeData` (`apps/server/src/push/fcm.ts`) and leave it out of the JSON body when absent.
2. **`service.ts`:** `PushServiceDeps` gains `nativeSender?: FcmSender`, an optional field. Task 4 fills it from the config.
3. **`delivery.ts`:** branch on `device.kind` **after the scan**, so mute, visibility, dedupe and `markNotified` stay shared.
   - **`webpush`:** exactly today's path, with `openDevice`, `buildPushPayload` and `sendPayloadEffect`. The `openDevice` call moves after the kind check; it still maps a throw to `Undecryptable`.
   - **`fcm`:**
     - `openNativeDevice`, then `buildNativeWakePayload(newest.message, { muted: false, visible: true, showPreviews }, deps.config.xmpp.domain)`, then `deps.nativeSender.send(token, data)`;
     - the same `gone` handling (`removeDeviceByNode`) and the same failure handling (`markDeviceFailed`, then `SendFailed`) as `sendPayloadEffect`;
     - share that `try`/`gone`/`failed` block between both kinds instead of copying it.
     - If `deps.nativeSender` is undefined, log `{ userId, deviceId }` with "native push not configured" and return `dropped(device, 'send-failed')`.
   - **`apns`:** no sender yet. Use the same not-configured drop.
   - The server id is `deps.config.xmpp.domain`, the same value `apps/server/src/push/api-subscribe.ts:59` uses.
4. **`rows.ts` (F1):** type `endpoint`, `p256dh` and `auth` as `string | null`, and `kind` as `PushDeviceKind`. Fix the compile errors this causes:
   - `openDevice` in `apps/server/src/push/store.ts` throws on a null column, so the row becomes `Undecryptable`;
   - `toPushDeviceView` and `apps/server/src/push/api-handlers.ts` handle null without changing what a Web Push row returns.
5. **Logs:** ids only (`userId`, `deviceId`); never a token, endpoint or key.
6. **Tests** (the message pipeline), in a new `apps/server/src/push/delivery.test.ts`, with at most 5 tests:
   - an fcm device sends `{ chatId, messageId, serverId }` and no text through a fake `nativeSender`;
   - a webpush device still goes through `sender` with today's payload;
   - a muted scan result drops before either sender is called;
   - an fcm `{ gone: true }` removes the device;
   - an fcm device with no `nativeSender` drops as `send-failed`.

   **How to test:**
   - If driving `handleIncomingPush` needs the MAM archive, export the post-scan step (for example `deliverToDevice(deps, device, newest, notifyIds)`) and test that, with fake senders and the test DB used by `apps/server/src/push/store.test.ts`.
   - Also run `apps/server/src/push/fcm.test.ts`, `store.test.ts` and `candidates.test.ts`. Edit only an `fcm.test.ts` expectation if the optional `messageId` change needs it.

### Read first
`AGENTS.md`, `docs/audit/native-push-plan.md` §3, `apps/server/src/push/delivery.ts`, `apps/server/src/push/payload.ts`, `apps/server/src/push/service.ts`, `apps/server/src/push/fcm.ts`, `apps/server/src/push/store.ts` and `apps/server/src/push/store.test.ts`.

### Allowed files
`apps/server/src/push/delivery.ts`, `apps/server/src/push/delivery.test.ts`, `apps/server/src/push/payload.ts`, `apps/server/src/push/service.ts`, `apps/server/src/push/fcm.ts`, `apps/server/src/push/fcm.test.ts`, `apps/server/src/push/store.ts`, `apps/server/src/push/api-handlers.ts`, `apps/server/src/db/rows.ts`, `work/T-1135-push-delivery-by-kind.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push/delivery.test.ts src/push/fcm.test.ts src/push/store.test.ts src/push/candidates.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- `delivery.ts` stays at most 400 lines.
- A Web Push row's API view and payload are unchanged.

---

## Report (written by the worker when done)

### What I did
1. **`payload.ts`** — extracted the mute/visibility rule into one `passesFilters(input)` both payload builders call. Added `buildNativeWakePayload(message, input, serverId)`: returns ids only (`chatId`, optional `messageId`, `serverId`), never text or sender name, and leaves `messageId` out of the object when the message has none.
2. **`fcm.ts`** — `FcmWakeData.messageId` is now optional and `fcmMessageBody` omits the key when it is absent.
3. **`service.ts`** — `PushServiceDeps.nativeSender?: FcmSender` (optional; Task 4 fills it from config).
4. **`delivery.ts`** — split the post-scan half into the exported `deliverToDevice(deps, device, scan)`. It branches on `device.kind` after the scan: `webpush` keeps today's `openDevice` → `buildPushPayload` → send; `fcm` opens with `openNativeDevice`, builds the wake with the same filter and `deps.config.xmpp.domain`, and sends through `deps.nativeSender`; `apns` and an unconfigured `fcm` log ids only ("native push not configured") and drop as `send-failed`. The `gone`/`failed` block is shared by both kinds (`sendWithCleanupEffect`), so `markDeviceFailed`/`removeDeviceByNode` cannot drift. Mute, visibility, dedupe and `markNotified` stay shared and run only after a successful send.
5. **F1 (`rows.ts`)** — `endpoint`, `p256dh`, `auth` are now `string | null` (`kind` was already `PushDeviceKind`). `store.ts` `openDevice` throws on a null column (mapped to `Undecryptable` by the caller); `api-handlers.ts` maps a non-Web-Push row to the same 410 `device_gone` on the test-send route. `toPushDeviceView` never read those columns, so it needs no change; Web Push rows return exactly what they did.
6. **`delivery.test.ts`** (new) — 5 tests: fcm ids-only wake; webpush unchanged payload; muted scan drops before either sender; fcm `{ gone: true }` removes the device; fcm with no `nativeSender` drops as `send-failed`.

### Files changed
`apps/server/src/push/delivery.ts`, `apps/server/src/push/delivery.test.ts` (new), `apps/server/src/push/payload.ts`, `apps/server/src/push/service.ts`, `apps/server/src/push/fcm.ts`, `apps/server/src/push/store.ts`, `apps/server/src/push/api-handlers.ts`, `apps/server/src/db/rows.ts`, `work/T-1135-push-delivery-by-kind.md`.

### Commands and results
- `pnpm install`: completed in 14s, no errors.
- `pnpm --filter @zilar/server exec vitest run src/push/delivery.test.ts src/push/fcm.test.ts src/push/store.test.ts src/push/candidates.test.ts --maxWorkers=2 --reporter=dot`: **4 files / 21 tests passed**.
- `pnpm gate` (repo root): **GATE PASS**. Summary lines:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (0.7s)
  PASS  lint  (1.0s)
  PASS  typecheck  (4.1s)
  PASS  effect  (1.0s)
  PASS  tests @zilar/server  (11.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The first gate run failed on `format` for `delivery.test.ts`; I ran `prettier --write` on only my changed files and the re-run passed.

### Acceptance
- Checks pass; `delivery.ts` is 265 lines (limit 400).
- Web Push payload/API view unchanged (asserted by the webpush test and the untouched `toPushDeviceView`).

### Deviations from the spec
- The spec's example signature was `deliverToDevice(deps, device, newest, notifyIds)`. I pass the scan-shaped result instead ("ScanResult" = `{ newest, notify, saw }`) so the required "muted scan result drops before either sender is called" test can drive the drop without the MAM archive. Everything else follows the spec.
- `fcm.test.ts` needed no edit: its case still carries `messageId`, so the expectation is unchanged. The omit-when-absent path is produced by `buildNativeWakePayload` (tested) and `fcmMessageBody` (not separately asserted).

### Blocked / needs a decision
None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **`delivery.ts` (265 lines):** the post-scan step is the exported `deliverToDevice`.
  - **webpush:** `openDevice`, then `buildPushPayload`, then `sender.send`, as before.
  - **fcm:** `openNativeDevice`, then `buildNativeWakePayload` (ids only: `chatId`, `messageId` when present, `serverId = config.xmpp.domain`), then `nativeSender.send`.
  - **apns, or no sender:** dropped as `send-failed`, logging ids only.
  - Both kinds share `sendWithCleanupEffect` (on `gone`, remove the device; on a throw, `markDeviceFailed` then `SendFailed`).
- **`payload.ts`:** one `passesFilters` guard is shared by both builders.
- **`rows.ts`:** the Web Push columns are now typed nullable (T-1132 F1).
- **Accepted change:** the Web Push device is now opened after the archive scan. An undecryptable row still drops, only after the scan.
- **Tests:** the lead ran the four push test files on the branch: 21 green.
- **Still not wired** (`main.ts` is Task 4), so nothing changes live.
