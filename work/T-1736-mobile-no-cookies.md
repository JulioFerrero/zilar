---
id: T-1736
title: "Phone: never send cookies to the server (credentials: 'omit' on the auth client and the API client), so a stale native session cookie cannot block sign-out and sign-in with a 403 MISSING_OR_NULL_ORIGIN; map that code to a clear message"
status: merged
milestone: M5
branch: task/T-1736-mobile-no-cookies
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1736: The phone app stops sending cookies

## Spec (written by Claude, do not edit)

### Why
On 2026-10-16 Julio signed out of the Android app (v0.2.4). Since then, entering his email answers "Something went wrong. Try again." His account exists (mail@julio.dev).

### Facts (the lead read them on 2026-10-16)
- **The live server log** (`/api/auth/...`, 16:55 to 17:07 UTC):
  - `POST /api/auth/sign-out` answered **403 in 8 ms**;
  - every `POST /api/auth/email-otp/send-verification-otp` after it answered **403 in 3 to 4 ms**;
  - no warning or error line was logged.
- **Better Auth 1.7.6** (`better-auth/dist/api/middlewares/origin-check.mjs`, `validateOrigin`):
  - a POST that carries a `cookie` header must carry an `Origin` (or `Referer`), or it throws `APIError.from("FORBIDDEN", BASE_ERROR_CODES.MISSING_OR_NULL_ORIGIN)` **without logging**;
  - React Native sends no `Origin`.
- **Why the app sends cookies:**
  - Better Auth's client sets `credentials: "include"` by default (`better-auth/dist/client/config.mjs:39`), and the app's own `fetchOptions` override it (`...restOfFetchOptions`, spread after the default);
  - so React Native's native cookie jar keeps the session cookie the server sets at sign-in, and sends it on every auth request.
  - After the 403 on sign-out the server never cleared that cookie, so every later send-code also fails.
- **The app's auth client:** `apps/mobile/src/lib/auth.ts:40-57` (`createZilarAuthClient`, `fetchOptions` with `customFetchImpl`, bearer `auth` and `onSuccess`). It's created in `apps/mobile/src/auth/session.ts:23`.
- **The app's API client:** `apps/mobile/src/lib/effect/api-client.ts:20-45` (`createApiClient`). Its `adapter` passes `init` through to `fetchWithTimeout` with no `credentials`, so it also sends cookies. On our own routes, a stale cookie could even stand in for a signed-out user.
- **The message:** `apps/mobile/src/auth/errors.ts:4-19` maps the error codes to messages; `MISSING_OR_NULL_ORIGIN` falls through to "Something went wrong. Try again.".
- **Existing tests:** `apps/mobile/src/lib/auth.test.ts` builds the client with a capturing `fetchImpl` (lines 71-133).

### Steps
1. **`apps/mobile/src/lib/auth.ts`:** in `createZilarAuthClient`'s `fetchOptions`, add `credentials: 'omit'`, with a short comment on why (the bearer token only; a native cookie jar plus no `Origin` gives a 403 `MISSING_OR_NULL_ORIGIN`).
2. **`apps/mobile/src/lib/effect/api-client.ts`:** in `adapter`, pass `credentials: 'omit'` in the init given to `fetchWithTimeout`.
3. **`apps/mobile/src/auth/errors.ts`:** map `MISSING_OR_NULL_ORIGIN` and `INVALID_ORIGIN` to "Sign-in was blocked. Close the app and try again." (old builds can still hit it).
4. **One test** in `apps/mobile/src/lib/auth.test.ts`: the request the auth client makes carries `credentials: 'omit'` (read it from the captured `init`).
5. **Phone only:** no server change, no UI change.

### Allowed files
- `apps/mobile/src/lib/auth.ts`
- `apps/mobile/src/lib/effect/api-client.ts`
- `apps/mobile/src/auth/errors.ts`
- `apps/mobile/src/lib/auth.test.ts`
- `work/T-1736-mobile-no-cookies.md`

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run src/lib/auth.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **Neither client sends cookies:** the auth and API clients both fetch with `credentials: 'omit'`.
- **The new test passes.** An old-build origin error shows the new message.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did
- `apps/mobile/src/lib/auth.ts`: added `credentials: 'omit'` to `createZilarAuthClient`'s `fetchOptions` (with a comment on why: bearer token only; a native cookie jar with no `Origin` gives a 403 `MISSING_OR_NULL_ORIGIN`). It is spread after Better Auth's default `credentials: 'include'`, so it wins.
- `apps/mobile/src/lib/effect/api-client.ts`: the `adapter` now passes `credentials: 'omit'` in the init handed to `fetchWithTimeout`, so the API client also never sends cookies.
- `apps/mobile/src/auth/errors.ts`: mapped `MISSING_OR_NULL_ORIGIN` and `INVALID_ORIGIN` to "Sign-in was blocked. Close the app and try again." (old builds can still hit it).
- `apps/mobile/src/lib/auth.test.ts`: extended `CapturedRequest` with `credentials`, captured it in both fetch fakes, and added one test in the `sign-in requests` block asserting both the send-code and sign-in requests carry `credentials: 'omit'`.

### Checks run
- `pnpm install` — Done in 17.5s.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/auth.test.ts` — 1 file passed, 8 tests passed (includes the new "never sends cookies" test).
- `pnpm gate` (from repo root) — summary:
  ```
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  tests @zilar/mobile
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  First run failed `format` on `auth.test.ts` (one long line); fixed with `pnpm exec prettier --write apps/mobile/src/lib/auth.test.ts`, then GATE PASS.

### Notes for the lead
- Changed files: `apps/mobile/src/lib/auth.ts`, `apps/mobile/src/lib/effect/api-client.ts`, `apps/mobile/src/auth/errors.ts`, `apps/mobile/src/lib/auth.test.ts`, and this task file.
- I wrote exactly one test, as the Spec's step 4 asks. The `MISSING_OR_NULL_ORIGIN`/`INVALID_ORIGIN` message mapping is not unit-tested (no existing test file for `errors.ts`, and a new test file is outside the Allowed files); I verified it by reading the code only.
- No server or UI change. No new dependencies.

## Review (written by Claude)

- **Accepted at `d388a31b0`.** The pre-review is clean (1 nit, 2 follow-ups) and the packet is current.
- **Device path checked by the lead:**
  - `credentials: 'omit'` makes whatwg-fetch set `xhr.withCredentials = false` (`fetch.umd.js:595`);
  - React Native Android then uses `CookieJar.NO_COOKIES` (`NetworkingModule.kt:371-372`);
  - so the auth client and the API client never send the jar's cookie again. The new test pins `credentials: 'omit'` on send-code and sign-in.
- **Follow-up, in the next phone task:**
  - the remaining raw fetches (`chat-api.ts:113`, `profile-api.ts:202`, `directory-api.ts:144`, `auth-api.ts:176`, `use-client-version.ts:28` and `use-group-picture.ts:158`) get `credentials: 'omit'` too;
  - the stale docstring at `auth.ts:36-38` gets fixed.
