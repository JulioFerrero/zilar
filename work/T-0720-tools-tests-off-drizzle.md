---
id: T-0720
title: "tests off drizzle (tools): replace every drizzle query in tools/routes.test.ts, tools/service.test.ts, tools/adapters.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0720-tools-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0720: tools tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the tools folder.

### Verified facts (do not re-derive)
- `apps/server/src/tools/routes.test.ts` (793 lines): drizzle at lines 3, 15, 33, 42, 54, 65, 71, 75, 78, 313, 325, 372, 384, 586, 632, 698, 747.
- `apps/server/src/tools/service.test.ts` (1303 lines): drizzle at lines 3, 16, 52, 61, 73, 84, 90, 99, 102, 124, 328, 755, 759, 761, 770, 991, 1072, 1113, 1119, 1138, 1190, 1200, 1227, 1274.
- `apps/server/src/tools/adapters.test.ts` (771 lines): drizzle at lines 18, 80, 89, 101, 111, 117, 119, 122, 144, 581, 721.
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
`apps/server/src/tools/routes.test.ts`, `apps/server/src/tools/service.test.ts`, `apps/server/src/tools/adapters.test.ts`, `work/T-0720-tools-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/tools/routes.test.ts src/tools/service.test.ts src/tools/adapters.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/tools/routes.test.ts apps/server/src/tools/service.test.ts apps/server/src/tools/adapters.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Replaced every drizzle query in the three tools test files with `testSql(context)` + effect/sql, and dropped the `drizzle-orm` and `../db/schema` imports. Same rows, values, order and assertions; selects only the columns each test reads, with small local row types (`AuditRow`, `AuditSubjectRow`, `ToolVersionRow`, `ToolRunRow`).

- `apps/server/src/tools/routes.test.ts`: `seedAi`/`seedGroup` and the two private-topic inserts now use `INSERT INTO provider_connections/ais/ai_limits/groups/group_members/group_ais/topics/topic_members` (snake_case columns, `NULL` omitted for `label`); the three `audit_log` reads are `SELECT action, detail FROM audit_log`; the `ais` status flip is `UPDATE ais SET status = 'stopped' WHERE id = ...`.
- `apps/server/src/tools/service.test.ts`: same seed conversion plus `seedTopic`; version reads are `SELECT version ... WHERE tool_id`; history-immutability reads select content columns (`id, tool_id, version, source, hosts, message, created_by` / run-row content columns) instead of `select *`; `deleted_at`, run-id and audit reads (incl. `subject_id, actor_user_id, ai_id` for the created/updated test) select only what the test reads. Kept the `sqlRuntimeFor` import (still used by the two AI-removal tests) and all `context.db` args passed into module functions.
- `apps/server/src/tools/adapters.test.ts`: same seed conversion plus `seedTopic`; audit reads are `SELECT action, detail` (secrets-absence test) and `SELECT action, subject_id, detail` (revoke test, which asserts `subjectId`).

No test patched `context.db.transaction` or another drizzle method (verified with grep: no `transaction`/`vi.mock` in the tools tests), so spec item 5 needed no `sqlRuntimeFor`-mock move. All columns drizzle defaulted in JS (`label: null`) were handled in raw SQL (`label` omitted/nullable); every other omitted column has a SQL default. No assertion meaning changed.

Commands (real results):
- Before: `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/tools/routes.test.ts src/tools/service.test.ts src/tools/adapters.test.ts` → 3 files, 92 passed.
- After (same command): 3 files, 92 passed.
- Acceptance grep `git grep -n "drizzle-orm\|db/schema" -- <three files>` → prints nothing; no `context.db.insert/select/update/delete` remain.
- `pnpm gate` (from repo root):
  - `gate: 4 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- One hiccup: first gate run failed on `format` (service.test.ts long SQL lines); fixed with `prettier --write` on that file, re-ran gate → PASS. No deviations from the spec; no open questions.

## Review (written by Claude)

**2026-10-09, lead:** approved. The pre-review was clean (packet head 56ee51b7), and all 92 tools tests pass. Two nits are accepted:
- an `AuditRow` type names a column that one query does not select;
- the history-immutability checks no longer compare `created_at`, which no path touches.
