---
id: T-1139
title: "Native push 5/6 (mobile): expo-notifications + google-services.json; after sign-in the app gets its FCM token, registers { kind: 'fcm', token } and sends the XMPP <enable/>; sign-out deletes the device; no Expo push token"
status: merged
milestone: M5
branch: task/T-1139-mobile-push-register
model: auto
effort: default
depends_on: [T-1138]
estimate: 0.4 day
---

# T-1139: The phone registers for push

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11: Android push through FCM, with no text in the push and no second app. The server side is done: `POST /api/push/subscriptions` accepts `{ kind: 'fcm', token, userAgent }` and answers `{ id, node, jid }` (T-1138). This is Task 5 of `docs/audit/native-push-plan.md` §7; **read §4.1-4.3 and §4.6**. Task 6 (the background wake and the local notification) comes next. **Do not build it here.**

Julio downloaded the Firebase file: `/Users/julio/Downloads/google-services.json` (project `zilar-db993`, package `app.zilar.chat`). It is not a secret, so it goes into the repo.

**What the lead read:**
- **`apps/mobile/package.json`:** `expo ~57.0.25` (`:32`) and `"main": "expo-router/entry"` (`:5`). Neither `expo-notifications` nor `expo-task-manager` is installed.
- **`apps/mobile/app.json`:** `android.package` is `app.zilar.chat` (`:13-14`); the plugins list is at `:44-67`.
- **The API client pattern:** `createApiClient({ getToken, fetchImpl, apiUrl })` (`apps/mobile/src/lib/effect/api-client.ts:19`), used as in `apps/mobile/src/lib/stickers-api.ts:1-14` with `API_URL` (`apps/mobile/src/lib/auth.ts:22`), `getSessionToken` (`apps/mobile/src/lib/session-token.ts`) and `runApi`.
- **The XEP-0357 enable** is in xmpp-core: `setPushEnabled({ pushJid, node, enable })` (`packages/xmpp-core/src/types.ts:297`). The web calls it through its store's `setPushPair` (`apps/web/src/store/effects/pins.ts:107-118`). The mobile store keeps its XMPP core in `locals.core` (`apps/mobile/src/store/effects/locals.ts`), and its connection status is `'offline' | 'connecting' | 'online' | 'reconnecting'` (`apps/mobile/src/store/types.ts:46`).
- **The store lifecycle:** it starts when the session is authenticated (`apps/mobile/src/store/chat-store-provider.tsx:121-128`).
- **Sign-out:** `signOut` in `apps/mobile/src/auth/session.ts:56` calls `signOutSession` (`apps/mobile/src/lib/auth.ts:136`). The session token is cleared after that (`apps/mobile/src/auth/session-store.ts:149-154`).

### What to build
1. **Install** `expo-notifications` and `expo-task-manager` at the SDK 57 versions (`pnpm --filter @zilar/mobile exec expo install expo-notifications expo-task-manager`). Commit `apps/mobile/package.json` and `pnpm-lock.yaml`.
2. **Copy** `/Users/julio/Downloads/google-services.json` to `apps/mobile/google-services.json`.
   - In `app.json`, set `android.googleServicesFile: "./google-services.json"`.
   - Add `"expo-notifications"` to `plugins`.
   - **Do not run `expo prebuild`;** the lead does that when building the APK.
3. **A store action `setPushPair({ pushJid, node, enable })`** in the mobile store, working like the web one (`apps/web/src/store/effects/pins.ts:107-118`): it fails when `locals.core` is missing or has no `setPushEnabled`.
   - Put the effect in a new `apps/mobile/src/store/effects/push-pair.ts`.
   - Add the action in `apps/mobile/src/store/real-store.ts` (which stays at most 400 lines) and its type in `apps/mobile/src/store/types.ts`.
4. **A new `apps/mobile/src/lib/push/native.ts`:**
   - **`registerNativePush({ setPushPair })`** runs, all best effort, and logs or throws no token:
     - on Android only, create the channel `messages` ("Messages", high importance) **before** asking permission (plan §4.2);
     - `getPermissionsAsync`, then `requestPermissionsAsync` if it isn't granted yet; stop quietly if it is denied;
     - `getDevicePushTokenAsync()` returns the FCM token. **Never call `getExpoPushTokenAsync`.**
     - `POST /api/push/subscriptions` with `{ kind: 'fcm', token, userAgent: 'Zilar Android' }` through `createApiClient`;
     - then `setPushPair({ pushJid: jid, node, enable: true })`;
     - save `{ id, node, jid }` in SecureStore under the key `zilar.push.registration`.
   - **`unregisterNativePush()`** reads the saved registration and calls `DELETE /api/push/subscriptions/:id`, with a 3-second timeout. It clears the key and never throws. Sending `<disable/>` is not needed: the server drops publishes for an unknown node.
   - **`Notifications.addPushTokenListener`:** when the token rolls, register again.
