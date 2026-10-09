---
id: T-0751
title: "S1 + DEL: drizzle out of the server — ServerDatabase becomes a plain runtime key (PGlite or a Postgres handle), test-support hands out the raw PGlite, the drizzle-based tests are rewritten without drizzle, and db/schema.ts, auth/auth-schema.ts, auth/cli-config.ts, drizzle.config.ts, db/rows.test.ts, the db:generate script and the drizzle-orm/drizzle-kit dependencies are deleted"
status: merged
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

**Status: review, with one acceptance item not met (item 1 below).**

### What changed
- `db/client.ts`: `ServerDatabase = PostgresServerDatabase | PGlite`; `PostgresServerDatabase` is `{ kind: 'postgres', url }`; `createDb` returns that key and a no-op `close` (the effect/sql runtime owns the pool). No drizzle or postgres-js import.
- `effect/sql.ts`: `isPgliteDatabase` is `db instanceof PGlite`; PGlite branch uses `liveClient: db`; drizzle comments removed. The adoption comments about `drizzle.__drizzle_migrations` stay, because live databases still have that table.
- `test-support.ts`: `TestContext.db` is the raw PGlite (`db: client`), `registerSqlRuntime(client, '')`, close disposes `client`. Drizzle and schema imports removed. `client` kept.
- `index.ts`: shutdown comment only.
- `db/migrate.test.ts`: all nine tests kept (the spec says "four", but the file has nine and the rule is to keep every other assertion). Seeds and asserts through `sqlRuntimeFor(client).runPromise` with `sql.unsafe`.
- `effect/sql.test.ts`: both adoption tests use `drizzleMigrated(pglite, N)`: `migrateSql` on the first N files, `DROP TABLE effect_sql_migrations`, `CREATE SCHEMA drizzle`, the `__drizzle_migrations` table, N rows. N = 46 and 41. All assertions kept (8 tests in the file).
- `auth/sql-adapter.pg.test.ts`: `drizzleAdapter`, `schema`, `drizzleAuth` and the two cross-read tests removed; round-trip and OTP tests kept.
- Deleted with `git rm`: `db/schema.ts`, `auth/auth-schema.ts`, `auth/cli-config.ts`, `apps/server/drizzle.config.ts`, `db/rows.test.ts`.
- `apps/server/package.json`: `db:generate`, `drizzle-orm`, `drizzle-kit` removed (`postgres` kept). `tsconfig.json`: `drizzle.config.ts` removed from `include`.
- Comments: `db/rows.ts` header (shapes follow `apps/server/drizzle/`, a schema change updates both); `media/indexer.ts`; `push/test-tables.ts`; `docs/SERVER_CONFIG.md` migration section (migrateSql, hand-written `NNNN_name.sql`, `--> statement-breakpoint`, update `db/rows.ts` and add a test).
- `apps/server/drizzle/` untouched.

