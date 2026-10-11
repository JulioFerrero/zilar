---
id: T-1129
title: "Audit: plan for native push (Android FCM now, iPhone APNs + publisher relay next), content-free, on top of the existing ejabberd mod_push pipeline — docs only"
status: merged
milestone: M5
branch: task/T-1129-native-push-plan
model: auto
effort: default
depends_on: [T-1128]
estimate: 0.3 day
---

# T-1129: Native push plan

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11:
- **Android: FCM only.** FCM is free with no message cap; the only limit is a rate of 600k messages per minute per project.
- **iPhone:** he gets the paid Apple account soon. Prepare APNs and a small relay run by the app publisher, so any self-hosted Zilar server can push to the official app (the Element "Sygnal" model).
- **The push carries no message text:** it only wakes the app, which fetches the message from its own server and shows it. Google and Apple see only that a push happened.

**What exists** (read by the lead):
- **Web Push only.** ejabberd's `mod_push` publishes to our XMPP component (`apps/server/src/push/component.ts`, `docs/PUSH_SPIKE.md`).
- **`apps/server/src/push/delivery.ts:50` `handleIncomingPush`:**
  - finds the device by node (`store.ts:176` `deviceByNode`);
  - reads the newest message from the archive (`archive-scan.ts`);
  - applies the mute and visibility checks and the show-previews setting (`store.ts:238`);
  - builds the payload (`payload.ts`) and sends with `web-push` (`sender.ts`).
- **The device row** (`apps/server/src/db/rows.ts:221` `PushSubscriptionRow`; table in `apps/server/drizzle/0031_glossy_wasp.sql:7`) is Web-Push shaped: `endpoint`, `p256dh` and `auth`, encrypted at rest (`store.ts:275` `openDevice`, `push/crypto.ts`).
- **Registration:** `api-subscribe.ts`. The web client subscribes in `apps/web/src/lib/push.ts` (`pushSupport` at `:12`) and `apps/web/src/lib/push/usePushEnable.ts`.
- **Mobile** (`apps/mobile`, Expo `~57.0.25`, RN 0.86.3) has **no** push code and no `expo-notifications`.
- **New migrations are hand-written SQL** (memory: hand-written migrations; check `apps/server/src/db/migrate.ts` for how they are run).

### What to build
**Only one file:** a new `docs/audit/native-push-plan.md` (no code). Every claim cites `file:line` or a doc URL with its version. It covers:

1. **The server, a device kind.** How `push_subscriptions` gains native devices:
   - the column changes, the hand-written SQL migration, and the `rows.ts` change;
   - what is stored for `fcm` and `apns` tokens, and whether they are encrypted at rest like the Web Push keys;
   - how `api-subscribe.ts` and the ejabberd enable step work for a native device.
2. **The server, the FCM sender:** HTTP v1 (`https://fcm.googleapis.com/v1/projects/<id>/messages:send`) with an OAuth2 token from a service-account JSON.
   - Plan to mint the token ourselves with `node:crypto` (RS256 JWT, then `oauth2.googleapis.com/token`, cached for about 55 minutes) instead of adding `firebase-admin`; say if that is wrong.
   - The env names (for example `FCM_SERVICE_ACCOUNT_JSON`).
   - The message shape: **data-only**, high priority, containing only the chat id, the message id and a server id. No text, no sender name.
   - The error codes that mean "token gone" (`UNREGISTERED`, 404) map to `removeDeviceByNode`.
3. **The server, delivery:** where in `delivery.ts` the code branches by device kind, keeping the mute and visibility checks.
4. **Mobile, Android:**
   - the packages for Expo 57 (`expo-notifications` and anything needed to handle a data-only message while the app is killed, such as `expo-task-manager` or a background notification task), checked against their docs for that SDK version;
   - `app.json` `android.googleServicesFile` and the `POST_NOTIFICATIONS` permission;
   - registering the FCM device token with our server after sign-in;
   - the background handler, which wakes, fetches the message with the stored session (name the existing mobile API it calls) and shows a local notification with the sender and text, respecting show-previews;
   - tapping the notification opens `/chat/<jid>`;
   - what happens on sign-out (unregister).
5. **iPhone (prepare, do not build):**
   - APNs token-based auth (a `.p8` key, key id, team id) and a Notification Service Extension that fetches the message;
   - the Expo config needed (a `mutable-content` push, the extension target);
   - the **publisher relay** design: a tiny service (new app or a server mode) that holds the Apple key (and could hold the FCM key for self-hosters too), accepts `{token, platform, wake}` from any Zilar server with an auth scheme, rate-limits it, and forwards. Compare with Matrix Sygnal or the Mattermost push proxy (cite them).
6. **What Julio must provide,** with exact click steps:
   - the Firebase project, with the Android app `app.zilar.chat`;
   - `google-services.json`;
   - the service-account key;
   - later, the Apple key.
   - **Also:** which of these files is secret (the service account and the `.p8` key) and which may sit in the repo (`google-services.json`).
7. **The task split:** a numbered list of worker tasks (each touching at most ~6 files, server and mobile separate, the schema task alone), with the Allowed files for each, and the tests that are needed. Push touches keys, so the tests are for the token minting, the sender error mapping and the device kind in delivery.

### Read first
`AGENTS.md`, `docs/PUSH_SPIKE.md`, all of `apps/server/src/push/`, `apps/server/src/db/rows.ts:221-242`, `apps/server/drizzle/0031_glossy_wasp.sql`, `apps/server/src/db/migrate.ts`, `apps/mobile/app.json`, `apps/mobile/package.json` and `apps/mobile/src/lib/auth.ts`.

