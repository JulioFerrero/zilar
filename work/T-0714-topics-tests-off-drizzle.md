---
id: T-0714
title: "tests off drizzle (topics): replace every drizzle query in topics/topics.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0714-topics-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0714: topics tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the topics folder.

### Verified facts (do not re-derive)
- `apps/server/src/topics/topics.test.ts` (1101 lines): drizzle at lines 2, 18, 101, 112, 165, 201, 315, 331, 419, 570, 582, 614, 620, 631, 668, 677, 689, 782, 855, 867, 880, 899, 903, 910, 946, 992, 1002, 1007, 1025, 1045, 1064, 1083, 1094.
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
`apps/server/src/topics/topics.test.ts`, `work/T-0714-topics-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/topics.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/topics/topics.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/topics/topics.test.ts`: every drizzle query (seed inserts, updates, reads used by assertions) now goes through `testSql(context)` with raw `effect/sql` SQL that names snake_case columns. Each read selects only the columns it asserts on, with a small local row type. `generalOf` has a `GeneralRow` interface.
- Removed the `drizzle-orm` and `../db/schema` imports (the `and`/`eq` helpers went with them).
- Inserts that used `.returning()` now generate their uuids in JS (`topicRuleId`, `generalRuleId`, `topicToolId`) and the assertions read those ids. Same rows and values.
- The one full-row read, the revived topic before `syncTopicRoom` (line 1051), is `SELECT *` typed as `TopicRow` from `./access`, because `syncTopicRoom` takes the full row type. Still a type import, not `db/schema`.
- Kept as they were: `context.db` passed to `syncTopicRoom` (module function, not a drizzle query), and the existing raw `context.client.query` backfill INSERT (plain PGlite SQL, not drizzle).
- No table here has a JS-side default (`$defaultFn`/`$onUpdate`); the DB defaults fill the omitted columns. Timestamps are passed as `toISOString()`, the same as `backgrounds/routes.test.ts`.
- Only file changed besides this report: the task front matter status.

### Commands and results
- Before any change: `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/topics.test.ts`: 1 file passed, 32 tests passed.
- After the change (and after prettier): same command, 1 file passed, 32 tests passed.
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/topics/topics.test.ts`: no output (exit 1).
- `pnpm exec prettier --write apps/server/src/topics/topics.test.ts`: formatted.
- `pnpm gate` (from /Users/julio/personal-projects/zilar-T-0714, exit 0), summary lines:
  - `PASS  install (frozen)  (1.7s)`
  - `PASS  format  (30.2s)`
  - `PASS  lint  (2.1s)`
  - `PASS  typecheck  (6.6s)`
  - `PASS  tests @zilar/server  (20.1s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
  - Gate reported 2 changed files against main: the test file and this task file.

### Problems, deviations, open questions
- No deviations from the spec. No test needed its assertion changed.
- Not verified beyond the test run and gate: I did not check the exact runtime types of timestamp and jsonb values from `testSql` (the assertions only check null / not-null and string containment, which hold).

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 5.5 min). The lead reviewed the diff directly and checked it against main. The role updates keep the same `WHERE user_id` as the originals, and the tool seeds carry explicit timestamps. There are 32 tests before and after, no drizzle import is left, and the gate passed.
