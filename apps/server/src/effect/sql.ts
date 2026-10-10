// T-0496: the `effect/sql` entry point for the server. One place builds the
// SQL client (`@effect/sql-pg` in production, `@effect/sql-pglite` in tests
// and for the migration adoption check) and runs the pins pilot through it.
//
// Conventions:
// - run a query with the `sql` tagged template: `` yield* sql<Row>`SELECT ...` ``;
//   the statement is an Effect, so `yield*` executes it and returns rows.
// - result columns are camelCased by `transformResultNames`, matching the
//   row types in `db/rows.ts`.
// - run a transaction with `sql.withTransaction(effect)`; every statement in
//   the effect uses the transaction connection.
// - advisory locks stay raw SQL inside the transaction:
//   `` yield* sql`SELECT pg_advisory_xact_lock(hashtext(${key}))` ``.
// - keep the module's exported functions `async` and surface them through
//   `ManagedRuntime.runPromise`, so routes and existing tests do not change.

import type { PGlite } from '@electric-sql/pglite';
import { PgClient } from '@effect/sql-pg';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Config, Effect, Layer, ManagedRuntime, Redacted } from 'effect';
import { Migrator, SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';

export const SQL_POOL_MAX = 10;
export const SQL_MIGRATIONS_TABLE = 'effect_sql_migrations';

// The committed migrations: `apps/server/drizzle`. From source this file sits
// in `src/effect/`; the production bundle is `dist/index.mjs`, one level down.
export const migrationsFolder = fileURLToPath(
  new URL(import.meta.url.endsWith('.ts') ? '../../drizzle' : '../drizzle', import.meta.url),
);

export type SqlRuntime = ManagedRuntime.ManagedRuntime<SqlClient.SqlClient, SqlError.SqlError>;

// The columns the server stores are snake_case; the row types in `db/rows.ts`
// are camelCase. The client transforms result names once so both agree.
export function snakeToCamel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

// A production key is the plain `{ kind: 'postgres', url }` record; anything else
// is a test's raw PGlite handle. No `instanceof`, so production never loads PGlite.
export function isPgliteDatabase(db: ServerDatabase): db is PGlite {
  return !('kind' in db && db.kind === 'postgres');
}

// PGlite and its `effect/sql` driver are devDependencies, so they load on demand
// and only on the test path.
function pgliteLayer(client: PGlite): Layer.Layer<SqlClient.SqlClient, SqlError.SqlError> {
  return Layer.unwrap(
    Effect.promise(() => import('@effect/sql-pglite')).pipe(
      Effect.map(({ PgliteClient }) =>
        PgliteClient.layer({
          liveClient: client,
          transformResultNames: snakeToCamel,
          transformJson: false,
        }),
      ),
    ),
  );
}

// `transformResultNames` camelCases column names to match the row types in
// `db/rows.ts`, but a jsonb value is data: its keys must read back exactly as
// they were written, so `transformJson: false` stops the driver renaming them too.
//
// Production: one pool of `SQL_POOL_MAX` from `DATABASE_URL`.
export const SqlLive: Layer.Layer<SqlClient.SqlClient, Config.ConfigError | SqlError.SqlError> =
  PgClient.layerConfig(
    Config.all({
      url: Config.Redacted('DATABASE_URL'),
      maxConnections: Config.succeed(SQL_POOL_MAX),
      transformResultNames: Config.succeed(snakeToCamel),
      transformJson: Config.succeed(false),
    }),
  );

// The layer behind a database key. Tests hand over their raw PGlite, production
// a `DATABASE_URL`; either way modules read through this layer and no route or
// test has to learn about `effect/sql`.
export function sqlLayerFor(
  db: ServerDatabase,
  databaseUrl: string,
): Layer.Layer<SqlClient.SqlClient, SqlError.SqlError> {
  if (isPgliteDatabase(db)) {
    return pgliteLayer(db);
  }
  return PgClient.layer({
    url: Redacted.make(databaseUrl),
    maxConnections: SQL_POOL_MAX,
    transformResultNames: snakeToCamel,
    transformJson: false,
  });
}

const runtimes = new WeakMap<ServerDatabase, SqlRuntime>();

export function registerSqlRuntime(db: ServerDatabase, databaseUrl: string): SqlRuntime {
  const existing = runtimes.get(db);
  if (existing !== undefined) {
    return existing;
  }
  const runtime = ManagedRuntime.make(sqlLayerFor(db, databaseUrl));
  runtimes.set(db, runtime);
  return runtime;
}

export function sqlRuntimeFor(db: ServerDatabase): SqlRuntime {
  const runtime = runtimes.get(db);
  if (runtime === undefined) {
    throw new Error('No effect/sql runtime registered for this database');
  }
  return runtime;
}

/**
 * Runs an effect that needs the SQL client on the runtime registered for `db`.
 * One shared copy for every module's service.
 */
export function runSql<A, E>(
  db: ServerDatabase,
  effect: Effect.Effect<A, E, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

// Disposes the runtime for one database and forgets it, so a later
// `sqlRuntimeFor(db)` throws instead of handing back a closed pool. The entry
// is removed first: a second dispose call is a no-op (idempotent), and no
// other caller can race a half-disposed runtime.
export async function disposeSqlRuntime(db: ServerDatabase): Promise<void> {
  const runtime = runtimes.get(db);
  if (runtime === undefined) {
    return;
  }
  runtimes.delete(db);
  await runtime.dispose();
}

// Test layer: a fresh PGlite per use, started from a snapshot of a database
// migrated by `migrateSql`. The snapshot idea is the one `test-support.ts` uses;
// this copy exists so a module test can ask for a SQL client without going
// through `createTestContext`.
let migratedSnapshot: Promise<Blob> | undefined;

async function snapshotOfMigratedDatabase(): Promise<Blob> {
  const { PGlite } = await import('@electric-sql/pglite');
  const template = new PGlite();
  await migratePglite(template);
  const snapshot = await template.dumpDataDir('none');
  await template.close();
  return snapshot;
}

export async function freshMigratedPglite(): Promise<PGlite> {
  migratedSnapshot ??= snapshotOfMigratedDatabase();
  const { PGlite } = await import('@electric-sql/pglite');
  return new PGlite({ loadDataDir: await migratedSnapshot });
}

export const SqlTest: Layer.Layer<SqlClient.SqlClient, SqlError.SqlError> = Layer.unwrap(
  Effect.gen(function* () {
    const client = yield* Effect.acquireRelease(
      Effect.promise(() => freshMigratedPglite()),
      (pglite) => Effect.promise(() => pglite.close()),
    );
    return pgliteLayer(client);
  }),
);

// Loads `apps/server/drizzle/*.sql` as `effect/sql` migrations. The core
// loader only imports `.ts`/`.js` modules, so this reads the committed SQL
// files and runs every statement between the `--> statement-breakpoint`
// markers.
export function sqlFileLoader(directory: string): Migrator.Loader {
  return Effect.tryPromise({
    try: async () => {
      const entries = await readdir(directory);
      const migrations: Array<Migrator.ResolvedMigration> = [];
      for (const entry of entries) {
        const match = /^(\d+)_(.+)\.sql$/.exec(entry);
        if (match === null) {
          continue;
        }
        // The effect migrator treats migration_id 0 as "nothing applied": an
        // empty journal maps to 0 and every `id <= 0` is skipped. Offset the
        // file number so `0000_*.sql` becomes id 1 and nothing is lost.
        const id = Number(match[1] ?? '') + 1;
        const name = match[2] ?? '';
        const migration = Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const contents = yield* Effect.promise(() => readFile(join(directory, entry), 'utf8'));
          for (const raw of contents.split('--> statement-breakpoint')) {
            const statement = raw.trim().replace(/;\s*$/, '');
            if (statement.length > 0) {
              yield* sql.unsafe(statement);
            }
          }
        });
        migrations.push([id, name, Effect.succeed(migration)]);
      }
      return migrations.sort(([left], [right]) => left - right);
    },
    catch: (cause) =>
      new Migrator.MigrationError({
        kind: 'ImportError',
        message: `Failed to read migrations directory ${directory}`,
        cause,
      }),
  });
}

