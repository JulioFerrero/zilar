---
id: T-0729
title: "tests off drizzle (auth/sql-adapter): replace every drizzle query in auth/sql-adapter.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0729-sql-adapter-test-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0729: auth/sql-adapter tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the auth/sql-adapter folder.

### Verified facts (do not re-derive)
- `apps/server/src/auth/sql-adapter.test.ts` (289 lines): drizzle at lines 4, 215, 285.
- **`testSql(context)`** is in `apps/server/src/test-support.ts` (T-0695). Use it as `await testSql(context)(Effect.gen(function* () { const sql = yield* SqlClient.SqlClient; return yield* sql<Row>\`...\`; }))`, with the imports `import { Effect } from 'effect'; import { SqlClient } from 'effect/sql';`. The worked example is `apps/server/src/pins/pins.test.ts`.
- **Results come back camelCased** (`transformResultNames`, `apps/server/src/effect/sql.ts:56`), and the SQL must name the **snake_case** columns. Keys passed to `sql.insert(...)` must be snake_case too. `"user"` must be quoted. Use `count(*)::int` for counts, and `${JSON.stringify(value)}::jsonb` for jsonb.
- **Drizzle filled some columns in JavaScript** (`$defaultFn`, `$onUpdate` in `apps/server/src/db/schema.ts`). The database does not, so a raw insert must give those values itself: check each table's columns in `schema.ts`. Columns with a SQL default (`defaultNow()`, `default(...)`) can be left out.

### What to build
1. **In each file above,** replace every drizzle query (seed inserts, updates, deletes, reads used by assertions) with `testSql(context)(...)`. Keep the same rows, values, order and assertions. Select only the columns a test reads, and give them a small local row type.
2. **Remove** the `drizzle-orm` and `../db/schema` imports, including any dynamic `import('../db/schema')`.
3. **Leave alone** the lines that pass `context.db` to a module function (`db: context.db`, `claimHandle(context.db, …)`): they are not drizzle queries.
4. **Values whose JS type differs** from drizzle (timestamps, numerics, jsonb): adapt only the read, never the meaning of an assertion. If a test cannot pass without changing what it checks, stop and ask (status: blocked).
5. **A test that patches `context.db.transaction` or another drizzle method** to inject a failure no longer reaches the module, because the modules run on effect/sql. Move it to the proven seam: a partial `vi.mock` of the effect/sql module that wraps `sqlRuntimeFor` in `vi.fn(actual.sqlRuntimeFor)`, then `mockReturnValueOnce({ runPromise: () => Promise.reject(err) } as never)` right before the call. See `apps/server/src/setup/routes.test.ts:25-30` and `apps/server/src/app.test.ts` (the down-database test). Keep what the test asserts.

### Read first
`AGENTS.md`, `docs/audit/drizzle-removal-plan.md` §2 (lines 249-390), `apps/server/src/pins/pins.test.ts` (the worked example), the files above, and the matching tables in `apps/server/src/db/schema.ts`.

### Allowed files
`apps/server/src/auth/sql-adapter.test.ts`, `work/T-0729-sql-adapter-test-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/sql-adapter.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/auth/sql-adapter.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did.** In `apps/server/src/auth/sql-adapter.test.ts` I replaced the three drizzle uses with `testSql(context)(Effect.gen(...))` + `SqlClient`:
- line 215 (old): `context.db.select().from(user)` in the "snake_case columns" test became `SELECT email_verified, created_at FROM "user"`, read into a local `UserTimestampRow` (`emailVerified`, `createdAt: Date`). Assertions unchanged.
- line 285 (old): the OTP test's `context.db.select().from(user)` became `SELECT email FROM "user"`, read into a local `UserEmailRow`. Assertions unchanged.
- Removed `import { user } from '../db/schema'`; added `Effect` from `effect`, `SqlClient` from `effect/sql`, and `testSql` from `../test-support`.
- Left alone: `effectSqlAdapter(context.db)` (lines 14 and 237), which passes `context.db` to a module function.
- No test in this file patches `context.db.transaction` or another drizzle method, so the item-5 seam move did not apply.
- The task file's status was set to `in-progress` at the start, then `review`.

**Files changed:** `apps/server/src/auth/sql-adapter.test.ts`, `work/T-0729-sql-adapter-test-off-drizzle.md`.

**Commands and results:**
- `pnpm install`: exit 0.
- Before any change, `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/sql-adapter.test.ts`: 8 passed (1 file).
- After the change, same command: 8 passed (1 file). `createdAt` came back as a `Date`, so the `toBeInstanceOf(Date)` assertion still holds.
- `pnpm exec prettier --write apps/server/src/auth/sql-adapter.test.ts`: unchanged.
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/auth/sql-adapter.test.ts`: no output (exit 1), as the acceptance requires.
- `pnpm gate` (from `/Users/julio/personal-projects/zilar-T-0729`, exit 0):
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (2.5s)
  PASS  format  (34.4s)
  PASS  lint  (1.2s)
  PASS  typecheck  (6.8s)
  PASS  tests @zilar/server  (11.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- The gate's own tests step ran the nearest server tests; I did not run the whole server suite.

**Problems / deviations:** none. A first gate attempt failed only because `timeout` is not installed on this macOS shell (exit 127, nothing ran); I reran it without it.

**Blocked / needs a decision:** none.

**Open questions:** none.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 2.8 min). The lead reviewed the diff directly. The two `"user"` reads are on `testSql`. There are 8 tests before and after, no drizzle import is left, and the gate passed.
