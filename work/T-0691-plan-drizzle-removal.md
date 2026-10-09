---
id: T-0691
title: "audit + plan (no code): the last drizzle removal (D1/D3 + tests) — a test recipe and helper to replace context.db.select/insert/update/delete in 56 test files and the test-support seeders, the test-support switch to the SqlTest client, the migrator switch, and the delete order; writes docs/audit/drizzle-removal-plan.md"
status: merged
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

### What I did
Wrote `docs/audit/drizzle-removal-plan.md` (no code changed) with the five
required sections, every claim citing `file:line`:

1. **Inventory** — all 56 test files that import `drizzle-orm` with per-file
   query sites/lines/tests and per-method totals (754 sites: 326 select, 377
   insert, 36 update, 12 delete, 3 execute); the 10 non-test files that import
   `drizzle-orm` plus the 4 callers that use drizzle-derived types; the
   `test-support.ts` seeders; and every `$inferSelect`/table-object reliance.
2. **Test recipe** — `testSql(context)` (exact signature) and
   `registerPgliteSqlRuntime` in `effect/sql.ts`, with before/after for a select
   with `where`, an insert, an update and a count, plus how to keep row types
   once `db/schema.ts` is gone.
3. **Test-support switch** — `createTestContext` builds a raw PGlite +
   `registerPgliteSqlRuntime`; `context.db` stays as the runtime key; a thin
   `ServerDatabase = object` alias can remain (96 files / 532 occurrences).
4. **Migrator switch (D3)** — steps, the adoption seed SQL, the
   one-transaction-per-migration point (effect wraps all pending in one;
   `Migrator.js:146`), how to test, and the live-DB deploy risk.
5. **Ordered task list** — `H1` helper first, then 33 per-folder test-conversion
   tasks smallest-first, then `S1` (test-support), `D3` (migrator), `H2`
   (health check) and `DEL` (deletions), with parallel/Julio notes.

### Files changed
- `docs/audit/drizzle-removal-plan.md` (new, Allowed).
- `work/T-0691-plan-drizzle-removal.md` (status + this Report, Allowed).

No other file was touched.

### Commands run (real results)
- `pnpm install --prefer-offline` — "Done in 18.8s"; one pre-existing peer
  warning (`apps/mobile` `@types/react-dom` 19.3.0 wants `@types/react`
  ^19.3.0, found 19.2.18), unrelated to this task.
- Measurement greps (`git grep -l "from 'drizzle-orm" -- 'apps/server/src/*.test.ts'`
  → 56; a `comm` of that list with the `db/schema` importers → 13 more; the
  `context.db.<m>(` counts reproduced the spec's 57 and 59 exactly).
- `pnpm gate` from the repo root — summary:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (15.3s)
  PASS  lint  (1.4s)
  PASS  typecheck  (1.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The gate ran no package tests because the diff is docs-only; I ran no test
  files directly (there is no code change to test).

### Problems / deviations from the spec
- The spec says "56 `*.test.ts` files import `drizzle-orm`". That is correct,
  but **13 more** test files import table objects from `db/schema` (and call
  `context.db.*`) without importing `drizzle-orm`
  (`actions/announce.test.ts`, `agents/listener/score.test.ts`,
  `auth/auth.test.ts`, `avatars/routes.test.ts`, `chat-folders/*.test.ts`,
  `connections/routes.test.ts`, `files/routes.test.ts`, `push/rooms.test.ts`,
  `push/service.test.ts`, `stickers/routes.test.ts`, `tools/adapters.test.ts`,
  `xmpp/provisioning.test.ts`, `xmpp/routes.test.ts`). They are in the plan
  (§1.2) because `db/schema.ts` cannot be deleted until they move.
- The task's D1/D3 labels differ from `docs/audit/effect-last-mile.md` §2 (there
  D1 = client/schema/harness). The plan says so and uses the task's labels.

### Open questions
- The better-auth adapter (`D2` / T-0690) is still undecided (open question 1 in
  `docs/audit/effect-sql-migration.md:269`); it blocks deleting
  `auth/auth-schema.ts` and `auth/cli-config.ts` and the full drizzle-free
  `createTestContext` (the plan gives the transitional split).
- The "one transaction per migration" implementation (call the migrator once per
  pending id in a loop vs accept the single transaction) is the one behaviour
  change; the plan recommends the per-id loop and a rollback test.

## Review (written by Claude)

**2026-10-09, lead:** approved. The pre-review was clean (packet head 15790ffd).
- **Lead notes:**
  - H2 was already done by T-0693;
  - H1 lands as just the `testSql` helper, and `registerPgliteSqlRuntime` plus the `ServerDatabase` change move to S1;
  - D3 and DEL wait for Julio (live DB and schema), as the plan says.
