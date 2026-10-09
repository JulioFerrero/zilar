---
id: T-0725
title: "tests off drizzle (ais/routes): replace every drizzle query in ais/routes.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0725-ais-routes-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0725: ais/routes tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the ais/routes folder.

### Verified facts (do not re-derive)
- `apps/server/src/ais/routes.test.ts` (2023 lines): drizzle at lines 3, 25, 235, 306, 381, 393, 394, 395, 428, 442, 497, 510, 539, 563, 583, 584, 601, 621, 622, 654, 655, 685, 686, 698, 710, 711, 723, 733, 745, 749, 761, 762, 772, 788, 800, 809, 819, 832, 927, 955, 957, 986, 1041, 1075, 1159, 1177, 1179, 1224, 1299, 1314, 1324, 1415, 1581, 1629, 1691, 1707, 1770, 1777, 1851, 1878, 2000, 2018, 2019.
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
`apps/server/src/ais/routes.test.ts`, `work/T-0725-ais-routes-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais/routes.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/ais/routes.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did**
- Replaced every drizzle query in `apps/server/src/ais/routes.test.ts` (seed inserts, updates, reads used by assertions, and `where eq(...)` lookups) with `testSql(context)(Effect.gen(...))` using `effect/sql`. Inserts use `sql.insert({...})` with snake_case keys, including the `ais` and `ai_limits` seeds in the "crash" test. The `machines` insert is written as a `VALUES (...)` statement with `${JSON.stringify({ os: 'macos' })}::jsonb`, because `sql.insert` cannot add a jsonb cast.
- Columns written and read were checked against `apps/server/src/db/schema.ts`: `provider_connections`, `ais`, `ai_limits`, `llm_virtual_keys`, `machines`, `audit_log`. The JS-filled defaults in the schema are only `chatFolders.id`, so no value needed to be filled in by the test. Other defaults are SQL defaults.
- Reads select only the columns the test uses. Local row types: `VirtualKeyRow` (5 columns, one read that uses all of them), `VirtualKeyIds` (2 columns), and inline types for the rest.
- Removed the `drizzle-orm` and `../db/schema` imports. Added `Effect`, `SqlClient` and `testSql`.
- Left the `db: context.db` lines (module functions and `createAuditRecorder`), as the spec says.
- The file has no drizzle method patches (no `vi.mock`, `spyOn` or `transaction` injection), so the failure-injection seam in item 5 did not apply.
- Ran `pnpm exec prettier --write apps/server/src/ais/routes.test.ts`.
- Ran `pnpm install --frozen-lockfile` once before starting.

**Test counts (single file, `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais/routes.test.ts`)**
- Before any change: `Test Files 1 passed (1)`, `Tests 49 passed (49)`.
- After the conversion, rerun at two checkpoints and after the final narrowing of selects: `Tests 49 passed (49)`.

**Acceptance**
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/ais/routes.test.ts` prints nothing (exit 1).

**Gate (`pnpm gate` from `/Users/julio/personal-projects/zilar-T-0725`, exit 0)**
- `PASS install (frozen) (2.6s)`
- `PASS format (34.9s)`
- `PASS lint (2.4s)`
- `PASS typecheck (5.3s)`
- `PASS tests @zilar/server (29.5s)`
- `scope: every changed file is inside the Allowed files`
- `GATE PASS`
- The gate reported 2 changed files against main: `apps/server/src/ais/routes.test.ts` and this task file.

**Problems or deviations**
- None in behaviour. I did not change any assertion, expected value or test name.

**Open questions**
- Unsure only whether reviewers want the `machines` insert as a `VALUES` statement rather than `sql.insert`, since `sql.insert` cannot add the jsonb cast.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 6.8 min). The lead reviewed the diff directly and checked it against main. The two updates match the drizzle originals, and the machine seed writes capabilities as `::jsonb` through `VALUES`, which is fine. There are 49 tests before and after, no drizzle import is left, and the gate passed.