// Generic migrator: tracks applied migrations in `effect_sql_migrations` and
// runs only the pending ones. Dialect detection lives in the `SqlClient`, so
// the same call works against Postgres and PGlite.
export function runSqlMigrations(options: {
  loader: Migrator.Loader;
}): Effect.Effect<
  ReadonlyArray<readonly [id: number, name: string]>,
  Migrator.MigrationError | SqlError.SqlError,
  SqlClient.SqlClient
> {
  return Migrator.make({})({ loader: options.loader, table: SQL_MIGRATIONS_TABLE });
}

// One-time adoption seed (D3). A database drizzle already migrated has one row
// in `drizzle.__drizzle_migrations` per applied file, applied in file order.
// That count is the highest migration id already applied (file N is id N+1),
// so the effect journal gets it as its only row and the committed history is
// skipped. It runs only while the effect journal is empty, so every later
// start is a no-op. `drizzle.__drizzle_migrations` is only read, never written.
// Returns the adopted count the first time it seeds, `undefined` otherwise.
function adoptDrizzleJournal(): Effect.Effect<
  number | undefined,
  SqlError.SqlError,
  SqlClient.SqlClient
> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [drizzleJournal] = yield* sql<{ present: boolean }>`
      SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`;
    if (drizzleJournal?.present !== true) {
      return undefined;
    }
    const seeded = yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`CREATE TABLE IF NOT EXISTS ${sql(SQL_MIGRATIONS_TABLE)} (
          migration_id integer primary key,
          created_at timestamp with time zone not null default now(),
          name text not null
        )`;
        return yield* sql<{ migrationId: number }>`
          INSERT INTO ${sql(SQL_MIGRATIONS_TABLE)} (migration_id, name)
          SELECT (SELECT count(*)::int FROM drizzle.__drizzle_migrations), 'adopted-from-drizzle'
          WHERE NOT EXISTS (SELECT 1 FROM ${sql(SQL_MIGRATIONS_TABLE)})
          RETURNING migration_id`;
      }),
    );
    return seeded[0]?.migrationId;
  });
}

