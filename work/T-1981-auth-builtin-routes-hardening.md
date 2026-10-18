---
id: T-1981
title: "Auth hardening: turn off two Better Auth HTTP routes the app replaces (/list-sessions, /update-user), and make the account export read the session without the 5-minute cookie cache"
status: merged
milestone: M5
branch: task/T-1981-auth-builtin-routes-hardening
model: deepseek/deepseek-flash
effort: default
estimate: 35 min
---

# T-1981: Auth hardening (built-in routes, export session)

## Spec (written by Claude, do not edit)

### Why
These are fixes from the lead's private security review of 2026-10-18 (T-1968).
- **The two built-in routes.** The app serves its own `/api/sessions` and `PATCH /api/me`, so Better Auth's built-in HTTP routes for the same jobs only widen the attack surface:
  - Better Auth's `list-sessions` endpoint (under the auth mount) returns every session row, token field included;
  - Better Auth's `update-user` endpoint skips the profile rules of `PATCH /api/me` and accepts any `image` URL.
- **The export.** It returns the whole archive, so it must not trust the 5-minute session cache cookie.

### Facts (read by the lead on 2026-10-18; paths under `apps/server/src/`)
- **Config.** `auth/auth.ts` (297 lines) builds Better Auth: `rateLimit` at `:102-111`, `session.cookieCache` at `:112-124`, `advanced` at `:126-136`, `plugins` from `:137`. It sets no `disabledPaths`.
- **Routing.** Every `/api/auth/*` path goes to `auth.handler` (`effect/edge.ts:173-175`).
- **No caller uses the two routes.**
  - The app's session list and revoke are `auth/sessions.ts`, served by `auth/api.ts:176-190`.
  - `PATCH /api/me` validates, then calls `deps.auth.api.updateUser(...)` **in-process** (`auth/api.ts:230-242`).
  - The phone's Devices screen uses the app contract (`apps/mobile/src/lib/auth-api.ts:140-156`), not Better Auth's routes.
- **The export.** It reads the session with `currentSession(deps.auth, headers)` (`auth/export.ts:142`), using the original headers.
  - For GET requests the session layer keeps the cache cookie (`effect/http-core.ts:40-42`); writes strip it through `headersWithoutSessionCache`.
  - `assertFreshSession` then requires a session under 30 minutes old.

### Steps
1. **Turn off the two routes.** In `auth/auth.ts`, add `disabledPaths: ['/list-sessions', '/update-user']` to the Better Auth options.
   - Check against the installed Better Auth version that the in-process `auth.api.updateUser(...)` call in `PATCH /api/me` still works.
   - If it doesn't, refuse only the HTTP route with a `hooks.before` rule instead, and say which one you used in the Report.
2. **Read the export session without the cache.** In `auth/export.ts`, look the session up without the cookie cache: either pass headers stripped of the cache cookie (reuse `headersWithoutSessionCache` from `effect/http-core.ts`), or use Better Auth's `disableCookieCache` query.
   - This covers both the session check and `runExport`.
3. **Add tests (auth is a crucial area).** Put them in the nearest existing auth test file:
   - a GET to the auth mount's `list-sessions` path with a valid session doesn't return sessions (404 or 403);
   - a POST to the auth mount's `update-user` path with a valid session doesn't change the user;
   - `PATCH /api/me` still renames the user.
4. **Keep files at or under 400 lines.**

### Allowed files
- `apps/server/src/auth/auth.ts`
- `apps/server/src/auth/export.ts`
- `apps/server/src/effect/http-core.ts`
- `apps/server/src/auth/auth.test.ts`
- `apps/server/src/auth/sessions.test.ts`
- `apps/server/src/auth/export.test.ts`
- `work/T-1981-auth-builtin-routes-hardening.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/auth --reporter=dot
pnpm gate
```

