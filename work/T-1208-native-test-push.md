---
id: T-1208
title: "T-1206 follow-up: 'Send test notification' works on a phone — the push test route (POST /push/test) sends a data-only FCM test wake to a native device (instead of answering 410), and the mobile background handler shows 'Push notifications work on this device.' for that wake"
status: merged
milestone: M5
branch: task/T-1208-native-test-push
model: auto
effort: default
depends_on: [T-1206]
estimate: 0.3 day
---

# T-1208: The test push reaches a phone

## Spec (written by Claude, do not edit)

### Why
T-1206 added Settings → Notifications on mobile, with a "Send test notification" button calling `push.test`. Its pre-review found that **`POST /push/test` (contract `packages/api-contract/src/push.ts:161`, under the `/api` prefix) answers 410 `device_gone` for every native (FCM) device**: `apps/server/src/push/api-handlers.ts:253-264` throws for a row without Web Push columns. So the button always shows the error sentence on a phone.
- **The native sender exists,** but only for the push component: `createNativeSender(push, logger)` (`apps/server/src/push/native-sender.ts:17-31`), built at `apps/server/src/main.ts:496`. It returns `undefined` without the FCM config.
- **FCM messages are data-only:** `FcmSender.send(token, data: FcmWakeData)`, where `FcmWakeData = { chatId; messageId?; serverId }` (`apps/server/src/push/fcm.ts:10-18`).
- **The phone draws the notification itself:** `apps/mobile/src/lib/push/background.ts:73-110` (`post`, `handleWake`) parses the wake at `:50-71`. A wake without a `messageId` posts the generic text.
- **The push API's deps:** `PushRoutesDependencies` (`apps/server/src/push/api.ts:50-62`) already carries `push: PushConfig` and `logger`. It's built at `apps/server/src/app.ts:370-378`.
- **Sizes:** `app.ts` (583) and `main.ts` (723) are over 400 lines and must not grow.

### What to build
1. **Server, `push/api.ts`:** add an optional `nativeSender?: FcmSender` to the deps, for tests to inject. When it's absent, build one once with `createNativeSender(deps.push, deps.logger)`. Don't change `app.ts` or `main.ts`.
2. **Server, `push/api-handlers.ts`,** the test handler, for a native row (`token` set, no Web Push columns; check the row shape in `apps/server/src/db/rows.ts`):
   - with a native sender: send `{ chatId: 'zilar:test', serverId: <the same serverId the component wakes use; find it and cite it> }`;
   - on `{ gone: true }`, delete the device the way the Web Push path does (scoped by id and user id), then answer 410;
   - on any other failure, answer the way the existing Web Push failure path in this handler does (stamp `failed_at`), with the same error code;
   - without a native sender (no FCM config), answer 503 with a clear code (for example `push_unavailable`; use the error codes the push routes already use, in `api-handlers.ts`);
   - Web Push rows are unchanged.
3. **Mobile, `lib/push/background.ts`:** a wake whose `chatId` is `'zilar:test'` posts the title "Zilar" and the body "Push notifications work on this device.", with `data: {}` and **no `chatId`**, so tapping it opens the app without opening a chat. Check that `tap.ts` ignores a missing `chatId`.
4. **Tests** (push is the message pipeline), 2, in the nearest push API test (find it, for example `apps/server/src/push/api-subscribe.test.ts` or a handlers test; cite which):
   - (a) a native device's test calls the injected `nativeSender.send` once with `chatId: 'zilar:test'`, and answers with the same success status the existing handler returns (`api-handlers.ts`, after the send);
   - (b) a `{ gone: true }` answer deletes the row and answers 410.

### Read first
`AGENTS.md`, `apps/server/src/push/api.ts`, `apps/server/src/push/api-handlers.ts:200-302`, `apps/server/src/push/native-sender.ts`, `apps/server/src/push/fcm.ts`, `apps/server/src/push/service.ts` and `apps/server/src/push/payload.ts:80-95` (how the component wakes a native device, and where `serverId` comes from), `apps/mobile/src/lib/push/background.ts` and `apps/mobile/src/lib/push/tap.ts`.

### Allowed files
`apps/server/src/push/api.ts`, `apps/server/src/push/api-handlers.ts`, `apps/server/src/push/api-subscribe.test.ts`, `apps/server/src/push/api-test.test.ts`, `apps/mobile/src/lib/push/background.ts`, `apps/mobile/src/lib/push/tap.ts`, `work/T-1208-native-test-push.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push/api-subscribe.test.ts --reporter=dot
pnpm gate
```
Run the test file you add or extend instead, if it's `api-test.test.ts`.

### Acceptance
- The Checks pass.
- Every touched file stays at most 400 lines; `app.ts` and `main.ts` are unchanged.
- **The lead's check after deploy:** the push test route still works for a browser device (Web Push). The phone check comes with the next APK.

---

## Report (written by the worker when done)

