# Database on `effect/sql`: spike result and conversion plan

Status: spike (T-0496), 2026-10-07. Written from the code and from the tests run
in `apps/server/src/effect/sql.test.ts` and `apps/server/src/pins/`.

Julio overrode `docs/audit/effect-everywhere-plan.md` §2.2 (keep drizzle) and
decided the database moves to `effect/sql` + `@effect/sql-pg`. This document is
the recipe, the migration strategy, the better-auth plan, the removal order and
the estimates. It is grounded in the pins pilot, which now runs on `effect/sql`
with its existing test file unchanged.

## What was built

- `apps/server/package.json` adds `@effect/sql-pg@4.0.2`,
  `@effect/sql-pglite@4.0.2` and bumps `effect` to `^4.0.2` (the drivers peer on
  it; T-0494 had not landed).
- `apps/server/src/effect/sql.ts`: the `SqlLive` layer (pg, pool 10), the
  `SqlTest` layer (PGlite, migrated snapshot), the per-database runtime registry
  the transition uses, a `.sql` migration loader and the generic migrator call.
- `apps/server/src/pins/service.ts` and `apps/server/src/pins/access.ts`: all
  their queries are `effect/sql` now; `pins.test.ts` passes unchanged.
- `apps/server/src/pins/routes.ts`: registers the pins runtime; `app.ts` needed
  no change.
- `apps/server/src/effect/sql.test.ts`: proves the `SqlTest` layer, the
  adoption of a drizzle-migrated database, and a full run of the committed
  SQL history.

## (a) Recipe: converting one module

The pins module (903 lines) is the worked example.

1. **Dependencies.** Add `@effect/sql-pg` and `@effect/sql-pglite` (both
   `4.0.2`) and `effect ^4.0.2`. The drivers peer on `effect ^4.0.2`.
2. **Build the client.** `apps/server/src/effect/sql.ts` owns two layers:
   - `SqlLive`: `PgClient.layerConfig({ url: Config.Redacted('DATABASE_URL'),
     maxConnections: 10, transformResultNames: snakeToCamel })`.
   - `sqlLayerFor(db, databaseUrl)`: for a PGlite-backed drizzle handle it wraps
     the live PGlite client (`PgliteClient.layer({ liveClient: db.$client })`);
     otherwise it builds the pg pool. `registerSqlRuntime(db, databaseUrl)`
     memoizes a `ManagedRuntime` per drizzle handle in a `WeakMap`, and
     `sqlRuntimeFor(db)` returns it.
   - `transformResultNames: snakeToCamel` keeps the raw SQL rows in the
     camelCase shape the drizzle row types already had (`chat_jid` →
     `chatJid`), so nothing downstream changes.
3. **Queries.** Replace drizzle builders with the tagged template:
   `` yield* sql<PinRow>`SELECT * FROM pinned_messages WHERE chat_jid = ${key} ORDER BY pinned_at DESC, id DESC` ``.
   A statement is an Effect, so `yield*` runs it and returns rows. Type the row
   with the drizzle inferred type (`sql<PinRow>`). Counts use
   `count(*)::int AS total` so the value is a number.
4. **Transactions.** `sql.withTransaction(effect)`; the effect runs on the
   transaction connection. An advisory lock stays raw SQL inside it:
   `` yield* sql`SELECT pg_advisory_xact_lock(hashtext(${chatJid}))` ``. The
   count check and the insert stay in the same transaction, so the cap is still
   atomic (`AGENTS.md:77`).
5. **Keep the module's shape.** The exported functions stay `async` and return
   the same values. A private helper runs each effect:
   `sqlRuntimeFor(deps.db).runPromise(effect)`. Routes and `pins.test.ts` did not
   change.
6. **Errors.** `effect/sql` raises `SqlError` with a structured
   `reason._tag`; map `UniqueViolation` to the existing 409 and everything else
   to the existing 503 with `Effect.mapError`, so the route answers are
   byte-identical. Keep the module's own `HttpError`s unchanged.
7. **Tests.** A module test can use the `SqlTest` layer (a fresh PGlite from a
   snapshot of a drizzle-migrated database) or, like pins, keep going through
   `createTestContext`/`testApp` because the runtime is built from the same
   drizzle handle the test already passes around.
