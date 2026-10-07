import { PGlite } from '@electric-sql/pglite';
import { PgliteClient } from '@effect/sql-pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { Effect, ManagedRuntime } from 'effect';
import { SqlClient } from 'effect/sql';
import { describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../db/migrate';
import * as schema from '../db/schema';
import {
  SQL_MIGRATIONS_TABLE,
  SqlTest,
  runSqlMigrations,
  snakeToCamel,
  sqlFileLoader,
} from './sql';

function runtimeFor(pglite: PGlite) {
  return ManagedRuntime.make(
    PgliteClient.layer({ liveClient: pglite, transformResultNames: snakeToCamel }),
  );
}

async function countRows(pglite: PGlite, table: string): Promise<number> {
  const result = await pglite.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM ${table}`,
  );
  return result.rows[0]?.total ?? -1;
}

describe('effect/sql', () => {
  it('provides a migrated PGlite client through the SqlTest layer', async () => {
    const program = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{
        total: number;
      }>`SELECT count(*)::int AS total FROM pinned_messages`;
      return rows[0]?.total;
    });
    const total = await Effect.runPromise(Effect.provide(program, SqlTest));
    expect(total).toBe(0);
  });

  it('adopts a database drizzle already migrated without re-running the history', async () => {
    const pglite = new PGlite();
    await runMigrations(drizzle(pglite, { schema }));
    expect(await countRows(pglite, 'drizzle.__drizzle_migrations')).toBe(46);

    // One-time adoption: seed the effect migrator's journal with the highest
    // migration id drizzle applied. Its rule is `id <= latest` is skipped, so
    // no committed SQL runs again.
    await pglite.exec(`
      CREATE TABLE IF NOT EXISTS ${SQL_MIGRATIONS_TABLE} (
        migration_id integer primary key,
        created_at timestamp with time zone not null default now(),
        name text not null
      );
      INSERT INTO ${SQL_MIGRATIONS_TABLE} (migration_id, name)
      SELECT (SELECT count(*)::int FROM drizzle.__drizzle_migrations), 'adopted-from-drizzle'
      WHERE NOT EXISTS (SELECT 1 FROM ${SQL_MIGRATIONS_TABLE});
    `);

    const runtime = runtimeFor(pglite);
    const completed = await runtime.runPromise(
      runSqlMigrations({ loader: sqlFileLoader(migrationsFolder) }),
    );
    await runtime.dispose();

    expect(completed).toHaveLength(0);
    expect(await countRows(pglite, 'pinned_messages')).toBe(0);
    await pglite.close();
  });

  it('runs the committed drizzle SQL from empty with the effect/sql migrator', async () => {
    const pglite = new PGlite();
    const runtime = runtimeFor(pglite);
    const completed = await runtime.runPromise(
      runSqlMigrations({ loader: sqlFileLoader(migrationsFolder) }),
    );
    await runtime.dispose();

    expect(completed).toHaveLength(46);
    expect(await countRows(pglite, 'pinned_messages')).toBe(0);
    await pglite.close();
  });
});