### What I did
- Server (`apps/server/src/push/api.ts`): added optional `nativeSender?: FcmSender` to `PushRoutesDependencies`, for tests to inject. `createPushGroupLayer` (`apps/server/src/push/api-handlers.ts`) uses `deps.nativeSender` when present, otherwise builds one once with `createNativeSender(deps.push, deps.logger)`.
- Server (`apps/server/src/push/api-handlers.ts`, the `test` handler): a native row (`token` set, `PushSubscriptionRow` in `apps/server/src/db/rows.ts:232-245`) now sends `{ chatId: 'zilar:test', serverId: deps.config.xmpp.domain }` — the same `serverId` the component wakes use (`delivery.ts:197`, `config.xmpp.domain`). `{ gone: true }` deletes the row scoped by id AND user id (`removeDevice`, same as the Web Push expired path) then answers 410 `device_gone`. Any other failure stamps `failed_at` (`markDeviceFailed`) and answers 502 `push_failed`, exactly like the Web Push failure path. No native sender (no FCM config) answers 503 `push_unavailable`. Web Push rows are unchanged (the native branch returns before the Web Push block).
- Mobile (`apps/mobile/src/lib/push/background.ts`): a wake with `chatId === 'zilar:test'` posts title "Zilar", body "Push notifications work on this device.", `data: {}`, no `chatId`, so tapping it opens the app without opening a chat. `tap.ts` already ignores a missing `chatId` (`chatIdFrom` returns `undefined` for a non-string, both listeners only navigate when defined) — no change needed there.
- Tests (`apps/server/src/push/api-subscribe.test.ts`, the nearest push-route test with full route coverage): (a) a native device's test calls the injected `nativeSender.send` once with `{ chatId: 'zilar:test', serverId }` and answers 200 `{ sent: true }`; (b) a `{ gone: true }` answer deletes the row and answers 410 `device_gone`.
- Wiring note: `createApp` (`apps/server/src/app.ts`) is unchanged. No passthrough was needed: the tests build `createPushApi` directly (see scope note).

### Files changed
- `apps/server/src/push/api.ts` (+4): `nativeSender?: FcmSender` dep + import.
- `apps/server/src/push/api-handlers.ts` (+53): exported `TEST_WAKE_CHAT_ID = 'zilar:test'`, lazy `createNativeSender` fallback, native branch in the `test` handler.
- `apps/server/src/push/api-subscribe.test.ts` (+141): `POST /api/push/test on a native device` describe with the 2 spec tests (push API built directly with `createPushApi`, handler called per `files/routes.test.ts:166-188`).
- `apps/mobile/src/lib/push/background.ts` (+19): `TEST_WAKE_CHAT_ID`/`TEST_WAKE_BODY` consts, `postTest()`, early branch in `handleWake`.
- `work/T-1208-native-test-push.md`: Report + status. (`apps/server/src/app.ts` unchanged; `main.ts` unchanged.)

### Commands and real results
- `pnpm install`: Done in 9.8s (pnpm v10.32.1).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/api-subscribe.test.ts`: 1 file passed, 6 tests passed (4 existing + 2 new), ~3.5-4.4s.
- `pnpm gate` (from repo root, after prettier --write on the test file): `gate: 6 changed file(s) against main` / PASS install (1.1s) / PASS format (1.0s) / PASS lint (0.8s) / PASS typecheck (2.5s) / PASS effect (0.5s) / PASS tests @zilar/mobile (1.0s) / PASS tests @zilar/server (12.5s) / `migration: every added migration continues from the base` / GATE PASS. Note: the gate's "6 changed files" count and its `scope: 1 file(s) outside the Allowed files: apps/server/src/app.ts` line are both computed against `main`, where another worker's T-1209 commit (`eea674e22`) has since landed. `git diff main --stat -- apps work/T-1208-native-test-push.md` shows only my 5 files (background.ts, api-handlers.ts, api-subscribe.test.ts, api.ts, the task file); `git diff main -- apps/server/src/app.ts` is empty (0 lines, 583 lines unchanged). The T-1209 task-file deletion and BOARD.md row in the gate's file list belong to that other worker's landed commit, not to my branch.

### Scope note (fix round)
`apps/server/src/app.ts` is fully reverted (583 lines, zero diff against main, verified with `git diff main -- apps/server/src/app.ts` = empty). The two new tests now build the push API directly with `createPushApi({ ..., nativeSender: fake })` and call `api.handler(new Request(...))`, following `apps/server/src/files/routes.test.ts:166-188` (which builds `createFilesApi` and calls `api.handler(new Request(url, init))`). The full `createApp` is still used for sign-up and the subscribes (they need the auth routes); only the `POST /push/test` calls go through the directly-mounted push API. No production file outside the Allowed list is touched.

### Problems / deviations
- `apps/mobile/src/lib/push/tap.ts` is listed in Allowed but needed no change: verified `chatIdFrom` + both listeners already ignore a missing `chatId`. Left untouched.
- No `api-test.test.ts` exists; the tests went into `apps/server/src/push/api-subscribe.test.ts` as the spec's first suggestion.
- Line counts: `api.ts` 123, `api-handlers.ts` 355, `api-subscribe.test.ts` 292, `background.ts` 173, `tap.ts` 96 (unchanged), `app.ts` 583 (unchanged), `main.ts` unchanged.

### Security checklist
- The token is never logged (only passed to `nativeSender.send`, same as the component path); logs carry ids only.
- The `gone` delete is scoped by id AND user id (`removeDevice(db, user.id, target.id)`); the unknown-id 404 precedes it, so ids cannot be probed.
- No new route; the test route keeps its 5-per-10-min limiter and full requirePush/decode/limiter/device order.
- No secrets, no new deps, no effect-before-permission-check change.

## Review (written by Claude)

**Lead, 2026-10-12: approved, after 1 lead round. The pre-review is clean.**
- **The push test route** sends a native device a data-only FCM wake, `{ chatId: 'zilar:test', serverId }`, through an optional injected `nativeSender`, or one built once with `createNativeSender`.
  - `{ gone: true }` deletes the row, scoped by id and user, and answers 410;
  - any other failure stamps `failed_at`;
  - without FCM config it answers 503.
  - Web Push rows are unchanged.
- **Mobile:** `background.ts` turns that wake into a local "Push notifications work on this device." notification with no `chatId`, so tapping it opens no chat.
- **The lead's round:** the `app.ts` passthrough was reverted (583 lines, it must not grow). The new tests build `createPushApi` directly.
- **Tests:** push `api-subscribe` 6 of 6, run by the lead.
- **Still to do:** the phone check with the next APK (Settings → Notifications → Send test).
