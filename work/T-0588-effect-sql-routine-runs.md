---
id: T-0588
title: "effect/sql: the routine scheduler claim (routines/scheduler.ts claimDue) and every query in routines/execute.ts move off drizzle; row types stay `typeof routines.$inferSelect` (type-only); same claims, skips, pauses and audit; tests unchanged"
status: todo
milestone: M5
branch: task/T-0588-effect-sql-routine-runs
model: auto
effort: low
depends_on: [T-0584]
estimate: 0.5 day
---

# T-0588: routine claims and runs on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. The routine scheduler and runner use only the top-level `db`, with no transactions, so they can move now. `routines/service.ts` is out of scope.

### Verified facts (do not re-derive)
- **`apps/server/src/routines/scheduler.ts:122-170`, `claimDue(db, nowDate, maxPerTick, logger)`:**
  1. Select **every column** from `routines`, `WHERE status = 'active' AND deleted_at IS NULL AND next_run_at <= $now ORDER BY next_run_at ASC LIMIT $max`.
  2. For each row whose `parseRoutineSchedule(row.schedule)` fails: `UPDATE routines SET next_run_at = now + 1h, updated_at = now WHERE id = $id AND next_run_at = $row.nextRunAt`, then a warn log (the id only).
  3. Otherwise: `UPDATE ... SET next_run_at = $advanced, updated_at = $now WHERE id AND status = 'active' AND deleted_at IS NULL AND next_run_at = $row.nextRunAt RETURNING id`. **Only a changed row is claimed**, and it is pushed as `{ ...row, nextRunAt: advanced }`.
  
  `ClaimedRoutine = typeof routines.$inferSelect` (110). **Keep that type**, as a type-only import of `routines`.
  
  **The selected row must have exactly that shape:**
  - all 19 columns in camelCase (alias each one);
  - the jsonb columns (`schedule`, `input`, `approved_hosts`) as decoded JSON;
  - the timestamps as `Date`;
  - `consecutive_failures` as a number.
  
  Compare `next_run_at` with the `Date` that was read, as today.
- **`apps/server/src/routines/execute.ts`** (`RoutineRow`, 41: keep it the same way). The queries:
  - `executeRoutine` (79): `SELECT status FROM ais WHERE id LIMIT 1`;
  - `executeRoutine` (95): `SELECT deleted_at, current_version FROM ai_tools WHERE id LIMIT 1`;
  - `isAiInTopicRoom` (162-180):
    - the topic by id. Select only `id`, `group_id`, `visibility`, `is_general` and `archived_at`, as `Pick<TopicRow, ...>`, enough for `allowedTopicAiIds` (`topics/access.ts:384-387`, which stays drizzle and unchanged);
    - for a general topic: `group_ais` by `group_id` and `ai_id`, `LIMIT 1`;
  - `readCurrentHosts` (182-193): `ai_tool_versions.hosts` by `tool_id` and `version`, giving a copy of the array or `null`;
  - five `UPDATE routines ... WHERE id = $id`: `markSkipped` (236), `markOk` (250), `pauseForFailures` (282; the `status` and `paused_reason` columns only when pausing), `pauseForHostsChanged` (307), and any other update in the file. **Keep each one's exact SET list.**
- **The sql runtime:** a local `runSql(db, effect) = sqlRuntimeFor(db).runPromise(effect)`, as in `apps/server/src/agents/gateway/db.ts`. One small helper module is fine: `apps/server/src/routines/db.ts`, holding the queries both files use.
- **When done:**
  - `scheduler.ts` and `execute.ts` import no runtime values from `drizzle-orm` or `db/schema`; type-only imports are fine;
  - `allowedTopicAiIds` is still called the same way.
- **Tests (all unchanged):**
  - `apps/server/src/routines/*.test.ts` (including `scheduler.effect.test.ts`, `scheduler.test.ts` and `wiring.test.ts`);
  - `apps/server/src/tools/*.test.ts`.

### What to build
1. **Move the queries above to effect/sql**, with the same control flow, conditional claims, SET lists, logs and audit calls.
2. **Tests:** every listed test passes **unchanged**. Name the claim-race test you relied on in the Report (two claimers, exactly one wins).

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/routines/scheduler.ts`, `apps/server/src/routines/execute.ts`, `apps/server/src/agents/gateway/db.ts` and `apps/server/src/db/schema.ts` (lines 1344-1384).

### Allowed files
`apps/server/src/routines/scheduler.ts`, `apps/server/src/routines/execute.ts`, `apps/server/src/routines/db.ts`, `work/T-0588-effect-sql-routine-runs.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot routines tools
pnpm gate
```

### Acceptance
- The routine claim and run queries run on effect/sql with the same claims, skips, pauses and audit.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
