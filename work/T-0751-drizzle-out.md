---
id: T-0751
title: "S1 + DEL: drizzle out of the server — ServerDatabase becomes a plain runtime key (PGlite or a Postgres handle), test-support hands out the raw PGlite, the drizzle-based tests are rewritten without drizzle, and db/schema.ts, auth/auth-schema.ts, auth/cli-config.ts, drizzle.config.ts, db/rows.test.ts, the db:generate script and the drizzle-orm/drizzle-kit dependencies are deleted"
status: todo
milestone: M5
branch: task/T-0751-drizzle-out
model: auto
effort: default
depends_on: [T-0741, T-0749]
estimate: 0.5 day
---

# T-0751: drizzle out of the server

## Spec (written by Claude, do not edit)

### Why
This is the last step of `docs/audit/drizzle-removal-plan.md`: S1 (§3, lines 389-440) and DEL (§5). All modules, migrations (T-0741, live since 2026-10-09) and row types (T-0749) are already off drizzle. Julio approved it on 2026-10-09 ("ok for everything"). After this task, new migrations are hand-written SQL files in `apps/server/drizzle/`, applied by `migrateSql`.

### Verified facts (do not re-derive; from `git grep` on main after T-0749)
- **Drizzle is left only in these places:**
  - `src/db/client.ts` (lines 1-26);
  - `src/db/schema.ts`;
  - `src/auth/auth-schema.ts`;
  - `src/auth/cli-config.ts`;
  - `src/test-support.ts` (`drizzle` at line 2, `PgliteServerDatabase` at 8, `schema` at 9, `db: PgliteServerDatabase` at 245, `drizzle(client, { schema })` around 314);
  - `src/effect/sql.ts` (line 25 imports the types; `isPgliteDatabase` at 42-44 checks `db.$client`; `sqlLayerFor` at 71-74 uses `db.$client as PGlite`);
  - the tests `src/db/migrate.test.ts` (seeds through drizzle), `src/effect/sql.test.ts` (lines 3, 4 and 12: the drizzle migrator in the adoption tests at 139 and 157), `src/auth/sql-adapter.pg.test.ts` (`drizzleAdapter` at line 2, `schema` at 9; the cross-read tests at 238 and 252) and `src/db/rows.test.ts`.
- **Comments that mention `db/schema.ts`:** `src/media/indexer.ts:232`, `src/push/test-tables.ts:9` and `src/db/rows.ts:2`.
- **No other code uses a drizzle feature of `db`.** Everywhere else `db` is only the key of `sqlRuntimeFor(db)` (`effect/sql.ts:88-110`).
- **`index.ts` startup and shutdown:** `createDb` at line 72, `registerSqlRuntime` at 76, and on shutdown `disposeSqlRuntime(db)` then `close()` (lines 537-540, with a stale comment). `ais/integration.test.ts:504,533` also uses `createDb` and `close()`.
- **`apps/server/package.json`:**
  - script `db:generate` (line 11) goes; `db:migrate` (line 12, `src/db/migrate-cli.ts`) stays;
  - dependencies `drizzle-orm` (line 25) and `drizzle-kit` (line 36) go;
  - **`postgres` (line 30) stays**, because `src/search/service.ts:3` uses it.
  - `tsconfig.json:8` includes `drizzle.config.ts`.
- **`docs/SERVER_CONFIG.md:288-304`** describes drizzle's `migrate` and `db:generate`.
- **`apps/server/drizzle/`** (the SQL files and `meta/`) stays untouched: the migrator reads the `.sql` files from it.

### What to build
1. **`src/db/client.ts`:**
   - `export interface PostgresServerDatabase { readonly kind: 'postgres'; readonly url: string }` and `export type ServerDatabase = PostgresServerDatabase | PGlite`;
   - `createDb(url)` returns `{ db: { kind: 'postgres', url }, close: async () => {} }`. Comment that the effect/sql runtime owns the pool, and that `disposeSqlRuntime` closes it.
   - No drizzle or postgres-js import.
2. **`src/effect/sql.ts`:**
   - `isPgliteDatabase(db)` becomes `db instanceof PGlite`;
   - the PGlite branch of `sqlLayerFor` uses `liveClient: db`;
   - remove the drizzle type imports and update the comments that mention drizzle.
