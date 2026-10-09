---
id: T-0701
title: "tests off drizzle (auth): replace every drizzle query in auth/invites.test.ts, auth/auth.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0701-auth-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0701: auth tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the auth folder.

### Verified facts (do not re-derive)
- `apps/server/src/auth/invites.test.ts` (111 lines): drizzle at lines 2, 6.
- `apps/server/src/auth/auth.test.ts` (738 lines): drizzle at lines 3, 133, 134, 154, 172, 190, 211, 247, 369, 387, 475, 608, 621.
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
`apps/server/src/auth/invites.test.ts`, `apps/server/src/auth/auth.test.ts`, `work/T-0701-auth-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/invites.test.ts src/auth/auth.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/auth/invites.test.ts apps/server/src/auth/auth.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/auth/auth.test.ts`: removed the `../db/schema` import and every
  drizzle read. The 12 `context.db.select().from(...)` reads plus the
  `failing.db.select().from(xmppAccounts)` read now run through
  `testSql(context)`/`testSql(failing)` with `effect/sql`; added `Effect` and
  `SqlClient` imports, `testSql` to the `test-support` import, and three small
  local row types (`IdRow`, `VerificationRow`, `XmppAccountRow`). Selects name the
  snake_case columns (`"user"`, `session`, `invites`, `verification`,
  `xmpp_accounts`) and read only the columns each assertion uses
  (`SELECT id ...`, `SELECT user_id, localpart, provisioned ...`), except the
  OTP test which keeps `SELECT *` so its `JSON.stringify(rows)` assertion still
  sees the whole stored row. `db: context.db` and all module calls
  (`createInvite(context.db, ...)`, `findInviteByCode`, `revokeInvite`,
  `consumeInvite`) are left as they were.
- `apps/server/src/auth/invites.test.ts`: dropped the `PGlite` + `drizzle` +
  `runMigrations` + `registerSqlRuntime`/`disposeSqlRuntime` setup (drizzle at
  old lines 2, 6, 26) for `createTestContext()` / `context.close()` as
  `docs/audit/drizzle-removal-plan.md` §2.2 prescribes for the files that built
  their own database. The one seed insert (`schema.user`) became an
  `INSERT INTO "user" (id, name, email)` through `testSql(context)`. All module
  calls now take `context.db`. Values are unchanged (that `user` insert leaves
  out `email_verified`, `created_at` and `updated_at`, which have SQL defaults).

No assertion was changed in meaning or number. `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/auth/invites.test.ts apps/server/src/auth/auth.test.ts` prints nothing (exit 1).

### Commands and results
- `pnpm install`: done, 1176 packages, no errors.
- Before: `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/invites.test.ts src/auth/auth.test.ts` -> `Test Files 2 passed (2)`, `Tests 43 passed (43)`.
- After (same command): `Test Files 2 passed (2)`, `Tests 43 passed (43)`.
- `pnpm gate` (repo root):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.9s)
  PASS  format  (52.0s)
  PASS  lint  (1.3s)
  PASS  typecheck  (5.5s)
  PASS  tests @zilar/server  (17.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Files changed
- `apps/server/src/auth/auth.test.ts`
- `apps/server/src/auth/invites.test.ts`
- `work/T-0701-auth-tests-off-drizzle.md` (front matter + this Report)

### Deviations / notes
- `invites.test.ts` switched its `beforeEach` to `createTestContext()` rather
  than keeping a bare `PGlite`, because `registerPgliteSqlRuntime` from the plan
  does not exist in this tree; §2.2 lists that switch as the alternative for
  exactly these files.
- No open questions, nothing blocked.

## Review (written by Claude)

**2026-10-09, lead:** approved. The pre-review was clean (packet head 365e31cc). There are 43 tests before and after. `invites.test.ts` now uses `createTestContext()` in place of its own drizzle PGlite, which drops 5 drizzle imports and uses the migrated snapshot.
