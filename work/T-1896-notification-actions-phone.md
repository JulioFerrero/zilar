---
id: T-1896
title: "Notification Reply / Mark as read, phone (plan task 3): a 'message' category with a Reply text action and a Mark as read action (both opensAppToForeground: false), posted on every chat notification with messageId + archiveId in its data; the wake task handles the action — Reply calls POST /chats/:jid/reply with a fresh clientId (one retry on 409), Mark as read calls PUT /chats/:jid/read with archiveId + displayed — then dismisses the notification"
status: merged
milestone: M5
branch: task/T-1896-notification-actions-phone
model: auto
effort: default
depends_on: [T-1889, T-1893]
estimate: 45 min
---

# T-1896: Reply and Mark as read on phone notifications (plan task 3)

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/notification-actions.md` §1 and §6 task 3** (Julio approved it on 2026-10-17). The server routes are merged:
- `POST /api/chats/:jid/reply` (T-1889);
- `PUT /api/chats/:jid/read` with `displayed`, plus the preview's `archiveId` (T-1893).

Now the Android notification gets the two actions, and the headless task handles them without opening the app.

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/lib/push/background.ts`** (258 lines):
  - `post(title, body, chatId, chatKind)` schedules `{ content: { title, body, data: { chatId } }, trigger: { channelId } }` (`:122-134`);
  - `handleWake` fetches `client.push.preview({ query: { messageId } })` and then calls `post` (`:154-180`); the preview is typed `{ title, body, chatId }`;
  - `WakeDeps` is `{ getToken?, fetchImpl?, apiUrl? }` (`:57-61`), and `createApiClient(deps)` builds the typed client;
  - the task (`:226-235`) returns early for any payload with `actionIdentifier`, assuming taps only reach `tap.ts`.
- **The library (plan §1, sourced from expo-notifications 57):**
  - on Android the registered task also runs for a notification **action** tap when the app is backgrounded or killed. The payload is a `NotificationResponse` with `actionIdentifier`, `notification` and, for a text action, `userText`;
  - `setNotificationCategoryAsync(id, actions)` stores the actions, and `categoryIdentifier` in the content attaches them on Android;
  - every action must set `opensAppToForeground: false` explicitly (the default is true);
  - `Notifications.DEFAULT_ACTION_IDENTIFIER` is a plain tap, which stays with `tap.ts`;
  - `Notifications.dismissNotificationAsync(identifier)` removes one.
- **`crypto.randomUUID`** is polyfilled before the task module loads (`apps/mobile/index.ts:3-4`, `apps/mobile/src/lib/polyfills.ts`).
- **The contract endpoints** (`packages/api-contract/src/chats.ts`):
  - `chats.reply`: params `{ jid }`, payload `{ clientId, text }`; 204, 409 `reply_in_flight`, 404, 429, 503;
  - `chats.markRead`: params `{ jid }`, payload `{ messageId: archiveId, displayed?: originId }`.

  Path params are URI-encoded the same way other phone calls encode a JID (find an existing `params: { jid` call in `apps/mobile/src` and copy it).

### Steps
1. **New `apps/mobile/src/lib/push/actions.ts`:**
   - `export const MESSAGE_CATEGORY = 'message'`;
   - `export const REPLY_ACTION = 'reply'` and `READ_ACTION = 'read'`;
   - `export async function registerMessageCategory()`: `setNotificationCategoryAsync(MESSAGE_CATEGORY, [...])` with:
     - `{ identifier: REPLY_ACTION, buttonTitle: 'Reply', textInput: { submitButtonTitle: 'Send', placeholder: 'Message' }, options: { opensAppToForeground: false } }`;
     - `{ identifier: READ_ACTION, buttonTitle: 'Mark as read', options: { opensAppToForeground: false } }`.
     - Best effort: warn on failure, never throw.
   - `export async function onNotificationAction(response, deps: WakeDeps = {})`:
     - read `chatId`, `messageId` and `archiveId` from `response.notification.request.content.data` (strings only);
     - **Reply** with non-empty trimmed `userText` (at most 4,000 characters, otherwise cut): call `chats.reply` with `clientId = crypto.randomUUID()`. On a 409, wait 2 s and retry **once with the same `clientId`**;
     - **Read** with `archiveId`: call `chats.markRead` with `{ messageId: archiveId, displayed: messageId }`;
     - then `dismissNotificationAsync(response.notification.request.identifier)` on success. Leave it on failure so the user can retry or tap;
     - other actions or missing ids → nothing;
     - **never log** the text or the token, and never throw.
2. **`background.ts`:**
   - `post` gains an optional `ids?: { messageId: string; archiveId?: string }`, put into `data` next to `chatId`, and sets `categoryIdentifier: MESSAGE_CATEGORY` for chat notifications. Never on the test wake.
   - `handleWake` passes `{ messageId: payload.messageId, archiveId: preview.archiveId }` when the preview succeeded, and widens the preview type with `archiveId?: string`.
   - In the task: if `'actionIdentifier' in data` and the action is not `Notifications.DEFAULT_ACTION_IDENTIFIER` → `await onNotificationAction(data)`. A default tap still returns as today.
   - Call `void registerMessageCategory()` once at module scope inside `if (!MOCK_MODE)`, next to `registerTaskAsync`.
   - Keep `background.ts` at most 400 lines.
