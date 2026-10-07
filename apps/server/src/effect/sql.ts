// T-0496: the `effect/sql` entry point for the server. One place builds the
// SQL client (`@effect/sql-pg` in production, `@effect/sql-pglite` in tests
// and for the migration adoption check) and runs the pins pilot through it.
//
// Convention while drizzle is still around:
// - run a query with the `sql` tagged template: `` yield* sql<Row>`SELECT ...` ``;
//   the statement is an Effect, so `yield*` executes it and returns rows.
// - result columns are camelCased by `transformResultNames`, matching the
//   drizzle row types the rest of the module already passes around.
// - run a transaction with `sql.withTransaction(effect)`; every statement in
//   the effect uses the transaction connection.
// - advisory locks stay raw SQL inside the transaction:
//   `` yield* sql`SELECT pg_advisory_xact_lock(hashtext(${key}))` ``.
// - keep the module's exported functions `async` and surface them through
//   `ManagedRuntime.runPromise`, so routes and existing tests do not change.

import { PGlite } from '@electric-sql/pglite';
import { PgliteClient } from '@effect/sql-pglite';
import { PgClient } from '@effect/sql-pg';
import { drizzle } from 'drizzle-orm/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Config, Effect, Layer, ManagedRuntime, Redacted } from 'effect';
import { Migrator, SqlClient, SqlError } from 'effect/sql';
import type { PgliteServerDatabase, ServerDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import * as schema from '../db/schema';

export const SQL_POOL_MAX = 10;
export const SQL_MIGRATIONS_TABLE = 'effect_sql_migrations';

export type SqlRuntime = ManagedRuntime.ManagedRuntime<SqlClient.SqlClient, SqlError.SqlError>;

// The columns the server stores are snake_case; the drizzle row types other
// modules still use are camelCase. The client transforms result names once so
// the two halves of the transition agree on the row shape.
export function snakeToCamel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

export function isPgliteDatabase(db: ServerDatabase): db is PgliteServerDatabase {
  return typeof db.$client !== 'function';
}

// Production: one pool of `SQL_POOL_MAX` from `DATABASE_URL`, matching the
// postgres-js pool `createDb` used to open.
export const SqlLive: Layer.Layer<SqlClient.SqlClient, Config.ConfigError | SqlError.SqlError> =
  PgClient.layerConfig(
    Config.all({
      url: Config.Redacted('DATABASE_URL'),
      maxConnections: Config.succeed(SQL_POOL_MAX),
      transformResultNames: Config.succeed(snakeToCamel),
    }),
  );

// Transition wiring: the pins module gets a `SqlClient` on the same database
// the app already has. Tests hand it a drizzle-wrapped PGlite, production a
// `DATABASE_URL`; either way the module reads through this layer and no route
// or test has to learn about `effect/sql`.
export function sqlLayerFor(
  db: ServerDatabase,
  databaseUrl: string,
): Layer.Layer<SqlClient.SqlClient, SqlError.SqlError> {
  if (isPgliteDatabase(db)) {
    // `db/client.ts` widens `$client` to `unknown`; for a PGlite handle it is
    // the live `PGlite` instance created by `test-support.ts`.
    return PgliteClient.layer({
      liveClient: db.$client as PGlite,
      transformResultNames: snakeToCamel,
    });
  }
  return PgClient.layer({
    url: Redacted.make(databaseUrl),
    maxConnections: SQL_POOL_MAX,
    transformResultNames: snakeToCamel,
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
// migrated by drizzle. The snapshot idea is the one `test-support.ts` uses;
// this copy exists so a module test can ask for a SQL client without going
// through `createTestContext`.
let migratedSnapshot: Promise<Blob> | undefined;

async function snapshotOfMigratedDatabase(): Promise<Blob> {
  const template = new PGlite();
  await runMigrations(drizzle(template, { schema }));
  const snapshot = await template.dumpDataDir('none');
  await template.close();
  return snapshot;
}

export async function freshMigratedPglite(): Promise<PGlite> {
  migratedSnapshot ??= snapshotOfMigratedDatabase();
  return new PGlite({ loadDataDir: await migratedSnapshot });
}

export const SqlTest: Layer.Layer<SqlClient.SqlClient, SqlError.SqlError> = Layer.unwrap(
  Effect.gen(function* () {
    const client = yield* Effect.acquireRelease(
      Effect.promise(() => freshMigratedPglite()),
      (pglite) => Effect.promise(() => pglite.close()),
    );
    return PgliteClient.layer({ liveClient: client, transformResultNames: snakeToCamel });
  }),
);

// Loads `apps/server/drizzle/*.sql` as `effect/sql` migrations. The core
// loader only imports `.ts`/`.js` modules, so this reads the committed SQL
// files and runs every statement between drizzle's `--> statement-breakpoint`
// markers. Used to test adoption on a PGlite that drizzle already migrated.
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