8. **Delete the drizzle imports** from the converted files. SQL text replaces
   the schema builder.

## (b) Migration strategy

### How each runner tracks applied migrations (evidence)

**drizzle** (`drizzle-orm/pg-core/dialect.js:44-71`): creates
`drizzle.__drizzle_migrations(id serial primary key, hash text, created_at bigint)`
and records `created_at = folderMillis` (the `when` from
`apps/server/drizzle/meta/_journal.json`). It applies a migration when
`created_at < folderMillis`, and wraps **each migration** in its own
transaction. Files are split on `--> statement-breakpoint`. `runMigrations`
(`apps/server/src/db/migrate.ts`) calls this for postgres-js or PGlite.

**effect/sql** (`effect/dist/sql/Migrator.js:46-151`): creates
`effect_sql_migrations(migration_id integer primary key, created_at timestamptz,
name text)`; reads the row with the highest `migration_id`; applies only
migrations with `id > latest`; and wraps **all pending migrations in one
transaction**. Its loaders import `.js`/`.ts`/`.mjs`/`.mts` modules that export
an Effect — **not `.sql` files**.

Three behaviours matter for the plan:

- **id 0 is reserved.** An empty journal maps to `0`, and every `id <= 0` is
  skipped. A loader that starts at 0 silently drops `0000_*.sql`. The loader in
  `effect/sql.ts` offsets the file number by one (`0000` → id 1), and the
  adoption seed uses the same offset.
- **One transaction for all pending migrations** (drizzle uses one per file).
  The committed history has no `ALTER TYPE ... ADD VALUE`, so running all of it
  in one transaction works; a future migration that cannot share a transaction
  must be split into its own release.
- **`.sql` needs a custom loader.** `sqlFileLoader(directory)` reads the
  directory, parses `<id>_<name>.sql`, splits on `--> statement-breakpoint` and
  runs each statement with `sql.unsafe(...)`. It returns the migration Effect
  wrapped in `Effect.succeed`, which is what the core migrator expects.

### Adoption of a database drizzle already migrated (tested)

A live database has `drizzle.__drizzle_migrations` and no
`effect_sql_migrations`. Seed the effect journal with the highest id drizzle
applied, once:

```sql
CREATE TABLE IF NOT EXISTS effect_sql_migrations (
  migration_id integer primary key,
  created_at timestamp with time zone not null default now(),
  name text not null
);
INSERT INTO effect_sql_migrations (migration_id, name)
SELECT (SELECT count(*)::int FROM drizzle.__drizzle_migrations), 'adopted-from-drizzle'
WHERE NOT EXISTS (SELECT 1 FROM effect_sql_migrations);
```

Drizzle always applies a prefix (in file order), and the loader maps file N to
id N+1, so `count` is exactly the highest effect id already applied. The
migrator then skips every committed migration and runs only new ones.

`apps/server/src/effect/sql.test.ts` proves all of it on PGlite:

- **adoption**: a PGlite migrated by drizzle (46 rows in
  `drizzle.__drizzle_migrations`, `pinned_messages` present) plus the seed
  above; `runSqlMigrations({ loader: sqlFileLoader(
  apps/server/drizzle) })` returns `[]` and the schema is intact.
- **from empty**: the same loader against a fresh PGlite applies all 46 files
  (returns 46 entries) and `pinned_messages` exists.

### Recommendation

**Keep `drizzle-kit` as the schema author and its migrator as the runner until
the last module leaves drizzle; switch to the `effect/sql` migrator as part of
the final removal in (d), not before.** Reasons, from the evidence above:

