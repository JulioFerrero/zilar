import { randomUUID } from 'node:crypto';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerConfig } from '../config';
import { loadServerConfig } from '../config';
import { createDb, type DbClient, type ServerDatabase } from '../db/client';
import * as schema from '../db/schema';
import { disposeSqlRuntime, registerSqlRuntime, sqlRuntimeFor } from '../effect/sql';
import {
  FakeAdminClient,
  TEST_SECRET,
  TEST_XMPP_JWT_SECRET,
  TEST_XMPP_WS_URL,
  TestMailer,
} from '../test-support';
import { createAuth, INVITE_HEADER, type Auth } from './auth';
import { createInvite } from './invites';
import { effectSqlAdapter } from './sql-adapter';

/**
 * The gated check for the effect/sql auth adapter on real Postgres. It writes
 * and reads `verification` rows through the adapter and through `drizzleAdapter`
 * (the adapter `auth.ts` used before T-0738), under a Madrid process time zone,
 * and checks that every read returns the same instant. It also runs a full
 * email-OTP sign-up and sign-in through `createAuth` on real Postgres. It deletes
 * only the rows it created.
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
const AUTH_BASE_URL = 'http://localhost:3000';
// better-auth's default session lifetime (7 days), which `createAuth` does not override.
const SESSION_LIFETIME_MS = 60 * 60 * 24 * 7 * 1000;
// A host-offset shift is an hour or more, so a minute of slack still catches it.
const SESSION_EXPIRY_TOLERANCE_MS = 60 * 1000;
const BOUNDARY_WINDOW_MS = 10 * 60 * 1000;

// 12:34:56 UTC is 13:34:56 in Madrid, so a host-offset shift shows up as a
// different instant.
const EXPIRES_AT = new Date('2030-03-10T12:34:56.789Z');
const EXPIRES_AT_WALL_CLOCK = '2030-03-10 12:34:56.789';

// Only the fields `createAuth` reads. The database URL is a placeholder: the
// test's real client is built from DATABASE_URL, and this config never opens it.
function pgTestConfig(): ServerConfig {
  return loadServerConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://test:CHANGE_ME@127.0.0.1:5432/zilar',
    BETTER_AUTH_SECRET: TEST_SECRET,
    PUBLIC_URL: AUTH_BASE_URL,
    EJABBERD_API_URL: 'http://127.0.0.1:5280/api',
    EJABBERD_ADMIN_JID: 'admin@zilar.localhost',
    EJABBERD_ADMIN_PASSWORD: 'admin-password',
    XMPP_WS_PUBLIC_URL: TEST_XMPP_WS_URL,
    ZILAR_XMPP_JWT_SECRET: TEST_XMPP_JWT_SECRET,
  });
}

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

  function authFor(mailer: TestMailer): Auth {
    return createAuth({
      db: db(),
      config: pgTestConfig(),
      mailer,
      adminClient: new FakeAdminClient(),
    });
  }

  function authPost(
    auth: Auth,
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    return auth.handler(
      new Request(`${AUTH_BASE_URL}/api/auth${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '10.20.30.40',
          ...headers,
        },
        body: JSON.stringify(body),
      }),
    );
  }

  // The user's sessions, read through the adapter the way better-auth reads them.
  // With `expiresBetween`, only sessions expiring strictly inside that window match.
  async function sessionsFor(
    email: string,
    expiresBetween?: readonly [Date, Date],
  ): Promise<Array<{ expiresAt: Date }>> {
    const user = await effectAdapter().findOne<{ id: string }>({
      model: 'user',
      where: [{ field: 'email', value: email }],
    });
    if (user === null) {
      throw new Error('expected the signed-up user row');
    }
    const expiryWhere =
      expiresBetween === undefined
        ? []
        : [
            { field: 'expiresAt', operator: 'gt' as const, value: expiresBetween[0] },
            { field: 'expiresAt', operator: 'lt' as const, value: expiresBetween[1] },
          ];
    return effectAdapter().findMany<{ expiresAt: Date }>({
      model: 'session',
      where: [{ field: 'userId', value: user.id }, ...expiryWhere],
      limit: 10,
    });
  }

  // Removes only what the sign-up created: the user (its sessions, accounts,
  // XMPP account and invite link cascade), the invite and the OTP rows for this email.
  async function deleteOwnRows(email: string, inviteId: string): Promise<void> {
    await effectAdapter().deleteMany({
      model: 'verification',
      where: [{ field: 'identifier', operator: 'contains', value: email }],
    });
    await effectAdapter().deleteMany({ model: 'user', where: [{ field: 'email', value: email }] });
    await sqlRuntimeFor(db()).runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM invites WHERE id = ${inviteId}`;
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

  it('signs up and back in with an email OTP through createAuth, with the session expiry at now plus the lifetime', async () => {
    const email = `pg-otp-${randomUUID()}@example.com`;
    const invite = await createInvite(db(), { createdBy: null });
    const mailer = new TestMailer();
    const auth = authFor(mailer);
    try {
      const sentForSignUp = await authPost(
        auth,
        '/email-otp/send-verification-otp',
        { email, type: 'sign-in' },
        { [INVITE_HEADER]: invite.code },
      );
      expect(sentForSignUp.status).toBe(200);

      const signUp = await authPost(
        auth,
        '/sign-in/email-otp',
        { email, otp: mailer.codeFor(email) },
        { [INVITE_HEADER]: invite.code },
      );
      expect(signUp.status).toBe(200);
      expect(
        signUp.headers
          .getSetCookie()
          .some((cookie) => cookie.includes('better-auth.session_token=')),
      ).toBe(true);

      const [session] = await sessionsFor(email);
      expect(session).toBeDefined();
      const expiry = session?.expiresAt.getTime() ?? 0;
      expect(Math.abs(expiry - (Date.now() + SESSION_LIFETIME_MS))).toBeLessThan(
        SESSION_EXPIRY_TOLERANCE_MS,
      );
      // A Date in a where clause must compare at the same instant as the stored
      // row: the session matches a window of ten minutes either side of its expiry.
      expect(
        await sessionsFor(email, [
          new Date(expiry - BOUNDARY_WINDOW_MS),
          new Date(expiry + BOUNDARY_WINDOW_MS),
        ]),
      ).toHaveLength(1);

      const sentForSignIn = await authPost(auth, '/email-otp/send-verification-otp', {
        email,
        type: 'sign-in',
      });
      expect(sentForSignIn.status).toBe(200);
      const signIn = await authPost(auth, '/sign-in/email-otp', {
        email,
        otp: mailer.codeFor(email),
      });
      expect(signIn.status).toBe(200);
      expect(await sessionsFor(email)).toHaveLength(2);
    } finally {
      await deleteOwnRows(email, invite.id);
    }
  });
});
