# Native push plan: Android FCM now, iPhone APNs + publisher relay next (T-1129)

Docs only. No code, config or schema changes. Line numbers are from `main` on 2026-10-11, the day of T-1129 (merged); re-check them before each spec. Task: `work/T-1129-native-push-plan.md`.

Sources: repo files (`path:line`), the SDK 57 module manifest
(`node_modules/.pnpm/expo@57.0.25.../expo/bundledNativeModules.json`), and the web
pages listed in "Sources" at the end. Anything I could not check is marked
**unverified**.

## Summary

Zilar already has the whole wake pipeline for the web: ejabberd `mod_push` sends a
content-free publish IQ to our XMPP component, and the server resolves the newest
message from the MAM archive, applies mute and visibility, and sends an encrypted
Web Push payload. Native devices change only two things: the **row** (a second
device kind) and the **send step** (a data-only FCM message instead of Web Push).
Mute, visibility, the 90-day rule and the "one buzz per device" dedupe stay exactly
where they are.

1. **The push is content-free for native.** Google and Apple see only a wake. The
   payload carries the chat JID, the message id and the server id — never text or a
   sender name. The app fetches the message from its own server, where the mute and
   preview rules already live.
2. **Android is FCM only, and free.** An FCM HTTP v1 data-only, high-priority
   message wakes the app; the app posts the local notification itself. No
   `firebase-admin` dependency is needed: one RS256 JWT signed with `node:crypto`
   buys an OAuth2 token that is cached for ~55 minutes.
3. **iPhone is prepared, not built.** The publisher's paid Apple account funds a
   `.p8` key and a tiny relay that any self-hosted server can call. iOS shows text
   through a Notification Service Extension (mutable-content), so the push itself
   still carries none.
4. **The token is a delivery address, not a credential.** The Web Push
   `p256dh`/`auth` keys must stay sealed because with the endpoint they *are* the
   send credential; an FCM/APNs token alone cannot send anything (sending needs the
   service account or the `.p8`), so it is stored in the clear like `endpoint`
   today and used as the dedupe key.
5. **Seven worker tasks** finish the Android path; the iPhone path is one deferred
   task. The schema task is alone, server and mobile are separate. See §7.

---

## 1. The server, a device kind

### 1.1 What exists

The device row is Web-Push shaped
(`apps/server/src/db/rows.ts:221-233`, table in
`apps/server/drizzle/0031_glossy_wasp.sql:7-20`):

| Column | Meaning | Sealed? |
| --- | --- | --- |
| `endpoint` | Web Push endpoint URL | no |
| `p256dh`, `auth` | the subscription keys | yes, `PushCipher` |
| `node` | the XEP-0357 node, unique | no |
| `user_agent`, `created_at`, `last_used_at`, `failed_at` | bookkeeping | no |

`saveDevice` (`store.ts:68-129`) runs one transaction under a per-user advisory
lock, caps devices at 20 (`PUSH_MAX_DEVICES_PER_USER`, `store.ts:16`), deletes the
stale rows for the same `(user_id, endpoint)` and inserts. `openDevice`
(`store.ts:275-283`) decrypts `p256dh`/`auth` at send time. `deviceByNode`
(`store.ts:176-189`) is how a publish IQ finds its device.

### 1.2 Column changes

Add a `kind` discriminator and a token column; relax the three Web-Push columns to
nullable. Hand-written migration `apps/server/drizzle/0047_native_push.sql`
(statement bodies):

```sql
ALTER TABLE "push_subscriptions" ADD COLUMN "kind" text DEFAULT 'webpush' NOT NULL;
ALTER TABLE "push_subscriptions" ADD COLUMN "token" text;
ALTER TABLE "push_subscriptions" ALTER COLUMN "endpoint" DROP NOT NULL;
ALTER TABLE "push_subscriptions" ALTER COLUMN "p256dh"  DROP NOT NULL;
ALTER TABLE "push_subscriptions" ALTER COLUMN "auth"    DROP NOT NULL;
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_kind_check"
  CHECK ("kind" IN ('webpush', 'fcm', 'apns'));
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_shape_check" CHECK (
  ("kind" = 'webpush'
     AND "endpoint" IS NOT NULL AND "p256dh" IS NOT NULL AND "auth" IS NOT NULL
     AND "token" IS NULL)
  OR
  ("kind" IN ('fcm', 'apns')
     AND "token" IS NOT NULL
     AND "endpoint" IS NULL AND "p256dh" IS NULL AND "auth" IS NULL)
);
CREATE UNIQUE INDEX "push_subscriptions_user_token_idx"
  ON "push_subscriptions" ("user_id", "token") WHERE "token" IS NOT NULL;
```

