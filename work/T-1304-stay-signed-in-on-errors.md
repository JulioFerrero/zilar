---
id: T-1304
title: "Stay signed in when the server is down: a failed session check (5xx, timeout, offline) keeps the user in the app and retries; only a 401 signs out — mobile and web; tested"
status: merged
milestone: M5
branch: task/T-1304-stay-signed-in-on-errors
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1304: Stay signed in when the server is down

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13: the Android app sent him to the login screen during a deploy, and he wants it to "never go to the login if the server is down". The phone's log shows the app restarted at 00:37:52 (22:37 UTC), while the server answered 502 during a deploy (22:36–22:40 UTC). He then hit the send-code rate limit trying to sign in again.

- **Mobile** (`apps/mobile/src/auth/session-store.ts:86-101`):
  - `bootstrap` reads the stored token and calls `api.fetchMe(token)`;
  - on **any** failure it sets `status: 'guest'`, which the guard (`apps/mobile/src/auth/guard.ts:19`) turns into the login screen;
  - it only deletes the token on a 401 (`isUnauthorized`, `:69-71`), so the session is still valid, but the user sees login anyway.
- **Web** (`apps/web/src/auth/AuthProvider.tsx:29`, `:86-88`):
  - `authClient.useSession()` gives `data`, `isPending` and `refetch`;
  - when `data` is null and not pending, the state is `guest`, and `RequireAuth` (`apps/web/src/routes/AppRoutes.tsx:68-76`) redirects to `/login`;
  - a 502 from `/api/auth/get-session` therefore looks the same as "signed out".

### What to build
1. **Mobile `session-store.ts`:**
   - in `bootstrap`, a failure that is **not** a 401 never sets `guest`;
   - add a status (for example `'offline'`; cite how `AuthStatus` is typed) that the guard treats like `allow` when the user is known, or like `loading` otherwise;
   - keep the last known `me` (persist it next to the token in the existing session storage, if not already; cite it), so the app opens on the chats;
   - retry `fetchMe` with backoff (1 s, 2 s, 4 s … up to 30 s) until it succeeds (→ `authenticated`) or answers 401 (→ clear the token, then `guest`).
   - The same rule applies to the `fetchMe` right after `signIn` (`:113-127`): don't clear the token on a 5xx or network error; retry instead.
2. **Mobile guard** (`apps/mobile/src/auth/guard.ts`): the new status never routes to login.
3. **Web `AuthProvider.tsx`:**
   - use the `error` that `useSession` returns (check its shape in better-auth; cite it). When there's no `data` and the error isn't a 401, the state is not `guest`: keep the last known user (in memory, plus `sessionStorage` for a reload) and retry `refetch` with the same backoff;
   - `RequireAuth` keeps rendering the app (or the loading screen if no user was ever known) instead of redirecting.
   - Only a real "no session" (`data === null` with no error, or a 401) is `guest`.
4. **UI:** no new screen. The existing offline or "Connecting…" indicators cover it; cite them.
5. **Tests** (auth), up to 4:
   - `apps/mobile/src/auth/session-store.test.ts`:
     - a 502 at bootstrap keeps the token and doesn't go `guest`, then becomes `authenticated` on retry;
     - a 401 clears the token and goes `guest`;
   - `apps/web/src/auth/AuthProvider.test.tsx`: a session error that isn't a 401 doesn't produce `guest`.
6. Keep every file at most 400 lines.

### Read first
`AGENTS.md`, `apps/mobile/src/auth/session-store.ts`, `apps/mobile/src/auth/guard.ts`, `apps/mobile/src/auth/session-storage.ts`, `apps/web/src/auth/AuthProvider.tsx` and `apps/web/src/routes/AppRoutes.tsx`.

