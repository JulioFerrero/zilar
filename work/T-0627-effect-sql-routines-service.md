---
id: T-0627
title: "effect/sql: routines/service.ts off drizzle except deleteRoutinesForAiInGroup (it runs inside the groups/service.ts drizzle transaction); jsonb written as JSON text, count(*)::int; same errors, audits, public shape; tests unchanged"
status: todo
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

## Review (written by Claude)
