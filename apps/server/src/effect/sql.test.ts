import { PGlite } from '@electric-sql/pglite';
import { PgliteClient } from '@effect/sql-pglite';
import { Effect, ManagedRuntime } from 'effect';
import { SqlClient } from 'effect/sql';
import { copyFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SQL_MIGRATIONS_TABLE,
  SqlTest,
  disposeSqlRuntime,
  freshMigratedPglite,
  migratePglite,
  migrateSql,
  migrationsFolder,
  registerSqlRuntime,
  snakeToCamel,
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

async function journalIds(pglite: PGlite): Promise<Array<number>> {
  const result = await pglite.query<{ migration_id: number }>(
    `SELECT migration_id FROM ${SQL_MIGRATIONS_TABLE} ORDER BY migration_id`,
  );
  return result.rows.map((row) => row.migration_id);
}

// Runs `migrateSql` on a PGlite through a runtime that is disposed afterwards.
async function migrateWithSql(pglite: PGlite, directory: string = migrationsFolder) {
  const runtime = runtimeFor(pglite);
  try {
    return await runtime.runPromise(migrateSql(directory));
  } finally {
    await runtime.dispose();
  }
}

const tempDirs: Array<string> = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function newTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'zilar-sql-migrations-'));
  tempDirs.push(dir);
  return dir;
}

// A temp folder holding the first `count` committed migration files, in order.
async function committedMigrationsUpTo(count: number): Promise<string> {
  const folder = await newTempDir();
  const files = (await readdir(migrationsFolder)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of files.slice(0, count)) {
    await copyFile(join(migrationsFolder, name), join(folder, name));
  }
  return folder;
}

// Makes `pglite` look like a database drizzle migrated up to `count` committed
// migrations: the first `count` files run through `migrateSql`, then the effect
// journal is dropped and drizzle's journal table gets one row per file.
async function drizzleMigrated(pglite: PGlite, count: number): Promise<void> {
  await migrateWithSql(pglite, await committedMigrationsUpTo(count));
  await pglite.exec(`DROP TABLE ${SQL_MIGRATIONS_TABLE}`);
  await pglite.exec('CREATE SCHEMA drizzle');
  await pglite.exec(
    'CREATE TABLE drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)',
  );
  await pglite.exec(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    SELECT 'hash-' || n, n FROM generate_series(1, ${count}) AS n`);
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

  it('keeps jsonb keys as written and only camelCases column names', async () => {
    const pglite = await freshMigratedPglite();
    const runtime = registerSqlRuntime(pglite, '');
    try {
      const stored = { max_items: 2, nested_key: { inner_key: 1 } };
      const rows = await runtime.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`CREATE TEMP TABLE jsonb_probe (id text, payload_column jsonb)`;
          yield* sql`INSERT INTO jsonb_probe (id, payload_column)
            VALUES ('one', ${JSON.stringify(stored)}::jsonb)`;
          return yield* sql<{
            id: string;
            payloadColumn: typeof stored;
          }>`SELECT * FROM jsonb_probe`;
        }),
      );
      expect(rows).toHaveLength(1);
      // The column name is camelCased, the jsonb keys are untouched.
      expect(rows[0]?.payloadColumn).toEqual(stored);
    } finally {
      await disposeSqlRuntime(pglite);
      await pglite.close();
    }
  });

  it('keeps jsonb keys as written through the SqlTest layer too', async () => {
    const stored = { max_items: 2, nested_key: { inner_key: 1 } };
    const program = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TEMP TABLE jsonb_layer_probe (id text, payload_column jsonb)`;
      yield* sql`INSERT INTO jsonb_layer_probe (id, payload_column)
        VALUES ('one', ${JSON.stringify(stored)}::jsonb)`;
      const rows = yield* sql<{
        payloadColumn: typeof stored;
      }>`SELECT * FROM jsonb_layer_probe`;
      return rows[0]?.payloadColumn;
    });
    const value = await Effect.runPromise(Effect.provide(program, SqlTest));
    expect(value).toEqual(stored);
  });

  it('adopts a database drizzle already migrated without re-running the history', async () => {
    const pglite = new PGlite();
    try {
      await drizzleMigrated(pglite, 46);
      expect(await countRows(pglite, 'drizzle.__drizzle_migrations')).toBe(46);

      const applied = await migrateWithSql(pglite);

      expect(applied).toEqual([]);
      expect(await countRows(pglite, 'pinned_messages')).toBe(0);
      // The seed records the highest drizzle id and leaves drizzle's journal alone.
      expect(await journalIds(pglite)).toEqual([46]);
      expect(await countRows(pglite, 'drizzle.__drizzle_migrations')).toBe(46);
    } finally {
      await pglite.close();
    }
  });

  it('applies only the committed migrations drizzle had not applied', async () => {
    const pglite = new PGlite();
    try {
      await drizzleMigrated(pglite, 41);
      expect(await countRows(pglite, 'drizzle.__drizzle_migrations')).toBe(41);

      const applied = await migrateWithSql(pglite);

      expect(applied.map(([id]) => id)).toEqual([42, 43, 44, 45, 46]);
      // 0045 creates the ai_delegations table.
      const table = await pglite.query<{ table: string | null }>(
        "select to_regclass('public.ai_delegations') as table",
      );
      expect(table.rows[0]?.table).toBe('ai_delegations');
    } finally {
      await pglite.close();
    }
  });

  it('runs the committed drizzle SQL from empty and journals all 46 migrations', async () => {
    const pglite = new PGlite();
    try {
      const applied = await migratePglite(pglite);

      expect(applied.map(([id]) => id)).toEqual(Array.from({ length: 46 }, (_, i) => i + 1));
      expect(await countRows(pglite, 'pinned_messages')).toBe(0);
      expect(await countRows(pglite, SQL_MIGRATIONS_TABLE)).toBe(46);
      // Nothing in this path touches drizzle's journal table.
      const journal = await pglite.query<{ table: string | null }>(
        "select to_regclass('drizzle.__drizzle_migrations') as table",
      );
      expect(journal.rows[0]?.table).toBeNull();
    } finally {
      await pglite.close();
    }
  });

  it('commits each migration on its own, so a failing one leaves the earlier ones journaled', async () => {
    const folder = await newTempDir();
    await writeFile(join(folder, '0000_first_probe.sql'), 'CREATE TABLE first_probe (id integer);');
    await writeFile(join(folder, '0001_broken_probe.sql'), 'CREATE TABLE broken_probe (');
    const pglite = new PGlite();
    try {
      await expect(migrateWithSql(pglite, folder)).rejects.toThrow();

      expect(await journalIds(pglite)).toEqual([1]);
      expect(await countRows(pglite, 'first_probe')).toBe(0);
      const broken = await pglite.query<{ table: string | null }>(
        "select to_regclass('public.broken_probe') as table",
      );
      expect(broken.rows[0]?.table).toBeNull();
    } finally {
      await pglite.close();
    }
  });

  it('applies nothing on a second run and journals exactly one adoption row', async () => {
    const pglite = new PGlite();
    try {
      await drizzleMigrated(pglite, 41);
      expect(await migrateWithSql(pglite)).toHaveLength(5);

      expect(await migrateWithSql(pglite)).toEqual([]);
      const adopted = await pglite.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM ${SQL_MIGRATIONS_TABLE} WHERE name = 'adopted-from-drizzle'`,
      );
      expect(adopted.rows[0]?.total).toBe(1);
      expect(await journalIds(pglite)).toEqual([41, 42, 43, 44, 45, 46]);
    } finally {
      await pglite.close();
    }
  });
});
