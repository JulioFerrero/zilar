---
id: T-0699
title: "tests off drizzle (search): replace every drizzle query in search/search.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0699-search-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0699: search tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the search folder.

### Verified facts (do not re-derive)
- `apps/server/src/search/search.test.ts` (1250 lines): drizzle at lines 3, 5, 395, 592, 602, 614, 644, 777.
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
`apps/server/src/search/search.test.ts`, `work/T-0699-search-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/search/search.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/search/search.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/search/search.test.ts`: removed the `drizzle-orm` and `../db/schema` imports and added `Effect`, `SqlClient` and `testSql` imports, following `pins/pins.test.ts`.
- Three group lookups (was `context.db.select().from(groups).where(eq(groups.id, group.id))`) now run `SELECT room_localpart FROM groups WHERE id = ${group.id}` through `testSql(context)`, typed with a new local `GroupRow { roomLocalpart: string }`.
- Seed of an AI DM: one `INSERT INTO provider_connections (id, owner, provider, encrypted_key, label)`, one `INSERT INTO ais (...)` with the 10 columns the test set (`provider_connection_id`, `localpart`, `jid`, `status`, and so on), and one `INSERT INTO ai_limits (ai_id, per_day_usd, per_month_usd)` with `'1.00'` and `'20.00'`. Every column name was checked against `apps/server/src/db/schema.ts`. The tables have no JS-side `$defaultFn` or `$onUpdate`, so nothing is filled in by hand: `created_at`, `updated_at`, `can_delegate`, `accepts_delegation`, `previous_persona` and `machine_id` take their SQL defaults or NULL.
- Left alone: `db: context.db` at line 137 (the `createApp` argument), as the spec asks.
- Assertions, rows and values are unchanged.

### Commands and results
- `pnpm install`: done, exit 0.
- Baseline before any change, `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/search/search.test.ts`: Test Files 1 passed (1), Tests 27 passed (27).
- After the change, same command: Test Files 1 passed (1), Tests 27 passed (27).
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/search/search.test.ts`: no output (exit 1, no match).
- `pnpm gate` from `/Users/julio/personal-projects/zilar-T-0699`, exit 0:
  - PASS install (frozen)
  - PASS format
  - PASS lint
  - PASS typecheck
  - PASS tests @zilar/server
  - scope: every changed file is inside the Allowed files
  - GATE PASS
- Changed files (`git status`): `apps/server/src/search/search.test.ts` and `work/T-0699-search-tests-off-drizzle.md`.

### Problems and deviations
- None against the spec. The gate's test step does not print test counts, so the 27 comes from the single-file run.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 7.8 min). The lead reviewed the diff directly. The seed inserts and group reads are on `testSql`, with snake_case columns and explicit ids. There are 27 tests before and after, no drizzle import is left, and the gate passed.
