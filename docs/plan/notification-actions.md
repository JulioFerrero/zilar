# Notification Reply, Mark as read, and one notification per chat

T-1887, plan only (no code). Closes the rest of audit finding MUX-23
(`docs/audit/findings-sweep-client.md:41`): T-1302 shipped the chat-kind channels,
but Reply, Mark as read and one notification per chat are still missing. Expo
paths below are under `apps/mobile/node_modules/expo-notifications/`.

## What exists today

- A data-only FCM wake runs the `WAKE_TASK` headless task
  (`apps/mobile/src/lib/push/background.ts:26,226-235`), registered with
  `registerTaskAsync` at `:238`. It fetches a preview (`:169-180`) and posts a
  local notification with no identifier and no `categoryIdentifier` (`:124-134`);
  the module is imported before `expo-router/entry` (`apps/mobile/index.ts:1-5`).
- `NotificationRouter` opens the chat on a tap (`apps/mobile/src/lib/push/tap.ts:43-48`
  live, `:54-93` cold start).
- Reading a chat dismisses its notifications and syncs the badge
  (`packages/client-core/src/store/reads.ts:51-54`); dismissal already filters on
  `data.chatId` (`apps/mobile/src/lib/push/badge.ts:63-83`).
- The task authenticates with the stored bearer token (`background.ts:155`;
  `apps/mobile/src/lib/session-token.ts:8-17`; SecureStore key
  `zilar.session-token`, `apps/mobile/src/auth/secure-session-storage.ts:11`).
- Sending is XMPP-only: no HTTP route sends a message. Read marks do have a route
  (`PUT /api/chats/:jid/read`, `packages/api-contract/src/chats.ts:151`) that only
  stores the caller's mark (`apps/server/src/chats/reads.ts:36-77`); the XEP-0333
  `<displayed>` comes separately from the app over XMPP
  (`packages/xmpp-core/src/core-effect/operations.ts:227-233`).
- The server can inject a stanza as a person through ejabberd:
  `EjabberdAdminClient.sendStanza` (`apps/server/src/xmpp/admin/client.ts:312-317`),
  already used for the delivered notice (`apps/server/src/chats/delivered-notice.ts:65-87`).

## 1. The library: does an action reach the task when the app is killed?

**Android: yes, for a custom action, whether or not the app is running.** The
installed 57.0.22 docs say it plainly: `registerTaskAsync.d.ts:2-4` — "Only on
Android, the task also runs in response to a notification action tap when the app
is backgrounded or terminated." The code matches:
`ExpoHandlingDelegate.handleNotificationResponse` opens the app only when the
action says so, then, for any non-default action while the app is not in the
foreground, calls `FirebaseMessagingDelegate.runTaskManagerTasks` with the
serialized response (`ExpoHandlingDelegate.kt:150-165`), which starts the
headless JS bundle and runs every registered task (`FirebaseMessagingDelegate.kt:84-92`).
The bundle carries `actionIdentifier`, `notification` and, for a text action,
`userText` (`NotificationSerializer.java:39-47`); JS types it as
`NotificationResponse` (`Notifications.types.d.ts:601-605`) and the task payload is
`NotificationResponse | { data }` (`:747-759`). So `opensAppToForeground: false`
is the reply path: the app stays closed and `userText` arrives in the task. The
flag defaults to true (`:664-670`), so every action must set it explicitly. In our
code the task returns early for any payload with `actionIdentifier`
(`background.ts:227-229`), assuming taps only reach `tap.ts`; that early return
becomes the reply/read handler, while `DEFAULT_ACTION_IDENTIFIER` stays with
`tap.ts`.

**Categories.** `setNotificationCategoryAsync(identifier, actions)` stores the
actions on the device (`ExpoNotificationCategoriesModule.kt:87-129`); a text
action becomes an Android remote input (`ExpoNotificationBuilder.kt:82-90`).
`categoryIdentifier` is documented as iOS-only (`Notifications.types.d.ts:560-562`)
but Android reads the same key (`ArgumentsNotificationContentBuilder.java:30`) and
attaches the actions (`ExpoNotificationBuilder.kt:113`). Register the categories at
module scope beside the task, before the first post; the app has launched once by
then.

**Updating and dismissing.** Re-posting with the same `identifier` replaces the
notification in place on Android: the identifier is the notification tag and the
numeric id is a constant (`ExpoPresentationDelegate.kt:105-112,127-129`). Dismiss
with `Notifications.dismissNotificationAsync(identifier)`
(`dismissNotificationAsync.d.ts:7`), or `dismissChatNotifications`, already
filtered by `data.chatId` (`badge.ts:63-83`); a tap dismisses automatically
(`autoDismiss` defaults to true, `ExpoNotificationBuilder.kt:100`). On iOS a
delivered notification cannot be replaced in place: dismiss, then post.

## 2. The server path: reply and read without XMPP