### Commands and results
- Baseline, before any edit: `pnpm --filter @zilar/server test --maxWorkers=4 --reporter=dot`: Test Files 152 passed | 7 skipped (159); Tests 2260 passed | 12 skipped (2272).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect/sql.test src/db/migrate.test`: Test Files 2 passed (2); Tests 17 passed (17).
- `pnpm --filter @zilar/server typecheck`: passed, no output.
- Gated pg test: `ZILAR_PG_INTEGRATION=1 TZ=Europe/Madrid pnpm --filter @zilar/server test --maxWorkers=1 --reporter=dot src/auth/sql-adapter.pg.test` against the local dev Postgres on 127.0.0.1:5432 (URL read from the galena `.env` into the environment, not printed): Test Files 1 passed (1); Tests 2 passed (2), 0 skipped.
- Full suite after the change, `pnpm --filter @zilar/server test --maxWorkers=4 --reporter=dot`: Test Files 151 passed | 7 skipped (158); Tests 2257 passed | 10 skipped (2267). The difference is `rows.test.ts` (3 tests) deleted and the two cross-read tests (skipped without the gate) deleted. Test count and skip count move by exactly these.
- Step 8, `git grep -n -E "drizzle-orm|drizzle-kit|db/schema" -- apps packages ':!**/node_modules/**'`, prints one line:

  ```
  packages/devtools/src/lead/task-file.test.ts:160:    expect(pickEffort(task('`apps/server/src/db/schema.ts`, `apps/web/**`'), undefined)).toBe(
  ```

  This is a string fixture in a devtools test, not a comment about the migration folder. That file is outside Allowed, so I did not touch it.
- `pnpm gate` from the worktree root, summary lines:
  - `gate: 20 changed file(s) against main`
  - `PASS  install (frozen)  (0.9s)`
  - `PASS  format  (12.5s)`
  - `PASS  lint  (1.1s)`
  - `PASS  typecheck  (3.4s)`
  - `PASS  tests @zilar/server  (33.6s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Deviations and open points
1. **Acceptance "drizzle-orm and drizzle-kit are not in pnpm-lock.yaml" is NOT met.** Both are removed from both `package.json` files and from the lock importers. `pnpm-lock.yaml` still has 27 lines naming drizzle: better-auth 1.7.6 declares `drizzle-orm` and `drizzle-kit` as optional peers and depends on `@better-auth/drizzle-adapter`, so the lock keeps their peer-suffixed snapshots and the `drizzle-orm@0.45.3` and `drizzle-kit@0.31.11` package entries. `pnpm install` kept them. `pnpm dedupe` also kept them and bumped an unrelated `@types/ws` pin, so I restored the lock from HEAD and reinstalled. The lock diff is now 11 insertions and 8 deletions (`optional: true` marks plus the importer removals). Clearing the rest needs a decision outside Allowed files (for example a peer rule in `pnpm-workspace.yaml`, or a better-auth upgrade, which changes behaviour). I did not guess.

   **Fix round 1 (lead request): clean re-resolution attempts, neither worked.**
   - `pnpm dedupe`: `grep -c drizzle pnpm-lock.yaml` 27 before, 27 after; `node_modules/.pnpm` still has `drizzle-kit@0.31.11` and `drizzle-orm@0.45.3_...`. It also bumped `@types/ws` 8.18.1 to 8.18.2 (unrelated). Reverted with `git checkout -- pnpm-lock.yaml`.
   - `pnpm install --fix-lockfile`: drizzle count 27 before, 27 after; the same two packages stay in `node_modules/.pnpm`. Its only lock change was removing one `deprecated: uuid@10 ...` line. Reverted with `git checkout -- pnpm-lock.yaml`.
   - So the lock is unchanged from the first commit, and I did not hand-edit it. The drizzle entries stay until someone decides on a peer rule or a better-auth change.
2. Stale comments outside Allowed files still mention drizzle (not touched): `auth/invite-cli.ts:91` and `db/migrate-cli.ts:18` ("drizzle client it shares"); `auth/sql-adapter.ts:2, 178, 230` (`drizzleAdapter`, `$onUpdate`); `contacts/service.ts:4-5` and `directory/service.ts:10` say calls "stay drizzle", which is no longer true; about a dozen "drizzle row type" comments in `ais`, `approvals`, `contact-requests`, `handles`, `machines`, `media`, `pins`, `push`, `routines`, `setup`, `topics`, `voice-transcription`.
3. The full suite run printed one worker line, `Aborted(Assertion failed: list_empty(&rt->gc_obj_list) ... quickjs.c,2036,JS_FreeRuntime)`. Every file still reported passed, and the line comes from the QuickJS runtime, which this change does not touch. I did not investigate it. I only looked at the last 15 lines of the baseline run, so I cannot say whether it is new.
4. `createDb().close` is now a no-op. Every caller that closes it first calls `disposeSqlRuntime` (`invite-cli.ts`, `migrate-cli.ts`, `index.ts`, `ais/integration.test.ts`, `sql-adapter.pg.test.ts`), so no pool is left open.

## Review (written by Claude)

**2026-10-09, lead:** approved after one fix round. Julio OKed DEL. Worker: Haiku 5.5. The lead reviewed the diff directly.
- **The code:**
  - `ServerDatabase` is a plain key: `{ kind: 'postgres', url }` or a raw PGlite;
  - `isPgliteDatabase` is an `instanceof` check, and the PGlite layer takes the client directly;
  - production no longer opens a second postgres-js pool;
  - tests hand out the raw PGlite.
- **Deleted:** `db/schema.ts`, `auth/auth-schema.ts`, `auth/cli-config.ts`, `drizzle.config.ts`, `db/rows.test.ts`, the `db:generate` script and the `drizzle-orm` and `drizzle-kit` dependencies.
- **Tests:** 2257 pass (was 2260; the drop is the 3 row-type tests, and the 2 drizzle cross-read tests are removed). The gated pg test passes 2 of 2. The gate passed.
- **Left in the lockfile:** drizzle stays only as better-auth's optional peer (`peerDependenciesMeta optional: true`); `pnpm dedupe` and `--fix-lockfile` did not drop it. No Zilar code imports it. Removing it is a follow-up (a pnpm peer rule, or a better-auth upgrade).
- **The QuickJS `Aborted(JS_FreeRuntime)` worker line:** the lead checks it separately.
