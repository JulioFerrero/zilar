---
id: T-1143
title: "Native push 6/6 (mobile): a headless task handles the FCM wake — GET /api/push/preview, then a local notification on the 'messages' channel; tapping it opens /chat/[id]; no text ever comes through Google"
status: merged
milestone: M5
branch: task/T-1143-mobile-push-wake
model: auto
effort: default
depends_on: [T-1142]
estimate: 0.4 day
---

# T-1143: The phone shows the notification

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11: Android push through FCM, with no text in the push. This is the last Android piece (Task 6 of `docs/audit/native-push-plan.md` §7; **read §4.4 and §4.5**).

**The pieces this builds on:**
- **The wake (T-1135):** the server sends a data-only FCM message whose data is `{ chatId, messageId?, serverId }`.
- **The registration (T-1139):** the phone already registers for push after sign-in (`apps/mobile/src/lib/push/native.ts`, channel id `messages`).
- **The text (T-1142):** `GET /api/push/preview?messageId=` (contract `push.preview`, query `PushPreviewQuery`, success `PushPreview { title, body, chatId }` in `packages/api-contract/src/push.ts`) builds the title and body server-side with the Web Push rules (mute, private topics, "Show previews").
  - It answers **404** for anything the user can't see or that is muted.

**The lead's change to plan §4.4:** the app does **not** open an XMPP connection in the background. It makes that one HTTPS call.

**What the lead read:**
- **Packages:** `expo-notifications` and `expo-task-manager` are installed (T-1139, `apps/mobile/package.json`).
- **The root layout:** `apps/mobile/src/app/_layout.tsx` (88 lines) imports polyfills first (`:1-2`) and renders `<ChatStoreProvider><Stack/></ChatStoreProvider>` (`:80-82`). The app entry is `expo-router/entry` (`apps/mobile/package.json:5`); there is no `index.ts`.
- **Chat navigation:** `router.push({ pathname: '/chat/[id]', params: { id: chatId } })` (`apps/mobile/src/app/(tabs)/index.tsx:140`).
- **The API client pattern:** as in `apps/mobile/src/lib/push/native.ts` (`createApiClient` with `getSessionToken` and `API_URL`).

### What to build
1. **A new `apps/mobile/src/lib/push/background.ts`.** At module scope, `TaskManager.defineTask(WAKE_TASK, handler)` then `Notifications.registerTaskAsync(WAKE_TASK)` (best effort; catch and warn).
   - The handler ignores tap payloads (`'actionIdentifier' in data`).
   - It reads `chatId` and `messageId` from the FCM data. **Check the payload shape** against the SDK 57 type `NotificationTaskPayload` in `node_modules/expo-notifications` (for example, `data.data` versus a JSON string under `data.dataString`), handle the real shape, and write it in the Report.
   - Then it calls `onWake`.
2. **`onWake({ chatId, messageId })`,** exported and testable with injected deps:
   - with no session token (`getSessionToken()` is undefined), do nothing;
   - without a `messageId`, post a generic notification: title "Zilar", body "New message", `data: { chatId }`;
   - otherwise call `push.preview` with `{ messageId }`:
     - **200:** `Notifications.scheduleNotificationAsync({ content: { title, body, data: { chatId } }, trigger: null })` on the Android channel `messages`; check where SDK 57 takes the channel id;
     - **404:** nothing (muted, hidden or gone);
     - **network or 5xx error:** the generic notification above (the server already decided to wake this phone);
   - it never logs the title, the body or the token.
3. **Foreground:** when the app is open, the live chat already shows the message, so **don't post** a local notification. Check `AppState.currentState === 'active'` in `onWake` and skip.
4. **Tapping a notification:** add a small `NotificationRouter` component in `apps/mobile/src/app/_layout.tsx` (or in `apps/mobile/src/lib/push/tap.ts`, imported there).
   - On mount, `getLastNotificationResponseAsync()`, then `addNotificationResponseReceivedListener`.
   - Read `data.chatId` and call `router.push({ pathname: '/chat/[id]', params: { id: chatId } })`.
   - Navigate only when the session is authenticated (`useSession()` from `@/auth/session`).
5. **Registration:** import `@/lib/push/background` once at the top of `apps/mobile/src/app/_layout.tsx`, right after the polyfills, so the task is defined before any route. If you find the task must be defined in an entry file, say so in the Report; don't add one yourself.
6. **Mock mode:** define nothing, schedule nothing.
7. **Tests** (the message pipeline), in a new `apps/mobile/src/lib/push/background.test.ts`, with at most 4. Mock `expo-notifications`, `expo-task-manager` and the fetch.
   - A 200 preview schedules one notification with `{ title, body, data: { chatId } }`.
   - A 404 schedules none.
   - No session: no request and no notification.
   - Foreground: no notification.

