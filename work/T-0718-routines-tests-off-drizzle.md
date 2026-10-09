---
id: T-0718
title: "tests off drizzle (routines): replace every drizzle query in routines/scheduler.effect.test.ts, routines/scheduler.test.ts, routines/service.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0718-routines-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0718: routines tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the routines folder.

### Verified facts (do not re-derive)
- `apps/server/src/routines/scheduler.effect.test.ts` (232 lines): drizzle at lines 3, 4, 46, 52, 60, 72, 131, 182.
- `apps/server/src/routines/scheduler.test.ts` (924 lines): drizzle at lines 3, 17, 65, 74, 86, 96, 102, 103, 105, 127, 140, 215, 226, 231, 412, 438, 448, 449, 484, 502, 505, 578, 621, 681, 727, 769, 889, 894.
- `apps/server/src/routines/service.test.ts` (887 lines): drizzle at lines 3, 17, 44, 53, 65, 76, 82, 84, 87, 109, 122, 365, 512, 564, 582, 624, 643, 687, 702, 724, 746, 781, 786, 799, 811, 812, 840, 851, 871, 883.
- **`testSql(context)`** is in `apps/server/src/test-support.ts` (T-0695). Use it as `await testSql(context)(Effect.gen(function* () { const sql = yield* SqlClient.SqlClient; return yield* sql<Row>\`...\`; }))`, with the imports `import { Effect } from 'effect'; import { SqlClient } from 'effect/sql';`. The worked example is `apps/server/src/pins/pins.test.ts`.
- **Results come back camelCased** (`transformResultNames`, `apps/server/src/effect/sql.ts:56`), and the SQL must name the **snake_case** columns. Keys passed to `sql.insert(...)` must be snake_case too. `"user"` must be quoted. Use `count(*)::int` for counts, and `${JSON.stringify(value)}::jsonb` for jsonb.
- **Drizzle filled some columns in JavaScript** (`$defaultFn`, `$onUpdate` in `apps/server/src/db/schema.ts`). The database does not, so a raw insert must give those values itself: check each table's columns in `schema.ts`. Columns with a SQL default (`defaultNow()`, `default(...)`) can be left out.

### What to build
1. **In each file above,** replace every drizzle query (seed inserts, updates, deletes, reads used by assertions) with `testSql(context)(...)`. Keep the same rows, values, order and assertions. Select only the columns a test reads, and give them a small local row type.
2. **Remove** the `drizzle-orm` and `../db/schema` imports, including any dynamic `import('../db/schema')`.
3. **Leave alone** the lines that pass `context.db` to a module function (`db: context.db`, `claimHandle(context.db, …)`): they are not drizzle queries.
4. **Values whose JS type differs** from drizzle (timestamps, numerics, jsonb): adapt only the read, never the meaning of an assertion. If a test cannot pass without changing what it checks, stop and ask (status: blocked).

### Read first
`AGENTS.md`, `docs/audit/drizzle-removal-plan.md` §2 (lines 249-390), `apps/server/src/pins/pins.test.ts` (the worked example), the files above, and the matching tables in `apps/server/src/db/schema.ts`.

### Allowed files
`apps/server/src/routines/scheduler.effect.test.ts`, `apps/server/src/routines/scheduler.test.ts`, `apps/server/src/routines/service.test.ts`, `work/T-0718-routines-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/scheduler.effect.test.ts src/routines/scheduler.test.ts src/routines/service.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/routines/scheduler.effect.test.ts apps/server/src/routines/scheduler.test.ts apps/server/src/routines/service.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Did: replaced every drizzle query in the three routines test files with
`testSql(context)(Effect.gen(...))` + `SqlClient`, following the
`pins.test.ts` worked example; removed all `drizzle-orm` and `../db/schema`
imports (including the dynamic `import('../db/schema')` for `topicAis` in
`service.test.ts`). `context.db` is now only passed through to module
functions (`createRoutine`, `saveToolVersion`, `deleteTool`,
`createAuditRecorder`, `removeGroupAi`, `removeTopicAi`,
`sqlRuntimeFor`), never queried directly.

- `scheduler.effect.test.ts`: `seedUser` inserts `"user"`;
  `seedActiveAi` inserts `provider_connections` / `ais` / `ai_limits`;
  both `rearm` closures `UPDATE routines SET next_run_at`.
- `scheduler.test.ts`: `seedAi` (with explicit `status` bind param, so the
  `stopped`-AI test works), `seedGroupWithTopic`, `seedNonGeneralTopic`,
  `seedRoutine` rearm, `readRoutine` (selects `last_status`,
  `consecutive_failures`, `last_run_at`, `next_run_at`, `status`,
  `paused_reason`, `deleted_at` into a local `RoutineRow`), `auditEntries`
  (selects `action, result, detail`), all pause/resume/rearm `UPDATE`s,
  both `ai_tools` name lookups, the deleted-tool `routines` lookup, and the
  audit-failure loop updates.
- `service.test.ts`: `seedAi`, `seedGroup` (group_ais loop inside one
  `Effect.gen`), `seedPrivateTopic`, all three `audit_log` selects (one
  `SELECT action, subject_id, detail`, applied with replaceAll since the
  text was identical), all `group_members` inserts, the `needs_approval`
  and resume-fail `UPDATE`s, all `routines` deleted/status reads, the
  `topics` + `topic_ais` seed in the remove-topic-AI test, and the
  `ai_tools` empty check (`SELECT id ... LIMIT 1`, `rows[0]` is
  `undefined`, same assertion as before).
- Raw SQL names snake_case columns; results come back camelCased. Dates
  are bound/read as `Date` (unchanged assertions like
  `row.nextRunAt.getTime()` still hold). `ai_limits` numerics inserted as
  `'1.00'`/`'20.00'` strings. No JS-default columns in these tables
  (only `chat_folders.id` uses `$defaultFn`, untouched), so every raw
  insert lists all non-defaulted columns explicitly. No assertion’s
  meaning was changed.

Files changed:
- `apps/server/src/routines/scheduler.effect.test.ts`
- `apps/server/src/routines/scheduler.test.ts`
- `apps/server/src/routines/service.test.ts`
- `work/T-0718-routines-tests-off-drizzle.md` (this report + status)

Commands and real results:
- `pnpm install`: done (23.7s).
- Baseline before changes:
  `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/routines/scheduler.effect.test.ts src/routines/scheduler.test.ts
  src/routines/service.test.ts` → 3 files, 43 passed.
- Same command after changes → 3 files, 43 passed (identical count).
- `git grep -n "drizzle-orm\|db/schema" -- <three files>` → prints
  nothing (exit 1, no matches).
- `pnpm gate` (after `prettier --write` on the two reformatted test
  files; first gate run failed format only): `gate: 4 changed file(s)
  against main / PASS install (frozen) / PASS format / PASS lint /
  PASS typecheck / PASS tests @zilar/server /
  scope: every changed file is inside the Allowed files / GATE PASS`.

Problems: none. First `pnpm gate` failed on `format` for the two larger
files (long `testSql` lines); fixed with prettier, no logic change.
Deviations: none. Open questions: none.

Security checklist: test-only change; no secrets, routes, caps, or audit
content touched. Deletes/updates in tests are scoped by primary key
(`WHERE id = ...`).

## Review (written by Claude)

**2026-10-09, lead:** approved. The pre-review was clean (packet head 94f4de2e). All 43 routines tests pass with the same assertions, and no drizzle import is left.
