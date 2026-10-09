---
id: T-0713
title: "tests off drizzle (machines): replace every drizzle query in machines/hub.effect.test.ts, machines/hub.test.ts, machines/registry.test.ts, machines/routes.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0713-machines-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0713: machines tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the machines folder.

### Verified facts (do not re-derive)
- `apps/server/src/machines/hub.effect.test.ts` (249 lines): drizzle at lines 2, 7, 149.
- `apps/server/src/machines/hub.test.ts` (703 lines): drizzle at lines 1, 13, 203, 465.
- `apps/server/src/machines/registry.test.ts` (113 lines): drizzle at lines 2, 5, 70.
- `apps/server/src/machines/routes.test.ts` (1143 lines): drizzle at lines 3, 4, 8, 9, 222, 665, 983, 1025, 1038, 1047, 1067, 1099, 1100, 1108, 1116, 1125, 1139, 1140.
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
`apps/server/src/machines/hub.effect.test.ts`, `apps/server/src/machines/hub.test.ts`, `apps/server/src/machines/registry.test.ts`, `apps/server/src/machines/routes.test.ts`, `work/T-0713-machines-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/machines/hub.effect.test.ts src/machines/hub.test.ts src/machines/registry.test.ts src/machines/routes.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/machines/hub.effect.test.ts apps/server/src/machines/hub.test.ts apps/server/src/machines/registry.test.ts apps/server/src/machines/routes.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did**

Every drizzle query in the four machines test files is now `testSql(context)(Effect.gen(...))` with raw SQL and bound parameters; the `drizzle-orm` and `../db/schema` imports are gone. `context.db` passed to module functions (`createApp`, `createDbMachineRegistry`, `createMachinesApi`, `revokeMachine`, `createAuditRecorder`) is untouched, as the spec requires.

- `hub.effect.test.ts`: `insertApprovedMachine` now takes `Pick<TestContext, 'db'>` and inserts the `"user"` row and the `machines` row through `testSql`. The revoke `UPDATE machines SET status='revoked', revoked_at=…` uses `testSql`. Removed the `drizzle-orm`, `../db/schema` (machines) and `../auth/auth-schema` (user) imports.
- `hub.test.ts`: same `insertMachine` helper conversion (call sites now pass `context`/`own`); the revoke `UPDATE` and the `last_seen_at` poll `SELECT` use `testSql`. Removed `drizzle-orm`, `../db/schema` and the now-unused `ServerDatabase` import.
- `registry.test.ts`: same `insertMachine` conversion; the `touchLastSeen` read is `SELECT last_seen_at, status FROM machines WHERE id = …`. `expect(row?.lastSeenAt).toEqual(at)` is unchanged — effect/sql + PGlite returns a `Date`, so the assertion still holds.
- `routes.test.ts`: converted the pairing-code `SELECT`, the expired-code `UPDATE`, both `audit_log` selects, two `provider_connections` inserts, the two- and one-row `machines` inserts, the two- and one-row `ais` inserts, the `ais.machine_id` selects and the `DELETE FROM machines`. Local row types: `CodeHashRow`, `AuditRow`, `AiMachineRow`. Removed `@electric-sql/pglite`, `drizzle-orm/pglite`, `drizzle-orm`, `../db/schema` (both the `* as schema` and the table imports).

`capabilities`/jsonb values are bound as `${JSON.stringify(value)}::jsonb`; counts/keys are snake_case in SQL and camelCase in the local row types.

**Deviation (one, inside an Allowed file)**

- `routes.test.ts` > "keeps answering when the recorder swallows a DB failure": the old code built a throwaway `new PGlite()` + `drizzle(client,{schema})`, closed it, and handed it to `createAuditRecorder`. Both helpers had to lose their `db/schema`/drizzle imports, so the broken handle is now a second `createTestContext()` whose `client` is closed before use. The recorder still fails every write (the registered runtime runs against a closed PGlite) and swallows it; the assertion (`audit_log` in the real `context` stays empty) is unchanged, as is the test name and intent.

**Commands and results**

- `pnpm install`: exit 0.
- `git grep -n "drizzle-orm\|db/schema" -- <the four files>`: no output (exit 1). Acceptance line is clean.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/machines/hub.effect.test.ts src/machines/hub.test.ts src/machines/registry.test.ts src/machines/routes.test.ts`: 4 files passed, 53 tests passed.
- Test counts before/after (structural `it(` count, unchanged by this task): hub.effect 3, hub 19, registry 5, routes 26 = 53 before; 53 after.
- First `pnpm gate` failed on `format` for `hub.test.ts` and `registry.test.ts` (style only); fixed with `pnpm exec prettier --write` on just those two files. Re-ran the four files (53 passed) and `pnpm gate` — below.

**Gate summary lines**

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (17.3s)
PASS  lint  (1.4s)
PASS  typecheck  (3.8s)
PASS  tests @zilar/server  (18.3s)
scope: every changed file is inside the Allowed files
GATE PASS
```

**Single tests run:** only the four files named in the task's Checks (twice: after the conversion and after the prettier fix). No other tests run by me.

**Open questions:** none.

## Review (written by Claude)

**2026-10-09, lead:** approved. The pre-review was clean (packet head 3690ed76), with 53 tests passing. Its 2 cosmetic nits are left as they are: the second context in the DB-failure test is closed by its client, and one comment is worded a little stale.