### Read first
`AGENTS.md`, `docs/audit/native-push-plan.md` §4.4-4.5, `apps/mobile/src/lib/push/native.ts`, `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/app/(tabs)/index.tsx:130-145`, and `packages/api-contract/src/push.ts` (the `preview` endpoint). Also read the expo-notifications SDK 57 type declarations in the installed package (find them with `pnpm --filter @zilar/mobile exec node -p "require.resolve('expo-notifications')"`).

### Allowed files
`apps/mobile/src/lib/push/background.ts`, `apps/mobile/src/lib/push/background.test.ts`, `apps/mobile/src/lib/push/tap.ts`, `apps/mobile/src/app/_layout.tsx`, `work/T-1143-mobile-push-wake.md`.

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run src/lib/push/background.test.ts src/lib/push/native.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- `_layout.tsx` stays at most 400 lines.
- **Lead and Julio check after merge:** the APK on the vivo, with the app killed. A message from another account shows a notification with the sender and text (or "New message" when previews are off), and tapping it opens that chat.

---

## Report (written by the worker when done)

### What I did

Built the Android wake handler and tap router (plan §4.4-4.5, with the lead's
change: one HTTPS `push.preview` call, no background XMPP connection).

- **`apps/mobile/src/lib/push/background.ts`** (new): defines and registers task
  `zilar-background-notification` at module scope. The executor ignores tap
  payloads (`'actionIdentifier' in data`), parses the wake, calls `onWake`, and
  returns `BackgroundNotificationTaskResult.NoData`. `onWake(payload, deps)` is
  exported and takes injected `getToken` / `fetchImpl` / `apiUrl`; it skips in
  the foreground (`AppState.currentState === 'active'`) and in mock mode, does
  nothing without a session token, posts `Zilar` / `New message` without a
  `messageId`, and otherwise calls `client.push.preview`. A 404 posts nothing;
  any other failure (network, 5xx, expired session) falls back to the generic
  text. It never logs the title, body or token.
- **`apps/mobile/src/lib/push/tap.ts`** (new): `NotificationRouter` component.
  On mount (once authenticated) it reads `getLastNotificationResponseAsync()`,
  clears it, and subscribes to `addNotificationResponseReceivedListener`. It
  reads `data.chatId` and calls `router.push({ pathname: '/chat/[id]', params: { id: chatId } })`.
- **`apps/mobile/src/app/_layout.tsx`**: imports `@/lib/push/background` right
  after the polyfills (line 3) and renders `<NotificationRouter />` next to
  `<SessionBootstrap />`. Still ~90 lines (limit 400).
- **`apps/mobile/src/lib/push/background.test.ts`** (new): 4 tests.

### Findings the task asked me to report

- **FCM payload shape (SDK 57 `NotificationTaskPayload`)**: the non-tap member is
  `{ notification: Record<string,unknown> | null; data: { dataString?: string;
  [key: string]: unknown }; aps? }`
  (`node_modules/expo-notifications/build/Notifications.types.d.ts:747`). For a
  data-only FCM message the ids arrive as a JSON string under `data.dataString`,
  not as `data.data`. `parseWake` parses `data.dataString` when present and also
  accepts the keys sitting directly on `data`. A payload with no `chatId` is
  ignored.
- **Where SDK 57 takes the Android channel id**: *not* in the content. In SDK 57
  `NotificationContentInput` has no `channelId` field; the channel is the
  `trigger`, via `ChannelAwareTriggerInput = { channelId: string }`
  (`Notifications.types.d.ts:358`). `parseTrigger` accepts an object with only
  `channelId` and treats it as immediate (an object needs a `type` *or*
  `channelId`; `scheduleNotificationAsync.js:79`). So I used
  `trigger: { channelId: 'messages' }` instead of the spec sketch's
  `trigger: null` plus a channel in the content.
- **Mock mode**: gated on the build-time `EXPO_PUBLIC_ZILAR_MOCK=1` only
  (imported as `ENV_MOCK` from `@/mock/gate`). A background task has no route
  params, so the `?mock=1` half of `isMockMode` cannot apply; I did not include
  `NODE_ENV === 'test'` either, so the tests exercise the real path. With mock
  mode on, the module defines/registers nothing and `onWake` returns early.
- **Task registration location**: the plan noted the Expo doc suggests the entry
  file; this app is Expo Router (`expo-router/entry`, no `index.ts`). I imported
  the module from the root layout as the task specifies, which is evaluated
  before any route. Whether the task actually fires on a killed-app cold start is
  for the phone check (Acceptance), not verifiable here.

### Files changed

