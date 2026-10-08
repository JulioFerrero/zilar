---
id: T-0627
title: "effect/sql: routines/service.ts off drizzle except deleteRoutinesForAiInGroup (it runs inside the groups/service.ts drizzle transaction); jsonb written as JSON text, count(*)::int; same errors, audits, public shape; tests unchanged"
status: merged
milestone: M5
branch: task/T-0627-effect-sql-routines-service
model: auto
effort: low
depends_on: [T-0596]
estimate: 1 day
---

# T-0627: the routines service on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. The recipe is `docs/audit/effect-sql-migration.md` §(a), with the pins example in `apps/server/src/pins/service.ts` (lines 150-230, a private `runSql`). For jsonb writes, follow `apps/server/src/tools/service.ts:773` and `:954` (`${JSON.stringify(x)}::jsonb`) and the timestamps there (`now.toISOString()`).

### Verified facts (do not re-derive; read the whole file, 571 lines)
- **`apps/server/src/routines/service.ts`**, drizzle imports at 7 and 11:
  - `createRoutine` (127): reads `ai_tools` by id (163-176) and the `ai_tool_versions` hosts for `(tool_id, version)` (186-190); calls `enforceRoutineLimit` (500, a `count()` over `routines`; use `count(*)::int AS total`); then inserts one row with `RETURNING *` (214-237). `schedule`, `input` (nullable) and `approved_hosts` are **jsonb**.
  - `getRoutine` (259), `listRoutinesForAi` (280), `listRoutinesForTopic` (289), and `toPublicRoutines` (521, one tool-name read per row): plain reads.
  - `pauseRoutine` (305), `resumeRoutine` (350), `deleteRoutine` (412): guarded `UPDATE … RETURNING *` plus the fallback reads. Keep every guard (`status = 'active'`, `status = 'paused'`, `deleted_at IS NULL`) and every error code and text.
  - `deleteRoutinesForAiInTopic` (447): called with the top-level `deps.db` at `apps/server/src/topics/service.ts:921`.
  - `deleteRoutinesForTool` (488): called with the top-level `db` at `apps/server/src/tools/service.ts:606`.
  - **`deleteRoutinesForAiInGroup` (468) stays on drizzle.** `apps/server/src/groups/service.ts:1106` calls it with a drizzle transaction. Leave it and its caller untouched, with a comment saying it moves when `removeGroupAi`'s transaction moves.
- **The `routines` table** (`apps/server/src/db/schema.ts`, around 1345-1380) has no bigint columns. Its jsonb columns are `schedule`, `input` and `approved_hosts`, and its timestamps include `next_run_at`, `last_run_at`, `created_at`, `updated_at` and `deleted_at`.
- **Rows:** `transformResultNames: snakeToCamel` gives the camelCase `RoutineRow` (`typeof routines.$inferSelect`; keep it as a type-only import). T-0614 keeps jsonb keys as written. `toPublicRoutine` (540) must return the same shape, with `nextRunAt` and `lastRunAt` as `Date`; check what the driver returns for timestamptz, as the pins and tools services do.
- **Tests that must pass unchanged:**
  - `apps/server/src/routines/*.test.ts`;
  - `apps/server/src/tools/*.test.ts`;
  - `apps/server/src/topics/*.test.ts`;
  - `apps/server/src/groups/*.test.ts`.

### What to build
1. Move every function above except `deleteRoutinesForAiInGroup` to effect/sql, with the same checks, order, errors, audits and returns. After the move, the drizzle imports serve only `deleteRoutinesForAiInGroup`.
2. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `docs/audit/effect-sql-migration.md` §(a), `apps/server/src/pins/service.ts` (lines 150-230), `apps/server/src/tools/service.ts` (lines 760-780 and 940-970), `apps/server/src/routines/service.ts`.

### Allowed files
`apps/server/src/routines/service.ts`, `work/T-0627-effect-sql-routines-service.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines src/tools src/topics src/groups
pnpm gate
```

