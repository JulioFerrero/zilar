---
id: T-0705
title: "tests off drizzle (backgrounds + agents/delegation): replace every drizzle query in backgrounds/routes.test.ts, agents/delegation/service.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0705-backgrounds-delegation-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0705: backgrounds + agents/delegation tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the backgrounds + agents/delegation folder.

### Verified facts (do not re-derive)
- `apps/server/src/backgrounds/routes.test.ts` (406 lines): drizzle at lines 5, 8, 162, 185, 199, 205, 215, 226, 249, 264, 269, 277, 285, 294, 306, 313, 322, 330, 342, 349, 384.
- `apps/server/src/agents/delegation/service.test.ts` (458 lines): drizzle at lines 2, 14, 32, 51, 60, 79, 85, 96, 117, 126, 312, 340.
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
`apps/server/src/backgrounds/routes.test.ts`, `apps/server/src/agents/delegation/service.test.ts`, `work/T-0705-backgrounds-delegation-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/backgrounds/routes.test.ts src/agents/delegation/service.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/backgrounds/routes.test.ts apps/server/src/agents/delegation/service.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did**
- `apps/server/src/backgrounds/routes.test.ts`: every drizzle seed insert, read and count now goes through `testSql(context)(Effect.gen(...))` with snake_case SQL and bound values. The `drizzle-orm` and `../db/schema` imports are gone. `createTestContext`, `bootstrapUser`, `contactOf` and `createApp({ db: context.db })` are unchanged. Added small local row types (`IdRow`, `StorageRow`, `MutedPrefRow`, `ArchivedPrefRow`, `ChatJidRow`, `UserIdRow`, `GroupBackgroundRow`). Timestamps are bound as ISO strings.
- `apps/server/src/agents/delegation/service.test.ts`: same conversion for the user, provider_connections, ais, groups, group_members, topics, group_ais, topic_ais and ai_delegations statements. Added `DelegationRow` and `BudgetRow`. The `createDelegation`, `checkDelegation`, `finishDelegation`, `cancelDelegation` and `getDelegationForAi` calls and all assertions are unchanged.
- No JS-side defaults apply: the only `$defaultFn` in `db/schema.ts` is on `chatFolders` (line 793), which these tests do not touch. The `user` table's `$onUpdate` is never reached because these tests only insert.
- I did not change any assertion or any test.

**Commands and results**
- Before the change, `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/backgrounds/routes.test.ts src/agents/delegation/service.test.ts`: 2 files passed, **33 tests passed**.
- After the change, same command: 2 files passed, **33 tests passed**.
- `git grep -n "drizzle-orm\|db/schema" -- <both files>`: no output (exit 1).
- `grep` for `db.select|db.insert|db.update|db.delete|schema.|import(` in both files: no output.
- `pnpm exec prettier --write` on both files: unchanged.
- `pnpm gate` (run from the worktree root, exit 0):
  ```
  PASS  install (frozen)  (3.6s)
  PASS  format  (74.0s)
  PASS  lint  (1.8s)
  PASS  typecheck  (6.5s)
  PASS  tests @zilar/server  (21.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The gate reported 3 changed files: the two test files and this task file.

**Problems and deviations**
- None. No test needed a change of meaning, so nothing is blocked.

**Open questions**
- `muted_until` is read into `Date | null`. The test only checks `not.toBeNull()`, so the exact runtime type is not asserted. I did not verify it.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 9.9 min). The lead reviewed the diff directly. The seeds (user, AI chain, group, topics, group and topic AIs, backgrounds with fixed `created_at`) are raw inserts on `testSql` with explicit ids. There are 33 tests before and after, no drizzle import is left, and the gate passed.
