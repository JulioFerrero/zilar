---
id: T-0613
title: "effect/sql: handles/store.ts (user @handle claim transaction under the per-user lock, reads, the retired-handle reaper) and groups/visibility.ts (public/private switch under the per-group lock, handle rows moved to retired_handles) off drizzle via sql.withTransaction; unique violations still answer handle_taken; isUniqueViolation keeps working for its drizzle caller; tests unchanged"
status: todo
milestone: M5
branch: task/T-0613-effect-sql-handles-visibility
model: auto
effort: low
depends_on: [T-0596]
estimate: 1 day
---

# T-0613: the handle store and the group visibility switch on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. The recipe is `docs/audit/effect-sql-migration.md` §(a), with the pins example at `apps/server/src/pins/service.ts:179`. These two files move together: both write `handles` and `retired_handles` under advisory locks, and `groups/visibility.ts:10-14` imports constants and `isUniqueViolation` from `handles/store.ts`. **No caller passes a transaction into either**, which the lead checked with grep.

### Verified facts (do not re-derive; read both files fully)
**`apps/server/src/handles/store.ts`:**
- **The reads:** 24, 33, 48, 75-80, 111-119 and 307 (the `"user"` table: quote it).
- **`claimHandle`** (comment at 140-144, transaction from 160):
  - `pg_advisory_xact_lock(hashtext('handle-user:' || userId))`;
  - every row the decision depends on is read **inside** the transaction;
  - the update at 178, the deletes at 210 and 214, the insert into `retired_handles` with `onConflictDoUpdate` (221-235; write the same `ON CONFLICT (...) DO UPDATE SET ...`), and the insert into `handles` (240).
  - It throws `HttpError` with `handle_invalid`, `handle_reserved`, `handle_taken` or `handle_change_too_soon` (with `nextChangeAt` in the detail). **Each answer stays byte-identical.**
- **`reapExpiredRetiredHandles`** (291-300): best effort, swallows errors. It is called by `handles/api.ts:243` with the top-level db.
- **`queryHandleForUser`** and **`Queryable`** (314-323): **no importer** (lead grep). Convert it like the rest, or remove it if it really has no importer; say which in the Report.
- **`isUniqueViolation`** is also used by `apps/server/src/groups/service.ts:32`, which stays on drizzle. **It must keep recognizing drizzle and postgres errors.** If these two files need to detect an effect/sql `SqlError` with `reason._tag === 'UniqueViolation'`, extend the check or add a second helper; do not break the drizzle case.

**`apps/server/src/groups/visibility.ts`:**
- **`setGroupVisibility`** (the comment at 34-52 is the contract; transaction from 59):
  - `pg_advisory_xact_lock(hashtext('group-visibility:' || groupId))`;
  - the group read (64), the owner check (67), and the handle reads (81, 172, 177);
  - the delete and the `retired_handles` upsert (92-104 and 186-200);
  - the `groups.visibility` updates (110, 148, 228), the handle update (143) and the insert (208);
  - the unique-violation catch maps to `handle_taken`; read the code just before line 225.
- **The local `reapExpiredRetiredHandles`** (237-242) is called at 230 **inside** the transaction, with a swallowed error. Keep the same behaviour: the same statement in the same place, its error ignored.
- **`handleForGroup`** (248): a plain read.

**The recipe:**
- `sql.withTransaction`; locks as raw SQL; a private `runSql(db, effect)`;
- an `HttpError` thrown inside the transaction must roll back and reach the caller unchanged; read `apps/server/src/chat-folders/service.ts` (lines 150-280);
- rows are camelCase through `snakeToCamel`; every column involved is timestamptz (lead-checked), so `Date` values stay as they are.

**Tests (all unchanged):**
- `apps/server/src/handles/*.test.ts`;
- `apps/server/src/groups/*.test.ts`;
- `apps/server/src/setup/*.test.ts`;
- the authz sweep (`authz-sweep`).

### What to build
1. Convert both files completely, with the same locks, reads inside the transaction, upserts, error answers and reaper behaviour. Neither file keeps a value import from `drizzle-orm` or `db/schema`.
2. `isUniqueViolation` keeps working for `groups/service.ts`.
3. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section: transactions and race recovery), `docs/audit/effect-sql-migration.md` §(a), `apps/server/src/pins/service.ts` (lines 150-230), `apps/server/src/chat-folders/service.ts` (lines 150-280), `apps/server/src/handles/store.ts` and `apps/server/src/groups/visibility.ts`.

### Allowed files
`apps/server/src/handles/store.ts`, `apps/server/src/groups/visibility.ts`, `work/T-0613-effect-sql-handles-visibility.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot handles groups setup authz-sweep
pnpm gate
```

### Acceptance
- Both files run on effect/sql with the same behaviour, and `isUniqueViolation` still serves `groups/service.ts`.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
