---
id: T-1887
title: "Plan (docs only): reply and mark-as-read from an Android notification, plus one notification per chat (grouping) — what expo-notifications 57 supports in the background task, how a reply/read reaches the server without the XMPP connection, the auth and abuse limits, and an ordered task list; write docs/plan/notification-actions.md"
status: merged
milestone: M5
branch: task/T-1887-notification-reply-plan
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1887: Plan notification Reply / Mark as read (docs only)

## Spec (written by Claude, do not edit)

### Why
**Audit finding MUX-23** is still partly open (`docs/audit/findings-sweep-client.md`). Phone notifications have no Reply or Mark as read action and are not grouped per chat. Telegram and WhatsApp let you reply from the notification. It's part of Julio's easy-life pass (2026-10-17). The hard part is that a notification action runs while the app may be killed, without the XMPP connection the app sends through. So this task researches and plans only; no code.

### Facts (read by the lead on 2026-10-17)
- **Dependencies:** `expo-notifications ~57.0.22` and `expo-task-manager ~57.0.21` (`apps/mobile/package.json:50,57`).
- **`apps/mobile/src/lib/push/background.ts`** (258 lines):
  - a data-only "wake" push runs the `WAKE_TASK` headless task (`TaskManager.defineTask` at `:226`, `Notifications.registerTaskAsync` at `:238`);
  - the task fetches a message preview with the stored token and posts a local notification via `post()` (`:122-134`), with `data: { chatId }` and a per-kind channel. There is no `categoryIdentifier`.
- **`apps/mobile/src/lib/push/tap.ts`:** `NotificationRouter` opens the chat on tap (`addNotificationResponseReceivedListener` at `:43`).
- **Other push files:** `native.ts` (registration and channels), `channels.ts`, `badge.ts` and `last-received.ts`.
- **Messages are sent over XMPP from the app** (`packages/client-core`). Find whether the server has any HTTP path that sends a message or sets a read marker for a user (search `apps/server/src` for the preview route the wake task calls, and for read markers / `displayed`).

### What to answer (cite `file:line` in our code, and expo docs or source links for the library)
1. **The library:**
   - in expo-notifications 57 on Android, does a category action with `textInput` and `opensAppToForeground: false` deliver its response (with `userText`) to the background task registered with `registerTaskAsync` when the app is killed, or only to `addNotificationResponseReceivedListener` when JS is running? Quote the doc or source;
   - how do you dismiss or update the notification afterwards?
2. **The server path:** how a reply and a read marker reach the server without XMPP. Options:
   - (a) a new authenticated HTTP route that sends as the user through ejabberd's API;
   - (b) start a short XMPP session in the headless task;
   - (c) open the app.

   Recommend one, with costs. For (a), cover: the session token the wake task already uses, membership and block checks equal to a normal send, rate limits, idempotency (a client id so a retried action never double-sends), and archive/MAM equality with a normal message.
