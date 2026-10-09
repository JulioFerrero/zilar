---
id: T-0741
title: "D3: migrations on effect/sql — a migrateSql Effect (drizzle-journal adoption seed + one transaction per migration) replaces drizzle's migrator; runMigrations(db) runs it on the registered runtime; every caller registers the runtime first; the test snapshots migrate a raw PGlite through it; 5 migrator tests"
status: todo
milestone: M5
branch: task/T-0741-migrator-switch
model: auto
effort: default
depends_on: [T-0743]
estimate: 0.5 day
---

# T-0741: the migrator on effect/sql (D3)

## Spec (written by Claude, do not edit)

### Why
D3 of `docs/audit/drizzle-removal-plan.md` §4 (lines 444-509). Julio approved it on 2026-10-09. After this task, drizzle no longer applies migrations anywhere. **The live database is migrated by the next deploy.** The lead rehearses that on a copy of live before deploying, and that rehearsal is not part of this task.

### Verified facts (do not re-derive)
- **`apps/server/src/db/migrate.ts:1-19`:** `runMigrations(db)` calls drizzle's `migratePglite` or `migratePostgres` with `migrationsFolder` (line 6, the `apps/server/drizzle` folder: 46 `NNNN_*.sql` files).
- **The callers of `runMigrations`:**
  - `apps/server/src/index.ts:77`. Here the runtime is already registered at line 76 (T-0743).
  - `apps/server/src/auth/invite-cli.ts:75`. Here the runtime is registered only **after** the call, at line 78.
  - `apps/server/src/db/migrate-cli.ts:12`. This script never registers a runtime.
  - `apps/server/src/test-support.ts:295` and `apps/server/src/effect/sql.ts:127` (`snapshotOfMigratedDatabase`, both migrate `drizzle(new PGlite(), { schema })`).
  - `apps/server/src/db/migrate.test.ts`, which seeds through drizzle.
- **`sqlFileLoader(directory)`** (`effect/sql.ts:156-191`) maps `NNNN_name.sql` to migration id `NNNN + 1` (line 169), and runs each statement between `--> statement-breakpoint` markers. Neither `sqlFileLoader` nor `runSqlMigrations` (`effect/sql.ts:197-205`) is called anywhere outside the tests today.
- **`runSqlMigrations`** is the core `Migrator.make`, with the journal table `effect_sql_migrations` (`SQL_MIGRATIONS_TABLE`, line 30). It runs **all** pending migrations in one transaction (`node_modules/.pnpm/effect@4.0.2/node_modules/effect/dist/sql/Migrator.js:146`).
- **The adoption seed** (plan §4, lines 467-476), idempotent:
  ```sql
  CREATE TABLE IF NOT EXISTS effect_sql_migrations (migration_id integer primary key, created_at timestamp with time zone not null default now(), name text not null);
  INSERT INTO effect_sql_migrations (migration_id, name)
  SELECT (SELECT count(*)::int FROM drizzle.__drizzle_migrations), 'adopted-from-drizzle'
  WHERE NOT EXISTS (SELECT 1 FROM effect_sql_migrations);
  ```
  It applies only when `to_regclass('drizzle.__drizzle_migrations')` is not null. Drizzle applies a prefix of the files in order, so `count(*)` equals the highest id already applied.
- **Live state:** since the 2026-10-09 deploy, live has 46 rows in `drizzle.__drizzle_migrations`, which is every file. The existing tests are in `apps/server/src/effect/sql.test.ts`: "adopts a database drizzle already migrated…" (line 90) and "runs the committed drizzle SQL from empty…" (line 120).
- **Runtime helpers:** `registerSqlRuntime(db, url)` and `disposeSqlRuntime` are in `effect/sql.ts:88-110`. `PgliteClient.layer({ liveClient, transformResultNames: snakeToCamel, transformJson: false })` is how `SqlTest` builds a PGlite client (`effect/sql.ts:138-149`).

