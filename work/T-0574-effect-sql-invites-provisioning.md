---
id: T-0574
title: "effect/sql: auth/invites.ts (create, find, find usable, consume, revoke) and xmpp/provisioning.ts (ensure + find XMPP account) drop drizzle; same rows (Dates stay Dates), same atomic consume; invite CLI registers and disposes the sql runtime; tests unchanged"
status: merged
milestone: M5
branch: task/T-0574-effect-sql-invites-provisioning
model: auto
effort: low
depends_on: [T-0568]
estimate: 0.5 day
---

# T-0574: sign-up invites and XMPP provisioning on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server service onto effect/sql". The closest examples:
- `apps/server/src/agents/delegation/service.ts` (T-0568: an INSERT, conditional UPDATEs with `RETURNING`, a local `runSql`);
- `apps/server/src/ais/usage.ts:34-39`.

### Verified facts (do not re-derive)
1. **`apps/server/src/auth/invites.ts`** (99 lines; table `invites`, `apps/server/src/db/schema.ts:50`). The columns are `id`, `code` (unique), `created_by`, `created_at`, `expires_at`, `max_uses`, `uses` and `revoked_at`, with timestamps as `timestamptz`.
   - **`type Invite = typeof invites.$inferSelect`** (line 12). **Keep this exact type, with Dates as `Date`.** A type-only import of the table for it is fine. `auth/invite-cli.ts:67` calls `invite.expiresAt.toISOString()`. Check how effect/sql returns `timestamptz` in this repo (the T-0568 review notes the driver gives `Date`), and convert if it does not.
   - The functions:
     - `createInvite` (24): an INSERT … `RETURNING *` with `uses 0`; it throws `'Failed to create invite'` when no row comes back;
     - `findInviteByCode` (52);
     - `findUsableInvite` (57);
     - **`consumeInvite`** (66): a single conditional `UPDATE … SET uses = uses + 1 WHERE <usable> RETURNING *`. **It must stay one atomic statement;**
     - `revokeInvite` (80): `revoked_at = now` where it is not revoked yet.
   - The usable rule (`usableInvite`, line 91) is `code = $1 AND revoked_at IS NULL AND expires_at > $now AND uses < max_uses`.
2. **`apps/server/src/xmpp/provisioning.ts`** (111 lines; table `xmpp_accounts`). The columns are `user_id` (primary key), `localpart`, `jid`, `provisioned`, `created_at` and `updated_at`.
   - **`ensureXmppAccount`** (39), in this order:
     1. an upsert `INSERT … ON CONFLICT (user_id) DO UPDATE SET localpart, jid, updated_at`;
     2. `adminClient.registerUser`;
     3. on failure **with** `requesterId`: read the row and return its state; **without** it: rethrow;
     4. `UPDATE … SET provisioned = true, updated_at RETURNING *`;
     5. return `{ jid, provisioned }` with the same fallbacks.
   - **`findXmppAccount`** (76) returns the full row type (`typeof xmppAccounts.$inferSelect`, kept, Dates as `Date`) or `null`.
   - `localpartFor`, `jidFor` and `base32` are pure; leave them unchanged.
3. **Callers, which stay unchanged:**
   - `auth/auth.ts:125,143,155` (better-auth hooks, at request time, after `createApp` registered the runtime);
   - `auth/routes.ts:52,126,135,143`;
   - `contacts/service.ts:278`;
   - `xmpp/api.ts:123`;
   - `ais/service.ts:250`.
   
   They all pass the app `db`, and none passes a transaction (check with grep).
4. **The invite CLI** (`apps/server/src/auth/invite-cli.ts:53-70`) builds its own `db` with `createDb` and **never registers an effect/sql runtime**, so `createInvite` would throw "No effect/sql runtime registered".
   - After `runMigrations`, call `registerSqlRuntime(db, config.DATABASE_URL)` (`apps/server/src/effect/sql.ts:81`).
   - In the `finally`, call `await disposeSqlRuntime(db)` before `close()`.
   - Leave the rest of the CLI unchanged; its zod moves in another task.
- **Tests (all unchanged):**
  - `apps/server/src/auth/*.test.ts`;
  - `apps/server/src/xmpp/*.test.ts`;
  - `apps/server/src/contacts/*.test.ts`;
  - `apps/server/src/ais/service.test.ts`.

### What to build
1. **Rewrite the database calls in both files with effect/sql:**
   - the same exported names, signatures, return types and order;
   - one statement per drizzle statement;
   - the consume stays atomic;
   - no `drizzle-orm` import left in either file.