// The server's migrator (D3). It adopts a drizzle-migrated database, then runs
// each committed migration in id order. `runSqlMigrations` skips every id at
// or below the journal's latest and locks the journal table inside its own
// transaction, so one call per id commits each migration on its own: when a
// later migration fails, the earlier ones stay committed and journaled.
export function migrateSql(
  directory: string = migrationsFolder,
): Effect.Effect<
  ReadonlyArray<readonly [id: number, name: string]>,
  Migrator.MigrationError | SqlError.SqlError,
  SqlClient.SqlClient
> {
  return Effect.gen(function* () {
    const adopted = yield* adoptDrizzleJournal();
    if (adopted !== undefined) {
      yield* Effect.logInfo(`migrations: adopted ${adopted} drizzle migrations`);
    }
    const migrations = yield* sqlFileLoader(directory);
    const applied: Array<readonly [id: number, name: string]> = [];
    for (const [id] of migrations) {
      const migrated = yield* runSqlMigrations({
        loader: Effect.succeed(migrations.filter(([candidate]) => candidate === id)),
      });
      applied.push(...migrated);
    }
    return applied;
  });
}

// Runs `migrateSql` on a raw PGlite handle. The caller owns the handle and
// closes it.
export function migratePglite(
  pglite: PGlite,
): Promise<ReadonlyArray<readonly [id: number, name: string]>> {
  return Effect.runPromise(migrateSql().pipe(Effect.provide(pgliteLayer(pglite))));
}