3. **`src/test-support.ts`:** `createTestContext` uses the raw PGlite (`client`) as `db` and calls `registerSqlRuntime(client, '')`. `TestContext.db` becomes `PGlite`. Remove the drizzle and schema imports. `TestContext.client` stays.
4. **`src/index.ts`:** update the stale shutdown comment. No behaviour change.
5. **The tests:**
   - **`db/migrate.test.ts`:** keep the four tests. Use a raw PGlite with `registerSqlRuntime(pglite, '')`, and seed and assert with `sqlRuntimeFor(pglite).runPromise` SQL instead of drizzle.
   - **`effect/sql.test.ts`:** the two adoption tests stop using drizzle's migrator. Simulate a drizzle-migrated DB as follows:
     1. run `migrateSql` on a temp folder holding the first N files;
     2. `DROP TABLE effect_sql_migrations`;
     3. `CREATE SCHEMA drizzle` and `CREATE TABLE drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)` with N rows;
     4. run `migrateSql` on the full folder.

     Use N = 46 for full adoption and N = 41 for partial. Keep every assertion.
   - **`auth/sql-adapter.pg.test.ts`:** delete the two cross-read tests (238, 252), the `drizzleAdapter` helper and the `schema` import. Keep the round-trip test and the OTP test.
   - **Delete `db/rows.test.ts`.** Update the header comment of `db/rows.ts`: the shapes follow the migration SQL in `apps/server/drizzle/`, and a schema change must update both.
6. **Delete** `src/db/schema.ts`, `src/auth/auth-schema.ts`, `src/auth/cli-config.ts` and `apps/server/drizzle.config.ts`. Remove `db:generate` and the two dependencies from `package.json`, run `pnpm install`, and drop `drizzle.config.ts` from `tsconfig.json`.
7. **Comments:**
   - `media/indexer.ts:232` and `push/test-tables.ts:9`: point at the migration SQL instead of `db/schema.ts`;
   - `docs/SERVER_CONFIG.md:288-304`: migrations run through `migrateSql` (`effect/sql.ts`) at startup, one transaction each; `db:migrate` runs it out of band; new migrations are hand-written `NNNN_name.sql` files in `apps/server/drizzle/`, with `--> statement-breakpoint` between statements, and must update `db/rows.ts` and add a test.
8. **Check:** `git grep -n -E "drizzle-orm|drizzle-kit|db/schema" -- apps packages ':!**/node_modules/**'` prints nothing except comments that name the `apps/server/drizzle/` folder.

### Read first
`AGENTS.md`, `docs/audit/drizzle-removal-plan.md` (lines 389-440 and the DEL row in §5), `apps/server/src/db/client.ts`, `apps/server/src/effect/sql.ts` (lines 1-120), `apps/server/src/test-support.ts` (lines 230-330), `apps/server/src/index.ts` (lines 65-80, 525-545), `apps/server/src/db/migrate.test.ts`, `apps/server/src/effect/sql.test.ts`, `apps/server/src/auth/sql-adapter.pg.test.ts`, `docs/SERVER_CONFIG.md` (lines 280-310).

### Allowed files
`apps/server/src/db/client.ts`, `apps/server/src/effect/sql.ts`, `apps/server/src/test-support.ts`, `apps/server/src/index.ts`, `apps/server/src/db/migrate.test.ts`, `apps/server/src/effect/sql.test.ts`, `apps/server/src/auth/sql-adapter.pg.test.ts`, `apps/server/src/db/rows.ts`, `apps/server/src/db/rows.test.ts`, `apps/server/src/db/schema.ts`, `apps/server/src/auth/auth-schema.ts`, `apps/server/src/auth/cli-config.ts`, `apps/server/drizzle.config.ts`, `apps/server/package.json`, `apps/server/tsconfig.json`, `pnpm-lock.yaml`, `apps/server/src/media/indexer.ts`, `apps/server/src/push/test-tables.ts`, `docs/SERVER_CONFIG.md`, `work/T-0751-drizzle-out.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect/sql.test src/db/migrate.test
pnpm --filter @zilar/server test --maxWorkers=4 --reporter=dot
pnpm gate
```
The second command runs the whole server suite once, because every test now gets a raw PGlite. Paste its summary line. If the local Postgres is up, also run `ZILAR_PG_INTEGRATION=1 TZ=Europe/Madrid pnpm --filter @zilar/server test --maxWorkers=1 --reporter=dot src/auth/sql-adapter.pg.test` against the dev DB (`DATABASE_URL` from `/Users/julio/personal-projects/galena/apps/server/.env`, read only; never print it). Paste that result too.

### Acceptance
- The whole server suite passes. `drizzle-orm` and `drizzle-kit` are not in any `package.json` or in `pnpm-lock.yaml`.
- The grep in step 8 prints nothing except comments about the migration folder.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
