---
id: T-0496
title: "Effect F3 spike: database on effect/sql + @effect/sql-pg (PGlite in tests) — the pins module end to end, a migration strategy, and a better-auth adapter plan"
status: merged
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
`apps/server/package.json`, `pnpm-lock.yaml`, `apps/server/src/effect/sql.ts`, `apps/server/src/effect/sql.test.ts`, `apps/server/src/pins/service.ts`, `apps/server/src/pins/access.ts`, `apps/server/src/pins/routes.ts`, `apps/server/src/app.ts`, `docs/audit/effect-sql-migration.md`, `apps/server/src/topics/backfill.test.ts` (lead-approved, 2026-10-07), `work/T-0496-db-effect-sql-spike.md`.

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

### Status: review — done; GATE PASS

Everything is done and green. `pnpm gate` install/format/lint/typecheck/tests
all PASS and the scope check PASSes. One pre-existing failure in
`src/topics/backfill.test.ts` (caused by T-0470's migration `0045`, not by this
task) was fixed with a lead-approved one-line exclusion so the gate could go
green; that fix is the same edit T-0494 makes. Details below.

### What I did

1. **Dependencies** (`apps/server/package.json`, `pnpm-lock.yaml`): added
   `@effect/sql-pg@4.0.2` and `@effect/sql-pglite@4.0.2`, and bumped `effect`
   to `^4.0.2` (both drivers peer on `effect ^4.0.2`; T-0494 had not landed).
2. **`apps/server/src/effect/sql.ts`** (new): `SqlLive` (pg pool of 10 from
   `Config.Redacted('DATABASE_URL')`), `SqlTest` (PGlite started from a snapshot
   of a drizzle-migrated database), `sqlLayerFor`/`registerSqlRuntime`/
   `sqlRuntimeFor` (a per-database `ManagedRuntime`, PGlite or pg),
   `snakeToCamel` result-name transform, `sqlFileLoader` (reads the committed
   `drizzle/*.sql`, splits on `--> statement-breakpoint`) and `runSqlMigrations`
   (the generic `effect/sql` migrator). Convention comment at the top.
3. **Pins pilot**: `service.ts` and `access.ts` now run every query on
   `effect/sql` (tagged template, `sql.withTransaction` around the count +
   advisory lock + insert, `SqlError.reason._tag` → the same 409/503 answers).
   Exported `async` functions and return shapes are unchanged. `routes.ts`
   registers the runtime from the drizzle handle the app already passes
   (`registerSqlRuntime(deps.db, deps.config.DATABASE_URL)`); `app.ts` needed no
   change, and neither did `pins.test.ts`.
4. **`apps/server/src/effect/sql.test.ts`** (new): the `SqlTest` layer; adoption
   of a drizzle-migrated PGlite (seed the effect journal with the highest
   drizzle id → the migrator re-runs none of 0000–0045); and a full run of the
   46 committed SQL files from empty.
5. **`docs/audit/effect-sql-migration.md`** (new): (a) the conversion recipe,
   (b) the migration strategy with the tested adoption, (c) better-auth,
   (d) the removal order, (e) per-group estimates using plan §4.4.

### Files changed (10, all in Allowed files)

`apps/server/package.json`, `pnpm-lock.yaml`, `apps/server/src/effect/sql.ts`,
`apps/server/src/effect/sql.test.ts`, `apps/server/src/pins/service.ts`,
`apps/server/src/pins/access.ts`, `apps/server/src/pins/routes.ts`,
`apps/server/src/topics/backfill.test.ts` (lead-approved, 2026-10-07),
`docs/audit/effect-sql-migration.md`, `work/T-0496-db-effect-sql-spike.md`.

### Commands and real results

- `pnpm install` → done in ~1m, 1289 resolved.
- `pnpm --filter @zilar/server add @effect/sql-pg@4.0.2 @effect/sql-pglite@4.0.2 "effect@^4.0.2"` → +3 −1.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot pins src/effect`
  → **2 files, 13 tests passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/memory/routes`
  (the other `resolvePinChat` caller) → **1 file, 7 tests passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot topics/backfill`
  (after the lead-approved fix) → **1 file, 1 test passed**.
- `pnpm --filter @zilar/server typecheck` → ok (run once during development to
  settle the Effect types).
- `pnpm gate` (final):

```
gate: 10 changed file(s) against main
PASS  install (frozen)  (3.5s)
PASS  format  (50.4s)
PASS  lint  (1.2s)
PASS  typecheck  (21.2s)
PASS  tests @zilar/server  (506.0s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Pre-existing failure fixed (lead-approved)

The first gate run failed only on `src/topics/backfill.test.ts`:
`apps/server/drizzle/0045_remarkable_dragon_lord.sql:31` (added by T-0470,
commit `9fe8eee8`) adds the foreign key
`ai_delegations.topic_id → public.topics(id)`, and the test applied `0045`
before `0018`/`0019` (which create `topics`), erroring with
`relation "public.topics" does not exist`. It reproduced in isolation and was
not caused by this task.

The lead approved editing the test and confirmed T-0494 makes the identical
edit. `apps/server/src/topics/backfill.test.ts` now excludes `0045_` (same bytes
as T-0494's diff), and `pnpm gate` is green.

### Deviations and notes

- `app.ts` needed no change; the runtime is registered in `createPinsRoutes`,
  which is the smallest wiring that keeps tests passing (the spec allowed this).
- I ran `pnpm --filter @zilar/server typecheck` once during development (before
  the gate) to settle the Effect types; the gate ran it again.
- Better-auth (doc §c): the PGlite leg was **not** integration-tested. The
  Kysely adapter detects a `pg` Pool but PGlite ships no Kysely dialect, and
  adding `kysely`/`pg` plus a dialect is outside the Allowed dependencies. The
  document records the evidence, the auth tables (`user`, `session`, `account`,
  `verification` in `auth-schema.ts`) and the options; it is listed as an open
  question.
- Migration findings recorded in the doc: the `effect/sql` migrator reserves
  `migration_id 0` (the loader offsets file `0000` to id 1), runs all pending
  migrations in one transaction, and does not read `.sql` files (hence
  `sqlFileLoader`).
- After the rebase onto main the lead's merge hit a broken lockfile (T-0500/T-0501 added `effect ^4.0.0`); `pnpm install` regenerated `pnpm-lock.yaml`, `pnpm install --frozen-lockfile` passes, and `pnpm gate` is GATE PASS.
- After the second rebase (T-0502 added `effect` to devtools) the lockfile was regenerated the same way; `pnpm install --frozen-lockfile` and `pnpm gate` (GATE PASS) confirm it.

## Review (written by Claude)

Approved (lead, 2026-10-07).
- **What landed:** pins runs on effect/sql (`@effect/sql-pg` and `@effect/sql-pglite` 4.0.2, server `effect` ^4.0.2). The transaction, advisory lock and 409/503 mapping are identical; `pins.test.ts` is unchanged. `docs/audit/effect-sql-migration.md` holds the recipe, migration adoption (tested), the auth options, the removal order and the estimates. The pre-existing topics backfill failure is fixed with the same line as T-0494.
- **Lead decisions on the open questions:**
  1. better-auth moves to a custom DBAdapter over effect/sql (no new dependency).
  2. Keep the drizzle-kit migrator until the final removal step.
  3. When the runner switches, it runs one transaction per migration, to match drizzle.
- **Follow-up for the first bulk task:** register the SQL runtime once in `createApp` (and the test context) instead of only in `createPinsRoutes`, so `sqlRuntimeFor` never throws for the shared db (finding: follow-up 1).
- **Nit accepted:** test-only table-name interpolation.
