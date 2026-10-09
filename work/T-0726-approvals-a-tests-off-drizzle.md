---
id: T-0726
title: "tests off drizzle (approvals (sweeper.effect, sweeper, service)): replace every drizzle query in approvals/sweeper.effect.test.ts, approvals/sweeper.test.ts, approvals/service.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0726-approvals-a-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0726: approvals (sweeper.effect, sweeper, service) tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the approvals (sweeper.effect, sweeper, service) folder.

### Verified facts (do not re-derive)
- `apps/server/src/approvals/sweeper.effect.test.ts` (156 lines): drizzle at lines 3, 4, 22, 28, 36, 48, 69, 119, 149, 154.
- `apps/server/src/approvals/sweeper.test.ts` (422 lines): drizzle at lines 3, 4, 33, 43, 51, 63, 89, 137, 159, 162, 189, 212, 240, 263, 287, 313, 322, 347, 391, 413, 418.
- `apps/server/src/approvals/service.test.ts` (1350 lines): drizzle at lines 3, 15, 55, 69, 79, 91, 102, 108, 116, 119, 552, 680, 701, 858, 944, 949, 980, 984, 1039, 1160, 1163.
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
`apps/server/src/approvals/sweeper.effect.test.ts`, `apps/server/src/approvals/sweeper.test.ts`, `apps/server/src/approvals/service.test.ts`, `work/T-0726-approvals-a-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals/sweeper.effect.test.ts src/approvals/sweeper.test.ts src/approvals/service.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/approvals/sweeper.effect.test.ts apps/server/src/approvals/sweeper.test.ts apps/server/src/approvals/service.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Did it. All three approvals test files now seed and assert through `testSql(context)` + effect/sql; no `drizzle-orm` or `db/schema` imports remain.

What changed:
- `apps/server/src/approvals/sweeper.effect.test.ts`: `seedUser`/`seedAi` use `INSERT INTO "user" / provider_connections / ais / ai_limits` with `sql.insert({...snake_case...})`; expiry rollback is `UPDATE approvals SET expires_at = ...`; the audit recorder writes via a `recordAuditRow` helper (explicit column list, `detail` as `NULL`/`...::jsonb` fragment like `audit/service.ts:199-200`, `cost_amount` via the same `toFixed(2)` expression); length assertions use `SELECT count(*)::int AS total`.
- `apps/server/src/approvals/sweeper.test.ts`: same helpers, plus `listAuditRows` (`SELECT action, actor_user_id, ai_id, group_id, subject_id, args_hash, result, detail`) and `approvalStatus` (`SELECT status, note ... WHERE id`). All six `audit.record` overrides route through `recordAuditRow`.
- `apps/server/src/approvals/service.test.ts`: `seedUser`/`seedAi`/`seedGroup` converted (multi-row `group_members` via `sql.insert([...])`, one effect per seed function, same values); reads via `approvalStatus` (`SELECT status`), `storedApproval` (full column list for `toPublicApproval` + `decidedAt` checks, with a local `StoredApprovalRow` type and `asPublicRow` date normalizer since the driver may return ISO strings), and `approvalRuleCount` (`count(*)::int`). The `canDecide` sanity test that only existed to use the `and` import was rewritten to assert the stored row left `pending` (`approved_once`) instead — same agreement check, no drizzle.
- Lines passing `context.db` to module functions (`createApproval`, `decideApproval`, etc.) untouched. Omitted insert columns all have SQL defaults (`email_verified`, `created_at/updated_at`, `status` where not set explicitly — `ais.status` is passed explicitly as `'active'`); `"user"` is quoted everywhere.
- No `vi.mock`/failure-injection tests existed in these files (spec item 5 not applicable).

Commands (real results):
- `pnpm install`: done (19.4s).
- `git grep -n "drizzle-orm\|db/schema" -- <three files>`: prints nothing (exit 1, no matches).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals/sweeper.effect.test.ts src/approvals/sweeper.test.ts src/approvals/service.test.ts`: 3 files, 53 passed (after `prettier --write` + readonly-array fix; re-ran, still 53 passed).
- Test counts before/after: before = 53 (`it('` count on HEAD: 1 + 6 + 46), after = 53 passed. Same tests, same assertions (one test renamed, none added/removed).
- `pnpm gate`: GATE PASS — `PASS install, format, lint, typecheck, tests @zilar/server`, `scope: every changed file is inside the Allowed files`.
- Fixes along the way: `prettier --write` on the three test files (gate format FAIL), and `listAuditRows` return type `Promise<readonly AuditRow[]>` (effect/sql returns readonly arrays; gate typecheck FAIL).

Security checklist: no secrets touched; test-only changes, no routes/permissions/caps/audit-shape changes; no production code touched.

## Review (written by Claude)

**2026-10-09, lead:** approved. The pre-review was clean (packet head 84bf6e17). Its one nit is accepted: a vacuous `expect(and(...)).toBeDefined()`, kept only to use an import, became a real status check, and the worker disclosed it.
