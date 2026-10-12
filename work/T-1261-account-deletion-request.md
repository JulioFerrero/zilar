---
id: T-1261
title: "Account deletion T-A (server): the user_deletions grace table (migration 0053), POST/DELETE/GET /me/deletion on the auth API (schedule in 7 days, cancel, status), a new sign-in cancels it, audit ids only — nothing is deleted yet (the job is T-B, held for Julio's decisions)"
status: merged
milestone: M5
branch: task/T-1261-account-deletion-request
model: auto
effort: default
depends_on: [T-1260]
estimate: 0.4 day
---

# T-1261: Request and cancel account deletion (server)

## Spec (written by Claude, do not edit)

### Why
This is task T-A of `docs/audit/account-deletion-plan.md` §9 (`:460-466`). The plan's §5 (`:216-289`) is the design; read it all. This task stores the request and lets the user cancel it. **It never deletes anything:** the deletion job is T-B, which the lead holds until Julio confirms the plan's §8 decisions. Decision 4 (the `retired_handles` FK) is **not** part of this task.

### What to build
1. **Migration `apps/server/drizzle/0053_user_deletions.sql`:** exactly the table and index in plan §5a (`:222-233`).
   - `user_id` text PK, **no FK** (the plan explains why at `:238-242`).
   - Add the row type to `apps/server/src/db/rows.ts`.
2. **The contract, on the auth group** (`packages/api-contract/src/auth.ts:126-154`, 160 lines), so `apps/server/src/app.ts` doesn't change:
   - a new GET at `/me/deletion`, answering `{ scheduled: false }` or `{ scheduled: true, deleteAfter: <ISO> }`;
   - a new POST at `/me/deletion`, which schedules in 7 days and answers the same shape. It is idempotent: a second POST keeps the first `delete_after`;
   - a new DELETE at `/me/deletion`, which cancels and answers `{ scheduled: false }`. It is idempotent.
   - The POST requires a fresh session: the session must have been created at most 30 minutes ago. Read the session's `createdAt` from the session lookup the `listSessions` route uses (`apps/server/src/auth/sessions.ts`). Otherwise it answers 403 `reauth_required` ("Sign in again to delete your account.").
   - Rate-limit the POST like `revokeSession`.
3. **The server:**
   - put the SQL in a new `apps/server/src/auth/deletion-request.ts`, and the handlers in `apps/server/src/auth/api.ts` (347 lines, must stay at most 400);
   - write audit entries `account.deletion_requested` and `account.deletion_cancelled` through `recordAudit` (`apps/server/src/audit/recorder.ts:41`), with `subject_id = userId` and nothing else;
   - log ids only.
4. **A sign-in cancels it:** in Better Auth's `databaseHooks` (`apps/server/src/auth/auth.ts:185`), add `session.create.after`, which deletes the user's `user_deletions` row. When a row was deleted, audit `account.deletion_cancelled` with `detail: { by: 'sign-in' }`. It's best effort: a failure is logged and never blocks the sign-in.
5. **The mock backend:** the same three routes in `packages/mock-backend/src/domains/me/`, holding the state in memory.
6. **Tests** (auth), in a new `apps/server/src/auth/deletion-request.test.ts`, up to 4:
   - POST schedules about 7 days ahead, and a second POST keeps the date;
   - DELETE cancels, and GET answers `{ scheduled: false }`;
   - a session older than 30 minutes answers 403 `reauth_required`;
   - another user's row is never touched (two users).

### Out of scope
- The deletion job (T-B).
- The export (T-C).
- The web and mobile UI (T-D, T-E).
- The `retired_handles` FK change.

### Read first
`AGENTS.md`, `docs/audit/account-deletion-plan.md` (§5 and §9), `packages/api-contract/src/auth.ts`, `apps/server/src/auth/api.ts`, `apps/server/src/auth/auth.ts:80-252`, `apps/server/src/auth/sessions.ts`, `apps/server/src/audit/recorder.ts`, `apps/server/drizzle/0052_user_profiles.sql` and `apps/server/src/db/rows.ts`.

