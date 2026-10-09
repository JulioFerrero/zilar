---
id: T-0723
title: "tests off drizzle (actions/gateway): replace every drizzle query in actions/gateway.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0723-actions-gateway-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0723: actions/gateway tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the actions/gateway folder.

### Verified facts (do not re-derive)
- `apps/server/src/actions/gateway.test.ts` (1794 lines): drizzle at lines 2, 18, 70, 80, 90, 102, 113, 119, 121, 124, 146, 357, 395, 439, 450, 491, 525, 545, 553, 611, 619, 648, 653, 696, 702, 745, 746, 816, 821, 932, 983, 994, 1004, 1006, 1025, 1032, 1039, 1060, 1071, 1093, 1113, 1120, 1153, 1304, 1309, 1430, 1466, 1487, 1552, 1656, 1664, 1677, 1722.
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
`apps/server/src/actions/gateway.test.ts`, `work/T-0723-actions-gateway-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/actions/gateway.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/actions/gateway.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Done.** Every drizzle query in `apps/server/src/actions/gateway.test.ts` (seeds, updates, reads, counts) is now `testSql(context)(Effect.gen(...))` with raw SQL on snake_case columns. The `drizzle-orm` and `../db/schema` imports are removed. `context.db` is still passed to module functions (`createAuditRecorder`, `decideApproval`, `createRule`, the gateway `db:` option), as the spec asks.

Notes on the translation:
- Row types added at the top of the file: `ApprovalRow`, `PendingRow`, `AuditRow`. Other reads use inline `sql<{...}>` types.
- Where a test checks that a secret is absent from a whole row (`JSON.stringify(rows)).not.toContain(...)`), the read is `SELECT *`, so the check still covers every column. These are the audit-log and pending-row checks.
- Timestamps are passed as ISO strings with `::timestamptz`, computed in JS the same way as before (`new Date(Date.now() - 1)` and similar). `archived_at` is set with `now()`.
- No ORDER BY was added where drizzle had none (the "last audit row" check keeps the same implicit order).
- The file had no `vi.mock`, no patched `db.transaction` and no other injected drizzle method, so the spec's point 5 did not apply.
- No schema defaults were JS-side: `schema.ts` has one `$defaultFn` (line 793, in `chatFolders`), and this file does not write that table.

Commands run (worktree `/Users/julio/personal-projects/zilar-T-0723`):
- `pnpm install`: exit 0.
- Baseline `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/actions/gateway.test.ts` before any edit: 1 file passed, **46 tests passed**.
- `pnpm exec prettier --write apps/server/src/actions/gateway.test.ts`: done.
- Same test command after the edits and formatting: 1 file passed, **46 tests passed** (same count).
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/actions/gateway.test.ts`: no output (exit 1, no match).
- `pnpm gate`: exit 0. Summary lines:
  - `gate: 1 changed file(s) against main`
  - `PASS  install (frozen)  (2.0s)`
  - `PASS  format  (37.2s)`
  - `PASS  lint  (1.5s)`
  - `PASS  typecheck  (5.7s)`
  - `PASS  tests @zilar/server  (26.7s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

Problems: none. Scratch logs went to the session scratchpad outside the worktree, so `git status` shows only `apps/server/src/actions/gateway.test.ts` (and this task file).

Open question: none that blocks. I was least sure about the `SELECT *` reads for the "must not contain" checks, which copy more than the spec's "select only the columns a test reads". I kept `SELECT *` on purpose so those assertions do not weaken; the lead can say if they want column lists instead.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 6.8 min). The lead reviewed the diff directly. The reads behind the no-secret checks keep `SELECT *` on purpose, so they cover every column. There are 46 tests before and after, no drizzle import is left, and the gate passed.
