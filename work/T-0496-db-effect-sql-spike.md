---
id: T-0496
title: "Effect F3 spike: database on effect/sql + @effect/sql-pg (PGlite in tests) — the pins module end to end, a migration strategy, and a better-auth adapter plan"
status: todo
milestone: M5
branch: task/T-0496-db-effect-sql-spike
model: auto
effort: low
depends_on: [T-0490]
estimate: 1 day
---

# T-0496: database spike on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: **drizzle goes. The database moves to `effect/sql` + `@effect/sql-pg`.** He overrode plan `docs/audit/effect-everywhere-plan.md` §2.2, which recommended keeping drizzle.

The plan counts what that touches: `apps/server/src/db/schema.ts` (1,534 lines), 67 drizzle files, 62 `.transaction(` sites and 46 migrations. Before 8 workers rewrite modules, one spike must prove the pattern on a small module and settle three questions:
1. how tests get a database;
2. how migrations work from now on;
3. what happens to better-auth, which uses `drizzleAdapter`.

### Verified facts (do not re-derive)
- **DB client:** `apps/server/src/db/client.ts` runs `postgres` (postgres-js, max 10) wrapped in `drizzle(client, { schema })`. `ServerDatabase` is a union of the postgres-js and PGlite drizzle types.
- **Migrations:**
  - `apps/server/src/db/migrate.ts` runs drizzle's migrator (`drizzle-orm/postgres-js/migrator` or `pglite/migrator`) over `apps/server/drizzle/` (0000 to `0045_remarkable_dragon_lord.sql`, plus `meta/`);
  - `apps/server/drizzle.config.ts` uses drizzle-kit (dialect `postgresql`, schema `./src/db/schema.ts`);
  - `pnpm --filter @zilar/server db:generate` makes new migrations, and `db:migrate` runs `src/db/migrate-cli.ts`;
  - `index.ts:72` calls `runMigrations(db)`;
  - the drizzle migrator records applied migrations in its own journal table.
- **Tests:** `apps/server/src/test-support.ts:286-301` migrates one PGlite (`@electric-sql/pglite`) per worker, snapshots its data dir, and starts every test database from that snapshot. `createTestContext` (line 303) wraps it in drizzle.
- **better-auth:** `apps/server/src/auth/auth.ts:2,48` uses `drizzleAdapter(db, { provider: 'pg', schema })`.
- **The pilot module, `pins`:**
  - `apps/server/src/pins/service.ts` (drizzle: `and`, `count`, `desc`, `eq`, `sql`, and the `pinnedMessages` table) with a transaction and an advisory lock around line 161;
  - `apps/server/src/pins/access.ts`, `apps/server/src/pins/routes.ts`;
  - tests in `apps/server/src/pins/pins.test.ts`.
  
  The module is 903 lines in total.
- **The registry** (2026-10-07): `@effect/sql-pg` 4.0.2 and `@effect/sql-pglite` 4.0.2 (both peer `effect` ^4.0.2). The SQL docs are in `docs/effect-reference/LLMS.md`, "Working with SQL databases": the `effect/sql` modules, `Model.Class`, migrations. There is no v4 drizzle integration.

### What to build
1. **Packages:** add `@effect/sql-pg` and `@effect/sql-pglite` (4.0.2) to `apps/server`, plus `effect` ^4.0.2 if T-0494 has not landed yet. Run `pnpm install` to update `pnpm-lock.yaml`.
2. **`apps/server/src/effect/sql.ts`:**
   - an `SqlLive` layer from `DATABASE_URL`: `@effect/sql-pg` with a pool of 10, matching today;
   - an `SqlTest` layer on PGlite (`@effect/sql-pglite`) that reuses the migrated-snapshot idea from `test-support.ts`;
   - a short convention comment: queries with the `sql` tagged template or `Model`-derived repositories, transactions with `sql.withTransaction`, advisory locks as raw SQL inside the transaction.
3. **The pins pilot:** rewrite `apps/server/src/pins/service.ts` and `apps/server/src/pins/access.ts` queries on `effect/sql`, with the same SQL semantics: the same rows, the same transaction and lock, the same errors.
   - Keep the module's exported Promise functions (routes still call them), run through a small runtime built from the `SqlLive` / `SqlTest` layer.
   - During the transition, routes and tests still pass the drizzle `db` around. Show how the pins functions get their `SqlClient` (for example a module-level runtime created at app start, or a parameter) with the **smallest change to `apps/server/src/pins/routes.ts` and `apps/server/src/app.ts`**, and note it as the recipe.
   - **`apps/server/src/pins/pins.test.ts` must pass unchanged.** If it cannot, explain exactly why in the Report and stop: do not edit it.
4. **Write `docs/audit/effect-sql-migration.md`** with:
   - **(a)** the recipe, step by step, for converting a module;
   - **(b) the migration strategy.**
     - Keep `apps/server/drizzle/*.sql` as history. Run them, and every future migration, with the `effect/sql` migrator, or keep drizzle-kit's runner until drizzle is gone? Answer with evidence: how the `effect/sql` migrator tracks applied migrations, and how a live database that drizzle already migrated is adopted without re-running 0000–0045. **Test the adoption on a PGlite** migrated by drizzle.
     - How new schema changes are written once `db:generate` is gone.
   - **(c) better-auth:** which adapter replaces `drizzleAdapter` (better-auth's built-in Kysely/pg pool adapter, or another). Check that better-auth's adapter works on both pg and PGlite (tests), and list the auth tables it needs from `schema.ts`. **Do not switch it in this task.**
   - **(d)** the order for removing `drizzle-orm`, `drizzle-kit`, `schema.ts` and `ServerDatabase` at the end;
   - **(e)** an estimate per module group, using the plan §4.4 groups.

### Read first
`AGENTS.md`, `docs/audit/effect-everywhere-plan.md` §1.1, §2.2 and §4, `docs/effect-reference/LLMS.md` (SQL section), `apps/server/src/db/client.ts`, `apps/server/src/db/migrate.ts`, `apps/server/src/test-support.ts:280-340`, `apps/server/src/auth/auth.ts:1-60`, `apps/server/src/pins/` (all files).

### Allowed files
`apps/server/package.json`, `pnpm-lock.yaml`, `apps/server/src/effect/sql.ts`, `apps/server/src/effect/sql.test.ts`, `apps/server/src/pins/service.ts`, `apps/server/src/pins/access.ts`, `apps/server/src/pins/routes.ts`, `apps/server/src/app.ts`, `docs/audit/effect-sql-migration.md`, `work/T-0496-db-effect-sql-spike.md`.

**`app.ts` changes are limited to wiring pins.** If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot pins src/effect
pnpm gate
```

### Acceptance
- The pins module runs on `effect/sql`, with its existing tests passing unchanged on PGlite.
- `docs/audit/effect-sql-migration.md` answers the recipe, migrations (with a tested adoption of a drizzle-migrated database), better-auth, removal order and estimates.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
