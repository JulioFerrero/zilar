---
id: T-0716
title: "tests off drizzle (setup): replace every drizzle query in setup/routes.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0716-setup-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0716: setup tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the setup folder.

### Verified facts (do not re-derive)
- `apps/server/src/setup/routes.test.ts` (384 lines): drizzle at lines 6, 10, 116, 164, 226, 278, 314, 336, 364, 371, 378.
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
`apps/server/src/setup/routes.test.ts`, `work/T-0716-setup-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/setup/routes.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/setup/routes.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Replaced every drizzle query in `apps/server/src/setup/routes.test.ts` with
`testSql(context)(Effect.gen(function* () { const sql = yield* SqlClient.SqlClient; ... }))`,
keeping the same rows, values, order and assertions.

1. Dropped the `drizzle-orm` import (`count`, `eq`) and the `../db/schema` import
   (`auditLog`, `instanceSettings`, `invites`, `user`); added `Effect`,
   `SqlClient` and `testSql`.
2. Three `context.db.insert(user)` seeds → `INSERT INTO "user" (id, name, email,
   email_verified) VALUES (...)`, keeping `emailVerified` true.
3. `select().from(instanceSettings)` → `SELECT key, value FROM instance_settings`
   with a local `InstanceSettingRow`.
4. `select().from(invites)` (empty-row check) → `SELECT id FROM invites`.
5. `select().from(auditLog).where(eq(auditLog.action, 'setup.completed'))` →
   `SELECT * FROM audit_log WHERE action = ${...}`, with a local `AuditRow`. The
   `SELECT *` keeps the existing "no audit column holds the key" `JSON.stringify`
   assertion meaningful.
6. `select().from(invites).where(eq(invites.code, inviteCode))` →
   `SELECT created_by, max_uses, uses FROM invites WHERE code = ${...}`, with a
   local `InviteRow`.
7. The dynamic `import('../db/schema')` + `count()` query →
   `SELECT count(*)::int AS total FROM invites`.

Left alone, per spec: the `db: context.db` arguments to `createApp` /
`createAuditRecorder` and the `getMailSettings(context.db, ...)` /
`needsSetup(context.db)` calls (module boundaries, not drizzle queries).

### Files changed

- `apps/server/src/setup/routes.test.ts`
- `work/T-0716-setup-tests-off-drizzle.md` (status + this Report)

### Commands and real results

- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/setup/routes.test.ts`
  → no output (acceptance met).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/setup/routes.test.ts`
  → 1 file passed, **16 tests passed**.
- `pnpm gate` (repo root) summary:
```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (41.8s)
PASS  lint  (1.2s)
PASS  typecheck  (5.1s)
PASS  tests @zilar/server  (14.2s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Tests before / after

- Before: 16 test cases in `routes.test.ts` at `HEAD` (counted with
  `git show HEAD:apps/server/src/setup/routes.test.ts | grep -c "  it("`; the
  baseline is green on `main`). I did not re-run the pre-change file.
- After: **16 passed** (`vitest run ... src/setup/routes.test.ts`).
- No test count change.

### Deviations / problems

None. No dependencies added, no check disabled, no secrets read or written.

### Blocked / needs a decision

None.

## Review (written by Claude)

**2026-10-09, lead:** approved. The pre-review was clean (packet head 5129c74c). The setup tests are on `testSql`, and the `sqlRuntimeFor` failure seam from T-0675 is unchanged.
