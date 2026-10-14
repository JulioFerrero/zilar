---
id: T-1358
title: "Android: a push wake reaches the app (it fetches the preview) but no notification is ever shown — find why the background task's scheduleNotificationAsync never posts, fix it, and show the 'Send test' notification even with the app closed"
status: merged
milestone: M5
branch: task/T-1358-android-wake-shows-nothing
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1358: Wake shows no notification

## Spec (written by Claude, do not edit)

### Why
The lead's live evidence on Julio's phone (vivo V2454A, Android 16, build `86647e0f`), 2026-10-14:
- **Wakes reach the app and it acts on them.** Play Services logged pushes for `app.zilar.chat` at 11:52:13 (retried until 12:22:42) and at 12:24:53, and at those exact times (10:22:43Z and 10:24:54Z) the server logged `GET /api/push/preview` from the app, so the background handler ran and fetched the preview.
- **But Android has never shown a Zilar notification:**
  - `dumpsys notification` shows all four app channels (`direct-messages`, `groups`, `channels`, and the deleted legacy `messages`) with `mLastNotificationUpdateTimeMs=0`;
  - the notification permission is granted, the channels are importance HIGH, and background power is allowed.
- **"Send test" at 12:34:53** (app in the foreground) also showed nothing.

The code:
- `apps/mobile/src/lib/push/background.ts` (243 lines): `parseWake` (`:67-93`); `post()` (`:96-105`), which calls `Notifications.scheduleNotificationAsync({ content, trigger: { channelId } })`; `postTest()` (`:111-118`); the task `zilar-background-notification` (`TaskManager.defineTask` `:204`, `Notifications.registerTaskAsync` `:216`);
- channels: `apps/mobile/src/lib/push/channels.ts`; registration and channel creation: `apps/mobile/src/lib/push/native.ts:175-200`;
- the `expo-notifications` version is in `apps/mobile/package.json` (SDK 57).

### What to do
1. **Find the failure.** Check, and cite the `expo-notifications` source for SDK 57 (`node_modules/expo-notifications/android/...`):
   - whether a `trigger: { channelId }` without a `type` and without `seconds` is treated as "present now" or rejected;
   - whether the foreground notification handler (`Notifications.setNotificationHandler`; find it and cite it) suppresses it (`shouldShowBanner` / `shouldShowList` false while the app process counts as foreground during a headless task);
   - whether the headless task can call `scheduleNotificationAsync` at all;
   - whether any exception is swallowed (log it with `console.warn` so `adb logcat ReactNativeJS` shows it).
2. **Fix it** so that:
   - a wake shows one notification on the right channel, with the app killed, in the background, or in the foreground but outside that chat;
   - "Send test" shows its notification even in the foreground;
   - with the app open on that chat, nothing is shown (existing rule; keep it if present).
   - Use `trigger: null` (immediate) with the channel set the way SDK 57 expects, if that's the fix.
3. **Logging:** one `console.warn` line per failed post. No tokens or message text in logs.
4. **Tests:** there are existing tests in `apps/mobile/src/lib/push/background.test.ts`. Update them only where the call shape changes. No new UI tests. Every file stays at most 400 lines.

### Read first
`AGENTS.md`, `apps/mobile/src/lib/push/background.ts`, `apps/mobile/src/lib/push/native.ts`, `apps/mobile/src/lib/push/channels.ts`, `apps/mobile/src/lib/push/background.test.ts`, the expo-notifications docs for SDK 57 (scheduling and Android channels).

### Allowed files
`apps/mobile/src/lib/push/*.ts`, `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/app/settings/notifications.tsx`, `work/T-1358-android-wake-shows-nothing.md`.

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run src/lib/push/background.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on Julio's phone over adb:**
  - "Send test" shows a notification;
  - a channel post with the app killed shows one (logcat clean, no swallowed error).

---

## Report (written by the worker when done)

**Root cause: the foreground notification handler, not the trigger.** `scheduleNotificationAsync` posts the notification; the exclusions in our TS then throw it away.

