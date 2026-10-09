---
id: T-0691
title: "audit + plan (no code): the last drizzle removal (D1/D3 + tests) — a test recipe and helper to replace context.db.select/insert/update/delete in 56 test files and the test-support seeders, the test-support switch to the SqlTest client, the migrator switch, and the delete order; writes docs/audit/drizzle-removal-plan.md"
status: todo
milestone: M5
branch: task/T-0691-plan-drizzle-removal
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0691: the last drizzle removal plan

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. Once the in-flight tasks land (T-0684, T-0688), no server module uses drizzle any more. What is left:
- **tests:** 56 `*.test.ts` files import `drizzle-orm`, and `test-support.ts` builds the test db with `drizzle(client, { schema })` (`apps/server/src/test-support.ts:2,293,306`), plus its seed helpers;
- **D3, the migrator:** `apps/server/src/db/migrate.ts` (drizzle migrator, `:1-17`) and `runSqlMigrations` with the adoption seed, both ready in `apps/server/src/effect/sql.ts:152-205` and tested in `effect/sql.test.ts:90-130`;
- **D1:** `db/client.ts`, `db/schema.ts`, `effect/sql.ts`'s drizzle snapshot helper and `app.ts`'s health check (`isDatabaseUp`, `db.execute(sql\`select 1\`)`, with a test that spies on `context.db.execute` at `app.test.ts:64-70`);
- **D2:** T-0690 builds the better-auth adapter; the switch comes later.

The lead needs a plan of small tasks first. **This task writes only the plan. It changes no code.**

### Verified facts (do not re-derive)
- **Prior decisions** (`work/NOW.md`, 2026-10-07 "Lead decisions tonight"): drizzle-kit migrations stay until the last step, then one transaction per migration; better-auth gets a custom adapter over effect/sql.
- **`docs/audit/effect-sql-migration.md`:** §(b) is the migration strategy and the adoption test; §(d) is the removal order, steps 1-7.
- **Test files that import drizzle:** run `git grep -l "from 'drizzle-orm" -- 'apps/server/src/*.test.ts'`. The two largest are `agents/gateway.test.ts` (57 drizzle query sites) and `ais/routes.test.ts` (59).
- **The proven test patterns** for failure injection on effect/sql are in `docs/EFFECT_GUIDE.md` (the "Tests that fake drizzle stop working" item).

### What to build
Write `docs/audit/drizzle-removal-plan.md` with these sections:
1. **Inventory:** every non-test file and every test file that still imports drizzle, with counts of `select`, `insert`, `update`, `delete` and `execute` sites. List the `test-support.ts` exports that use drizzle (the seeders), and every place a test relies on drizzle row types (`$inferSelect`) or table objects.
2. **A test recipe:** one small helper to add to `test-support.ts` (for example `testSql(context)`, or `runSql(context, effect)`), with its exact signature, and before/after examples for a select with `where`, an insert, an update and a count. Also how to keep the row types once `db/schema.ts` is gone (a local type, or the `*Row` types the modules already export).
3. **The test-support switch:** how `createTestContext` moves to the `SqlTest` layer or a PGlite client without drizzle, and what `context.db` becomes for the modules' `ServerDatabase` parameter. Check what `ServerDatabase` is used for after the module conversions (`db/client.ts`). Say whether a thin `ServerDatabase` type can stay as the runtime key.
4. **The migrator switch (D3):** the exact steps, the adoption seed for the live database (with the SQL), the one-transaction-per-migration requirement, how to test it, and the deploy risk.
5. **An ordered task list:**
   - test conversions per folder, smallest first, each with files, tests and size;
   - the helper task first;
   - then the test-support switch, D3, the health check, and the final deletions (`db/client.ts`, `db/schema.ts`, `auth/auth-schema.ts`, `auth/cli-config.ts`, `drizzle.config.ts`, the package dependencies);
   - mark what can run in parallel, and what is a schema or live-DB risk that needs Julio.

### Read first
`AGENTS.md`, `apps/server/src/test-support.ts`, `apps/server/src/db/client.ts`, `apps/server/src/db/migrate.ts`, `apps/server/src/effect/sql.ts`, `apps/server/src/effect/sql.test.ts`, `docs/audit/effect-sql-migration.md`, one small and one large test file from the inventory.

### Allowed files
`docs/audit/drizzle-removal-plan.md`, `work/T-0691-plan-drizzle-removal.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The plan exists with all five sections, and every claim cites `file:line`.
- No code changed.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