2. **Update the invite CLI** as described in fact 4.
3. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/agents/delegation/service.ts`, `apps/server/src/effect/sql.ts`, `apps/server/src/auth/invites.ts`, `apps/server/src/xmpp/provisioning.ts` and `apps/server/src/auth/invite-cli.ts`.

### Allowed files
`apps/server/src/auth/invites.ts`, `apps/server/src/xmpp/provisioning.ts`, `apps/server/src/auth/invite-cli.ts`, `apps/server/src/auth/invites.test.ts` (lead, 2026-10-08: setup and teardown lines only, to register and dispose the sql runtime), `work/T-0574-effect-sql-invites-provisioning.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot auth xmpp contacts ais/service
pnpm gate
```

### Acceptance
- Invites and XMPP provisioning run on effect/sql with the same rows and behaviour.
- The CLI registers and disposes the runtime.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- Rewrote `apps/server/src/auth/invites.ts` on `effect/sql` (`sqlRuntimeFor(db).runPromise` via a local `runSql`, as in `ais/usage.ts`). Every exported name, constant, type and signature is unchanged; the `Invite` type stays `typeof invites.$inferSelect` (type-only import, Dates as `Date`).
  - `createInvite`: one `INSERT … RETURNING *` with `uses 0`; still throws `'Failed to create invite'` when no row comes back.
  - `findInviteByCode`: `SELECT * … WHERE code = $1 LIMIT 1`.
  - `findUsableInvite`: same usable predicate `code = $1 AND revoked_at IS NULL AND expires_at > $now AND uses < max_uses`.
  - `consumeInvite`: one conditional `UPDATE … SET uses = uses + 1 WHERE <usable> RETURNING *` — still a single atomic statement.
  - `revokeInvite`: `UPDATE … SET revoked_at = $now WHERE code = $1 AND revoked_at IS NULL RETURNING *`.
- Rewrote the DB calls in `apps/server/src/xmpp/provisioning.ts` on `effect/sql`, same order and fallbacks:
  1. `INSERT … ON CONFLICT (user_id) DO UPDATE SET localpart, jid, updated_at`;
  2. `adminClient.registerUser`;
  3. on failure with `requesterId`: read the row and return its state; without it: rethrow;
  4. `UPDATE … SET provisioned = true, updated_at RETURNING *`;
  5. return `{ jid, provisioned }` with the same fallbacks.
  - `findXmppAccount` is a `SELECT * … LIMIT 1` returning the full row type (`typeof xmppAccounts.$inferSelect`, type-only import, Dates as `Date`) or `null`.
  - `localpartFor`, `jidFor`, `sha256Base32` and `base32` are untouched.
- Updated `apps/server/src/auth/invite-cli.ts`: after `runMigrations` it calls `registerSqlRuntime(db, config.DATABASE_URL)`, and in the `finally` it calls `await disposeSqlRuntime(db)` before `close()`. The rest of the CLI is unchanged.

### Lead review fixes (2026-10-08)
- `apps/server/src/auth/invites.ts`: removed the `isPgliteDatabase` / `registerSqlRuntime` branch from `runSql`, which is now exactly `sqlRuntimeFor(db).runPromise(effect)` like `ais/usage.ts:34-39`; dropped the now-unused imports.
- `apps/server/src/auth/invites.test.ts` (lead added it to Allowed files, setup/teardown only): `beforeEach` now calls `registerSqlRuntime(db, '')` right after `db = drizzle(...)`, and `afterEach` calls `await disposeSqlRuntime(db)` before `client.close()`; nothing else in the file changed.
- First iteration had a `runSql` shim that registered a PGlite runtime from inside the production module; that deviation is now removed, and the runtime is registered in the test setup instead.

### Files changed
- `apps/server/src/auth/invites.ts`
- `apps/server/src/xmpp/provisioning.ts`
- `apps/server/src/auth/invite-cli.ts`
- `apps/server/src/auth/invites.test.ts` (lead-approved setup/teardown change)
- `work/T-0574-effect-sql-invites-provisioning.md` (status + this Report)

No file outside the Allowed files was touched.

### Commands and real results
- `pnpm install` — exit 0 (only the pre-existing peer-dependency warning).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/invites.test.ts` — 1 file passed, 7 tests passed (runtime now registered/disposed by the test setup).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/xmpp/provisioning.test.ts` — 1 file passed, 13 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot auth xmpp contacts ais/service` — 13 files passed, 164 tests passed (re-run after the review fixes: 13 files, 164 tests passed again).
- After the review fixes, `pnpm gate` from the repo root (5 changed files):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (3.1s)
  PASS  format  (63.4s)
  PASS  lint  (1.3s)
  PASS  typecheck  (30.3s)
  PASS  tests @zilar/server  (488.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / open questions
- None after the review fixes. The earlier PGlite registration shim in `invites.ts` was removed; the test setup now owns registration and disposal.
- Security: `consumeInvite` remains a single conditional update, so a cap is never check-then-insert; `revokeInvite`/`findUsableInvite` keep the same scoping by `code`; no secrets are logged.

## Review (written by Claude)

**2026-10-08, lead:** approved after 1 lead fix round. The PGlite runtime registration moved out of `invites.ts` into the setup and teardown of `invites.test.ts`; the lead allowed those 3 lines.
- **Pre-review:** clean. The packet (08:20) is newer than HEAD d81dc934.
- **Lead check:** the lead read every statement.
  - `consumeInvite` is still one conditional `UPDATE … SET uses = uses + 1 WHERE <usable> RETURNING *`.
  - The usable rule is the same.
  - Provisioning keeps the upsert → register → fallback read → provisioned update order.
  - The invite CLI registers the runtime after the migrations and disposes it before close.