- **(a) a new authenticated HTTP route that sends as the user through ejabberd's
  API.** Cost: one contract endpoint, one handler, one small table and an
  admin-client call; no new process or credential.
- **(b) start a short XMPP session in the headless task.** Cost: the password or a
  token exchange, a SASL connect, roster and room joins, and a reconnect story
  inside a task the OS may kill in seconds; it also duplicates the client core in
  a second runtime. Reject.
- **(c) open the app.** Not a reply from the notification; it is what the tap
  already does. Keep it only as the iOS fallback (§5).

**Recommendation: (a).** A message built by `buildMessage` and injected with
`send_stanza` is the same stanza the app sends, and the admin path already carries
per-user stanzas (`delivered-notice.ts:65-87`).

### Route

`POST /api/chats/:jid/reply` in `ChatsGroup` (`packages/api-contract/src/chats.ts:148`),
body `{ clientId, text, readUpTo?, displayed? }`: `clientId` (1–128 chars) is the
idempotency key and stanza id, `text` is 1–4,000 chars, `readUpTo` is an optional
archive id that stores the read mark, and `displayed` is an optional origin id that
sends the XEP-0333 marker. One call does reply + read + displayed, so the task makes
one request. `Session` already covers the group (`chats.ts:180`), so the route joins
the 401 sweep (`apps/server/src/authz-sweep.test.ts` enumerates `app.routes`). The
handler goes in `apps/server/src/chats/reply-handler.ts`, wired next to `markRead`
(`apps/server/src/chats/api.ts:78-81`). The task authenticates with the existing
`getSessionToken()` (`background.ts:155,169-172`; SecureStore, never AsyncStorage),
so nothing new is stored.

### Check order (access, then budget, then the write)

1. `requireChatAccess` (`apps/server/src/chat-prefs/access.ts:101-133`): DMs only
   with a contact or own AI, rooms only when the topic is visible; unknown,
   malformed and invisible all answer 404.
2. For a DM, `isDmBlocked` (`apps/server/src/blocks/service.ts:70-98`): a block in
   either direction answers the same 404, so the block stays silent.
3. Its own `createRateLimiter({ max: 60, windowMs: 10 * 60 * 1000 })`, checked
   before the write like `markRead` (`apps/server/src/chats/mark-handlers.ts:58-64`):
   over budget answers 429, and no `adminClient` answers 503 `xmpp_unavailable`
   (`apps/server/src/errors.ts:26-28`).
4. No second membership check: `requireChatAccess` decides visibility, and
   ejabberd refuses a `groupchat` stanza from a non-member, which becomes a failed
   `send_stanza` and a 503 ("Could not send the reply. Try again.", no text logged).

### Idempotency

A retried action must not double-send, so the claim is a row, not a check. The
`notification_replies` table holds `(user_id uuid, client_id text, chat_jid text,
created_at timestamptz default now(), sent_at timestamptz)` under `PRIMARY KEY
(user_id, client_id)`; its migration opens with `SET lock_timeout = '5s';` and
only adds. The handler inserts `ON CONFLICT DO NOTHING RETURNING 1` before
sending, and only the winner sends. No row means the claim exists: 204 only when
`sent_at` is set, 409 `reply_in_flight` while it is open and under 2 min old, so
the task retries the same `clientId` instead of reporting success; an older claim
is abandoned and replaced. A failed send deletes the claim. `clientId` is
`crypto.randomUUID()` once per action, from the polyfill that runs before the
task (`apps/mobile/src/lib/polyfills.ts:35-52`); Hermes has no `crypto.subtle`.

### Archive/MAM equality

`buildMessage({ id: clientId, to, kind, text })` emits `type`, `<body>` and the
`<origin-id/>` (XEP-0359), exactly as a normal send
(`packages/xmpp-core/src/stanza/build-outgoing.ts:95-148`; the origin-id comment
at `:143-145`). Injected from the user's bare JID, ejabberd archives it in mod_mam
and routes it like any stanza from that account, so the receiver's live view, MAM
replay and scrollback see the same message. The `from` has no resource; every
comparison in our code is on the bare JID (`apps/server/src/chats/deliveries.ts:48`).
Whether ejabberd also carbons it to the sender's other resources is the one thing
to verify on the phone; if not, the sender learns the message from MAM on its next
sync.

### Read marker

`PUT /api/chats/:jid/read` gains an optional `displayed` origin id. It keeps its
order (access, budget, `putChatRead`; `mark-handlers.ts:52-70`, `reads.ts:36-77`)
and then, best effort after the store, sends `buildDisplayed`
(`packages/xmpp-core/src/stanza/build-control.ts:50-60`) as the user through the
same admin client, matching an in-app read (`operations.ts:227-233`). `PushPreview`
(`packages/api-contract/src/push.ts:62-66`) must also return `archiveId` (the row
timestamp, `apps/server/src/push/archive-scan.ts:22-31`), so the notification data
carries `chatId`, `messageId` (for `displayed`) and `archiveId` (for `readUpTo`),
which is what `markRead` needs (`reads.ts:44-55`).