5. **When to register:** in `apps/mobile/src/store/chat-store-provider.tsx`, once the store status first becomes `'online'` after a sign-in, call `registerNativePush` once per signed-in session. Also run it on every cold start; the server dedupes on `(user_id, token)`.
6. **Sign-out:** in `apps/mobile/src/auth/session.ts:56`, await `unregisterNativePush()` before `signOutSession`, so the bearer token is still there.
7. **Mock mode:** register nothing (see how `chat-store-provider.tsx` detects mock).
8. **Tests** (auth and the message pipeline), in a new `apps/mobile/src/lib/push/native.test.ts`, with at most 3. Mock `expo-notifications` and the fetch.
   - The request body is exactly `{ kind: 'fcm', token, userAgent }`, and `getExpoPushTokenAsync` is never called.
   - A denied permission sends nothing.
   - `unregisterNativePush` sends the DELETE for the saved id and clears the key.

### Read first
`AGENTS.md`, `docs/audit/native-push-plan.md` §4, `apps/mobile/app.json`, `apps/mobile/package.json`, `apps/mobile/src/lib/stickers-api.ts`, `apps/mobile/src/lib/effect/api-client.ts`, `apps/mobile/src/store/chat-store-provider.tsx`, `apps/mobile/src/auth/session.ts` and `apps/web/src/store/effects/pins.ts:104-118`.

### Allowed files
`apps/mobile/package.json`, `pnpm-lock.yaml`, `apps/mobile/app.json`, `apps/mobile/app.config.ts`, `apps/mobile/.gitignore`, `apps/mobile/src/lib/push/native.ts`, `apps/mobile/src/lib/push/native.test.ts`, `apps/mobile/src/store/effects/push-pair.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/chat-store-provider.tsx`, `apps/mobile/src/auth/session.ts`, `work/T-1139-mobile-push-register.md`.

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run src/lib/push/native.test.ts src/store/real-store.sign-out.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- `real-store.ts` stays at most 400 lines.
- **Lead check after merge:** build the APK and sign in on Julio's phone. A device row of kind `fcm` appears, and signing out removes it.

---

## Report (written by the worker when done)

Status: review. All Checks pass; `pnpm gate` ends with `GATE PASS` and every changed file is inside the Allowed files.

### What I did

