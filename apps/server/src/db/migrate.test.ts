import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PgliteServerDatabase } from './client';
import { runMigrations } from './migrate';
import * as schema from './schema';
import { serverMeta } from './schema';

describe('runMigrations', () => {
  let client: PGlite;
  let db: PgliteServerDatabase;

  beforeEach(() => {
    client = new PGlite();
    db = drizzle(client, { schema });
  });

  afterEach(async () => {
    await client.close();
  });

  it('creates the server_meta table', async () => {
    await runMigrations(db);

    const result = await client.query<{ table: string | null }>(
      "select to_regclass('public.server_meta') as table",
    );
    expect(result.rows[0]?.table).toBe('server_meta');
  });

  it('round-trips an insert and a select', async () => {
    await runMigrations(db);

    await db.insert(serverMeta).values({ key: 'greeting', value: 'hello' });
    const rows = await db.select().from(serverMeta);

    expect(rows).toEqual([{ key: 'greeting', value: 'hello', updatedAt: expect.any(Date) }]);
  });

  it('is a no-op when run twice', async () => {
    await runMigrations(db);
    await db.insert(serverMeta).values({ key: 'greeting', value: 'hello' });

    await runMigrations(db);

    const rows = await db.select().from(serverMeta);
    expect(rows).toHaveLength(1);
  });
});