3. **Tests** (message pipeline), in a new `apps/mobile/src/lib/push/actions.test.ts`, mocking `expo-notifications` like `background.test.ts` does and injecting `fetchImpl`:
   - a Reply with `userText` calls `POST …/chats/<jid>/reply` with that text and a `clientId`, then dismisses;
   - a 409 then 204 sends the **same** `clientId` twice;
   - Read calls `PUT …/read` with `messageId` = archiveId and `displayed` = origin id;
   - a default tap or a missing `chatId` makes no request.

   Update `background.test.ts` only if an expectation on `post`'s content changes.

### Allowed files
- `apps/mobile/src/lib/push/actions.ts`
- `apps/mobile/src/lib/push/actions.test.ts`
- `apps/mobile/src/lib/push/background.ts`
- `apps/mobile/src/lib/push/background.test.ts`
- `work/T-1896-notification-actions-phone.md`

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run src/lib/push/actions.test.ts src/lib/push/background.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **Chat notifications show Reply and Mark as read.**
- **Reply** sends through the server route with a stable `clientId`; **Mark as read** stores the mark and sends `displayed`. Both work with the app killed, and the notification goes away after success.
- **A plain tap** still opens the chat.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Added `apps/mobile/src/lib/push/actions.ts`:
  - `MESSAGE_CATEGORY`, `REPLY_ACTION`, `READ_ACTION`;
  - `registerMessageCategory()` stores a `message` category with a Reply text action (Send / Message) and a Mark as read action, both `opensAppToForeground: false`; failures warn and never throw;
  - `onNotificationAction(response, deps)` reads `chatId`, `messageId` and `archiveId` from the notification data as non-empty strings. Reply trims `userText`, cuts it to 4,000 characters, sends `chats.reply` with `crypto.randomUUID()` and, on a 409, waits 2 s and retries once with the same `clientId`. Mark as read sends `chats.markRead` with `messageId` = archive id and `displayed` = origin id (when present). Only a successful call dismisses the notification; failures warn without the text or token and leave it in place.
  - The promise boundary runs through `Effect.tryPromise`/`Effect.catch` (the `effect` gate ratchet requires Effect in a new file with native/async signals), matching `onWake`'s pattern.
- `background.ts`: `post` takes optional `ids` (`messageId`, `archiveId`) into `content.data` and always sets `categoryIdentifier: MESSAGE_CATEGORY` for chat notifications; the preview type is widened with `archiveId?`; `handleWake` passes the wake `messageId` and preview `archiveId` on a successful preview; the task runs `onNotificationAction` for a non-default `actionIdentifier` and still returns for a plain tap; `void registerMessageCategory()` runs once at module scope next to `registerTaskAsync`. The test wake is unchanged (no category, no ids). File is 277 lines.
- Tests: new `actions.test.ts` (Reply text + `clientId` + dismiss; 409 then 204 with the same `clientId`; Read `PUT` with archive id and `displayed`; default tap and missing `chatId` send nothing). Updated `background.test.ts` expectations for the new data/category and added a case for the preview `archiveId`; the notifications mock gained `setNotificationCategoryAsync`.

### Checks run
- `pnpm install --frozen-lockfile`: succeeded.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/push/actions.test.ts src/lib/push/background.test.ts`: 2 files passed, 12 tests passed.
- `pnpm gate`: GATE PASS. Summary lines:
  - `gate: 5 changed file(s) against main`
  - `PASS  install (frozen)`, `PASS  format`, `PASS  lint`, `PASS  typecheck`, `PASS  effect`, `PASS  tests @zilar/mobile`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`

### Notes for the lead
- Files changed: `apps/mobile/src/lib/push/actions.ts` (new), `actions.test.ts` (new), `background.ts`, `background.test.ts`, and this task file.
- The generic-text fallbacks (preview 404/error, or a wake without `messageId`) carry no `archiveId`, so Mark as read no-ops on them; Reply still works because it only needs `chatId`. I followed the spec's "pass ids when the preview succeeded" literally. A preview 5xx keeps its wake `messageId` available, so if you want Reply data completeness on that path I can add `messageId` there too (without `archiveId`).
- No deviations otherwise; no open questions.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `882c776cf`. The lead read `actions.ts` in full.
- **The category:** "message", with Reply (text input) and Mark as read, both `opensAppToForeground: false`. Every chat notification gets it, carrying `messageId` and `archiveId`.
- **Reply** sends one `clientId`, with a single retry on 409 using the same id. **Mark as read** sends the archive id and `displayed`.
- **Dismiss** happens only after success. The text is never logged.
- **A plain tap** still goes to `tap.ts`.
- **The nit** (the comment says `reply_in_flight` and the code retries on any 409) is accepted, since 409 only means in-flight on this route.
- **Not checkable on the emulator:** a real FCM wake is needed. This is plan task 6, the phone check with the next APK (v0.2.9).
