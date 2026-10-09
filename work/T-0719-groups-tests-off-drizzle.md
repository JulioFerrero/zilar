---
id: T-0719
title: "tests off drizzle (groups): replace every drizzle query in groups/groups.test.ts, groups/visibility.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: todo
milestone: M5
branch: task/T-0719-groups-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0719: groups tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the groups folder.

### Verified facts (do not re-derive)
- `apps/server/src/groups/groups.test.ts` (1750 lines): drizzle at lines 3, 18, 92, 102, 118, 127, 139, 227, 279, 280, 318, 319, 334, 335, 408, 449, 587, 612, 657, 756, 782, 800, 867, 875, 906, 917, 928, 935, 938, 946, 960, 969, 972, 994, 1022, 1033, 1050, 1095, 1111, 1118, 1130, 1141, 1157, 1171, 1186, 1204, 1217, 1232, 1251, 1274, 1377, 1464, 1668, 1716, 1718.
- `apps/server/src/groups/visibility.test.ts` (872 lines): drizzle at lines 7, 16, 139, 230, 341, 385, 387, 429, 437, 651, 652, 693, 716, 722, 731, 749, 756, 768, 824, 839, 860, 868.
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
`apps/server/src/groups/groups.test.ts`, `apps/server/src/groups/visibility.test.ts`, `work/T-0719-groups-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/groups.test.ts src/groups/visibility.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/groups/groups.test.ts apps/server/src/groups/visibility.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