### Allowed files
`apps/server/drizzle/0053_user_deletions.sql`, `apps/server/src/db/rows.ts`, `packages/api-contract/src/auth.ts`, `apps/server/src/auth/api.ts`, `apps/server/src/auth/auth.ts`, `apps/server/src/auth/sessions.ts`, `apps/server/src/auth/deletion-request.ts`, `apps/server/src/auth/deletion-request.test.ts`, `packages/mock-backend/src/domains/me/**`, `work/T-1261-account-deletion-request.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/auth/deletion-request.test.ts src/auth/sessions.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, and every touched file stays at most 400 lines.
- **The lead's live check after deploy (read-only):** the new deletion-status GET answers 200 `{ scheduled: false }`. The lead never POSTs on Julio's account.

---

## Report (written by the worker when done)

### What I did
- **Migration `apps/server/drizzle/0053_user_deletions.sql`**: the `user_deletions` table exactly as plan §5a (text PK `user_id` with **no FK**, `requested_at`, `delete_after`, `phase`, `started_at`, `last_error`) plus the partial index `user_deletions_due_idx`. Added `UserDeletionRow` / `UserDeletionPhase` to `apps/server/src/db/rows.ts`.
- **Contract** (`packages/api-contract/src/auth.ts`): `AuthDeletionStatus` (`{ scheduled: false } | { scheduled: true, deleteAfter }`) and three new endpoints on the existing `AuthGroup`, so `apps/server/src/app.ts` did not change: `GET /me/deletion`, `POST /me/deletion` (`.middleware(AuthMeRateLimit)`), `DELETE /me/deletion` (`.middleware(AuthMeRateLimit)`).
- **Server** `apps/server/src/auth/deletion-request.ts` (new): `deletionStatus`, `requestDeletion` (fresh-session gate + idempotent `INSERT … ON CONFLICT DO NOTHING`), `cancelDeletion` (idempotent `DELETE … WHERE user_id`), and `cancelDeletionOnSignIn`. Handlers wired in `apps/server/src/auth/api.ts` (369 lines). Audit entries `account.deletion_requested` / `account.deletion_cancelled` go through `recordAudit`/`createAuditRecorder` with `subject_id = userId`; the sign-in cancel adds `detail: { by: 'sign-in' }`. Ids only, never a handle, e-mail or text.
- **Fresh session**: added `currentSession()` to `apps/server/src/auth/sessions.ts` (the `auth.api.getSession` lookup `listSessions` already used) and refactored `currentSessionId` onto it. `POST` demands `createdAt` at most 30 minutes old, else 403 `reauth_required` "Sign in again to delete your account.".
- **Sign-in cancel** (`apps/server/src/auth/auth.ts`): `databaseHooks.session.create.after` calls `cancelDeletionOnSignIn`, best effort (a failure is logged, never blocks sign-in). Widened the local `AuthLogger` interface with `error` for that log.
- **Mock backend** (`packages/mock-backend/src/domains/me/`): new `deletion.ts` (in-memory, per `MockData`, WeakMap like mock sessions) and the three `GET`/`POST`/`DELETE /me/deletion` routes in `routes.ts`.
- **Tests** `apps/server/src/auth/deletion-request.test.ts` (4): schedule ~7 days + second POST keeps the date; DELETE cancels and idempotently answers `{ scheduled: false }`; a session older than 30 min answers 403 `reauth_required`; two users are isolated and a sign-in cancels only the signer's row.

Nothing is deleted by this task: the job is T-B, and decision 4 (`retired_handles` FK) is untouched.

### Files changed (11, all inside Allowed)
`apps/server/drizzle/0053_user_deletions.sql`, `apps/server/src/db/rows.ts`, `packages/api-contract/src/auth.ts`, `apps/server/src/auth/api.ts`, `apps/server/src/auth/auth.ts`, `apps/server/src/auth/sessions.ts`, `apps/server/src/auth/deletion-request.ts`, `apps/server/src/auth/deletion-request.test.ts`, `packages/mock-backend/src/domains/me/deletion.ts`, `packages/mock-backend/src/domains/me/routes.ts`, `work/T-1261-account-deletion-request.md`.

### Commands and real results
- `pnpm install`: done, 16 workspace projects.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/deletion-request.test.ts src/auth/sessions.test.ts`: **7 passed** (2 files).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/auth.test.ts`: **36 passed** (1 file).
- `pnpm gate` (repo root): **GATE PASS**. Summary:
  ```
  gate: 11 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.6s)
  PASS  typecheck  (2.3s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/api-contract (no nearby test files)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (10.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Deviations / decisions to flag
- **DELETE is rate-limited too.** The spec says "rate-limit the POST like `revokeSession`"; I also put `AuthMeRateLimit` on `DELETE /me/deletion` because it is a write and the security checklist says every write needs a rate limit (its sibling `revokeSession` DELETE is limited the same way). Easy to drop if the lead prefers POST only.
- **Audit actor.** I set `actor_user_id = userId` alongside `subject_id = userId`, reading "nothing else" as "no detail payload", consistent with `session.revoked`. If the lead wanted a null actor, say so and I will change it.
- **Freshness source.** Per the spec, the freshness check reads `createdAt` from the same `auth.api.getSession` lookup `listSessions` uses (exposed as `currentSession`), not a raw SQL read.
- A test-only detail: to age a session I wrote `created_at = (now() AT TIME ZONE 'UTC') - interval '31 minutes'`, matching the UTC-wall-clock convention in `sessions.ts` / `sql-adapter.ts` (the process here is not UTC).

### Blocked / needs a decision
None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (2 nits).**
- **Migration 0053:** `user_deletions` exactly as plan §5a, with no FK, plus the partial due-index.
- **Routes:** GET/POST/DELETE `/me/deletion` on the auth group (`app.ts` unchanged).
  - POST needs a session at most 30 min old (`DELETION_FRESH_SESSION_MS`), else 403 `reauth_required`.
  - Both POST and DELETE are idempotent.
- **Sign-in cancel:** `session.create.after` calls `cancelDeletionOnSignIn`, which is try/catch, best effort, and never blocks a sign-in.
- **Audit:** ids only.
- **Nothing deletes data yet:** the job is T-B, held for Julio's decisions.
- **Lead's checks after rebasing onto main:**
  - auth `deletion-request`, `sessions` and `auth` tests: 43 passed;
  - server tsc: 0 errors;
  - `api.ts` is 369 lines.
- **Next:** live after deploy, read-only: the deletion-status GET answers `{ scheduled: false }`. The lead never POSTs on Julio's account.