### Acceptance
- The new tests pass, and the gate passes.
- After deploy, the lead checks live that the auth mount's `list-sessions` path doesn't answer 200 with a session list.
- Renaming in Settings still works.

---

## Report (written by the worker when done)

### What I did

- **Turned off the two built-in routes.** Added
  `disabledPaths: ['/list-sessions', '/update-user']` to the Better Auth options in
  `apps/server/src/auth/auth.ts`.
  - Checked the installed Better Auth version (1.7.6): `disabledPaths` is enforced
    in the router's `onRequest` (`better-auth/dist/api/index.mjs:166-168`), which
    answers `404 Not Found` before the endpoint runs. The in-process
    `auth.api.updateUser(...)` call in `PATCH /api/me` goes through
    `toAuthEndpoints`, not the router, so it is unaffected — and the new rename
    test plus the existing `PATCH /api/me` suite confirm it still works. I used
    `disabledPaths`, not a `hooks.before` rule.
- **Export reads the session without the 5-minute cache.**
  `apps/server/src/auth/export.ts` now calls `currentSession` with
  `headersWithoutSessionCache(headers)`, so both the session lookup and the
  freshness check always hit the `session` table. I reused the existing helper
  from `apps/server/src/effect/http-core.ts` by exporting it (its parameter is now
  `Headers | Record<string, string>`, which covers both existing callers; the
  package has no `DOM` lib, so `HeadersInit` is not a global name).
- **Tests.**
  - `apps/server/src/auth/sessions.test.ts`: new `Better Auth built-in routes`
    block — `GET /api/auth/list-sessions` with a valid session answers 403/404
    and no session token; `POST /api/auth/update-user` answers 403/404 and leaves
    `name`/`image` unchanged; `PATCH /api/me` still renames the user.
  - `apps/server/src/auth/export.test.ts`: new test that signs in with the full
    cookie jar (including `better-auth.session_data`), deletes the caller's
    session rows, and expects the export to answer `401 unauthorized` instead of
    streaming a stale cached session. I verified this test fails with
    `expected 200 to be 401` when the fix is temporarily reverted, then restored
    the fix and re-ran it green.

All edited files are at or under 400 lines.

### Checks run

Single test files while working:

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/sessions.test.ts`
  → 6 passed (1 file).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/export.test.ts`
  → 5 passed (1 file).
- With the export fix temporarily reverted, the new export test failed as
  expected: `expected 200 to be 401` at `export.test.ts:323`.

`pnpm gate` from the repo root (final run):

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (2.7s)
PASS  format  (1.6s)
PASS  lint  (1.1s)
PASS  typecheck  (8.0s)
PASS  effect  (2.5s)
PASS  tests @zilar/server  (32.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

The first gate run failed on `format` for `sessions.test.ts`; I fixed it with
Prettier and the second run failed on `typecheck` because `HeadersInit` is not a
global in this package (`http-core.ts:122`); I changed the helper's parameter
type to `Headers | Record<string, string>` and the final run passed.

### Notes for the lead

- The app's own session list (`GET /api/me/sessions`) and rename
  (`PATCH /api/me`) are untouched; the new tests exercise both through the app.
- No mobile or web caller used the two Better Auth routes: the only matches for
  `/api/auth/list-sessions` and `/api/auth/update-user` in `apps/` are the new
  tests.
- `assertFreshSession` still needs a session under 30 minutes old; the change only
  makes the session itself read from the database, not the cache cookie.
- I did not run the live post-deploy check (it is the lead's step).

## Review (written by Claude)

Approved.
- **Routes turned off.** `disabledPaths` turns off the two built-in routes. The in-process `auth.api.updateUser` call stays, and the tests prove that renaming through `PATCH /api/me` still works.
- **Export.** It now reads the session from the database, through the shared `headersWithoutSessionCache`, which is now exported.
- **Pre-review:** clean.
- **After the deploy,** the lead checks live that the `list-sessions` path no longer answers a session list.
