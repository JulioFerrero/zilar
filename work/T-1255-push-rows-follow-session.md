---
id: T-1255
title: "Security follow-up to T-1235: a signed-out (revoked) session's push devices stop getting notifications — push_subscriptions gets session_id REFERENCES session(id) ON DELETE CASCADE (migration 0051), set on every subscribe and re-registration"
status: merged
milestone: M5
branch: task/T-1255-push-rows-follow-session
model: auto
effort: default
depends_on: [T-1235]
estimate: 0.3 day
---

# T-1255: A revoked session's devices stop getting push

## Spec (written by Claude, do not edit)

### Why
This is T-1235's follow-up F1 (`work/T-1235-web-devices-page.md:91-93`).
- **The problem:** `push_subscriptions` rows have no session id (`apps/server/drizzle/0047_native_push.sql`, row type `apps/server/src/db/rows.ts:233-245`). When you sign a device out from Devices (`revokeSession`, `apps/server/src/auth/sessions.ts:90-120`, `DELETE FROM "session"` at `:104`), that phone or browser keeps getting push notifications.
- **Why a cascade is enough:** delivery looks the device up by node and drops the notification when no row exists (`apps/server/src/push/delivery.ts:57-60`, `unknown-device`).

### What to build
1. **Migration `apps/server/drizzle/0051_push_session.sql`** (hand-written SQL, like `0050_chat_prefs_unread_mark.sql`):
   - `ALTER TABLE "push_subscriptions" ADD COLUMN "session_id" text REFERENCES "session"("id") ON DELETE CASCADE;`
   - an index on `session_id`;
   - the column stays nullable: existing rows keep NULL until the device registers again.
   - Register it wherever the other hand-written migrations are registered (find how 0050 is run and cite it).
2. **`rows.ts`:** add `sessionId: string | null` to `PushSubscriptionRow`.
3. **Saving a device:**
   - `saveDevice` (`apps/server/src/push/store.ts:73`; the native insert is at `:134`, the Web Push insert at `:197`, and the re-registration updates are in between) takes `sessionId` and writes it on the insert **and** on every re-registration update, so an old row moves to the new session.
   - `store.ts` is **exactly 400 lines**: first move the native branch, or the Web Push branch, into a new `apps/server/src/push/store-save.ts`, and keep both files at most 400 lines.
4. **Where the session id comes from:**
   - export `currentSessionId` (`apps/server/src/auth/sessions.ts:40-45`), or reuse what the session middleware already provides (check `apps/server/src/push/api-subscribe.ts` and cite);
   - the subscribe handlers (`apps/server/src/push/api-subscribe.ts`, `apps/server/src/push/api-handlers.ts`) pass it to `saveDevice`;
   - no token is ever logged.
5. **Tests** (auth and permissions), in `apps/server/src/push/store.test.ts`, up to 3, on the real test database like the existing tests:
   - a device saved with session A is gone after `DELETE FROM "session" WHERE id = A`, and a device of session B stays;
   - re-registering the same token from session B moves the row to B;
   - a NULL `session_id` row (legacy) is untouched by a session delete.

### Read first
`AGENTS.md`, `work/T-1235-web-devices-page.md` (F1), `apps/server/src/push/store.ts`, `apps/server/src/push/api-subscribe.ts`, `apps/server/src/push/api-handlers.ts`, `apps/server/src/push/delivery.ts:50-60`, `apps/server/src/auth/sessions.ts`, `apps/server/src/db/rows.ts`, `apps/server/drizzle/0047_native_push.sql` and `0050_chat_prefs_unread_mark.sql`.

