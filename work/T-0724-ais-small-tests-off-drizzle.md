---
id: T-0724
title: "tests off drizzle (ais (integration, usage, service)): replace every drizzle query in ais/integration.test.ts, ais/usage.test.ts, ais/service.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0724-ais-small-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0724: ais (integration, usage, service) tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the ais (integration, usage, service) folder.

### Verified facts (do not re-derive)
- `apps/server/src/ais/integration.test.ts` (583 lines): drizzle at lines 5, 9.
- `apps/server/src/ais/usage.test.ts` (392 lines): drizzle at lines 3, 13, 94, 98, 106, 118, 119, 139, 241, 253, 340, 384.
- `apps/server/src/ais/service.test.ts` (873 lines): drizzle at lines 3, 14, 114, 119, 128, 140, 141, 171, 186, 194, 211, 227, 246, 264, 281, 286, 295, 307, 308, 342, 379, 382, 454, 457, 468, 493, 495, 507, 521, 523, 557, 558, 585, 603, 656, 675, 688, 709, 718, 734, 757, 772, 779, 795, 799, 832, 841, 861, 862.
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
`apps/server/src/ais/integration.test.ts`, `apps/server/src/ais/usage.test.ts`, `apps/server/src/ais/service.test.ts`, `work/T-0724-ais-small-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais/integration.test.ts src/ais/usage.test.ts src/ais/service.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/ais/integration.test.ts apps/server/src/ais/usage.test.ts apps/server/src/ais/service.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Replaced every drizzle query in the three ais test files with effect/sql via
`testSql(context)` (usage, service) and `registerSqlRuntime` +
`sqlRuntimeFor` (integration backfill, which points at a live Postgres, not a
PGlite test context). Removed all `drizzle-orm` and `../db/schema` imports.
Same rows, values, order and assertions; selects name snake_case columns and
read into small local row types (`VirtualKeyRow`, `AiRow`,
`{ baselineUsd }`, etc.). Numerics still assert as strings (`'1.50'`,
`'3.25'`), unchanged meaning. No test patched `context.db.transaction`, so no
vi.mock seam was needed. `db: context.db` / `db: directDb.db` passed into
module functions left alone.

Files changed:
- `apps/server/src/ais/usage.test.ts` — seed inserts, `baselineFor` select,
  two `aiDailySpend` count/shape reads, two `ai_limits` updates.
- `apps/server/src/ais/service.test.ts` — `seedOldAi` / `seedSwappableAi` /
  `addOwnedConnection` / stranger inserts, all `llm_virtual_keys` and `ais`
  reads, `ais` status updates, `ai_limits` untouched (no drizzle there),
  full-table `DELETE FROM llm_virtual_keys`, empty-table length assertions.
- `apps/server/src/ais/integration.test.ts` — backfill
  `update(llmVirtualKeys).set({ litellmModelId: null })` replaced with an
  effect/sql `UPDATE llm_virtual_keys ...` on a runtime registered for the
  live handle (`registerSqlRuntime(directDb.db, databaseUrl)`), disposed in
  the `finally` next to `directDb.close()`. Deviation from spec: `testSql`
  cannot typecheck here (`TestContext['db']` is the PGlite drizzle type,
  `createDb(DATABASE_URL)` is postgres-js), so the proven
  register/sqlRuntimeFor pair from `effect/sql.ts` is used instead; same SQL,
  same effect/sql path the modules use.
- `work/T-0724-ais-small-tests-off-drizzle.md` — this report.

Commands and real results:
- `pnpm install`: done (27.6s).
- Before: `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/ais/integration.test.ts src/ais/usage.test.ts src/ais/service.test.ts`
  → 39 passed, 2 skipped (integration file gated off), 0 failed.
- After (same command): 39 passed, 2 skipped, 0 failed. The 2 skipped live
  integration tests never ran (need `ZILAR_AIS_INTEGRATION=1` plus ejabberd /
  LiteLLM / Postgres), so the backfill-path edit above is typechecked but not
  executed.
- `git grep -n "drizzle-orm\|db/schema" -- <the three files>`: prints nothing.
- `pnpm prettier --write` on the touched test files (gate's format check
  flagged my hand indentation).
- `pnpm gate` summary:
  `gate: 4 changed file(s) against main` / `PASS install (frozen)` /
  `PASS format` / `PASS lint` / `PASS typecheck` /
  `PASS tests @zilar/server` /
  `scope: every changed file is inside the Allowed files` / `GATE PASS`.

Blocked / needs a decision: none.

## Review (written by Claude)

**2026-10-09, lead:** approved. The pre-review was clean (packet head b2c41e07). Its one nit is accepted: the backfill UPDATE runs only in the gated live-integration test, a 1:1 translation of the drizzle line.