Why this shape:

- **`DEFAULT 'webpush' NOT NULL`** backfills every existing row, so the migration
  is a pure `ALTER` with no data rewrite and no downtime.
- **`token` in the clear.** An FCM registration token or an APNs device token is a
  delivery address, exactly like `endpoint`: it cannot send by itself, because
  sending needs the owner's service-account key (§2) or `.p8` key (§5). So it does
  not need the `PushCipher` envelope that `p256dh`/`auth` need — those two, with the
  endpoint, *are* the Web Push send credential. Keeping `token` readable also lets
  the `(user_id, token)` unique index and the stale-row lookup work: AES-GCM uses a
  fresh salt and IV per encryption, so a sealed token could not be deduped by a
  column comparison.
- **`shape_check` per kind.** A row is either a complete Web Push row or a native
  row with a token; a half-filled row fails loudly.
- **Partial unique index.** Two registrations of the same device token for one user
  collapse to one row, the way two registrations of the same endpoint do today.

The effect migrator loads `apps/server/drizzle/*.sql` by filename and ignores
Drizzle's `meta/_journal.json` (`apps/server/src/effect/sql.ts:166-202`,
`migrate.ts:8-18`), so a hand-written file numbered `0047_*` is all that is needed;
no journal or snapshot edit.

### 1.3 `rows.ts`

`PushSubscriptionRow` (`rows.ts:221-233`) gains:

```ts
export type PushDeviceKind = 'webpush' | 'fcm' | 'apns';

export interface PushSubscriptionRow {
  id: string;
  userId: string;
  node: string;
  kind: PushDeviceKind;
  endpoint: string | null;   // webpush
  p256dh: string | null;     // webpush, sealed
  auth: string | null;       // webpush, sealed
  token: string | null;      // fcm/apns
  userAgent: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  failedAt: Date | null;
}
```

### 1.4 `store.ts`

- `SaveDeviceInput` becomes a discriminated union: `{ kind: 'webpush',
  subscription }` or `{ kind: 'fcm' | 'apns', token }`.
- `saveDevice` branches on the kind: it dedupes on `(user_id, endpoint)` for
  `webpush` and on `(user_id, token)` for native, both inside the same advisory-lock
  transaction and the same 20-device cap, so a native registration cannot race past
  the cap or leave a duplicate. The insert writes `kind` and either the three
  Web-Push columns or `token`.
- `openDevice` stays Web-Push only; add `openNativeDevice(row): { kind, token }`
  that reads the two native columns and throws/`undefined` when the row is not
  native.
- `toPushDeviceView` (`store.ts:30-40`) may gain `kind` so the settings list can
  label a phone; that is a contract change (§4).

### 1.5 How `api-subscribe.ts` and the ejabberd enable step work for native

The route is already kind-agnostic: it decodes a body, picks a random `node`
(`api-subscribe.ts:71-72`), saves the row and returns `{ id, node, jid }`
(`api-subscribe.ts:138`). Native reuses it unchanged in shape; only the decoded
payload gains a native variant (§4). The important part is that **the enable step
does not change**: ejabberd's `mod_push` requires a live session, so the *client*
sends `<enable jid="<pushJid>" node="<node>"/>` over its own XMPP session
(`docs/PUSH_SPIKE.md:27-30`), and the native app already holds that session (the
mobile app connects XMPP through `@zilar/xmpp-core`). When the app is later killed,
ejabberd routes the publish IQ to our component by `node` and `deviceByNode`
(`store.ts:176`) finds the native row. No server-side admin call is involved
(`api-subscribe.ts:40-70` explains why there is no admin shortcut).

On sign-out the app sends `<disable/>` for its pair and `DELETE
/api/push/subscriptions/:id`, which is the existing scoped delete
(`api-handlers.ts:66-119`, `store.ts:159-174`).

---

## 2. The server, the FCM sender

### 2.1 Endpoint and auth