### Allowed files
`apps/server/drizzle/0051_push_session.sql`, `apps/server/drizzle/meta/**`, `apps/server/src/db/rows.ts`, `apps/server/src/db/migrate*.ts`, `apps/server/src/push/store.ts`, `apps/server/src/push/store-save.ts`, `apps/server/src/push/store.test.ts`, `apps/server/src/push/api-subscribe.ts`, `apps/server/src/push/api-handlers.ts`, `apps/server/src/auth/sessions.ts`, `work/T-1255-push-rows-follow-session.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push/store.test.ts src/push/api-subscribe.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, and every touched file stays at most 400 lines.
- **The lead's live check after deploy (read-only):** `/health` is OK and the push subscriptions list (`/push/subscriptions` in `packages/api-contract/src/push.ts:143`) still answers 200.

---

## Report (written by the worker when done)

### What I did
- **Migration** `apps/server/drizzle/0051_push_session.sql` (new): adds nullable `session_id` text to `push_subscriptions`, a named FK `push_subscriptions_session_id_session_id_fk` → `"session"("id") ON DELETE cascade`, and index `push_subscriptions_session_id_idx`. No registration list to edit: migrations are loaded from `apps/server/drizzle/*.sql` by filename in `sqlFileLoader` (`apps/server/src/effect/sql.ts:166-200`, folder from `migrationsFolder` at `:31-32`); like `0047`–`0050`, this hand-written file is picked up without a `meta/_journal.json` entry, so I left `meta/**` untouched.
- **`rows.ts`**: `PushSubscriptionRow` gains `sessionId: string | null` (`session_id` → camelCase, same as the other columns).
- **Save path**: `store.ts` was exactly 400 lines, so `saveDevice`, `PUSH_MAX_DEVICES_PER_USER` and the `SaveDeviceInput`/`SaveDeviceAdmin` types moved unchanged into the new `apps/server/src/push/store-save.ts`; `store.ts` re-exports them, so every existing importer keeps working. `saveDevice` now reads `sessionId` (optional on the input, `input.sessionId ?? null`) and writes `session_id` on **both** inserts (native at `store-save.ts:139-155`, Web Push at `:203-221`) and on **both** re-registration updates (native `:100-107`, Web Push `:176-186`), so a re-registered token/endpoint moves to the new session.
- **Session id source**: exported `currentSessionId` from `apps/server/src/auth/sessions.ts` (it was already the `listSessions`/`revokeSession` helper; the Effect session middleware only provides `CurrentUser = { id }`, so the handler must read the session once more, as `PATCH /me` does). `api-subscribe.ts` now calls it with `new Headers(request.request.headers)` after the limiter check and passes `sessionId` to both `saveDevice` branches. No token is read or logged — only the session id, and it never reaches a log line.
- **Tests** in `apps/server/src/push/store.test.ts` (3 new, real test DB): a device whose registering session is deleted cascades away while another session's device stays; re-registering the same token from session B moves `session_id` to B (and deleting A leaves the row); a legacy NULL-session row is untouched by a session delete.

`api-handlers.ts` was not changed: the subscribe route (and thus the only `saveDevice` call site) is in `api-subscribe.ts`; `api-handlers.ts` has no subscribe save. It stays in scope in case the lead expected the split there.

### Files changed
`apps/server/drizzle/0051_push_session.sql` (new), `apps/server/src/push/store-save.ts` (new), `apps/server/src/db/rows.ts`, `apps/server/src/push/store.ts`, `apps/server/src/push/api-subscribe.ts`, `apps/server/src/auth/sessions.ts`, `apps/server/src/push/store.test.ts`, `work/T-1255-push-rows-follow-session.md`. All within Allowed files. Line counts: store.ts 210, store-save.ts 226, api-subscribe.ts 165, api-handlers.ts 355, sessions.ts 131, rows.ts 299, store.test.ts 288 — all ≤ 400.

### Commands and real results
- `pnpm install` — done (1270 resolved), no errors.
- `pnpm --filter @zilar/server exec vitest run src/push/store.test.ts src/push/api-subscribe.test.ts --reporter=dot` — **2 files passed, 19 tests passed** (5.66s).
- `pnpm gate` (repo root) — summary lines:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.5s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/server  (13.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Deviations / notes
- `sessionId` is **optional** on `SaveDeviceInput` rather than required. `delivery.test.ts` and `group-notifier.test.ts` build `SaveDeviceInput` and are **not** in Allowed files, so a required field would break typecheck outside scope. Optional also matches "the column stays nullable": a missing `sessionId` writes NULL. The production path (`api-subscribe.ts`) always passes it.
- `store.ts` re-exports the moved symbols; I did not change any other importer.
- No secrets, tokens or endpoints are logged; the FK delete is scoped by the session row itself, and the cap is still enforced atomically under the per-user advisory lock.

### Open questions
None. The spec's acceptance live check is the lead's after deploy; nothing here changes `/health` or the list route's shape.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (1 nit).**
- **Migration 0051:**
  - a nullable `session_id` with FK `session(id) ON DELETE CASCADE`, plus an index;
  - existing rows stay NULL, so the FK validation is instant.
- **Every save writes the session:** the single `saveDevice` call (`api-subscribe.ts`) covers Web Push and native. Its four writes (two inserts, two re-registration updates in the new `store-save.ts`) all set `session_id`, so a re-registered device moves to the new session.
- **How the id is read:** `currentSessionId` is exported and reused; it reads the id only, never the token.
- **Line count:** `store.ts` went from 400 to 210 lines (and `store-save.ts` is 226).
- **Lead's checks after rebasing onto main:**
  - push `store`, `api-subscribe` and `api-preview` tests: 23 passed;
  - server tsc: 0 errors.
- **Live check after deploy (read-only):** `/health` OK, and the push subscriptions list answers 200.
