---
id: T-0722
title: "tests off drizzle (actions/flow.e2e): replace every drizzle query in actions/flow.e2e.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0722-actions-flow-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0722: actions/flow.e2e tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the actions/flow.e2e folder.

### Verified facts (do not re-derive)
- `apps/server/src/actions/flow.e2e.test.ts` (1460 lines): drizzle at lines 2, 17, 26, 150, 160, 172, 243, 253, 344, 392, 459, 472, 494, 496, 524, 526, 537, 574, 659, 665, 669, 673, 745, 755, 826, 832, 836, 839, 867, 886, 982, 988, 989, 991, 1133, 1156, 1246, 1262, 1328, 1340, 1387, 1447.
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
`apps/server/src/actions/flow.e2e.test.ts`, `work/T-0722-actions-flow-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/actions/flow.e2e.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/actions/flow.e2e.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Replaced every drizzle query in `apps/server/src/actions/flow.e2e.test.ts`
with `testSql(context)(Effect.gen(...))` + `SqlClient`, following the
`pins.test.ts` pattern. Removed the `drizzle-orm` (`eq`) import and both
`../db/schema` imports. Added small local row types (`PendingActionRow`,
`AuditLeakRow`, `ApprovalCardRow`, `ApprovalTopicRow`, `AiOwnerRow`,
`ToolApprovalRow`); selects fetch only the columns each test reads.
Seeds use snake_case columns and plain SQL (`INSERT INTO
provider_connections/ais/ai_limits/groups/group_members/group_ais/topics/topic_ais`,
`UPDATE approvals SET expires_at`, `UPDATE pending_actions SET args_hash`,
`UPDATE ais SET status`). `context.db` is now passed only to module
functions (`createActionGateway`, `createApp`, `saveToolVersion`,
`approveToolHosts`, `listRoutinesForAi`, `getTool`). No test patched
`context.db.transaction`, so spec item 5 did not apply. No assertion meaning
changed (timestamps bound as `Date`, numerics seeded as `'1.00'`/`'20.00'`
strings, no jsonb columns touched). Prettier reformatted the file after the
first gate run (format FAIL -> fixed with `prettier --write` on this file
only).

Files changed: `apps/server/src/actions/flow.e2e.test.ts`,
`work/T-0722-actions-flow-tests-off-drizzle.md`.

Commands (real results):
- `pnpm install`: done in 25.8s.
- Baseline before change: `pnpm --filter @zilar/server test
  --maxWorkers=2 --reporter=dot src/actions/flow.e2e.test.ts` -> 1 file,
  20 passed.
- After change, same command -> 1 file, 20 passed.
- `git grep -n "drizzle-orm\|db/schema" --
  apps/server/src/actions/flow.e2e.test.ts` prints nothing (exit 1, no
  matches).
- `pnpm gate` summary:
  - gate: 2 changed file(s) against main
  - PASS install (frozen) (1.8s)
  - PASS format (30.4s)
  - PASS lint (1.7s)
  - PASS typecheck (6.3s)
  - PASS tests @zilar/server (22.0s)
  - scope: every changed file is inside the Allowed files
  - GATE PASS

No deviations, no open questions.

## Review (written by Claude)

**2026-10-09, lead:** approved. The pre-review was clean (packet head 9d813d13). `actions/flow.e2e.test.ts` is on `testSql`.