1. `apps/server/src/db/schema.ts` is still the single source of truth for
   `pnpm db:generate`. Until every module is on `effect/sql`, new schema changes
   must be generated from it; running two journals at once (drizzle's and
   effect's) would need dual seeding on every existing environment and buys
   nothing while drizzle is still present.
2. The switch is already de-risked: the custom loader and the adoption seed are
   tested, so it is a mechanical step once `drizzle-orm` must go.
3. The one-transaction difference is a real semantic change; making it at the
   end keeps the transitional risk out of 54 module conversions.

**New schema once `db:generate` is gone.** Write the migration by hand as
`apps/server/drizzle/NNNN_name.sql` (one statement per
`--> statement-breakpoint`, which is what `sqlFileLoader` reads) and run it with
`runSqlMigrations`. This keeps the SQL history in `apps/server/drizzle/` and
reviewable. The alternative — a `NNNN_name.ts` module exporting an Effect, which
the core `fromFileSystem` loader imports directly — is available for data
migrations that need real code; both share `effect_sql_migrations`.

## (c) better-auth

**Today.** `apps/server/src/auth/auth.ts:2,48` uses
`drizzleAdapter(db, { provider: 'pg', schema })`. It works on pg and PGlite
because drizzle has both drivers. `schema` comes from `src/db/schema` but the
auth tables actually live in `apps/server/src/auth/auth-schema.ts`.

**Replacement.** better-auth 1.7.6 ships a Kysely adapter,
`better-auth/adapters/kysely` (`kyselyAdapter`). Evidence from
`@better-auth/kysely-adapter@1.7.6/dist/index.mjs`:
`createKyselyAdapter` builds a Kysely with `PostgresDialect({ pool: db })` for
any object with `connect` — i.e. a `pg` Pool (`node-postgres`) — accepts an
already-built `Kysely`/`{ dialect }`, and accepts a `{ db, type, transaction }`
driver config. `kyselyAdapter(db, config?)` takes a `Kysely<any>`.

**pg.** Passing a `pg.Pool` works with no adapter code. It adds the `pg`
dependency (the repo uses postgres-js today).

**PGlite.** The Kysely adapter does **not** cover PGlite out of the box:
`getKyselyDatabaseType` only recognises `PostgresDialect`/`MysqlDialect`/
`SqliteDialect`/`MssqlDialect` and the pg Pool shape (`"connect" in db`);
`@electric-sql/pglite@0.5.8` publishes no Kysely dialect (its `exports` have no
`kysely` entry). So a test run of the adapter against PGlite needs either a
PGlite Kysely dialect or a hand-written adapter. I did **not** run that test:
doing so needs a new dependency (`kysely` plus a PGlite dialect, or `pg`), which
is outside this task's allowed files. This is a decision for the lead before the
auth switch (see Open questions).

Options, in order of preference:

1. **Custom `DBAdapter` over the app's `SqlClient`.** better-auth exposes the
   adapter factory in `better-auth/db/adapter`; a small adapter delegates
   `create/findOne/findMany/update/updateMany/delete/deleteMany/count` (and
   `transaction`) to `effect/sql`. It works on pg and PGlite by construction —
   the same `SqlClient` the rest of the server uses — and adds no dependency.
   Highest code cost.
2. **Kysely adapter + `pg` Pool** in production, plus a PGlite Kysely dialect
   for tests. Lowest code cost, needs `pg` and a maintained dialect package.
3. Keep `drizzleAdapter` only for auth while the rest moves. Rejected: it keeps
   `drizzle-orm` and `auth-schema.ts` alive after the conversion, which the
   removal order is trying to end.

**Auth tables better-auth needs** (from `apps/server/src/auth/auth-schema.ts`,
not `schema.ts`):

| table | columns |
| --- | --- |
| `user` | `id`, `name`, `email` (unique), `email_verified`, `image`, `created_at`, `updated_at` |
| `session` | `id`, `expires_at`, `token` (unique), `created_at`, `updated_at`, `ip_address`, `user_agent`, `user_id` → `user` |
| `account` | `id`, `account_id`, `provider_id`, `user_id` → `user`, `access_token`, `refresh_token`, `id_token`, `access_token_expires_at`, `refresh_token_expires_at`, `scope`, `password`, `created_at`, `updated_at` |
| `verification` | `id`, `identifier`, `value`, `expires_at`, `created_at`, `updated_at` |

The `bearer` plugin adds no table. The `emailOTP` plugin stores codes in
`verification` (no extra table). These four tables and their indexes must exist
under whichever adapter replaces drizzle, and the removal of `auth-schema.ts`
must keep them (hand-written SQL migration 0001 already creates them).

**Do not switch in this task** — this section is the plan only.

## (d) Order for removing drizzle

Each step is independently mergeable and keeps `pnpm gate` green.

1. Convert the remaining modules to `effect/sql` (server bulk, §e). Keep
   `drizzle-orm` for the modules not yet converted.
2. Convert background loops and the remaining drizzle call sites; the
   `Database`/runtime service (plan F1/F3) becomes the single client.
3. Move better-auth to the chosen adapter and delete the `drizzleAdapter` use.
   Move the four auth tables out of `auth-schema.ts`: keep them in the SQL
   history only.
4. Switch `runMigrations` from the drizzle migrator to `runSqlMigrations` and
   apply the adoption seed to live databases (tested in `sql.test.ts`).
5. Delete `apps/server/src/db/client.ts` (`createDb`, `ServerDatabase`,
   `Postgres/PgliteServerDatabase`) and `apps/server/src/db/schema.ts` (1,534
   lines); remove the drizzle branch from `apps/server/src/db/migrate.ts`.
6. Delete `apps/server/src/auth/auth-schema.ts`, `apps/server/drizzle.config.ts`
   and the `db:generate`/`db:migrate` scripts; drop `drizzle-orm` and
   `drizzle-kit` from `apps/server/package.json` and `postgres` if nothing else
   uses it. **Keep `apps/server/drizzle/*.sql` as history.**
7. Update `test-support.ts` so `createTestContext` builds the effect/sql
   `SqlTest` client instead of `drizzle(client, { schema })`, and drop the last
   `drizzle-orm` imports from tests.

## (e) Estimates per module group (plan §4.4)

Rough worker-days, assuming the pins recipe is followed. The pins pilot (903
lines, 1 drizzle file, transactions + advisory lock) is the S baseline (~0.5
day of conversion work plus review).

| Group | Modules | Estimate |
| --- | --- | --- |
| 1 | `handles`, `pins` (done), `blocks`, `contacts`, `contact-requests`, `directory` | 3–4 days |
| 2 | `drafts`, `chat-prefs`, `chat-folders`, `chatList`/`chats`, `topics` | 5–7 days |
| 3 | `groups`, `roles`, `invite-links`, `approvals`, `audit` | 5–7 days |
| 4 | `media`, `files`, `avatars`, `backgrounds`, `stickers` | 5–7 days |
| 5 | `gifs`, `search`, `xmpp`, `machines`, `tools`, `routines` | 6–8 days |
| 6 | `push`, `integrations`, `setup`, `connections`, `ais`, `agents`, `actions` | 7–9 days |
| 7 | `chats`, `voice`, `voice-transcription`, auth routes | 5–7 days |
| 8 | Edge flip (Hono → `HttpApi`) | 8–12 days |
| Background loops (Streams + `Schedule`) | runner hub, routines, approvals, actions, agents, drafts, push, Telegram import, mailer, sandbox, Giphy | 8–12 days |
| Web bulk | 4 zod files, upload sites, store pipelines | 30–45 days |
| Mobile bulk | 25 `*-api.ts`, stores, native lifetimes | 30–45 days |
| Packages + runner | `runner-tunnel`, `xmpp-core`, `devtools`, `chat-core` | 12–18 days |

The pins pilot was small; the table's per-module groups are deliberately wider
than pins because most groups mix 2–3 drizzle files and cross-module calls
(`agents/memory` calling `resolvePinChat` is the shape to expect). Re-estimate
after the first bulk group lands.

## Open questions for the lead

1. **better-auth adapter** (§c): custom `DBAdapter` over `effect/sql` (no new
   dependency, more code) or Kysely adapter with `pg` + a PGlite Kysely dialect
   (less code, two dependencies)? The PGlite integration test was not run
   because neither option's dependency is in this task's allowed files.
2. **Migration runner timing** (§b): the recommendation is to keep
   `drizzle-kit`'s runner until the final removal. Confirm, or ask for the
   `effect/sql` runner to be adopted now (the loader and seed are ready).
3. **One transaction for all pending migrations** (§b): accept, or make
   `runSqlMigrations` run one transaction per migration to match drizzle
   exactly? The pins pilot does not depend on this.
