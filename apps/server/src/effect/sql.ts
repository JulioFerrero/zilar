// The `effect/sql` entry point: one place builds the client (pg in production,
// pglite in tests) and runs queries through it. Columns are camelCased by
// `transformResultNames`; `sql.withTransaction` makes every statement use the
// transaction connection; advisory locks stay raw SQL inside it. Exported
// functions are `async` over `ManagedRuntime.runPromise`.

import type { PGlite } from '@electric-sql/pglite';
import { PgClient } from '@effect/sql-pg';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, Layer, ManagedRuntime, Redacted } from 'effect';
import { Migrator, SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';

export const SQL_POOL_MAX = 10;
export const SQL_MIGRATIONS_TABLE = 'effect_sql_migrations';

// `apps/server/drizzle`. From source this file is in `src/effect/`; the bundle
// is `dist/index.mjs`, one level down.
export const migrationsFolder = fileURLToPath(
  new URL(import.meta.url.endsWith('.ts') ? '../../drizzle' : '../drizzle', import.meta.url),
);

export type SqlRuntime = ManagedRuntime.ManagedRuntime<SqlClient.SqlClient, SqlError.SqlError>;

export function snakeToCamel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

// A production key is the plain `{ kind: 'postgres', url }` record; anything else
// is a test's PGlite. No `instanceof`, so production never loads PGlite.
export function isPgliteDatabase(db: ServerDatabase): db is PGlite {
  return !('kind' in db && db.kind === 'postgres');
}

// PGlite is a devDependency, so it loads on demand and only on the test path.
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

// A jsonb value is data: its keys must read back as written, so
// `transformJson: false` stops the driver renaming them too.

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
 * Runs an effect on the runtime registered for `db`.
 */
export function runSql<A, E>(
  db: ServerDatabase,
  effect: Effect.Effect<A, E, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

// Forgets the runtime first, so a second dispose is a no-op and no caller can
// race a half-disposed one; a later `sqlRuntimeFor` throws instead of handing
// back a closed pool.
export async function disposeSqlRuntime(db: ServerDatabase): Promise<void> {
  const runtime = runtimes.get(db);
  if (runtime === undefined) {
    return;
  }
  runtimes.delete(db);
  await runtime.dispose();
}

// Reads the committed `.sql` files (the core loader only imports modules) and
// runs each statement between the `--> statement-breakpoint` markers.
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
        // The migrator treats id 0 as "nothing applied", so offset the file number:
        // `0000_*.sql` becomes id 1 and nothing is lost.
        const id = Number(match[1] ?? '') + 1;
        const name = match[2] ?? '';
        const migration = Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const contents = yield* Effect.promise(() => readFile(join(directory, entry), 'utf8'));
          // Each migration gets its own transaction, so `SET LOCAL` scopes the lock
          // wait to it and resets at commit; a plain `SET` would leak the timeout
          // onto the session's later queries.
          yield* sql.unsafe("SET LOCAL lock_timeout = '5s'");
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

// Tracks applied migrations in `effect_sql_migrations` and runs the pending
// ones; dialect detection lives in the `SqlClient`.
export function runSqlMigrations(options: {
  loader: Migrator.Loader;
}): Effect.Effect<
  ReadonlyArray<readonly [id: number, name: string]>,
  Migrator.MigrationError | SqlError.SqlError,
  SqlClient.SqlClient
> {
  return Migrator.make({})({ loader: options.loader, table: SQL_MIGRATIONS_TABLE });
}

// Adoption seed: a drizzle-migrated database has one `__drizzle_migrations` row
// per applied file, and that count is the highest id already applied (file N is
// id N+1). It seeds that count as the only journal row, only while the journal
// is empty, and never writes `drizzle.__drizzle_migrations`.
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

// The migrator skips every id at or below the latest applied one, so a file
// numbered below the tip and missing from the journal never runs. Warn for each
// so the gap is visible at start.
function warnSkippedMigrations(
  migrations: ReadonlyArray<Migrator.ResolvedMigration>,
): Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [journal] = yield* sql<{ present: boolean }>`
      SELECT to_regclass(${SQL_MIGRATIONS_TABLE}) IS NOT NULL AS present`;
    if (journal?.present !== true) {
      return;
    }
    const rows = yield* sql<{ migrationId: number; name: string }>`
      SELECT migration_id, name FROM ${sql(SQL_MIGRATIONS_TABLE)} ORDER BY migration_id DESC`;
    const applied = new Set(rows.map((row) => row.migrationId));
    // Adoption seeds one row at the drizzle tip; every id up to it was applied by
    // drizzle and is not journaled row by row, so that prefix is not a gap.
    const adopted = rows.find((row) => row.name === 'adopted-from-drizzle');
    const appliedThrough = adopted?.migrationId ?? 0;
    const latest = Math.max(0, ...applied);
    for (const [id, name] of migrations) {
      if (id <= latest && id > appliedThrough && !applied.has(id)) {
        yield* Effect.logWarning(
          `migrations: ${String(id - 1).padStart(4, '0')}_${name}.sql (id ${id}) is at or below the latest applied id ${latest} and is not journaled; it will not run`,
        );
      }
    }
  });
}

// Adopts a drizzle-migrated database, then runs each migration in id order, one
// transaction per id: when a later migration fails, the earlier ones stay
// committed and journaled.
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
    // A read-only warning must never keep the server from starting; the
    // migrations below still fail loudly.
    yield* warnSkippedMigrations(migrations).pipe(
      Effect.catchCause(() => Effect.logWarning('migrations: could not check for skipped files')),
    );
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

// The caller owns the PGlite handle and closes it.
export function migratePglite(
  pglite: PGlite,
): Promise<ReadonlyArray<readonly [id: number, name: string]>> {
  return Effect.runPromise(migrateSql().pipe(Effect.provide(pgliteLayer(pglite))));
}
