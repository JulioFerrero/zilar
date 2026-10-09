---
id: T-0706
title: "tests off drizzle (audit): replace every drizzle query in audit/routes.test.ts, audit/service.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0706-audit-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0706: audit tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the audit folder.

### Verified facts (do not re-derive)
- `apps/server/src/audit/routes.test.ts` (326 lines): drizzle at lines 2, 12, 42, 50, 62, 192, 198, 199, 200, 323.
- `apps/server/src/audit/service.test.ts` (438 lines): drizzle at lines 2, 4, 40, 48, 60, 71, 82, 124, 196, 202, 207, 216, 248, 378.
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
`apps/server/src/audit/routes.test.ts`, `apps/server/src/audit/service.test.ts`, `work/T-0706-audit-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/audit/routes.test.ts src/audit/service.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/audit/routes.test.ts apps/server/src/audit/service.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Done.** Every drizzle query in the two audit test files now runs through `testSql(context)` with `effect/sql`. The `drizzle-orm` and `../db/schema` imports are gone. `context.db` is still passed to module functions (`recordAudit`, `listAuditForAi`, `createAuditRecorder`, `createAuditApi` callers) and was left alone.

**Files changed** (both in Allowed files, plus this task file):
- `apps/server/src/audit/routes.test.ts`: seed inserts for `provider_connections`, `ais`, `ai_limits`, `groups`, `group_members` as raw SQL in `testSql`; the final `audit_log` read is a `SELECT action ... WHERE subject_id = ...`.
- `apps/server/src/audit/service.test.ts`: the same seeds in `seedAi` and `seedGroup`; the group role update in `beforeEach`; the three trigger-refusal tests (UPDATE, DELETE, TRUNCATE) now run raw SQL and use `rejects.toThrow()`; the `audit_log` reads are narrow typed selects (`id, at, action, actor_user_id, subject_id, result` in the first read, `id` and `subject_id` in the others). Added a local `AuditRow` interface.
- `work/T-0706-audit-tests-off-drizzle.md`: status and this Report.

**Column check.** Every column name written was checked against `apps/server/src/db/schema.ts`. No table used here has a JS-side default (`$defaultFn` appears only on `chatFolders`), so the raw inserts give only the columns the tests already set.

**Test counts** (`pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/audit/routes.test.ts src/audit/service.test.ts`):
- Before: 2 files passed, 32 tests passed.
- After: 2 files passed, 32 tests passed.

**Acceptance.**
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/audit/routes.test.ts apps/server/src/audit/service.test.ts` prints nothing (exit 1).
- Prettier was run on both files before the gate (`routes.test.ts` reformatted, `service.test.ts` unchanged).

**`pnpm gate`** (run from the worktree root, output in the scratchpad log):
```
PASS  install (frozen)  (2.1s)
PASS  format  (35.1s)
PASS  lint  (1.5s)
PASS  typecheck  (5.6s)
PASS  tests @zilar/server  (18.5s)
scope: every changed file is inside the Allowed files
GATE PASS
```
The gate ran past the 120 s foreground limit and the harness moved it to the background; it completed with exit 0. I did not start any background job myself.

**Blocked / needs a decision:** none.

**Open question:** none. The timestamp assertion (`row.at` toEqual `now`) passes unchanged because PGlite returns `timestamptz` as a `Date`, the same type drizzle returned, so no read adaptation was needed.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 6.2 min). The lead reviewed the diff directly. The AI-chain and group seeds and the audit reads are on `testSql`. There are 32 tests before and after, no drizzle import is left, and the gate passed.
