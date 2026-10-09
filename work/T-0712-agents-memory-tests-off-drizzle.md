---
id: T-0712
title: "tests off drizzle (agents/memory): replace every drizzle query in agents/memory/cleanup.test.ts, agents/memory/compactor.test.ts, agents/memory/indexer.test.ts, agents/memory/routes.test.ts, agents/memory/store.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
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

### What I did
Replaced every drizzle query in the five `agents/memory` test files with `testSql(context)` + `effect/sql`, keeping the same rows, values, order and assertions. Removed the `drizzle-orm` and `../../db/schema` imports from all five. The lines that pass `context.db` to a module function (`compactMemory({ db: context.db, … })`, `claimHandle`-style calls, `sqlRuntimeFor(context.db).runPromise(…)` in cleanup.test.ts) were left unchanged.

Conventions followed (per the spec and `pins/pins.test.ts` / `chats/chats.test.ts`):
- SQL names snake_case columns; results come back camelCased via `transformResultNames`.
- Seeding uses `sql\`INSERT INTO <table> ${sql.insert({…})}\`` with snake_case keys (bulk rows use `sql.insert([…])`); `"user"` is quoted; `ai_limits` money values are passed as strings.
- Timestamps are passed as `Date` objects (`at`, `created_at`), matching the production `indexer.ts` insert; `now`/`DEFAULT` columns are omitted.
- Counts use `count(*)::int AS total`.
- `indexed_through_micros` (bigint column) is read as `indexed_through_micros::float8 AS indexed_through_micros` so the assertion sees a number, mirroring `media/indexer.test.ts`.
- The `ai_memory_messages.at` column reads back as a JS `Date` from PGlite (verified directly against `@electric-sql/pglite`), so `stored[0]?.at.toISOString()` was kept as-is.
- `rowsFor`/`nodesFor` in `indexer.test.ts` return `readonly` row arrays because `sql<T>` yields `ReadonlyArray<T>`.
- Local row interfaces (`MemoryMessageRow`, `MemoryNodeRow`) were added in `indexer.test.ts`; other files select single columns inline.

### Files changed
- `apps/server/src/agents/memory/cleanup.test.ts`
- `apps/server/src/agents/memory/compactor.test.ts`
- `apps/server/src/agents/memory/indexer.test.ts`
- `apps/server/src/agents/memory/routes.test.ts`
- `apps/server/src/agents/memory/store.test.ts`
- `work/T-0712-agents-memory-tests-off-drizzle.md` (status + this Report)

### Commands and real results
- `pnpm install` → `Done in 11.9s using pnpm v10.32.1` (warnings about an unrelated mobile peer dep).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot <the five files>` → `Test Files 5 passed (5)`, `Tests 50 passed (50)`, 44.05s.
- `git grep -n "drizzle-orm\|db/schema" -- <the five files>` → no output (exit 1). Acceptance met.
- `pnpm gate` (final run) summary:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (22.7s)
  PASS  lint  (0.5s)
  PASS  typecheck  (2.9s)
  PASS  tests @zilar/server  (48.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Tests: before / after
Unchanged, no tests added or removed. Counts from `git show HEAD:<file> | grep -c "  it("`:
- cleanup: 4 before / 4 after
- compactor: 5 before / 5 after
- indexer: 10 before / 10 after
- routes: 7 before / 7 after
- store: 24 before / 24 after
- Total: 50 before / 50 after.

### Deviations / notes
- Two gate iterations were needed: the first failed `format` on `indexer.test.ts`; I ran `prettier --write` on that one file. The second failed `typecheck` with `TS4104` (readonly array), fixed by typing `rowsFor`/`nodesFor` as `Promise<readonly …[]>`. The third gate run passed.
- No changes to assertion meaning: the only value-type adaptations are the `::float8` cast on `indexed_through_micros` and passing ISO/`Date` timestamp values, both preserving the checked values.
- No open questions.

## Review (written by Claude)

**2026-10-09, lead:** approved. The pre-review was clean (packet head 21c26a80). All five agents/memory test files are on `testSql`.
