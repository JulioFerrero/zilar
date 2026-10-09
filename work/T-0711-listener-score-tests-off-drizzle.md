---
id: T-0711
title: "tests off drizzle (agents/listener): replace every drizzle query in agents/listener/score.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0711-listener-score-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0711: agents/listener tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the agents/listener folder.

### Verified facts (do not re-derive)
- `apps/server/src/agents/listener/score.test.ts` (341 lines): drizzle at lines 12, 28, 41, 50, 67, 73, 79, 122, 142, 143.
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
`apps/server/src/agents/listener/score.test.ts`, `work/T-0711-listener-score-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/listener/score.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/agents/listener/score.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did.** In `apps/server/src/agents/listener/score.test.ts` every drizzle seed insert is now a raw `INSERT` run through `testSql(context)` with `Effect` and `SqlClient` (same pattern as `apps/server/src/audit/service.test.ts`). Covered: `user`, `provider_connections`, `ais`, `groups`, `group_members`, `topics`, `group_ais` (two places), `topic_ais`. The `drizzle-orm` and `../../db/schema` imports are removed. The file had only inserts, no reads, so no row types were needed. Both `loadRoster(context.db, ...)` calls are left as they were. The `TEST_XMPP_DOMAIN` value is still used for the AI jid. Insert order is unchanged (connection before AI, group before member, group before the AI links). Columns were checked against `apps/server/src/db/schema.ts` (`pgTable` names and columns) and `apps/server/src/auth/auth-schema.ts` (`user`). Drizzle `$defaultFn` appears only on one table in `schema.ts`, which is not one of these tables, so no JS-filled values were needed. Values match the old drizzle calls: `label` is null, `visibility`, `kind`, `status`, `is_general` and `role` are set explicitly, and the others use SQL defaults. Prettier was run on the file.

**Files changed.** `apps/server/src/agents/listener/score.test.ts`, `work/T-0711-listener-score-tests-off-drizzle.md` (this Report and status).

**Commands and results.**
- `pnpm install`: done, no errors.
- Before the change, `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/listener/score.test.ts`: 1 file passed, 14 tests passed.
- After the change, the same command: 1 file passed, 14 tests passed.
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/agents/listener/score.test.ts`: no output (exit 1), as the acceptance check requires.
- `pnpm gate` (from `/Users/julio/personal-projects/zilar-T-0711`), summary lines: `gate: 2 changed file(s) against main`, `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/server`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.

**Problems.** None. No test needed a change to what it checks.

**Open questions.** None.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 2.8 min). The lead reviewed the diff directly. The user, AI-chain and group seeds are raw inserts on `testSql`. There are 14 tests before and after, no drizzle import is left, and the gate passed.