1. **Packages.** `pnpm --filter @zilar/mobile exec expo install expo-notifications expo-task-manager` installed the SDK 57 versions `expo-notifications ~57.0.22` and `expo-task-manager ~57.0.21` (Expo picked the compatible versions; the plan's table said `~57.0.21`/`~57.0.20`). `apps/mobile/package.json` and `pnpm-lock.yaml` are committed; `expo prebuild` was not run.
2. **Firebase file (Julio's 2026-10-11 change).** `google-services.json` is **not** committed. It is now listed in `apps/mobile/.gitignore` (line 37) and I confirmed `git check-ignore apps/mobile/google-services.json` matches and `git ls-files` returns nothing for it. The copy is present on disk only for local builds. A new `apps/mobile/app.config.ts` takes the `app.json` config and adds `android.googleServicesFile: './google-services.json'` **only** when the file exists (`existsSync(join(projectRoot, 'google-services.json'))`); without it the config is exactly `app.json`. `"expo-notifications"` was added to `plugins` in `app.json`.
3. **Store action `setPushPair`.** New `apps/mobile/src/store/effects/push-pair.ts` (`makePushPair`), the mobile twin of the web `setPushPair` (`apps/web/src/store/effects/pins.ts:107-118`): it fails with `the chat connection cannot toggle push` when `ctx.s.core` is missing or has no `setPushEnabled`. The action is spread into the store in `real-store.ts` and typed in `types.ts`.
4. **`apps/mobile/src/lib/push/native.ts`.**
   - `registerNativePush({ setPushPair, ... })`: on Android only it creates channel `messages` ("Messages", `AndroidImportance.HIGH`) before the permission prompt; then `getPermissionsAsync` → `requestPermissionsAsync` when not granted → quiet return when still denied; then `getDevicePushTokenAsync()` (never `getExpoPushTokenAsync`); `POST /api/push/subscriptions` with `{ kind: 'fcm', token, userAgent: 'Zilar Android' }` through `createApiClient`; `setPushPair({ pushJid: jid, node, enable: true })`; then the registration is saved in SecureStore under `zilar.push.registration`. It is best effort and never throws; it logs a warning for a missing token or a failure.
   - `unregisterNativePush()`: reads the saved registration, `DELETE /api/push/subscriptions/:id` with a 3-second timeout (`withTimeout`), clears the key, never throws.
   - `watchPushTokenRolls(deps)`: wraps `Notifications.addPushTokenListener` and re-registers with the token the listener hands over (see Deviations).
5. **When to register.** `chat-store-provider.tsx` subscribes to the store once `active` (authenticated) and calls `registerNativePush` the first time `status === 'online'`, once per signed-in session; the effect cleanup removes the token-roll listener on sign-out. Mock mode registers nothing (`if (!active || mock) return;`).
6. **Sign-out.** `apps/mobile/src/auth/session.ts` awaits `unregisterNativePush()` before `signOutSession`, so the bearer token is still valid.
7. **Tests.** `apps/mobile/src/lib/push/native.test.ts`, 3 tests, mocking `expo-notifications`, `expo-secure-store`, `react-native` and the injected fetch: exact body `{ kind: 'fcm', token, userAgent }` and `getExpoPushTokenAsync` never called; denied permission sends nothing; `unregisterNativePush` sends the DELETE for the saved id and deletes the key.

### Deviations from the spec (and why)

- **`google-services.json` / `app.config.ts`**: per Julio's change, exactly as above.
- **`session.ts` uses a dynamic import** of the push module: `unregisterNativePush` pulls in `expo-notifications`, which Node/Vitest cannot load (`__DEV__ is not defined`). The static import made `src/auth/session.test.ts` fail at import time in the gate. The existing `session-token.ts` uses the same dynamic-import pattern for `expo-secure-store`. The unregister failure is ignored (`Effect.ignore`) so sign-out always proceeds.
- **A small extra export, `watchPushTokenRolls`**: Expo's docs for `addPushTokenListener` say not to call `getDevicePushTokenAsync` inside the listener (it can loop). The listener therefore re-registers with the token it receives; `registerNativePush` itself does the full channel+permission flow. The provider attaches the listener while a session is active and removes it on sign-out.
- **Order inside a registration**: the `setPushPair` (XEP-0357 enable) failure is caught on its own so the `{ id, node, jid }` is still saved even when the enable IQ fails. Otherwise a failed enable would leak a server device row that sign-out could not delete.

### Commands and real results

- `pnpm install`: ok.
- `pnpm --filter @zilar/mobile exec expo install expo-notifications expo-task-manager`: added `expo-notifications ~57.0.22`, `expo-task-manager ~57.0.21`.
- `pnpm --filter @zilar/mobile exec expo config --json` (parsed with `node -e`): `plugins` ends with `"expo-notifications"`; `android.googleServicesFile` = `./google-services.json`; `android.package` = `app.zilar.chat`.
- `pnpm --filter @zilar/mobile exec vitest run src/lib/push/native.test.ts src/store/real-store.sign-out.test.ts --maxWorkers=2 --reporter=dot`: **2 files passed, 5 tests passed**.
- Also ran while working: `... vitest run src/lib/push/native.test.ts` (3 passed) and `... vitest run src/auth/session.test.ts src/lib/push/native.test.ts` (17 passed).
- `pnpm gate` (final run, current tree):
  ```
  gate: 13 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.6s)
  PASS  typecheck  (0.8s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/mobile  (3.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Files changed

`apps/mobile/package.json`, `pnpm-lock.yaml`, `apps/mobile/app.json`, `apps/mobile/app.config.ts` (new), `apps/mobile/.gitignore`, `apps/mobile/src/lib/push/native.ts` (new), `apps/mobile/src/lib/push/native.test.ts` (new), `apps/mobile/src/store/effects/push-pair.ts` (new), `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/chat-store-provider.tsx`, `apps/mobile/src/auth/session.ts`, `work/T-1139-mobile-push-register.md`. `real-store.ts` is 309 lines (≤ 400).

### Security checklist

- The FCM token and the bearer token never reach logs: warn messages carry a fixed sentence and the caught error only; the request body is not logged. SecureStore holds the registration; `google-services.json` is ignored and untracked.
- The DELETE is scoped to the saved registration id for the current session; the mobile API rejects with `unauthorized` before sending when no session token is stored.
- `unregisterNativePush` runs before the token is cleared, so the delete is authenticated.

### Open questions / not done here

- Task 6 (the background wake and the local notification) is not built here, as the spec says.
- I did not run `expo prebuild` or build the APK (the lead's job).
- The phone smoke (a device row of kind `fcm` appears on sign-in and disappears on sign-out) still needs Julio's phone.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 2 nits; nit 2 becomes the server follow-up T-1141.**
- **`google-services.json` stays out of git** (Julio's call): it is in `apps/mobile/.gitignore` and not tracked (`git ls-files` shows 0). `app.config.ts` adds `googleServicesFile` only when the file exists, so a build without it works as before.
- **`lib/push/native.ts` (187 lines):** the channel `messages` is created first, then permission, then `getDevicePushTokenAsync`; there is no Expo push token. Then `POST { kind: 'fcm', token, userAgent }`, then `setPushPair` enable, and the registration is saved in SecureStore. The token listener re-registers. Sign-out sends the DELETE with a 3 s timeout before `signOutSession`.
- **Accepted nit 1:** the timeout doesn't abort the request; it only leaves a socket open.
- **Nit 2, fixed on the server by T-1141:** an offline sign-out leaves the old account's row on the same token. The server removes other users' rows for a token when it is registered again.
- **Tests:** the lead ran `native.test.ts` and `real-store.sign-out.test.ts` on the branch: 5 green. `real-store.ts` is 309 lines.
- **The phone check is still to do:** with the APK built using the local `google-services.json` and a sign-in on Julio's phone, an `fcm` device row should appear.