## 3. Grouping: one notification per chat

Use a stable identifier, `chat:<chatId>`, so each wake replaces the chat's
notification instead of stacking (`ExpoPresentationDelegate.kt:105-112`). The
content gains `badge: unread` (Android's `setNumber`,
`ExpoNotificationBuilder.kt:112`) and keeps the newest line as the body; the count
comes from `push.preview`, calling `unreadForChats` with a single-chat scope
(`apps/server/src/chats/unread.ts:174-243`), the same rule the chat list uses.

Android group summaries are not exposed: the builder never calls `setGroup` or
`setGroupSummary` (`ExpoNotificationBuilder.kt:92-119`; the only "group" left is
the channel group in Settings, `AndroidXNotificationsChannelManager.java:114`).
Android's own auto-grouping still stacks the per-chat notifications under one app
summary after four (developer.android.com/develop/ui/views/notifications/group),
which is the right v1; a "3 chats, 12 messages" summary needs a native module.

On tap the OS dismisses that notification and `tap.ts:21-23` opens the chat. After
reading in the app, `recordRead` dismisses the rest (`reads.ts:51-54`,
`badge.ts:63-83`), already filtered on `data.chatId`, so no change is needed there.
After a successful reply the task dismisses the chat's notification
(`dismissNotificationAsync.d.ts:7`); on failure it leaves it and posts nothing new.
A `lines: string[]` (last three) needs a second archive read and the same
mute/visibility rules per row; it is a follow-up, not part of MUX-23.

## 4. Security

- Reply text is user content: never logged, never in an audit detail, never in an
  error; audit rows carry ids only and the task logs fixed sentences and error
  classes.
- Access is the caller's: session user → `requireChatAccess` → `isDmBlocked`.
  Unknown, invisible and blocked all answer the same 404, so a chat cannot be
  probed.
- The token is the existing bearer token from SecureStore; the route is a normal
  session route, covered by the 401 sweep, and the reply has its own rate limit.
- Idempotency is a unique index, not a check-then-insert.

## 5. iOS

The category API is the same (`setNotificationCategoryAsync`,
`Notifications.types.d.ts:681-685`), but the background task is not: on iOS
`registerTaskAsync` needs the `remote-notification` background mode and is fed by
remote notifications (`ios/ExpoNotifications/Notifications/Background/BackgroundModule.swift:13-34`),
while an action response is queued and handed to JS only when the app next runs
(`NotificationCenterManager.swift:169-182`). A killed iOS app therefore cannot
reply headlessly: the Reply action opens the app
(`opensAppToForeground: true`) and the text is sent from the response listener.
iOS is a later phase anyway, as the server accepts only `fcm` tokens today
(`packages/api-contract/src/push.ts:109-113`); reuse the category and copy.

## 6. Task list, in order

| # | Task | Min | Files | Needs Julio |
|---|------|-----|-------|-------------|
| 1 | Contract + `POST /chats/:jid/reply` + idempotency migration + tests | 45 | `packages/api-contract/src/chats.ts`, `apps/server/src/chats/reply-handler.ts`, `apps/server/src/chats/reply-handler.test.ts`, `apps/server/src/chats/api.ts`, `apps/server/drizzle/<ts>_notification_replies.sql` | no |
| 2 | Read route `displayed` + preview `archiveId`/`messageId` + tests | 35 | `packages/api-contract/src/chats.ts`, `packages/api-contract/src/push.ts`, `apps/server/src/chats/mark-handlers.ts`, `apps/server/src/chats/reads.ts`, `apps/server/src/push/api-handlers.ts`, their tests | no |
| 3 | Categories + reply/read handlers in the wake task | 45 | new `apps/mobile/src/lib/push/categories.ts`, `apps/mobile/src/lib/push/background.ts`, `apps/mobile/src/lib/push/background.test.ts` | no |
| 4 | One notification per chat: stable identifier, badge count, dismiss after reply | 40 | `apps/mobile/src/lib/push/background.ts`, `apps/mobile/src/lib/push/background.test.ts` | no |
| 5 | Tap and read cleanup for the stable identifier | 25 | `apps/mobile/src/lib/push/tap.ts`, `apps/mobile/src/lib/push/badge.ts`, `apps/mobile/src/lib/push/badge.test.ts` | no |
| 6 | Phone smoke: reply, mark as read, one notification per chat | 30 | — | **yes** (device run) |
| 7 | iOS phase: category with `opensAppToForeground: true`, APNs support | 45 | `apps/mobile/src/lib/push/categories.ts`, `apps/mobile/src/lib/push/tap.ts`, `packages/api-contract/src/push.ts`, `apps/server/src/push/*` | **yes** (APNs key + config) |

No task adds a native dependency: categories, remote input, dismiss and badge ship
in expo-notifications 57. No new APK is needed for tasks 1–5 (JavaScript only).
Tasks 1–2 land first so the phone work has a server to call.