### Acceptance
- The routines service runs on effect/sql, except the one function that waits for its caller's transaction.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Moved every function in `apps/server/src/routines/service.ts` except
`deleteRoutinesForAiInGroup` from drizzle to `effect/sql`, following the pins
recipe (`docs/audit/effect-sql-migration.md` §(a)) and the
`apps/server/src/tools/service.ts` examples.

- Added a private `runSql(db, effect)` helper (`sqlRuntimeFor(db).runPromise`).
- Reads: `createRoutine`'s `ai_tools` lookup and `ai_tool_versions` hosts
  lookup, `getRoutine`, `listRoutinesForAi`, `listRoutinesForTopic`,
  `toPublicRoutines`'s per-row tool-name read, and `enforceRoutineLimit`
  (`SELECT count(*)::int AS total`).
- Writes: `createRoutine`'s insert (`RETURNING *`), `pauseRoutine`,
  `resumeRoutine`, `deleteRoutine`, `deleteRoutinesForAiInTopic` (now takes the
  top-level `db`, as `topics/service.ts:921` already passes `deps.db`),
  `deleteRoutinesForTool`.
- jsonb (`schedule`, `input`, `approved_hosts`) written as JSON text:
  `${JSON.stringify(x)}::jsonb`; nullable `input` as `NULL` (same pattern as
  `audit/service.ts:200`). Timestamps written as `now.toISOString()`.
- Every guard (`status = 'active'`, `status = 'paused'`, `deleted_at IS NULL`),
  error code, message, audit entry and return shape kept identical.
- `deleteRoutinesForAiInGroup` and its caller left untouched, with a comment
  saying it moves when `removeGroupAi`'s transaction moves. After the move the
  drizzle imports in the file serve only that function (`and`, `eq`, `isNull`,
  `routines`); `count` and the `aiTools`/`aiToolVersions` imports are gone.
- `RoutineRow` stays the type-only `typeof routines.$inferSelect`; the rows come
  back camelCased via `transformResultNames`, and timestamptz comes back as
  `Date` (as pins/tools already rely on).

### Files changed

- `apps/server/src/routines/service.ts` (only source file).
- `work/T-0627-effect-sql-routines-service.md` (front matter status + this report).

### Commands run (real results)

- `pnpm install`: done, no blockers.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/service.test.ts`:
  1 file passed, 19 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines src/tools src/topics src/groups`:
  12 files passed, 273 tests passed (56.1s). Tests unchanged.
- `pnpm gate` (first run): FAILED on `@zilar/server#typecheck` — `sql<RoutineRow>`
  returns `readonly RoutineRow[]`, which does not satisfy the private
  `toPublicRoutines(rows: RoutineRow[])` parameter (2 errors at
  service.ts:340 and :355). Scope check was already clean.
- Fix: changed the private helper to `rows: readonly RoutineRow[]`.
- `pnpm gate` (after fix):
  ```
  PASS  install (frozen)  (1.3s)
  PASS  format  (15.6s)
  PASS  lint  (0.6s)
  PASS  typecheck  (7.5s)
  PASS  tests @zilar/server  (6.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Notes / deviations

- No test file was changed; all listed tests pass unchanged.
- No drizzle/Hono/zod patterns were altered outside the converted functions.
- Error mapping: like `tools/service.ts`, the routines service has no
  HTTP-level mapping of `SqlError` (its callers treat thrown errors as before);
  I kept that shape rather than inventing an error map the spec did not ask for.

### Open questions

- None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, 1 nit, 1 follow-up. The packet head is b08317c5, the current HEAD.
- **Lead check:**
  - the insert binds every value;
  - jsonb is written as `::jsonb` casts, and a missing `input` becomes SQL NULL;
  - every guard and error text is kept;
  - `deleteRoutinesForAiInGroup` stays on drizzle, with its comment;
  - 68 service tests are green.
- **Nit, for the cleanup task:** the effect/sql comment is duplicated at `service.ts:7` and `:92`.
- **Follow-up:** the cap of 10 routines is check-then-insert, so two concurrent creates can pass it. This was true before the conversion; fix it later with a lock.
