---
id: T-0613
title: "effect/sql: handles/store.ts (user @handle claim transaction under the per-user lock, reads, the retired-handle reaper) and groups/visibility.ts (public/private switch under the per-group lock, handle rows moved to retired_handles) off drizzle via sql.withTransaction; unique violations still answer handle_taken; isUniqueViolation keeps working for its drizzle caller; tests unchanged"
status: merged
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

### What I did

Converted both files completely off drizzle onto `effect/sql`, following `docs/audit/effect-sql-migration.md` §(a) and the `pins`/`chat-folders` examples. Each keeps its `async` exported signatures and runs its effects through a private `runSql(db, effect)` that calls `sqlRuntimeFor(db).runPromise(effect)`. Neither file keeps a value import from `drizzle-orm` or `db/schema`.

**`apps/server/src/handles/store.ts`**
- All reads are tagged-template SQL now (`findHandle`, `handleForUser`, `handleUserIdFor`, `checkHandleAvailability`, `checkGroupHandleAvailability`, `displayNameFor`); `handleUserIdFor` uses `sql.in(...)`; `displayNameFor` reads the quoted `"user"` table.
- `claimHandle` runs in `sql.withTransaction` under the same raw `pg_advisory_xact_lock(hashtext('handle-user:' || userId))`; every deciding row is read inside the transaction; the casing-only update, the deletes, the `retired_handles` upsert (`ON CONFLICT (handle_lower) DO UPDATE SET ...` via `EXCLUDED`) and the final `handles` insert are all the same statements in the same order. Every `HttpError` (`handle_invalid`, `handle_reserved`, `handle_taken`, `handle_change_too_soon` + `nextChangeAt`) is byte-identical and is re-failed inside the effect so the transaction rolls back and the error reaches the caller unchanged.
- Unique violation: the final insert is wrapped in `Effect.catchIf(isUniqueViolation, ...)` mapping to the same `409 handle_taken` as before.
- `reapExpiredRetiredHandles` issues `DELETE FROM retired_handles WHERE reserved_until <= now` inside the same best-effort `try/catch` (error swallowed).
- Removed `queryHandleForUser` and the `Queryable` type (and the now-unused `SetupTransaction` import): the lead's grep and mine both found no importer, and the spec allowed removing it. `findHandle`, `handleUserIdFor` and `displayNameFor` also have no importer today, but I converted and kept them to preserve the module's public read API (parallel worktrees may rely on it).
- `isUniqueViolation` now checks `error instanceof SqlError.SqlError` with `reason._tag === 'UniqueViolation'` first, then keeps the existing drizzle/`23505` cause-chain walk unchanged so `groups/service.ts` (still on drizzle) keeps working.

**`apps/server/src/groups/visibility.ts`**
- `setGroupVisibility` runs in `sql.withTransaction` under the same raw `pg_advisory_xact_lock(hashtext('group-visibility:' || groupId))`; the group read, owner check, live/retired handle reads, deletes, `retired_handles` upsert, `groups.visibility` updates and the final handle insert are the same statements in the same order, with the same 404/400/409 errors.
- The local `reapExpiredRetiredHandles` was removed and its single statement is inlined at the same place **inside the transaction**, with its error ignored via `Effect.catchCause(() => Effect.void)` (same best-effort behaviour).
- `handleForGroup` is a plain read. Drizzle and `db/schema` imports removed.

### Files changed
- `apps/server/src/handles/store.ts`
- `apps/server/src/groups/visibility.ts`
- `work/T-0613-effect-sql-handles-visibility.md` (status + this report)

### Commands run (real results)
- `pnpm install` — done, 48.8s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot handles` — 2 files, 16 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot groups` — 2 files, 80 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot handles groups setup authz-sweep` (the Spec's Checks line) — 7 files, 124 tests passed (36.5s on the final run).
- `pnpm exec prettier --write apps/server/src/handles/store.ts apps/server/src/groups/visibility.ts` — after the first gate flagged formatting on the two files.
- `pnpm gate` — final run:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (26.1s)
  PASS  lint  (0.8s)
  PASS  typecheck  (0.8s)
  PASS  tests @zilar/server  (487.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Tests
Every listed test file runs unchanged (handles, groups, setup, authz-sweep; plus the broader `--changed main` set the gate runs). No test was edited.

### Problems / deviations
- `queryHandleForUser` + `Queryable` were removed instead of converted (no importer; spec allowed either). Everything else was converted.
- `isUniqueViolation` keeps the pre-existing message-text fallback (`/duplicate key/`, `/UNIQUE constraint/`) so the still-drizzle `groups/service.ts` caller cannot regress; the structured `SqlError` check and the `23505` code are the primary paths, and nothing matches message text for the effect/sql case.
- The gate's test step (`vitest --changed main`) selects a large slice of the server suite because many tests boot the full app (which pulls in `store.ts`/`groups/service.ts`); under heavy parallel load on this shared machine earlier runs were killed, but the final unloaded run passed (487.7s).

### Open questions
None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. It was restarted once after a hung session; the packet (20:16) is newer than HEAD 1f50d848.
- **No test file changed.**
- **Lead check:**
  - `isUniqueViolation` checks `SqlError.reason._tag` first and keeps the drizzle and postgres walk for `groups/service.ts`;
  - a unique violation on the handle insert answers 409 `handle_taken`;
  - the unused `queryHandleForUser` and `Queryable` are gone;
  - the gate passes.
