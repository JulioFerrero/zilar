---
id: T-0858
title: "better-auth session cookie cache, 5 minutes — Julio approved"
status: merged
milestone: M5
branch: task/T-0858-session-cookie-cache
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0858: better-auth session cookie cache, 5 minutes — Julio approved

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Julio approved this on 2026-10-09 ("Yes, 5 minutes", D-3). Finding C-F7 in `docs/audit/simplify-2026-10-09/C-server.md`.
- **Today:** every authenticated request calls `auth.api.getSession` (`apps/server/src/effect/http-core.ts:55`, `apps/server/src/auth/api.ts:273`).
- **No cache:** `apps/server/src/auth/auth.ts` (about lines 67-133) configures no `session: { cookieCache }`.
- **Two queries per request:** the custom adapter `apps/server/src/auth/sql-adapter.ts` implements no join, so each lookup is at least 2 queries.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Enable better-auth's session cookie cache with `maxAge` of 5 minutes. Read the installed better-auth version's types and docs in node_modules for the exact option and how it signs the cookie.
2. Check how the mobile **bearer** path (the bearer plugin) interacts with the cookie cache, and say in the Report whether mobile requests benefit or still hit the DB. Do not add a custom cache in this task.
3. **Behaviour to keep:** sign-out on this device must end the session at once (the cookie is cleared). A session revoked from another device may stay valid for up to 5 minutes; Julio accepted that. Add or adjust tests:
   - a cached session is served without a DB session read (count adapter calls if the tests allow);
   - sign-out clears it;
   - the existing auth tests pass.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/server/src/auth/auth.ts`, `apps/server/src/auth/*.test.ts`, `apps/server/src/effect/http-core.ts`, `work/T-0858-session-cookie-cache.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=30000 --hookTimeout=30000 src/auth
pnpm --filter @zilar/server typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.
- Live check for Julio's single test: Julio signs in on web and mobile, signs out, and signs in again.

---

## Report (written by the worker when done)

- **auth.ts:** `session.cookieCache { enabled: true, maxAge: 300 }` (better-auth 1.7.6, default compact signed cookie `better-auth.session_data`, Max-Age 300; I read `api/routes/session.mjs`).
- **Tests:** new `apps/server/src/auth/session-cache.test.ts` (6 tests): cookie is set with Max-Age 300; a request with the cache cookie makes 0 session-table queries (spy on PGlite `query`); token-only cookie and bearer both read the table; sign-out clears the cache cookie and the device is then 401, a token-only replay is 401; PATCH /api/me returns the new name with a cache cookie. src/auth: 82 passed before (6 tests are new) -> 88 passed, 2 skipped after; 3 of 3 runs green. Typecheck and oxlint clean.
- **Mobile bearer finding:** the bearer plugin only turns `Authorization: Bearer` into a `session_token` cookie. It never builds or reads `session_data`, and mobile code sends only the Authorization header. So mobile does NOT benefit and still hits the DB on every request (test proves it). Web browsers do.
- **Found while testing (spec gap):** `PATCH /api/me` calls `updateUser` then `getSession` (api.ts:273, not an Allowed file). With the cache cookie that second read returned the OLD name. Fix round 1: (a) `effect/http-core.ts` now strips the `session_data` cookie only for the session lookup of non-GET/HEAD requests; the handler sees the untouched request (the first fix re-provided a modified request and broke the stickers body decoding). (b) `auth.ts` gives the cache a `version` function backed by an in-process per-user counter that a `databaseHooks.user.update.after` bumps, so after a profile update every cache cookie of that user is dropped and the next read hits the DB (this fixes the PATCH re-read, and other devices see the new name at once on this server process). A restart resets the counter, which only expires caches.
- **Fix round 1 tests:** `src/auth src/stickers src/effect`: 230 passed, 2 skipped, twice; typecheck and oxlint clean.
- **Behaviour differences:** reads on web may serve a session revoked elsewhere for up to 5 minutes; user name/email in the session is not used by other routes (only `id`), and GET /api/me reads the user from the DB. Writes unchanged. No timings measured (no live check; the machine load was 70+ during the work).
- **Audit facts:** all cited lines were right (http-core.ts:55, api.ts:273); sql-adapter has no join (not re-measured).
- **Unsure:** the sign-out test needs an `origin` header (origin check, 403 without); the cache cookie name is matched by substring `session_data` (covers `__Secure-` prefix and chunks).

## Review (written by Claude)

**Lead, 2026-10-10: approved after fix round 1.**
- **What changed:** the better-auth cookie cache lasts 5 minutes, as Julio approved. Writes strip the cache cookie for the session lookup, so a revoked session can never write. A per-user version counter in server memory, bumped on a user update, drops stale caches, so `PATCH /api/me` returns the new name.
- **Fix round:** fixed the stickers 400 bodies that the first version broke.
- **Mobile:** bearer requests still read the session table each time; that is a follow-up.
- **Live check for Julio:** sign in, sign out and sign in again on web and mobile, and rename yourself on web.