### Allowed files
`docs/audit/native-push-plan.md`, `work/T-1129-native-push-plan.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The plan exists, cites its sources, and ends with the task split.

---

## Report (written by the worker when done)

**Status: done (review).** The plan exists at `docs/audit/native-push-plan.md` and
ends with the task split, as the Acceptance asks.

### What I did

Wrote `docs/audit/native-push-plan.md`, one design doc, no code. It covers the
seven sections the spec lists:

1. **Server, a device kind** — `kind` (`webpush`/`fcm`/`apns`) plus a nullable
   `token` and relaxed `endpoint`/`p256dh`/`auth`, with a hand-written migration
   `apps/server/drizzle/0047_native_push.sql`, a `kind`+shape `CHECK`, and a partial
   unique index `(user_id, token)`; the `rows.ts` change; the `store.ts` union; why
   the token is stored in the clear (it is a delivery address, not the send
   credential, unlike `p256dh`/`auth`); and why the subscribe/enable step needs no
   new stanza (the app already holds an XMPP session).
2. **FCM sender** — HTTP v1 `messages:send`, an RS256 JWT minted with `node:crypto`
   and exchanged at `oauth2.googleapis.com/token` (cached ~55 min), no
   `firebase-admin`; env names `FCM_SERVICE_ACCOUNT_JSON`/`FCM_PROJECT_ID`; the
   data-only, high-priority, ids-only message shape; `UNREGISTERED`/404 →
   `removeDeviceByNode`.
3. **Delivery** — the branch point in `resolveAndSendEffect`, with mute, visibility,
   show-previews, dedupe and the 90-day rule shown to stay put.
4. **Mobile Android** — `expo-notifications ~57.0.21` + `expo-task-manager ~57.0.20`
   (read from Expo 57's `bundledNativeModules.json`), `app.json`
   `android.googleServicesFile` and the Android-13 permission/channel order, token
   registration after sign-in, the headless wake → MAM fetch → local notification,
   tap → `/chat/<jid>`, sign-out delete.
5. **iPhone (prepared only)** — `.p8` + Key ID + Team ID, mutable-content + a
   Notification Service Extension, the Expo config, and the publisher relay design
   compared with Sygnal and the Mattermost push proxy.
6. **What Julio must provide** — click steps for the Firebase project, the Android
   app `app.zilar.chat`, `google-services.json`, the service-account key and the
   Apple key, with secret-vs-repo called out per file.
7. **Task split** — seven tasks with Allowed files and the tests each needs.

Every claim cites `file:line` or a doc URL; the external pages are listed at the
end with their fetch date/version, and the one thing I could not verify (the exact
Expo mechanism for shipping an iOS extension target under CNG) is marked
**unverified**.

### Files changed

- `docs/audit/native-push-plan.md` (new)
- `work/T-1129-native-push-plan.md` (this file: status + Report)

Both are inside the Allowed files.

### Commands run

- `pnpm install` — `Done in 11.8s`, 16 workspace projects. (One existing peer
  warning about `@types/react-dom`; unrelated to this task.)
- `pnpm gate` (from the repo root) — summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (0.6s)
  PASS  lint  (0.9s)
  PASS  typecheck  (1.2s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

No test files were run individually: the change is docs-only, so `pnpm gate`'s
nearest-tests step had no package to test.

### Findings that shaped the plan (worth the lead's eye)

- The effect migrator reads `apps/server/drizzle/*.sql` by filename and ignores
  Drizzle's `meta/_journal.json` (`apps/server/src/effect/sql.ts:166-202`), so the
  schema task needs only the new `0047_*.sql`. No snapshot/journal edit.
- There is **no REST route to fetch one message by id** (checked all of
  `packages/api-contract/src/`); the existing mobile path is MAM through
  `@zilar/xmpp-core` (`loadHistory`). The plan names that path and flags a small
  server route as the fallback if a killed-app task finds MAM too slow.
- The app is Expo Router with `"main": "expo-router/entry"` and no `index.ts`, so
  the background task is registered from the root layout; the plan notes the
  cold-start risk and the fallback entry file.
- The subscriber payload becomes a union, so the change touches the shared
  `@zilar/api-contract` `push.ts` — assigned to its own task (4).

### Deviations / decisions taken (no decision needed unless the lead disagrees)

- **Token in the clear.** The spec asks whether FCM/APNs tokens are encrypted like
  the Web Push keys; I decided no, because the token alone cannot send (the
  credential is the service account / `.p8`), and plaintext is what makes the
  `(user_id, token)` dedupe index possible. If the lead wants them sealed, the plan
  needs a `token_hash` column for dedupe — say so and I will revise.
- **`serverId` = the XMPP domain** (the server's identity), matching the role
  Mattermost's `server_id` plays. Not a secret.
- **Minting the JWT ourselves is stated as correct**, with the Google doc's
  client-library recommendation quoted and the one risk (clock skew) addressed.

### Open questions

None that block. The only real choice left to Julio is Task 7's "new `apps/relay`
package vs a `PUSH_RELAY_*` server mode" (§5.3), which is deferred with the iPhone
work.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 2 nits, which the lead fixes in the doc after the merge.**
- **The plan** (`docs/audit/native-push-plan.md`):
  - it reuses the whole mod_push pipeline, and native devices change only the device row (a second kind) and the send step (a data-only FCM wake, ids only);
  - the FCM OAuth token is minted with `node:crypto` (no `firebase-admin`);
  - the mobile background handler fetches the message and posts the local notification;
  - iPhone (APNs, Notification Service Extension, a publisher relay) is prepared;
  - there are 7 tasks.
- **Accepted reasoning:** an FCM or APNs token is a delivery address, not a credential (sending needs the service account or the `.p8` key), so it may be stored in the clear like `endpoint`.
- **The nits:** a machine path in the header, and Task 5 naming `auth/session.ts` instead of the sign-out site. The lead edits both in the doc on main.