### Allowed files
`apps/mobile/src/auth/*.ts`, `apps/mobile/src/auth/*.tsx`, `apps/mobile/src/app/_layout.tsx`, `apps/web/src/auth/*.ts`, `apps/web/src/auth/*.tsx`, `apps/web/src/routes/AppRoutes.tsx`, `work/T-1304-stay-signed-in-on-errors.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --reporter=dot src/auth/session-store.test.ts
pnpm --filter @zilar/web exec vitest run src/auth/AuthProvider.test.tsx --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- **The lead's check:** on the emulator, a dev build pointed at a stopped local server opens on the chats, not on login; on web, the same with the server stopped shows the app, not `/login`.

---

## Report (written by the worker when done)

**Status: review.**

### What I did

A transient session-check failure (5xx, timeout, offline) no longer signs anyone out; only a 401 does.

**Mobile** (`apps/mobile/src/auth/`)
- `session-store.ts`: `AuthStatus` is now `'loading' | 'authenticated' | 'guest' | 'offline'` (was `… | 'guest'`). `bootstrap` and the `fetchMe` right after `signIn` now share one `loadMe` loop: a failure that is **not** a 401 sets `status: 'offline'` and retries `fetchMe` with backoff 1 s, 2 s, 4 s … capped at 30 s (`RETRY_BASE_MS`/`RETRY_MAX_MS`, `retryDelayMs`), until the server answers (`me`) or rejects the token (401). Only a 401 clears the token (+ the cached profile) and goes `guest`. On success the profile is persisted.
- `session-storage.ts`: `SessionStorage` gains `getMe()` / `setMe(me)`; `clearToken()` now drops the token **and** the cached profile together. `createMemorySessionStorage` implements both.
- `secure-session-storage.ts`: the last profile is stored under a second SecureStore key `SESSION_ME_KEY` (`zilar.session-me`) next to the token; `getMe` decodes it with an Effect `struct` schema (same boundary-validation style as `lib/chat-list-cache.ts`) and reads an unusable value as "none"; `clearToken` deletes both keys.
- `guard.ts`: `guardDecision` treats `'offline'` like `allow` when a user is known (`name !== undefined`), otherwise like `loading` — it never returns `login`.
- `RequireAuth.tsx`: `RequireUser` waits while offline with no known user.
- UI: no new screen — the existing mobile connection line (`components/chat/chat-list.tsx:76-78`, `chat-header.tsx:79-83`, `lib/connection.ts`) and the web `Connecting…`/`offline` rows (`components/chatList/rowsSelector.ts:63-64`, `store/storeOptions.ts:3`) cover the state (spec point 4).

**Web** (`apps/web/src/auth/AuthProvider.tsx`)
- Reads `error` from `authClient.useSession()` (better-auth `ReactAuthClient.useSession` returns `error: BetterFetchError | null`; `BetterFetchError` has `status`). With no `data` and an error that is **not** a 401, the state is never `guest`: it keeps the last known user and retries `refetch` with the same backoff (`RETRY_*`/`retryDelayMs`). Only `data === null` with no error, or a 401, is `guest`.
- The last user is kept in memory plus `sessionStorage` (`zilar:lastUser`, id/name/email, decoded with an Effect `struct` schema), so a reload while the server is down opens the app. `RequireAuth` (`routes/AppRoutes.tsx:68-106`) therefore renders the app for a known user, or the existing `Loading…` screen when no user was ever known — never `/login`. `AppRoutes.tsx` needed no change.

### Files changed (all inside Allowed files)

- `apps/mobile/src/auth/session-store.ts`, `session-storage.ts`, `secure-session-storage.ts`, `guard.ts`, `RequireAuth.tsx`
- `apps/mobile/src/auth/session-store.test.ts` (+ the 502-retry test), `guard.test.ts` (+ offline), `session.test.ts` (mock storage gains `getMe`/`setMe`)
- `apps/web/src/auth/AuthProvider.tsx`, `AuthProvider.test.tsx` (+ transient-error test, `sessionStorage.clear()` per test)
- `work/T-1304-stay-signed-in-on-errors.md`

No new dependency.

### Tests I ran (single files, quiet reporter)

- `pnpm install` → done in 11s.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/auth/session-store.test.ts` → **1 file, 10 passed** (includes “keeps the token on a 502 and retries until the profile loads” and “clears the token when the server rejects it”).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/auth/guard.test.ts src/auth/session.test.ts src/auth/session-storage.test.ts src/auth/secure-session-storage.test.ts` → **4 files, 34 passed**.
- `pnpm --filter @zilar/web exec vitest run src/auth/AuthProvider.test.tsx --reporter=dot` → **1 file, 5 passed** (includes “does not report a guest when the session check fails without a 401”).

### `pnpm gate` (repo root) — summary lines

```
gate: 11 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (0.6s)
PASS  lint  (0.6s)
PASS  typecheck  (4.2s)
PASS  effect  (1.5s)
PASS  tests @zilar/mobile  (1.8s)
PASS  tests @zilar/web  (3.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Deviations / notes

- **Test seam:** `createAuthStore` takes an optional `wait?: (ms) => Promise<void>` (default = real `setTimeout`), same idea as the existing injected `api`/`storage` (“so tests use fakes”). Only the new 502 test passes it, to drive the backoff deterministically without fake timers. Production (`session.ts`) does not pass it, so the real 1/2/4…30 s backoff runs.
- **Mobile signIn** awaits the retry loop after a successful OTP (spec: “retry instead”); if the server stays down the login button keeps showing busy until the profile loads or a 401 arrives.
- **Guard wording:** per the spec, offline with a known user is `allow`, so an offline user with an empty display name enters the app instead of the name step. Flagging it since it is a deliberate reading of “treats like `allow` when the user is known”.
- `sessionStorage` (not `localStorage`) is used on web, as the spec says; a brand-new tab with no remembered user and the server down shows the `Loading…` screen while it retries, not `/login`.

### Security checklist

Secrets/tokens never logged (the existing “never logs the session token” test still passes); the cached profile carries no token and is cleared together with the token on 401/sign-out; no new route, no `where`, no cap/uniqueness change; nothing outside the allowed files.

### Round 2 (fix round, findings from PREREVIEW.md)

Fixed: finding 1 (must-fix) and finding 3 (should-fix). Finding 2 is a follow-up whose fix is outside the Allowed files; findings 4 and 5 are nits (4 is outside a line I changed) — none is a must-fix or should-fix, so they are left as they are.

- **Finding 1 — the remembered web user survives a deliberate sign-out while the server is down.** `AuthProvider.tsx` now drops the cached user at mount when the app opens on the login page (`isOnLoginPage()` + `rememberedUserAtMount()`, used by the `knownUser` initializer). A deliberate sign-out reloads the page on `/login` even when its `authClient.signOut()` call failed (`store/effects/lifecycle.ts` calls `goToLogin`, and the real port is `window.location.assign('/login')`), so the login route is the signal that the session is gone. Starting there with the cached user would make `LoginPage` (which redirects when `authenticated`) go straight back into the app under the previous identity. Justification for the route check: no session signal distinguishes a failed sign-out from a transient outage — better-auth’s session atom only changes on a *successful* `/sign-out` (its `atomListeners` run in the fetch `onSuccess` hook, `client/proxy.mjs:47-70`), so on a failed sign-out the atom still reads `data: null, error: 502` exactly like an outage.
- **Finding 3 — document why `.finally()` on `refetch()` is safe.** Added a comment in the retry effect: `refetch` is better-auth’s `fetchSession`, which resolves to `void` and never rejects (the session atom catches the fetch error), so `.finally()` cannot become an unhandled rejection.

Tests added (web `AuthProvider.test.tsx`):

- “drops the remembered user on the login page after a sign-out (finding 1)” — cached user + `data: null`/502 + pathname `/login` → `loading`, and `zilar:lastUser` is gone.
- “keeps the remembered user on an app route while the server is down” — same but on `/` → `authenticated:Ada`, cache kept (guards the pathname check against over-clearing).

Finding 3 is a comment only, so it adds no test. Mobile needed no change (finding 1 already notes `session-store.ts:220-226` clears the token and profile unconditionally).

Single tests:

- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/auth/session-store.test.ts` → **1 file, 10 passed**.
- `pnpm --filter @zilar/web exec vitest run src/auth/AuthProvider.test.tsx --reporter=dot` → **1 file, 7 passed**.

`pnpm gate` (repo root) — summary lines:

```
gate: 11 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (1.3s)
PASS  lint  (0.7s)
PASS  typecheck  (3.9s)
PASS  effect  (1.0s)
PASS  tests @zilar/mobile  (1.6s)
PASS  tests @zilar/web  (3.7s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Disagreements

None.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean after 1 auto round (must-fix and should-fix fixed; 3 nits, 1 follow-up).**
- **Web:** `transientError` = a session error that isn't a 401; it isn't `guest`, the last user is kept in memory and `sessionStorage`, and it retries (`apps/web/src/auth/AuthProvider.tsx:138-161`).
- **Mobile:** the new `offline` status, the last `me` persisted next to the token, backoff retries; only a 401 clears the token.
- **Lead's checks after the rebase:** mobile auth: 6 files, 54 tests pass; web auth: 7 tests pass; tsc: 0 errors in web and mobile. `AuthProvider.tsx` is 284 lines, `session-store.ts` 237.
- **Follow-up:** `app/join/[token].tsx` and `app/at/[handle].tsx` treat `offline` like signed in (harmless failed calls).
- **Lead's check after the merge:** a release APK cold start with the network off, on the emulator.
