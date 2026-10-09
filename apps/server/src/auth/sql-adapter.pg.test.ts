import { randomUUID } from 'node:crypto';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createDb, type DbClient, type ServerDatabase } from '../db/client';
import * as schema from '../db/schema';
import { disposeSqlRuntime, registerSqlRuntime, sqlRuntimeFor } from '../effect/sql';
import { effectSqlAdapter } from './sql-adapter';

/**
 * The gated check for the effect/sql auth adapter on real Postgres. It writes
 * and reads `verification` rows through the adapter and through `drizzleAdapter`
 * (the one `auth.ts` uses today), under a Madrid process time zone, and checks
 * that every read returns the same instant. It deletes only the rows it created.
 *
 * Required env vars:
 *   ZILAR_PG_INTEGRATION=1                  (turns the test on)
 *   DATABASE_URL=<postgres url>             (must point at 127.0.0.1 or localhost)
 *
 *   ZILAR_PG_INTEGRATION=1 DATABASE_URL=<url> TZ=Europe/Madrid \
 *   pnpm --filter @zilar/server test --maxWorkers=1 --reporter=dot src/auth/sql-adapter.pg.test
 */

const ENABLED = process.env['ZILAR_PG_INTEGRATION'] === '1';
const DATABASE_URL = process.env['DATABASE_URL'];
const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];
const TEST_TIME_ZONE = 'Europe/Madrid';

// 12:34:56 UTC is 13:34:56 in Madrid, so a host-offset shift shows up as a
// different instant.
const EXPIRES_AT = new Date('2030-03-10T12:34:56.789Z');
const EXPIRES_AT_WALL_CLOCK = '2030-03-10 12:34:56.789';

describe.skipIf(!ENABLED)('effectSqlAdapter on real Postgres', () => {
  let client: DbClient | undefined;
  let savedTimeZone: string | undefined;
  const createdIdentifiers: string[] = [];

  function db(): ServerDatabase {
    if (client === undefined) {
      throw new Error('The Postgres test client was not opened');
    }
    return client.db;
  }

  function effectAdapter() {
    return effectSqlAdapter(db())({});
  }

  function drizzleAuth() {
    return drizzleAdapter(db(), { provider: 'pg', schema })({});
  }

  // Identifiers are random per run and recorded before the insert, so a failed
  // run still deletes its rows. better-auth assigns each row its own `id`, so
  // the rows are found by this identifier.
  function newIdentifier(): string {
    const identifier = `pg-test-${randomUUID()}`;
    createdIdentifiers.push(identifier);
    return identifier;
  }

  function storedWallClock(id: string): Promise<string | undefined> {
    return sqlRuntimeFor(db()).runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<{
          wall: string;
        }>`SELECT expires_at::text AS wall FROM verification WHERE id = ${id}`;
        return rows[0]?.wall;
      }),
    );
  }

  beforeAll(() => {
    if (DATABASE_URL === undefined) {
      throw new Error('DATABASE_URL must point at the local dev Postgres');
    }
    const { hostname } = new URL(DATABASE_URL);
    if (!LOCAL_HOSTS.includes(hostname)) {
      throw new Error(`Refusing to run the Postgres test against host ${hostname}`);
    }
    savedTimeZone = process.env['TZ'];
    process.env['TZ'] = TEST_TIME_ZONE;
    // January in Madrid is UTC+1, so the offset must be -60 for the zone to bite.
    expect(new Date(2030, 0, 15).getTimezoneOffset()).toBe(-60);

    client = createDb(DATABASE_URL);
    registerSqlRuntime(client.db, DATABASE_URL);
  });

  afterAll(async () => {
    if (client !== undefined) {
      const adapter = effectAdapter();
      for (const identifier of createdIdentifiers) {
        await adapter.deleteMany({
          model: 'verification',
          where: [{ field: 'identifier', value: identifier }],
        });
      }
      await disposeSqlRuntime(client.db);
      await client.close();
    }
    if (savedTimeZone === undefined) {
      delete process.env['TZ'];
    } else {
      process.env['TZ'] = savedTimeZone;
    }
  });

  it('round trips expiresAt through the adapter and stores the UTC wall clock', async () => {
    const created = await effectAdapter().create<{
      id: string;
      identifier: string;
      value: string;
      expiresAt: Date;
    }>({
      model: 'verification',
      data: { identifier: newIdentifier(), value: 'code', expiresAt: EXPIRES_AT },
    });
    expect(created.expiresAt.toISOString()).toBe(EXPIRES_AT.toISOString());

    const found = await effectAdapter().findOne<{ expiresAt: Date }>({
      model: 'verification',
      where: [{ field: 'id', value: created.id }],
    });
    expect(found?.expiresAt.toISOString()).toBe(EXPIRES_AT.toISOString());
    expect(await storedWallClock(created.id)).toBe(EXPIRES_AT_WALL_CLOCK);
  });

  it('reads a verification row written by drizzleAdapter at the same instant', async () => {
    const identifier = newIdentifier();
    await drizzleAuth().create({
      model: 'verification',
      data: { identifier, value: 'code', expiresAt: EXPIRES_AT },
    });

    const found = await effectAdapter().findOne<{ expiresAt: Date }>({
      model: 'verification',
      where: [{ field: 'identifier', value: identifier }],
    });
    expect(found?.expiresAt.toISOString()).toBe(EXPIRES_AT.toISOString());
  });

  it('reads a verification row written by the adapter through drizzleAdapter at the same instant', async () => {
    const identifier = newIdentifier();
    await effectAdapter().create({
      model: 'verification',
      data: { identifier, value: 'code', expiresAt: EXPIRES_AT },
    });

    const found = await drizzleAuth().findOne<{ expiresAt: Date }>({
      model: 'verification',
      where: [{ field: 'identifier', value: identifier }],
    });
    expect(found?.expiresAt.toISOString()).toBe(EXPIRES_AT.toISOString());
  });
});
