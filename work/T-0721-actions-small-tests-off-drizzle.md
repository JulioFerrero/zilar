---
id: T-0721
title: "tests off drizzle (actions (announce, production-announcer, demo)): replace every drizzle query in actions/announce.test.ts, actions/production-announcer.test.ts, actions/demo.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0721-actions-small-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0721: actions (announce, production-announcer, demo) tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the actions (announce, production-announcer, demo) folder.

### Verified facts (do not re-derive)
- `apps/server/src/actions/announce.test.ts` (160 lines): drizzle at lines 3.
- `apps/server/src/actions/production-announcer.test.ts` (253 lines): drizzle at lines 2, 14, 51, 57, 58, 63, 100, 110, 122, 142, 144, 186, 188, 216.
- `apps/server/src/actions/demo.test.ts` (340 lines): drizzle at lines 2, 16, 42, 52, 62, 74, 85, 91, 92, 181, 190, 204, 236, 260, 263, 313.
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
`apps/server/src/actions/announce.test.ts`, `apps/server/src/actions/production-announcer.test.ts`, `apps/server/src/actions/demo.test.ts`, `work/T-0721-actions-small-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/actions/announce.test.ts src/actions/production-announcer.test.ts src/actions/demo.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/actions/announce.test.ts apps/server/src/actions/production-announcer.test.ts apps/server/src/actions/demo.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Files changed (all in Allowed files):** `apps/server/src/actions/announce.test.ts`, `apps/server/src/actions/production-announcer.test.ts`, `apps/server/src/actions/demo.test.ts`, this task file.

**What changed**
- All drizzle seed inserts, updates, reads and `.returning()` calls in the three files now run through `testSql(context)` with `SqlClient` and snake_case SQL. The `drizzle-orm` and `../db/schema` imports are gone, and so is the `eq` import.
- `announce.test.ts`: its only drizzle use was `typeof approvals.$inferSelect`. `announce.ts` (outside scope) exports no row type, so the test declares a local `ApprovalRow` with the same shape.
- `production-announcer.test.ts`: `context.db` remains only as `db: context.db` in the two `createProductionAnnouncer` calls.
- `demo.test.ts`: `context.db` remains for `captureRecorder`, `createActionGateway`, `decideApproval`. The `auditLog` read is `SELECT * FROM audit_log` (the dump only checks for absence of strings). `user` is inserted as `"user"`.
- The `approvals` inserts that used `.returning()` now reuse the client-generated id, which is the same value.
- Local row types: `AiOwnerRow`, `ApprovalSummaryRow`, `PendingStatusRow`, `PendingResultRow`. Timestamps are passed as ISO strings. None of the touched tables has a JS-side default (`$defaultFn` or `$onUpdate` on insert), so raw inserts need no extra values.
- No test patched `context.db` to inject a failure in these files, so the seam move from the spec was not needed.

**Commands and results**
- Before any change: `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/actions/announce.test.ts src/actions/production-announcer.test.ts src/actions/demo.test.ts`: 3 files passed, 21 tests passed.
- After the change, same command: 3 files passed, 21 tests passed.
- `git grep -n "drizzle-orm\|db/schema" -- <three files>`: no output (exit 1).
- `pnpm exec prettier --write` on the three files: announce and demo unchanged, production-announcer reformatted.
- `pnpm gate` (exit 0), summary lines:
  - `gate: 3 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

**Problems and deviations**
- I set `status: in-progress` only at the end, not at the start as AGENTS.md step 2 asks. Status is `review` now.

**Open questions**
- None blocking. Whether `announce.ts` should export its approval row type is for a later task, since it is outside this scope.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 4.6 min). The lead reviewed the diff directly. The three actions tests are on `testSql`. `announce.test.ts` now declares a local `ApprovalRow` in place of `$inferSelect`; `approvals/service.ts:175` still derives its own from drizzle, and that goes in DEL. There are 21 tests before and after, and the gate passed.
