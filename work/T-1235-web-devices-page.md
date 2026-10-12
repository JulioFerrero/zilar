---
id: T-1235
title: "TG-12 sessions, web: Settings → Devices lists your signed-in sessions (this device marked, browser/OS from the user agent, last active, created), Sign out one, and Sign out all other devices — on Better Auth's built-in list-sessions / revoke-session / revoke-other-sessions"
status: merged
milestone: M5
branch: task/T-1235-web-devices-page
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1235: Your devices (web)

## Spec (written by Claude, do not edit)

### Why
It's item 12 of the Telegram parity fix plan (`docs/audit/telegram-parity-audit.md` §4): there's no list of signed-in devices and no way to sign one out.
- The server runs Better Auth 1.7.6 under `/api/auth/*` (`apps/server/src/authz-sweep.test.ts:16`), with the `bearer` and `emailOTP` plugins (`apps/server/src/auth/auth.ts:3,112-128`).
- Its core API already has the routes `/list-sessions`, `/revoke-session` and `/revoke-other-sessions` (`better-auth/dist/api/routes/session.d.mts`).
- The `session` table stores `ip_address`, `user_agent`, `created_at` and `updated_at` (`apps/server/drizzle/0001_nifty_nomad.sql:29-39`).
- The web's `authClient` is `createAuthClient({ plugins: [emailOTPClient()] })` (`apps/web/src/lib/auth.ts:11-13`).

### What to build
1. **Check the routes work through our server:** call them via `authClient.listSessions()`, `authClient.revokeSession({ token })` and `authClient.revokeOtherSessions()`. If a route needs a server option to be on, stop and report it in Blocked; don't change auth config without the lead.
2. **A new page, `apps/web/src/routes/DevicesPage.tsx`,** at `/settings/devices`. Register it next to `/settings/blocked` (`apps/web/src/routes/AppRoutes.tsx:219`), and link it as "Devices" next to "Blocked people" in `apps/web/src/components/chatList/ChatListMenu.tsx:116`. Copy `BlockedPage.tsx`'s layout.
   - **One row per session:**
     - a friendly device line parsed from `userAgent`, such as "Chrome on macOS" or "Zilar on Android", with a small pure parser in the page file or `apps/web/src/lib/user-agent.ts`. An unknown agent shows "Unknown device";
     - "Last active" from `updatedAt` and "Signed in" from `createdAt`, using the chat-core date helpers (cite them);
     - **no IP address on screen.**
   - **The current session:** first, with a "This device" label and no Sign out button. Match it with `authClient.getSession()`'s session id or token.
   - **Sign out on each other row:** an in-page confirm, then `revokeSession`, then the row is dropped.
   - **"Sign out all other devices" at the top,** shown only when there are others: confirm, then `revokeOtherSessions`, then the list reloads.
   - **Errors:** a failure shows one line ("Could not sign out. Try again.") and keeps the row.
   - **Never render or log a session token.**