3. **Grouping:**
   - one notification per chat that updates (a stable identifier per `chatId`, a message count, the last few lines), versus Android group summaries;
   - what `expo-notifications` 57 exposes;
   - what happens on tap and after reading the chat in the app (clear that chat's notification).
4. **Security:**
   - reply text is user content; no logging of text;
   - the action works only for the signed-in user's own chats;
   - the token is stored the way the wake task already reads it.
5. **iOS:** what differs (the categories are the same API; background delivery differs). It can be a later phase.
6. **An ordered task list,** each ≤ 45 worker minutes with its files. Mark any task that needs a new native dependency, a new APK or a server config change as "needs Julio". Server routes count as normal tasks (web first, server first).

### Steps
1. Write `docs/plan/notification-actions.md`, under 220 lines.
2. Don't change any code.

### Allowed files
- `docs/plan/notification-actions.md`
- `work/T-1887-notification-reply-plan.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The plan answers 1–6** with citations, recommends one server path, and gives an ordered task list.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

Wrote `docs/plan/notification-actions.md` (219 lines, no code) answering the six
questions in the Spec, with `file:line` citations in our code and expo-notifications
57.0.22 sources/links:

1. **Library.** Android runs a custom action (non-default `actionIdentifier`) in
   the task registered with `registerTaskAsync` when the app is backgrounded or
   killed, and the task payload carries `userText` for a text input action; this
   is documented in `registerTaskAsync.d.ts:2-4` and implemented in
   `ExpoHandlingDelegate.kt:150-165` + `FirebaseMessagingDelegate.kt:84-92` +
   `NotificationSerializer.java:39-47`. `opensAppToForeground: false` keeps the
   app closed. Update by re-posting with the same `identifier` (Android replaces
   in place, `ExpoPresentationDelegate.kt:105-112,127-129`); dismiss with
   `dismissNotificationAsync`.
2. **Server path.** Recommends (a): a new authenticated
   `POST /api/chats/:jid/reply` that builds the stanza with `buildMessage` and
   sends it as the user through `EjabberdAdminClient.sendStanza` (the path the
   delivered notice already uses). Covers the existing bearer token, chat access
   + DM block checks with a 404 for unknown/invisible/blocked, a 60/10 min rate
   limit, a `notification_replies` unique-index claim for idempotency, and
   MAM/archive equality via the same stanza shape and `<origin-id/>`. Read marks
   reuse `PUT /chats/:jid/read` with an optional `displayed` marker, plus
   `archiveId` in the preview answer.
3. **Grouping.** One notification per chat with the stable identifier
   `chat:<chatId>`, an unread count from `unreadForChats` and the newest line;
   Android group summaries are not exposed by the builder, so Android auto-grouping
   is the v1; tap and read dismissal already work by `data.chatId`.
4. **Security.** No text in logs/audit/errors, caller-only access, SecureStore
   token, own rate limit, atomic idempotency.
5. **iOS.** Same category API, no headless action delivery without the app; the
   reply action opens the app; iOS push is a later phase because only `fcm`
   tokens are accepted.
6. **Task list.** Seven ordered tasks (45, 35, 45, 40, 25, 30, 45 min) with files;
   only the phone smoke and the iOS/APNs phase are marked "needs Julio". No new
   native dependency and no new APK for the JavaScript work.

### Files changed

- `docs/plan/notification-actions.md` (new, 219 lines)
- `work/T-1887-notification-reply-plan.md` (status + this Report)

### Checks run

- `pnpm install` — completed, no changes reported.
- `pnpm gate` — real summary:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (1.3s)
PASS  lint  (1.5s)
PASS  typecheck  (1.6s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test files were run: this task changes docs only and the gate skipped
the test stage.

### Round (fix round after PREREVIEW)

- **Finding 1 (should-fix) — fixed.** The idempotency section now separates a
  finished send from an in-flight one with a `sent_at` column: a duplicate
  answers 204 only when `sent_at` is set; while the claim is open and younger
  than 2 min it answers 409 `reply_in_flight`, and the task retries the same
  `clientId` instead of dismissing the notification as sent. A claim older than
  2 min is treated as abandoned and replaced, and a failed send still deletes
  the claim.
- **Findings 2 and 3 (nits) — untouched.** Neither sits on a line this round
  changed, so per the fix-round rules they are left as they are.
- **Tests:** none added or adjusted. This is a docs-only change, the finding
  names no test, and the repo has no test for `docs/plan/`.
- **`pnpm gate`:** `GATE PASS`. Real summary:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.3s)
PASS  lint  (1.0s)
PASS  typecheck  (1.0s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- **Continuation session:** the previous session hit an OpenCode quota error after
  committing this round. In this session I re-read the plan (219 lines), confirmed
  finding 1 is fixed and both nits are still untouched, confirmed the status is
  `review`, and re-ran `pnpm gate` once: `GATE PASS` (install 1.6s, format 1.1s,
  lint 0.9s, typecheck 0.9s, `SKIP effect`, scope/migration/images/size OK). No
  further code or doc changes were needed.
- `wc -l docs/plan/notification-actions.md` — 219 lines, still under the 220
  limit. Status stays `review`.

### Disagreements

None: both nits were skipped only because they are outside the lines this round
changed, not because I dispute them.

### Notes for the lead

- **Verify on the phone:** whether ejabberd also carbons an API-injected stanza
  to the sender's other resources. If it does not, the sending phone learns the
  reply from MAM on its next sync; the plan notes an optimistic insert as the
  fallback.
- **Doc gap:** `categoryIdentifier` is marked iOS-only in
  `Notifications.types.d.ts:560-562`, but Android reads the same key and attaches
  the actions; the plan relies on the Android source, not the TS comment.
- `PushPreview` must grow `archiveId` for the read action (`markRead` needs the
  numeric archive id, not the origin id); that is task 2 in the list.
- No deviations from the Spec. Open question: should the read action also clear
  the app's unread badge, or is the server mark enough? The plan assumes the
  server mark plus the existing `dismissChatNotifications` is enough.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `353567117`. The NEEDS LEAD packet (19:20) predates the fix commit `874174934` (19:21): an in-flight duplicate now answers 409.
- **The library answer is well sourced:** on Android, a custom action reaches the registered task even when the app is killed, and `userText` arrives with it.
- **The server path is (a):** `POST /api/chats/:jid/reply` sends as the user through `send_stanza`, with access → block → rate limit → claim row, like the delivered notice.

**Corrections for the specs:**
1. **"No new APK for tasks 1–5" is wrong.** Phone JS ships only inside an APK (no over-the-air updates), so tasks 3–5 reach phones with the next release, and releases need Julio's OK.
2. **The migration is a numbered, hand-written file** in `apps/server/drizzle/` (next `0075_…sql`, run by `migrateSql`) and updates `db/rows*.ts`. It's not a `<ts>_` file.
3. **Group replies depend on ejabberd accepting a `groupchat` stanza from the bare JID.** That works for MucSub subscribers, which is how push subscribes members. Task 1 must prove it on a live room before the phone tasks start.