### What to build
1. **`effect/sql.ts`:**
   - `migrateSql(directory = migrationsFolder)`: an `Effect<ReadonlyArray<[id, name]>, MigrationError | SqlError, SqlClient>` that:
     - (a) if the drizzle journal exists, runs the seed above, and the first time it seeds, logs `migrations: adopted N drizzle migrations` through `Effect.logInfo`;
     - (b) loads the files once, then for each pending id in ascending order calls `runSqlMigrations` with a loader that returns only that one migration, so each migration commits in its own transaction;
     - (c) returns the applied list.

     Move `migrationsFolder` here, or import it, keeping a single definition.
   - `migratePglite(pglite: PGlite): Promise<…>` runs `migrateSql` on a `PgliteClient.layer` for that client, with no drizzle. `snapshotOfMigratedDatabase` uses it, and the drizzle import for that function goes.
2. **`db/migrate.ts`:** `runMigrations(db)` keeps its signature and becomes `await sqlRuntimeFor(db).runPromise(migrateSql())`. It logs the applied ids, if any. The drizzle migrator imports go.
3. **The callers:**
   - `auth/invite-cli.ts`: move `registerSqlRuntime(db, config.DATABASE_URL)` before `runMigrations(db)`.
   - `db/migrate-cli.ts`: register before and `disposeSqlRuntime` in `finally`, as `invite-cli.ts` does.
   - `test-support.ts`: the snapshot uses `migratePglite(template)`. The context's drizzle wrapper stays; S1 removes it later.
   - `index.ts` needs no change. Check it.
4. **`drizzle.__drizzle_migrations`** is never written, altered or dropped (it keeps rollback possible).
5. **Tests in `effect/sql.test.ts`,** on raw PGlite and through `migratePglite` or `migrateSql`:
   - **(i) full adoption:** a PGlite migrated by the drizzle migrator (keep one use of `drizzle-orm/pglite/migrator` in this test only), then `migrateSql` applies nothing and the schema is intact;
   - **(ii) partial adoption:** a PGlite migrated by drizzle with only files 0000 to 0040 (copy them to a temp folder, with `meta/_journal.json` trimmed to 41 entries), then `migrateSql` on the full folder applies exactly ids 42 to 46, and a column or table from 0045 exists;
   - **(iii) from empty:** 46 applied;
   - **(iv) per-migration rollback:** a temp folder with two migrations where the second contains invalid SQL; the run fails, the first is committed and journaled, and the second is absent;
   - **(v) a second run** applies nothing, and the journal has exactly one `adopted-from-drizzle` row.
6. **`db/migrate.test.ts`:** keep its four tests. Register a runtime for its drizzle-wrapped PGlite before `runMigrations` and dispose it after.

### Read first
`AGENTS.md`, `docs/audit/drizzle-removal-plan.md` (lines 444-509), `docs/EFFECT_GUIDE.md` ("The Promise boundary rule", "How to test"), `apps/server/src/effect/sql.ts`, `apps/server/src/effect/sql.test.ts`, `apps/server/src/db/migrate.ts`, `apps/server/src/db/migrate.test.ts`, `apps/server/src/db/migrate-cli.ts`, `apps/server/src/auth/invite-cli.ts` (lines 60-95), `apps/server/src/test-support.ts` (lines 280-325), `apps/server/src/index.ts` (lines 70-80).

### Allowed files
`apps/server/src/effect/sql.ts`, `apps/server/src/effect/sql.test.ts`, `apps/server/src/db/migrate.ts`, `apps/server/src/db/migrate.test.ts`, `apps/server/src/db/migrate-cli.ts`, `apps/server/src/auth/invite-cli.ts`, `apps/server/src/test-support.ts`, `work/T-0741-migrator-switch.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect/sql.test src/db/migrate.test
pnpm --filter @zilar/server test --maxWorkers=4 --reporter=dot --testTimeout=30000
pnpm gate
```
The second check runs the whole server suite once, because every test starts from the new snapshot. Paste its summary line.

### Acceptance
- The five migrator tests pass, and the whole server suite passes.
- `db/migrate.ts` has no drizzle import.
- `git grep -n "drizzle-orm/.*migrator" -- apps/server/src` shows only `effect/sql.test.ts`.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
