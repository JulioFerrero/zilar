---
id: T-0574
title: "effect/sql: auth/invites.ts (create, find, find usable, consume, revoke) and xmpp/provisioning.ts (ensure + find XMPP account) drop drizzle; same rows (Dates stay Dates), same atomic consume; invite CLI registers and disposes the sql runtime; tests unchanged"
status: todo
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
`apps/server/src/auth/invites.ts`, `apps/server/src/xmpp/provisioning.ts`, `apps/server/src/auth/invite-cli.ts`, `work/T-0574-effect-sql-invites-provisioning.md`.

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

## Review (written by Claude)
