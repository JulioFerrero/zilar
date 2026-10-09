---
id: T-0712
title: "tests off drizzle (agents/memory): replace every drizzle query in agents/memory/cleanup.test.ts, agents/memory/compactor.test.ts, agents/memory/indexer.test.ts, agents/memory/routes.test.ts, agents/memory/store.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: todo
milestone: M5
branch: task/T-0712-agents-memory-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0712: agents/memory tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the agents/memory folder.

### Verified facts (do not re-derive)
- `apps/server/src/agents/memory/cleanup.test.ts` (308 lines): drizzle at lines 3, 17, 42, 51, 63, 75, 85, 92, 99, 115, 119, 123, 127, 157, 163, 164, 167, 195, 207.
- `apps/server/src/agents/memory/compactor.test.ts` (207 lines): drizzle at lines 3, 4, 21, 25, 33, 64, 68, 82, 173.
- `apps/server/src/agents/memory/indexer.test.ts` (521 lines): drizzle at lines 4, 12, 227, 231, 239, 286, 294, 318, 364, 454, 477.
- `apps/server/src/agents/memory/routes.test.ts` (300 lines): drizzle at lines 3, 10, 70, 80, 97, 103, 179, 184, 200, 278.
- `apps/server/src/agents/memory/store.test.ts` (522 lines): drizzle at lines 3, 11, 44, 48, 56, 87, 96, 116, 126, 189, 272, 397, 409, 419, 473, 478.
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
`apps/server/src/agents/memory/cleanup.test.ts`, `apps/server/src/agents/memory/compactor.test.ts`, `apps/server/src/agents/memory/indexer.test.ts`, `apps/server/src/agents/memory/routes.test.ts`, `apps/server/src/agents/memory/store.test.ts`, `work/T-0712-agents-memory-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/memory/cleanup.test.ts src/agents/memory/compactor.test.ts src/agents/memory/indexer.test.ts src/agents/memory/routes.test.ts src/agents/memory/store.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/agents/memory/cleanup.test.ts apps/server/src/agents/memory/compactor.test.ts apps/server/src/agents/memory/indexer.test.ts apps/server/src/agents/memory/routes.test.ts apps/server/src/agents/memory/store.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
