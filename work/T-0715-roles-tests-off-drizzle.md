---
id: T-0715
title: "tests off drizzle (roles): replace every drizzle query in roles/roles.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0715-roles-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0715: roles tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the roles folder.

### Verified facts (do not re-derive)
- `apps/server/src/roles/roles.test.ts` (1150 lines): drizzle at lines 2, 3, 113, 114, 116, 209, 349, 386, 428, 436, 448, 453, 567, 569, 577, 589, 594, 654, 678, 680, 681, 808, 853, 855, 856, 870, 872, 873, 899, 904, 939, 953, 954, 956, 958, 962, 970, 982, 987, 1022, 1037, 1063, 1081, 1099, 1104, 1105, 1106, 1138, 1140.
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
`apps/server/src/roles/roles.test.ts`, `work/T-0715-roles-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/roles/roles.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/roles/roles.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Done.** Every drizzle query in `apps/server/src/roles/roles.test.ts` now goes through `testSql(context)(Effect.gen(...))` with `effect/sql` and snake_case SQL. The `drizzle-orm` and `../db/schema` imports, including the dynamic `import('../db/schema')`, are gone. `context.db` stays only where it is passed to module functions (`createApproval`, `canDecide`). No production code changed.

Changes in the file:
- New local row types: `AuditRow`, `GroupMemberRoleRow`, `TopicRoleAccessRow`, `TopicArchiveRow`, `TopicApproverRow`. Each read selects only the columns the test uses.
- New `seedAi(ownerId, groupId)` helper. It replaces three identical copies of the raw seed (provider connection, AI, ai_limits, group_ais). Same rows and values, same order.
- `randomUUID` and `aiLocalpart` are now static imports (they were dynamic before).
- The "sequential replacements" read and the "concurrent replacements" read each go through `testSql` with a local name (`sequentialRows`, `final`). Assertions are unchanged.
- Column names checked against `apps/server/src/db/schema.ts`: `provider_connections`, `ais`, `ai_limits`, `group_ais`, `group_members`, `group_member_roles` (`assigned_at` left to its SQL default), `topic_role_access`, `topics` (`archived_at`, `approver_role_id`), `group_roles`, `audit_log` (`subject_id`, `detail`). None of these tables has a JS-side `$defaultFn` or `$onUpdate` that the raw inserts would miss.

Commands run:
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/roles/roles.test.ts` before the change: 1 file passed, 22 tests passed.
- The same command after the change: 1 file passed, 22 tests passed.
- `pnpm exec prettier --write apps/server/src/roles/roles.test.ts`: exit 0.
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/roles/roles.test.ts`: no output, exit 1.
- `pnpm gate` from the worktree root: exit 0.
  - `gate: 2 changed file(s) against main`
  - `PASS  install (frozen)  (2.5s)`
  - `PASS  format  (28.3s)`
  - `PASS  lint  (1.7s)`
  - `PASS  typecheck  (4.9s)`
  - `PASS  tests @zilar/server  (22.0s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

Open questions: none. One detail to check in review: `archived_at` now comes back through `effect/sql`, and the two assertions only check for null or not-null. I did not compare the Date type itself.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 4.9 min). The lead reviewed the diff directly and checked it against main. The seeds, the role and approver updates (the same `WHERE` as the drizzle originals) and the reads are on `testSql`. There are 22 tests before and after, no drizzle import is left, and the gate passed.