1. **`trigger: { channelId }` is *not* rejected — it is "present now".** JS `parseTrigger` (`node_modules/expo-notifications/build/scheduleNotificationAsync.js`: `hasValidTriggerObject` accepts `type` *or* `channelId`; the android fallback returns `{ type: 'channel', channelId }`) → native `NotificationScheduler.triggerFromParams` maps `"channel"` to `ChannelAwareTrigger` (`android/.../notifications/scheduling/NotificationScheduler.kt`, the `"channel" ->` branch) → `ExpoSchedulingDelegate.scheduleNotification` calls `NotificationsService.receive(...)` at once for a `ChannelAwareTrigger` (`android/.../service/delegates/ExpoSchedulingDelegate.kt:44-60`). So the channel-aware immediate trigger works; `trigger: null` would **lose** the channel (SDK 57's `NotificationContentInput` has no `channelId`, and `BaseNotificationBuilder.channelId` falls back to a generic channel when the trigger is null). I therefore did **not** switch to `trigger: null` (deviation from the spec's conditional hint — see below).
2. **Where it is dropped:** when the OS asks the app's handler, our handler returned `shouldShowBanner: false, shouldShowList: false` for every non-test post. Native maps that to `NotificationBehaviorRecord.shouldPresentAlert = false` (`android/.../notifications/model/NotificationBehaviorRecord.kt`), and `ExpoPresentationDelegate.presentNotification` returns early without posting (`.../service/delegates/ExpoPresentationDelegate.kt`). `ExpoHandlingDelegate.handleNotification` consults the handler **whenever `isAppInForeground()`** (`.../service/delegates/ExpoHandlingDelegate.kt:129-137`), and a data-only FCM wake always runs the task (`FirebaseMessagingDelegate.onMessageReceived` → `runTaskManagerTasks`), so a wake that runs while the app process is up was silently suppressed. This matches the live evidence exactly: the task ran and fetched `GET /api/push/preview`, but no notification was ever presented (all channels `mLastNotificationUpdateTimeMs=0`).
3. The old guard `AppState.currentState === 'active'` (`background.ts:181` before this change) is a coarse proxy for "the app is open", and it is evaluated in the wake's own JS context, which can be a headless one while the app is on screen. It could not tell "open on that chat" (silent) from "open elsewhere" (must show) — the exact split the spec asks for.

### What I did
- **`apps/mobile/src/lib/push/background.ts`**
  - `post`/`postTest` now go through a small `schedule()` helper that catches a failed post and logs **exactly one** `console.warn('native push: the notification could not be posted', error)` — with no title, body or token, so a silent rejection now appears in `adb logcat ReactNativeJS`. The trigger stays `{ channelId }` (correct SDK 57 immediate channel form, cited above).
  - The wake is dropped **only for the chat the app currently has open** (`getActiveChatId() === payload.chatId`), not for every foreground state; the test wake is always posted. No more `AppState` read.
  - `setNotificationHandler` now presents a post unless it is for the open chat (`shouldShowBanner/shouldShowList = notificationChatId !== getActiveChatId()`). A post with no `chatId` (the test wake) always shows.
  - Removed the now-unused `isTestWake` helper (its identifier `TEST_WAKE_IDENTIFIER` stays on the test post).
- **`apps/mobile/src/lib/push/active-chat.ts`** (new): a tiny module-level mirror (`setActiveChatId`/`getActiveChatId`) that the headless context can read.
- **`apps/mobile/src/app/_layout.tsx`**: a `ActiveChatSync` component inside `ChatStoreProvider` mirrors the store's `activeChatId` into that module, so "open on that chat" is accurate and not an `AppState` guess.
- **`apps/mobile/src/lib/push/background.test.ts`**: the foreground test now sets the open chat (`setActiveChatId('chat-1')`) and asserts no fetch and no post; added "posts a wake for the foreground when another chat is open"; the test-wake test now sets an open chat and still expects the post.

### Commands and real results
- `pnpm install`: done.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/push/background.test.ts`: **7 passed, 0 failed** (1 file).
- `pnpm gate` (repo root): first run failed only on `format` (`background.test.ts`); I ran `pnpm exec prettier --write` on that one file, then re-ran the gate:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.1s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/mobile  (1.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- Single tests run while working: only `background.test.ts` above. No `npx`, no `--force`.

### Deviations / problems
- **Did not use `trigger: null`.** The spec said to use it "if that's the fix"; it is not. `{ channelId }` is already immediate in SDK 57 and is the only way to target a channel (content has no `channelId`). Switching to `trigger: null` would drop the per-kind channel and fall back to a generic one, which fails "on the right channel".
- **Killed case not verified here.** I could not run the phone. My change makes a wake that reaches the app robust (it is no longer suppressed by the handler), and the new `console.warn` will now surface a rejected post in logcat. If a killed-app wake still shows nothing with an empty logcat, the remaining suspect is the phone-side delivery, not the TS: T-1356 recorded Play Services `No response to broadcast from app.zilar.chat … time=2ms` (vivo autostart on a cold process), and T-1357 has the server not publishing for a *pending* XMPP session — both outside this task's Allowed files.
- **Cross-context race (pre-existing).** When the app is foreground the OS consults the JS handler; if the wake happens to run in a headless context (whose `getActiveChatId()` is `null`) and its handler answers before the main one, a wake for the open chat could still show. In the observed case the task runs in the main context (T-1215 logcat), where the open chat is known. I chose not to touch this further.
- `"Send test"` needs no change: the test post carries no `chatId`, so the new handler always presents it.

### Security checklist
- No secrets, tokens or message text in logs; the new warn logs only the error object. No DB writes/deletes, no routes, no audit entries in this change.

## Review (written by Claude)

**Lead, 2026-10-14: approved. Pre-review clean (3 nits, 1 follow-up); the packet is current for `62c751dc`.**
- **The cause matches the live evidence:** the wake ran (`/api/push/preview` was fetched) but no channel ever posted. The handler's `shouldShowBanner/List: false` while the process was up dropped every post.
- **Kept `{ channelId }`,** with SDK 57 source cited; the reasoning is sound.
- **F1** (a wake in a headless context while that chat is open may still show) is minor: at worst one extra banner. Track it only if Julio sees it.
- **Still to do:** phone check over adb when Julio is back.