3. **No tests** (UI; the routes are Better Auth's).

### Note for the Report
- **The revoked device:** say what it sees. T-1223 (if merged) sends a device whose session is gone to the sign-in screen.
- **Native push rows:** check whether `native_push` rows of a revoked session stay behind (T-1139 unregisters only on sign-out). Report it as a follow-up; don't fix it here.

### Read first
`AGENTS.md`, `apps/web/src/lib/auth.ts`, `apps/web/src/routes/BlockedPage.tsx`, `apps/web/src/routes/AppRoutes.tsx`, `apps/web/src/components/chatList/ChatListMenu.tsx` and `apps/server/src/auth/auth.ts:100-140`.

### Allowed files
`packages/api-contract/src/auth.ts`, `apps/server/src/auth/sessions.ts`, `apps/server/src/auth/sessions.test.ts`, `apps/server/src/auth/api.ts`, `apps/web/src/lib/api/**` (fix round 1, lead), `apps/web/src/routes/DevicesPage.tsx`, `apps/web/src/routes/AppRoutes.tsx`, `apps/web/src/components/chatList/ChatListMenu.tsx`, `apps/web/src/lib/user-agent.ts`, `apps/web/src/lib/auth.ts`, `work/T-1235-web-devices-page.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every touched file stays at most 400 lines.
- **The lead's check on live web (read-only):** the page lists Julio's sessions with "This device" first. The lead won't sign anything out.

---

## Report (written by the worker when done)

### What I built (final, after fix round 1)

- **Contract `packages/api-contract/src/auth.ts`**: the auth group gains `GET /api/me/sessions` → `{ sessions }`, each `{ id, createdAt, updatedAt, userAgent?, current }` (newest `updatedAt` first), and `DELETE /api/me/sessions/:id` → 204 (`HttpApiSchema.NoContent`), 404 for a foreign or unknown id and 400 for the caller's own session. The delete uses the shared auth-write budget (see Deviations).
- **Server `apps/server/src/auth/sessions.ts`** (new): `listSessions` and `revokeSession` read/write the `session` table. The list filters `user_id = caller AND expires_at > now()` and marks `current` by comparing with the caller's session id; timestamps are cast `AT TIME ZONE 'UTC'`, like `/me` (`apps/server/src/auth/api.ts:294-297`). The token and `ip_address` never leave the server. The delete is scoped `WHERE id = :id AND user_id = caller`, answers 400 "Use Sign out" for the caller's own session, and writes one audit entry (`session.revoked`, ids only).
- **Server `apps/server/src/auth/api.ts`**: wires the two handlers and builds the audit recorder from the existing deps, so `app.ts` is unchanged (337 lines).
- **Tests `apps/server/src/auth/sessions.test.ts`** (new): 3 tests — the list is the caller's only, exactly one `current`, no `token`; a foreign id is 404 and deletes nothing; the caller's own session is 400.
- **Web `apps/web/src/lib/api/devices.ts`** (new): `listSessions()` / `revokeSession(id)` through the derived client (`callApi((client) => client.auth.…)`).
- **Web `apps/web/src/routes/DevicesPage.tsx`**: Settings → Devices at `/settings/devices`. Layout from `BlockedPage.tsx`. One row per session, this browser first with a "This device" label and no Sign out (taken from the server's `current`); other rows get an in-page confirm → the delete route → the row is dropped; "Sign out all other devices" loops over the non-current ids then refreshes; a failure shows one line and keeps the row; the error line clears on a successful sign-out. Device line from `describeUserAgent`, `Last active`/`Signed in` from chat-core's `formatListTime`/`formatShortDate` (`packages/chat-core/src/format.ts`). No IP, no token.
- **Web `apps/web/src/lib/user-agent.ts`**: "Chrome on macOS"-style label; adds `EdgiOS`, `OPR/` (Opera) and `FxiOS` to the round-0 parser.
- **Web `apps/web/src/lib/auth.ts`**: the round-0 session helpers were removed (the file is back to its base contents); the page no longer imports it.
- **`apps/web/src/routes/AppRoutes.tsx`** and **`apps/web/src/components/chatList/ChatListMenu.tsx`**: the `/settings/devices` route and the "Devices" menu item from round 0 are unchanged.

### Blocker found in pre-review, fixed here

Better Auth's own `/list-sessions` runs `freshSessionMiddleware` (`better-auth/dist/api/routes/session.mjs:347-350`), which answers 403 `SESSION_NOT_FRESH` for any session older than the default 24 h `freshAge`. Our config sets no `freshAge` (`apps/server/src/auth/auth.ts:87-92`), so the round-0 page failed for almost every real user; its revoke routes only use `sensitiveSessionMiddleware` (`:304-311`, no freshness check). The fix adds our own two routes keyed by session id, so no token reaches the client and `freshAge` is left alone (it guards other sensitive routes).

### Where the current session id comes from

The `Session` middleware calls `auth.api.getSession({ headers })` (`apps/server/src/effect/http-core.ts:45-46`) but hands the handler only the user id (`CurrentUser` = `{ id }`, `packages/api-contract/src/middleware.ts:14-21`; provided at `http-core.ts:61`). So each handler re-reads the session with `auth.api.getSession` to get the session id, exactly like `PATCH /me` (`apps/server/src/auth/api.ts:183,186`). The list compares that id to mark `current`; the delete compares it to answer 400.

### "Sign out all other devices"

A client loop over the non-current ids (`Promise.all` in `DevicesPage.tsx`), not a bulk `DELETE /me/sessions`: the collection delete would add a third endpoint, contract line and its own audit semantics, while the loop reuses the route that already exists — the smaller change. Each call spends the same auth-write budget a single sign-out spends.

### The revoked device

- **Web:** the browser keeps Better Auth's signed `session_data` cookie cache for `SESSION_COOKIE_CACHE_SECONDS` = 5 minutes (`apps/server/src/auth/auth.ts:20,87-99`), so the revoked tab can keep working for up to 5 minutes; after that `authClient.useSession()` fails, `RequireAuth` sees `guest` and navigates to `/login`.
- **Native:** bearer requests always read the database (`auth.ts:90-91`), so the server rejects the revoked token at once. The app has no revoked-session handling yet — **T-1223 is still `status: todo`** (not merged on this branch) — so until it lands the app keeps retrying the XMPP token fetch (every 60 s) and does not reach the sign-in screen.

### Follow-up: `native_push` rows survive session revocation (not fixed here)

`push_subscriptions` rows are keyed by `user_id` + `token`/`endpoint` and carry no session id (`apps/server/drizzle/0047_native_push.sql`). Neither Better Auth's `revoke-session` nor the new `DELETE /api/me/sessions/:id` touches the push table, and no server code deletes a push row on revocation. Rows are only removed on delivery failure (`push/delivery.ts:228`), a user-initiated delete (`push/api-handlers.ts:105,289,339`, scoped by `user.id`) or native sign-out (`apps/mobile/src/lib/push/native.ts` `unregisterNativePush`, T-1139). So a revoked device's push row and its ejabberd enable-pair **stay behind** and can keep receiving wakes until it signs out or the user removes the device. Web push rows behave the same. Suggested follow-up: prune a user's push devices on session revocation (there is no session↔device link to do it by today).

### Commands and real results

**Round 0 (superseded by Fix round 1)**

- `pnpm install`: done, no lock change.
- `pnpm gate` (round 0): `FAIL effect` (auth.ts needed Effect), then **GATE PASS** with 6 changed files and `SKIP tests @zilar/web`.

### Fix round 1

- `pnpm --filter @zilar/server exec vitest run src/auth/sessions.test.ts --reporter=dot`: **3 passed (3)**.
- `pnpm gate` (first fix run): `FAIL format` — Prettier flagged my two new server files (`apps/server/src/auth/sessions.ts`, `apps/server/src/auth/sessions.test.ts`). All other steps passed and scope was clean. Fixed with `pnpm exec prettier --write` on just those two files.
- `pnpm gate` (final fix run): **GATE PASS**
  ```
  gate: 11 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.1s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.6s)
  PASS  effect  (0.6s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/server  (9.5s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- Line counts (all ≤ 400): `apps/server/src/auth/api.ts` 337, `sessions.ts` 129, `sessions.test.ts` 147, contract `auth.ts` 137, `DevicesPage.tsx` 242, `api/devices.ts` 19, `user-agent.ts` 57.

### Deviations (fix round 1)

- **Rate limit reused, not a new tag.** The delete carries `AuthMeRateLimit` (`packages/api-contract/src/auth.ts`), the same per-user auth-write budget `PATCH /me` uses (`apps/server/src/auth/api.ts:88`, declared at `packages/api-contract/src/middleware.ts:144-147`, provided at `apps/server/src/auth/api.ts:240-242`). The contract's middleware tags live in `middleware.ts`, which is not in the Allowed files, so a dedicated `AuthSessionsRateLimit` tag would need it. Consequence: sign-out shares the 10-per-10-minute profile-edit budget and the 429 body says "Too many profile changes"; the web shows its own fixed sentence for any failure, so that text is never surfaced. Say the word and I'll add a dedicated tag next round (one tag in `middleware.ts`, one layer here).
- **`api/devices.ts` imported directly.** The page imports `@/lib/api/devices` because the barrel `apps/web/src/lib/api.ts` is not covered by the Allowed glob `apps/web/src/lib/api/**`; no other page does this yet.
- The parser's `Zilar on <OS>` heuristic and the extra load-error line from round 0 are unchanged.

### Security checklist (fix round 1)

- The list never returns `token` or `ip_address`. The delete is scoped `id = :id AND user_id = caller`, so an unknown id and another user's id answer the same 404; the caller's own session answers 400 before any delete runs.
- No token is rendered, held by the page or logged; the session id is the only key, and the audit entry carries ids only (`session.revoked`, `subjectId` = the revoked id, `detail: null`).
- Both new routes sit under the `Session` middleware, so the authz 401 sweep covers them; the write shares the auth-write rate limit.

### Rebase onto T-1233

Resolved the rebase conflicts by keeping both sides, then staged both files:

- `apps/web/src/routes/AppRoutes.tsx`: both the `/settings/contacts` and `/settings/devices` routes (and both `ContactsPage`/`DevicesPage` imports and route wrappers).
- `apps/web/src/components/chatList/ChatListMenu.tsx`: both the "Contacts" and "Devices" menu links, with "Contacts" first.

`pnpm --filter @zilar/web exec tsc --noEmit -p tsconfig.json`: **exit 0, no output (clean)**.

### Fix round 2 (review round)

- **should-fix 1 fixed** (`apps/web/src/routes/DevicesPage.tsx:30-41`): the bulk "Sign out all other devices" action now runs `Promise.allSettled` instead of `Promise.all`. Its single success callback always closes the confirm and calls `refresh()`, and sets the error line only when at least one revocation was rejected. A partial failure (e.g. a 429 mid-loop) can no longer leave already-revoked rows on screen or the confirm UI stuck open.
- **Tests added/adjusted:** none. The finding names no test, and both the Spec ("No tests (UI; the routes are Better Auth's)") and `AGENTS.md` ("UI code gets no tests") forbid UI tests. A new `apps/web/src/routes/DevicesPage.test.tsx` is also outside this task's Allowed files, so the gate's scope check would reject it. The fix is UI behaviour and stays covered by the lead's live web check.
- **Nits (1-3):** left untouched; none falls on a line this round changes.
- **Single tests run this round:** none — the only source change is web UI, which has no nearby test files (`SKIP tests @zilar/web`), and the server tests are untouched by this round.
- **Gate** (from repo root, after the fix):
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (2.5s)
  PASS  format  (1.2s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.8s)
  PASS  effect  (1.2s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/server  (16.6s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

## Review (written by Claude)

**Lead, 2026-10-12: approved after the lead's fix round 1. Pre-review clean (2 follow-ups).**
- **Round 0 blocker:** Better Auth's `/list-sessions` needs a session younger than 24 h (`freshSessionMiddleware`), so the page would fail for almost everyone.
- **Fix:** our own `GET /api/me/sessions` and `DELETE /api/me/sessions/:id` (`auth/sessions.ts`).
  - The list scopes by `user_id`, keeps only unexpired sessions, and never returns a token or IP address; `current` comes from the caller's session id.
  - The delete is `WHERE id AND user_id`: another user's id gets 404, and the caller's own session gets 400 "Use Sign out".
  - The page uses the typed client, labels "This device" from `current`, clears the error line after a success, and its parser knows `EdgiOS`, `OPR/` and `FxiOS`.
- **Tests:** `auth/sessions.test.ts`.
- **Known:** a revoked device keeps working for up to 5 minutes (the session cache).
- **Follow-ups:**
  - F1: `native_push` rows of a revoked session remain (push side);
  - F2: the delete shares the profile rate-limit message.
- **After deploy:** a read-only live GET of `/api/me/sessions` on Julio's web. The lead won't sign anything out.