FCM HTTP v1: `POST https://fcm.googleapis.com/v1/projects/<project_id>/messages:send`,
`Authorization: Bearer <OAuth2 token>` (FCM v1 doc, "Send messages to specific
devices"). The token is minted from a service-account JSON the same way the Google
OAuth2 service-account flow describes: sign a JWT and exchange it.

### 2.2 Mint the token ourselves (recommended)

**Do not add `firebase-admin`.** The `google-auth-library` transitively pulled by
`firebase-admin` is large, and we need exactly one operation. Mint with
`node:crypto` (Google OAuth2 service-account doc, "HTTP/REST"):

1. Header `{"alg":"RS256","typ":"JWT"}`.
2. Claims `iss = client_email`, `scope = "https://www.googleapis.com/auth/firebase.messaging"`,
   `aud = "https://oauth2.googleapis.com/token"`, `iat = now`, `exp = now + 3600`.
3. Sign `base64url(header) + "." + base64url(claims)` with RSA-SHA256 and the
   `private_key` from the JSON.
4. `POST https://oauth2.googleapis.com/token` with
   `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt>`.
5. Read `access_token` and cache it for `expires_in - 300` seconds (≈55 minutes)
   (the response carries `expires_in: 3600`).

The code path lives in a new `apps/server/src/push/fcm-token.ts`:
`createFcmTokenProvider(config): { token(): Promise<string> }`, with a single
in-flight refresh promise so concurrent sends share one exchange. Only `node:crypto`
and `fetch` are used.

**Is that wrong?** No — the Google docs *recommend* a client library because JWTs
are easy to get subtly wrong, but the claim set here is fixed and small, the
signature is one `crypto.sign('RSA-SHA256', ...)`, and the private key never leaves
the process. The one risk the docs name (clock skew, `exp` too far from `iat`) is
handled by using `iat = now` and `exp = now + 3600`. A dependency is a bigger cost
than 30 lines here; if the lead prefers the library, the swap is contained to
`fcm-token.ts`.

### 2.3 Environment names

Added to the effect schema in `config.ts` (`pushEnvSchema`, `config.ts:32-68`) and
to `pushConfigError` (`config.ts:161-184`, so a half-configured server refuses to
start):

| Name | Secret | Meaning |
| --- | --- | --- |
| `FCM_SERVICE_ACCOUNT_JSON` | **yes** | the downloaded service-account JSON, as a single-line string |
| `FCM_PROJECT_ID` | no | the project id; may be read from the JSON's `project_id` when omitted |

The service-account value is never logged and never echoed in a config error — the
existing `PushConfigError` machinery already reports only key names
(`config.ts:85-102`). For a self-hoster using the publisher relay instead of their
own Firebase project, the two names are absent and `PUSH_RELAY_URL` /
`PUSH_RELAY_TOKEN` take over (§5.3).

### 2.4 The message shape: data-only, high priority, ids only

```json
{
  "message": {
    "token": "<fcm registration token>",
    "data": {
      "chatId": "ana@zilar.localhost",
      "messageId": "origin-1",
      "serverId": "zilar.localhost"
    },
    "android": { "priority": "high", "ttl": "3600s" }
  }
}
```

- **Data-only** (no `notification` block). That is what makes a headless
  background task run and stops FCM from drawing a notification the app cannot
  enrich (Expo notifications doc, "Headless (Background) notifications"; FCM v1
  doc, "Message types").
- **`android.priority: "high"`** so the message wakes a sleeping device rather than
  being batched (FCM "Set message priority"; Expo sending doc's `priority` note).
- **Ids only.** `chatId` is the room bare JID or the DM peer bare JID (the same
  value `ResolvedPushMessage.chatJid` carries, `payload.ts:22-31`); `messageId` is
  the MAM origin id (`candidates.ts:97`, `:129`); `serverId` is the server's XMPP
  domain, so a device registered against more than one Zilar server knows where to
  fetch (the same role Mattermost's `server_id` plays in its proxy payload). No
  text, no sender name.

### 2.5 Error codes that mean "token gone"

FCM error codes (FCM error-codes doc, last updated 2026-10-08):

- `UNREGISTERED` (HTTP 404): the token is no longer valid — map to `{ gone: true }`
  and call `removeDeviceByNode` (`store.ts:191-202`), exactly as Web Push maps
  404/410 (`sender.ts:65-71`, `delivery.ts:163-169`).
- `SENDER_ID_MISMATCH` (403), `INVALID_ARGUMENT` (400), `UNAVAILABLE` (503),
  `INTERNAL` (500): treat as a send failure, stamp `failed_at`, keep the device.
- `QUOTA_EXCEEDED` (429): send failure; a backoff is a later concern.

---

## 3. The server, delivery

The branch point is inside `resolveAndSendEffect`
(`apps/server/src/push/delivery.ts:105-147`), after the archive scan has already
decided *whether* to notify:

```
openDeviceEffect(deps, device)                 // delivery.ts:110
  ├─ kind === 'webpush'  → buildPushPayload(..., showPreviews)   // today
  └─ kind === 'fcm'/'apns' → buildNativeWakePayload(...)          // new
sendPayloadEffect(deps, device, subscription|token, payload)      // delivery.ts:149
```

What stays:

- **Mute and visibility.** They are resolved in the scan, not at send:
  `resolveCandidate` returns `muted`/`hidden` (`candidates.ts:17-39`,
  `archive-scan.ts:76-95`), including the private-topic check via `canSeeTopic`
  (`candidates.ts:63`) and the group-General mute inheritance (`candidates.ts:137-171`).
  Native inherits all of it because the scan runs before the kind branch.
- **Show-previews.** `showPreviewsForUser` (`delivery.ts:132`, `store.ts:238-248`)
  is read once. For Web Push it decides the `body` (`payload.ts:53-54`); for native
  it is *not* applied server-side at all — the app decides locally (§4.4), because
  the native payload has no body to blank out.
- **Dedupe and the 90-day rule.** `markNotified` (`delivery.ts:145`, `:191-203`)
  and `markDeviceUsed` (`delivery.ts:89-91`, `store.ts:204-218`) are kind-agnostic.
- **`gone` cleanup.** Same `removeDeviceByNode` path.

New in `payload.ts`: `buildNativeWakePayload(message, input)` returns
`{ chatId, messageId, serverId }` or `undefined` when `input.muted || !input.visible`
— it reuses the same filter guard as `buildPushPayload` (`payload.ts:45-51`) so a
future change to the guard cannot drift between the two kinds.

`PushServiceDeps` (`service.ts:20-36`) gains a `nativeSender` beside `sender`; the
component wiring supplies both (`main.ts:489-510`). `PushOutcome` is unchanged.

---

## 4. Mobile, Android

### 4.1 Packages for Expo 57

Expo SDK 57's own module manifest pins the matching versions (checked in
`expo@57.0.25`'s `bundledNativeModules.json`):

| Package | Version | Why |
| --- | --- | --- |
| `expo-notifications` | `~57.0.21` | native device token, local notifications, `registerTaskAsync` |
| `expo-task-manager` | `~57.0.20` | runs a headless task when the app is killed |

`expo-notifications`' doc for SDK 57 is explicit: to handle a notification "while
the app is in the background or not running" you must add `expo-task-manager`,
configure background notifications, and set up a background task
(`docs.expo.dev/versions/v57.0.0/sdk/notifications/`, "Headless (Background)
notifications"). Remote push on Android is not available in Expo Go since SDK 53;
a development build is required (same page, top note).

### 4.2 `app.json`

- `android.googleServicesFile: "./google-services.json"` (the file Julio downloads
  in §6). `android.package` is already `app.zilar.chat` (`apps/mobile/app.json:13-14`),
  so the Firebase Android app must use exactly that package name.
- Add `expo-notifications` to `plugins` (`app.json:44-67`). The plugin's `icon` and
  `color` are optional; `defaultChannel` matches the channel created at runtime.
- The Android 13 `POST_NOTIFICATIONS` permission is granted by the OS prompt, which
  "will not appear until at least one notification channel is created", so
  `setNotificationChannelAsync` must be called before `getDevicePushTokenAsync`
  (Expo notifications doc, "Permissions → Android"). With CNG the permission is
  contributed by the plugin's Android manifest; if the lead prefers an explicit
  declaration, `android.permissions: ["POST_NOTIFICATIONS"]`.
- iOS later needs `enableBackgroundRemoteNotifications: true` for
  `UIBackgroundModes: remote-notification` (Expo notifications doc, "Background
  notification configuration"); not needed for the Android milestone.

### 4.3 Registering the FCM token after sign-in

After sign-in, when `Notifications.getPermissionsAsync()`/`requestPermissionsAsync()`
granted and a channel exists:

1. `const { data: token } = await Notifications.getDevicePushTokenAsync();` — this
   returns the native **FCM** token on Android (Expo notifications doc,
   "`getDevicePushTokenAsync()`").
2. `POST /api/push/subscriptions` with `{ kind: 'fcm', token, userAgent }` using the
   stored bearer session. The mobile transport already exists:
   `createApiClient({ getToken, fetchImpl, apiUrl })`
   (`apps/mobile/src/lib/effect/api-client.ts:19`) with `getSessionToken`
   (`apps/mobile/src/lib/session-token.ts:15`) and `API_URL`
   (`apps/mobile/src/lib/auth.ts:22`).
3. The response is `{ id, node, jid }`; send `<enable jid="<jid>" node="<node>"/>`
   over the XMPP session, the same stanza the web client sends.
4. Re-register when `Notifications.addPushTokenListener` fires (a rolled token),
   and on every cold start; the `(user_id, token)` unique index makes it idempotent.

The Expo push *token* service is **not** used: we talk to FCM directly, so the app
must not call `getExpoPushTokenAsync` (that would route through Expo's servers and
defeat the point).

### 4.4 The background handler

A headless task defined in a module that is required early by the app (Expo
notifications doc, "`registerTaskAsync`"):

```ts
// apps/mobile/src/lib/push/background.ts (module scope), imported by the root layout
const TASK = 'zilar-background-notification';
TaskManager.defineTask<Notifications.NotificationTaskPayload>(TASK, async ({ data }) => {
  if ('actionIdentifier' in data) return BackgroundNotificationResult.NoData; // a tap
  await onWake(data);                       // fetch + local notification
  return BackgroundNotificationResult.NewData;
});
Notifications.registerTaskAsync(TASK);
```

The Expo doc suggests the entry file (`index.ts`); this app is Expo Router
(`"main": "expo-router/entry"`, `package.json:5`) and has no `index.ts`, so the task
is registered from the root layout (`src/app/_layout.tsx`), which Expo Router
evaluates before any route. Task 6 must confirm the task actually fires on a cold
start; if it does not, the fallback is a custom `index.ts` that imports
`expo-router/entry` after defining the task.

`onWake`:

1. Read the stored session with `getSessionToken()`.
2. Fetch the message through the **existing mobile API**: `POST /api/xmpp/token`
   via `createChatApi(getSessionToken).getXmppToken()`
   (`apps/mobile/src/lib/chat-api.ts:62`, built at
   `apps/mobile/src/store/effects/ports.ts:222`), then connect with
   `@zilar/xmpp-core` and call `loadHistory(chatJid, kind)`, which runs a MAM query
   (`packages/xmpp-core/src/mam.ts:17-46`,
   `packages/xmpp-core/src/core-effect/operations.ts:266-305`). Pick the entry whose
   origin id equals the wake's `messageId`. **Note:** there is no REST
   "message by id" route (checked `packages/api-contract/src/`), so MAM is the
   existing path; if the fetch is too slow in a killed-app task, the fallback is a
   new tiny server route that returns one message's sender and text by origin id —
   the server's own archive code (`archive-scan.ts`) already does this.
3. Read `showPreviews` from `GET /api/push/settings` (`push.settings` in
   `packages/api-contract/src/push.ts:105-107`, reachable as `client.push.settings()`
   through the shared client). Absent = on, matching `store.ts:247`.
4. `Notifications.scheduleNotificationAsync` with `title = senderName`,
   `body = showPreviews ? text : 'New message'`, `data: { chatId, messageId }`, and
   a `channelId`. When the app is in the foreground the existing
   `setNotificationHandler` decides what to show.

The notification is local, so Google never sees the text.

### 4.5 Tapping the notification

The notification's `data.chatId` is the chat JID the app already uses in its routes
(`/chat/<jid>`); a response listener in the root layout reads
`getLastNotificationResponse()` and `addNotificationResponseReceivedListener` and
pushes that route (Expo notifications doc, "Handle push notifications with
navigation"). iOS `contentAvailable` / `mutable-content` are not needed for the
Android milestone.

### 4.6 Sign-out

On sign-out (`signOutSession`, `apps/mobile/src/lib/auth.ts:136-138`): remove the
task's registration is *not* needed (the token stays valid on the device), but the
device row must go: `DELETE /api/push/subscriptions/:id` with the last stored id,
and send `<disable/>` for the node, before the session token is cleared. A best
effort is fine — the component drops publishes for an unknown node
(`api-subscribe.ts:41-47`).

---

## 5. iPhone (prepare, do not build)

### 5.1 APNs token-based auth

Use a `.p8` **key** (not a certificate): Apple issues one key, and the server signs
a short-lived JWT with it. The inputs are the key file, its Key ID and the Team ID
(Apple, "Establishing a token-based connection to APNs"). Sygnal and Mattermost
both use exactly this trio:

- Sygnal's `apns` app type: `keyfile`, `key_id`, `team_id`, `topic` (the bundle id),
  plus `platform` production/sandbox and `push_type` (Sygnal README,
  `element-hq/sygnal`).
- Mattermost: `AppleAuthKeyFile`, `AppleAuthKeyID`, `AppleTeamID`,
  `ApplePushTopic`, `ApplePushUseDevelopment`
  (Mattermost, "Push notification service").

### 5.2 The Notification Service Extension

`mutable-content: 1` lets a Notification Service Extension rewrite the alert before
it is shown (Apple, "Modifying content in newly delivered notifications"). The
mechanism:

1. The server (or relay) sends `aps: { alert: { title: "Zilar", body: "New message" },
   "mutable-content": 1, "content-available": 1 }` plus the ids.
2. The extension (an app-extension target, ~30 s budget, shared session token via an
   app group) fetches the message from its own server, and rewrites the body with
   the sender and text when show-previews is on; otherwise it leaves the generic
   body.
3. `apns-topic` must be the app's bundle id (`app.zilar.chat`, `app.json:11`) and
   `apns-push-type: alert`, `apns-priority: 10`.

**Expo config.** `expo-notifications` ships no first-class plugin for arbitrary
extension code; its own docs say that to enrich iOS notifications you "need to add a
Notification Service Extension target" (Expo sending doc, `richContent` note). With
CNG that means an Expo config plugin (config-plugin `mod`s that add the extension
target to the Xcode project) or a small `ios/` prebuild patch; this is the part I
mark **unverified** until a spike runs it. `enableBackgroundRemoteNotifications` is
the config-plugin switch that sets `UIBackgroundModes: remote-notification`.

### 5.3 The publisher relay

A tiny service the publisher runs, so any self-hosted Zilar server can push to the
one official app without holding the Apple key.

**Request** (server → relay):

```
POST https://push.zilar.app/v1/push
Authorization: Bearer <relay token>
{ "token": "<apns or fcm device token>", "platform": "apns" | "fcm",
  "wake": { "chatId": "...", "messageId": "...", "serverId": "..." } }
```

**Response:** `{ "ok": true }`, or `{ "ok": false, "gone": true }` so the server can
drop the device (`removeDeviceByNode`).

Design points:

- **Auth scheme:** a per-install bearer token (or HMAC over the body). Unlike
  Sygnal, which is an open gateway per the Matrix push-gateway spec
  (`https://spec.matrix.org/latest/push-gateway-api/`, `POST /_matrix/push/v1/notify`,
  no auth, returns `rejected` pushkeys), a public relay for a consumer app needs a
  credential so it cannot be used as free infrastructure.
- **Rate limit:** per token and per device (for example 60/min/token, 10/min/device),
  returning `429` with `Retry-After`. Both Sygnal (gateway) and Mattermost (proxy)
  are self-hosted and unthrottled by default; a shared consumer relay must throttle.
- **No text:** the body carries ids only; the relay never sees a message. Mattermost
  by contrast ships message text in `send_push` (`{"type":"message","message":"test",
  ...,"server_id":...,"device_id":...,"channel_id":...}`, Mattermost "Test the
  Mattermost push notification service"), which is exactly the model we avoid.
- **Android self-host option:** a self-hoster may hold their own Firebase service
  account and call FCM directly (§2) and use the relay only for `apns`; the relay can
  also hold the FCM key so a self-hoster needs no Google account at all. Sygnal does
  the same: its `gcm` app type takes `api_version: v1`, `project_id` and a
  `service_account_file`, so one gateway serves both platforms.
- **Where it lives:** either a new `apps/relay` workspace package or a server "mode"
  (`PUSH_RELAY_ENABLED`, which serves `POST /v1/push` and nothing else). A separate
  app keeps the Apple/FCM secrets out of the chat server image; that is the
  recommendation.

---

## 6. What Julio must provide

### 6.1 Firebase (Android, now)

1. Open `https://console.firebase.google.com` → **Add project** → name it (for
   example "Zilar") → **Create project**.
2. In the project, click **Add app → Android**. Package name: **`app.zilar.chat`**
   (must match `apps/mobile/app.json:14`) → **Register app**.
3. **Download `google-services.json`** and place it at
   `apps/mobile/google-services.json`.
4. **Project settings (gear) → Service accounts → Generate new private key →
   Generate key.** This downloads a service-account JSON. This file is a **secret**
   (§6.3); put its contents in `FCM_SERVICE_ACCOUNT_JSON`.
5. Copy `project_id` from that JSON into `FCM_PROJECT_ID` (optional; the server can
   read it from the JSON).
6. In Google Cloud Console (`console.cloud.google.com`) → **APIs & Services →
   Credentials**, restrict the Android API key that `google-services.json` carries
   (Android apps + `app.zilar.chat`), so the public copy is not an open key.

### 6.2 Apple (iPhone, later)

1. `https://developer.apple.com/account` → **Certificates, Identifiers & Profiles →
   Keys → +**. Name it (for example "Zilar APNs"), tick **Apple Push Notifications
   service (APNs)**, **Configure**, then **Continue → Register**.
2. **Download** `AuthKey_XXXXXXXXXX.p8` — Apple lets you download it once. This file
   is a **secret**. Note the **Key ID**.
3. Note the **Team ID** (Apple Developer account → Membership).
4. Enable the **Push Notifications** capability on the app's bundle id
   `app.zilar.chat`.
5. Hand the relay: the `.p8`, the Key ID, the Team ID and the topic
   `app.zilar.chat`.

### 6.3 Secret vs repository

| File | Secret? | Where it goes |
| --- | --- | --- |
| `google-services.json` | **no** | may sit in the repo at `apps/mobile/google-services.json` |
| service-account JSON | **yes** | `FCM_SERVICE_ACCOUNT_JSON` env only, never committed |
| `AuthKey_*.p8` (+ Key ID) | **yes** | relay's env/secret store only, never committed |

Firebase's own guidance: API keys restricted to Firebase services "do not need to
be treated as secrets, and it's safe to include them in your code or configuration"
(`firebase.google.com/docs/projects/api-keys`; the security checklist repeats it).
The service-account JSON is a private key and the `.p8` is a signing key — both are
`AGENTS.md` "never commit" material. Add `google-services.json` only once the API key
is restricted (§6.1 step 6).

---

## 7. The task split

Seven tasks. Tasks 1–4 are server, 5–6 mobile, 7 the deferred iPhone/relay work.
Each stays inside the Allowed files it lists; the schema task is alone.

**Task 1 — schema + store: the device kind (server, alone).**
Allowed: `apps/server/drizzle/0047_native_push.sql` (new),
`apps/server/drizzle/meta/_journal.json` (not needed by the loader, which reads the `.sql` files, `apps/server/src/effect/sql.ts:169-172`; touch it only if a test checks it),
`apps/server/src/db/migrate.test.ts`, `apps/server/src/effect/sql.test.ts`, `apps/server/src/topics/backfill.test.ts` (only if they pin the migration count, as T-0849 had to edit them),
`apps/server/src/push/store.ts`, `apps/server/src/db/rows.ts`,
`apps/server/src/push/subscriptions.ts` (native token schema),
`apps/server/src/push/store.test.ts` (new).
Tests: web-push row round-trips unchanged; a native row stores kind+token and
`openNativeDevice` returns it; the 20-device cap still holds; the same token
registered twice leaves one row; a mismatched kind/shape is rejected by the
constraint.

**Task 2 — server: FCM token minting + sender (server).**
Allowed: `apps/server/src/push/fcm-token.ts` (new), `apps/server/src/push/fcm.ts`
(new), `apps/server/src/push/fcm-token.test.ts` (new),
`apps/server/src/push/fcm.test.ts` (new), `apps/server/src/push/config.ts`.
Tests (no real Google call; a locally generated RSA key stands in for the service
account): the JWT is RS256 and carries the right `iss`/`scope`/`aud`; the token is
cached until near expiry and a single refresh is shared; a 404 `UNREGISTERED`
answers `{ gone: true }`; 400/403/5xx answer a send failure; the config names the
missing FCM variables without echoing a value.

**Task 3 — server: delivery branches by device kind (server).**
Allowed: `apps/server/src/push/delivery.ts`, `apps/server/src/push/service.ts`,
`apps/server/src/push/payload.ts`, `apps/server/src/push/sender.ts`,
`apps/server/src/push/delivery.test.ts` (new).
Tests: an FCM device sends a data-only wake with `chatId`/`messageId`/`serverId` and
no text; a web-push device takes the old path; a muted or hidden scan still drops
before either sender; a `gone` result removes the node; `markDeviceUsed` and the
dedupe still run for native.

**Task 4 — server: API contract, subscribe kind, wiring (server).**
Allowed: `packages/api-contract/src/push.ts`, `apps/server/src/push/api-subscribe.ts`,
`apps/server/src/push/api-handlers.ts`, `apps/server/src/push/api.ts`,
`apps/server/src/main.ts`.
Tests: subscribe accepts `{ kind: 'fcm', token }` and stores it, rejects an unknown
kind with 400 `invalid_subscription`, and still accepts the Web Push body; the
config route and the wiring boot with FCM configured.

**Task 5 — mobile: packages, config, register/unregister (mobile).**
Allowed: `apps/mobile/package.json`, `apps/mobile/app.json`,
`apps/mobile/google-services.json` (new), `apps/mobile/src/lib/push/native.ts`
(new), `apps/mobile/src/lib/push/native.test.ts` (new),
`apps/mobile/src/auth/session.ts`, `apps/mobile/src/lib/auth.ts` (sign-out is `signOutSession`, `:136`; lead fix 2026-10-11).
Tests: the token→`{ kind, token, userAgent }` payload mapping; sign-out issues the
scoped delete; no Expo push token is requested.

**Task 6 — mobile: background wake → local notification → deep link (mobile).**
Allowed: `apps/mobile/src/lib/push/background.ts` (new),
`apps/mobile/src/lib/push/notify.ts` (new),
`apps/mobile/src/lib/push/background.test.ts` (new),
`apps/mobile/src/app/_layout.tsx`.
Tests: a wake payload resolves the message through the injected XMPP fake and shows
sender + text when show-previews is on and "New message" when off; a tap routes to
`/chat/<jid>`; a missing session does nothing.

**Task 7 — iPhone: APNs + publisher relay (deferred, blocked on the Apple account).**
Allowed (when started): a new `apps/relay/` package or a `PUSH_RELAY_*` mode in
`apps/server`, plus the iOS extension via an Expo config plugin.
Tests: APNs JWT signing (`node:crypto`, `.p8`), the relay's auth and rate limit, the
`gone` response, and that the request body carries ids only. This is the one task
that may need a decision from Julio on "new app vs server mode" (§5.3).

---

## Sources

Repo: all `apps/server/src/push/*`, `apps/server/src/db/rows.ts`,
`apps/server/drizzle/0031_glossy_wasp.sql`, `apps/server/src/effect/sql.ts`,
`apps/server/src/main.ts`, `apps/server/src/app.ts`,
`packages/api-contract/src/push.ts`, `apps/mobile/app.json`,
`apps/mobile/package.json`, `apps/mobile/src/lib/*`,
`packages/xmpp-core/src/mam.ts`, `packages/xmpp-core/src/core-effect/operations.ts`,
`docs/PUSH_SPIKE.md`.

Web (fetched 2026-10-11):

- Expo SDK 57 Notifications — `https://docs.expo.dev/versions/v57.0.0/sdk/notifications/`
  (page date 2026-09-25): headless background notifications, `registerTaskAsync`,
  `getDevicePushTokenAsync`, `enableBackgroundRemoteNotifications`, Android
  permission/channel order.
- Expo — Send notifications — `https://docs.expo.dev/push-notifications/sending-notifications/`
  (page date 2026-09-25): `contentAvailable`, `mutableContent`, `DeviceNotRegistered`,
  the `richContent` note that iOS needs a Notification Service Extension target.
- FCM HTTP v1 send — `https://firebase.google.com/docs/cloud-messaging/send/v1-api`
  (updated 2026-10-08): endpoint, `Authorization: Bearer`, `firebase.messaging` scope.
- FCM error codes — `https://firebase.google.com/docs/cloud-messaging/error-codes`
  (updated 2026-10-08): `UNREGISTERED` = 404, `SENDER_ID_MISMATCH`, `QUOTA_EXCEEDED`.
- Google OAuth2 service accounts —
  `https://developers.google.com/identity/protocols/oauth2/service-account`
  (updated 2026-03-23): RS256 JWT, `oauth2.googleapis.com/token`, `expires_in: 3600`.
- Apple, token-based APNs connection —
  `https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns`.
- Apple, modifying content in newly delivered notifications —
  `https://developer.apple.com/documentation/usernotifications/modifying-content-in-newly-delivered-notifications`.
- Matrix Push Gateway API — `https://spec.matrix.org/latest/push-gateway-api/` (v1.19).
- Sygnal — `https://github.com/element-hq/sygnal` (README): `apns`/`gcm` app types,
  `keyfile`/`key_id`/`team_id`/`topic`, `service_account_file`.
- Mattermost push proxy —
  `https://developers.mattermost.com/contribute/mobile/push-notifications/service/`:
  server → proxy, `send_push` body, `.p8` config.
- Firebase API keys — `https://firebase.google.com/docs/projects/api-keys`.
- Expo bundled native modules (SDK 57) — `expo@57.0.25` `bundledNativeModules.json`.