`apps/mobile/src/lib/push/background.ts`,
`apps/mobile/src/lib/push/background.test.ts`,
`apps/mobile/src/lib/push/tap.ts`,
`apps/mobile/src/app/_layout.tsx`,
`work/T-1143-mobile-push-wake.md`.

### Commands and real results

- `pnpm install` — done (peer-dependency warning for `@types/react-dom` only).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/push/background.test.ts src/lib/push/native.test.ts`
  — `Test Files 2 passed (2)`, `Tests 7 passed (7)`.
- `pnpm gate` (from repo root):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.0s)
  PASS  lint  (0.8s)
  PASS  typecheck  (2.1s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/mobile  (0.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes

- `trigger: { channelId: 'messages' }` instead of `trigger: null` (see the SDK 57
  finding above) — same effect: immediate delivery on the `messages` channel.
- `NotificationRouter` clears the last response after handling it, so a later
  mount does not reopen the same chat; the spec did not mention this step.
- The gate's Effect ratchet rejects a changed file that is `needs-effect`, so both
  new files use `Effect` for real (`onWake` runs `handleWake` best-effort through
  `Effect.tryPromise`; the tap read uses `Effect.tryPromise`/`tap`/`ignore`).
- `PushPreview.chatId` is not used for navigation; the notification's `data`
  carries the wake's `chatId`, which the tap opens.

### Open questions

- None blocking. The one thing I cannot verify from here is the phone Acceptance
  (killed app, notification shown, tap opens the chat) and that the headless task
  actually fires from the root-layout import on a cold start.

### Fix round (pre-review)

Three changes, one commit each:

- `55404309` — reworded the `WAKE_TASK` comment: the task is defined and
  registered in this module, not by `native.ts`.
- `48c1a56a` — a 200 preview now posts with the server's `preview.chatId` (the
  generic fallbacks still use `payload.chatId`). The 200 test gives the preview a
  different chatId from the wake (`preview-chat` vs `wake-chat`) and asserts
  `data: { chatId: 'preview-chat' }`, so it proves which one is used.
- `ef14c63f` — `tap.ts` now uses `useRootNavigationState()`: a cold-start tap is
  held in a ref and pushed only once `navigationState.key` is defined and the
  session is authenticated; live taps through the listener navigate as before.
  No test for this UI file.

Fix-round commands: `pnpm --filter @zilar/mobile exec vitest run
src/lib/push/background.test.ts src/lib/push/native.test.ts --reporter=dot` →
`Test Files 2 passed (2)`, `Tests 7 passed (7)`; `pnpm gate` → `GATE PASS`
(install, format, lint, typecheck, effect, tests all PASS; scope clean).

### Round (pre-review finding 1)

- **Finding 1 (should-fix) fixed, `1419089b6`:** the live-tap listener in
  `tap.ts` now returns early unless `status === 'authenticated'`, matching the
  cold-start push at `tap.ts:80`. The listener effect depends on `[status]`, so
  it (re)subscribes when the session becomes signed in and is removed while
  signed out — a tap on a lingering notification while signed out no longer
  pushes `/chat/[id]`.
- **Finding 2 (nit) not fixed:** it is a nit and lives in `background.ts`, a line
  this round does not change; per the fix-round instructions nits are left alone.
- **Tests added: none.** `tap.ts` is UI code, which `AGENTS.md` says gets no
  tests; the task's only test file is `background.test.ts` (Allowed files), and a
  new `tap.test.ts` would be outside the Allowed files.
- **Gate:** `GATE PASS` — install, format, lint, typecheck, effect, tests all
  PASS; scope clean (5 changed files, all inside the Allowed files). Single
  check: `pnpm --filter @zilar/mobile exec vitest run
  src/lib/push/background.test.ts src/lib/push/native.test.ts --reporter=dot
  --maxWorkers=2` → `Test Files 2 passed (2)`, `Tests 7 passed (7)`.

## Review (written by Claude)

**Lead, 2026-10-11: approved. It is clean after the lead's fix round and 1 auto round, with 1 nit.**
- **`lib/push/background.ts`:** a module-scope `defineTask` plus `registerTaskAsync` reads the FCM data from `data.dataString` (the SDK 57 shape, as the Report records).
  - `onWake`: no session → nothing; foreground or mock → nothing; no `messageId` → a generic "New message".
  - Otherwise `push.preview`: on 200 it posts the title and body on the server-resolved `preview.chatId`; on 404 nothing; on an error a generic notification. No text or token is logged.
- **`lib/push/tap.ts`:** a cold-start tap waits for `useRootNavigationState().key` and an authenticated session, through a pending ref. Live taps are also gated on the session. It opens `/chat/[id]`.
- **Tests:** the lead ran `background.test.ts` and `native.test.ts` on the branch: 7 green.
- **Not checked yet:** a killed-app wake on a real phone, which only Julio's vivo can show.
