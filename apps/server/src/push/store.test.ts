import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedUser } from '../test-support/seed';
import { createPushCipher } from './crypto';
import {
  PUSH_MAX_DEVICES_PER_USER,
  openDevice,
  openNativeDevice,
  saveDevice,
  type SaveDeviceInput,
} from './store';

// A fixed storage key and clock: the cipher only needs any 32+ character
// string, and the exact `created_at` never matters here.
const STORAGE_KEY = 'test-push-storage-key-0000000000000000';
const cipher = createPushCipher(STORAGE_KEY);
const NOW = new Date('2026-06-01T12:00:00Z');

function webPushInput(userId: string, index: number, sessionId?: string): SaveDeviceInput {
  return {
    id: randomUUID(),
    userId,
    node: randomUUID(),
    kind: 'webpush',
    subscription: {
      endpoint: `https://push.example.com/${index}`,
      keys: { p256dh: `p256dh-${index}`, auth: `auth-${index}` },
    },
    userAgent: 'test-agent',
    now: NOW,
    ...(sessionId === undefined ? {} : { sessionId }),
  };
}

function nativeInput(
  userId: string,
  token: string,
  kind: 'fcm' | 'apns' = 'fcm',
  sessionId?: string,
): SaveDeviceInput {
  return {
    id: randomUUID(),
    userId,
    node: randomUUID(),
    kind,
    token,
    userAgent: 'test-agent',
    now: NOW,
    ...(sessionId === undefined ? {} : { sessionId }),
  };
}

async function rowsForUser(context: TestContext, userId: string) {
  return testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string; kind: string; token: string | null }>`SELECT id, kind, token
        FROM push_subscriptions WHERE user_id = ${userId} ORDER BY created_at`;
    }),
  );
}

// A `session` row for the FK behind `push_subscriptions.session_id`. The token
// is a placeholder (`session.token` is unique, never read here).
async function seedSession(context: TestContext, userId: string): Promise<string> {
  const id = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO "session" (id, expires_at, token, updated_at, user_id)
        VALUES (${id}, ${NOW}, ${`token-${id}`}, ${NOW}, ${userId})`;
    }),
  );
  return id;
}

async function deleteSession(context: TestContext, sessionId: string): Promise<void> {
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM "session" WHERE id = ${sessionId}`;
    }),
  );
}

async function sessionIdForToken(
  context: TestContext,
  userId: string,
  token: string,
): Promise<string | null> {
  const [row] = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ sessionId: string | null }>`SELECT session_id AS "sessionId"
        FROM push_subscriptions WHERE user_id = ${userId} AND token = ${token}`;
    }),
  );
  return row?.sessionId ?? null;
}

describe('push device store', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('round-trips a Web Push row unchanged', async () => {
    const userId = await seedUser(context);
    const saved = await saveDevice(context.db, cipher, webPushInput(userId, 1));

    expect(saved.kind).toBe('webpush');
    expect(saved.endpoint).toBe('https://push.example.com/1');
    expect(saved.token).toBeNull();

    expect(openDevice(cipher, saved)).toEqual({
      endpoint: 'https://push.example.com/1',
      keys: { p256dh: 'p256dh-1', auth: 'auth-1' },
    });
  });

  it('stores a native row and opens it through openNativeDevice', async () => {
    const userId = await seedUser(context);
    const saved = await saveDevice(context.db, cipher, nativeInput(userId, 'fcm-token-1', 'fcm'));

    expect(saved.kind).toBe('fcm');
    expect(saved.token).toBe('fcm-token-1');
    expect(saved.endpoint).toBeNull();
    expect(saved.p256dh).toBeNull();
    expect(saved.auth).toBeNull();

    expect(openNativeDevice(saved)).toEqual({ kind: 'fcm', token: 'fcm-token-1' });
  });

  it('keeps the 20-device cap across both kinds', async () => {
    const userId = await seedUser(context);
    for (let index = 0; index < PUSH_MAX_DEVICES_PER_USER - 1; index += 1) {
      await saveDevice(context.db, cipher, webPushInput(userId, index));
    }
    await saveDevice(context.db, cipher, nativeInput(userId, 'native-token-20'));

    await expect(
      saveDevice(context.db, cipher, nativeInput(userId, 'native-token-21')),
    ).rejects.toMatchObject({ status: 409, code: 'too_many_devices' });

    const rows = await rowsForUser(context, userId);
    expect(rows).toHaveLength(PUSH_MAX_DEVICES_PER_USER);
  });

  it('keeps one row, node and id across two registrations of the same token', async () => {
    const userId = await seedUser(context);
    const first = await saveDevice(context.db, cipher, nativeInput(userId, 'same-token', 'fcm'));
    const second = await saveDevice(context.db, cipher, nativeInput(userId, 'same-token', 'fcm'));

    const rows = await rowsForUser(context, userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(first.id);
    expect(second.id).toBe(first.id);
    expect(second.node).toBe(first.node);
  });

  it('keeps one row, node and id across two registrations of the same endpoint', async () => {
    const userId = await seedUser(context);
    const first = await saveDevice(context.db, cipher, webPushInput(userId, 7));
    const second = await saveDevice(context.db, cipher, webPushInput(userId, 7));

    const rows = await rowsForUser(context, userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(first.id);
    expect(second.id).toBe(first.id);
    expect(second.node).toBe(first.node);
  });

  it('moves a token to the second account that registers it', async () => {
    const userA = await seedUser(context);
    const userB = await seedUser(context);
    await saveDevice(context.db, cipher, nativeInput(userA, 'shared-token', 'fcm'));

    const saved = await saveDevice(context.db, cipher, nativeInput(userB, 'shared-token', 'fcm'));

    expect(await rowsForUser(context, userA)).toHaveLength(0);
    const rowsB = await rowsForUser(context, userB);
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]?.id).toBe(saved.id);
  });

  it('moves a Web Push endpoint to the second account that registers it', async () => {
    const userA = await seedUser(context);
    const userB = await seedUser(context);
    await saveDevice(context.db, cipher, webPushInput(userA, 9));

    const saved = await saveDevice(context.db, cipher, webPushInput(userB, 9));

    expect(await rowsForUser(context, userA)).toHaveLength(0);
    const rowsB = await rowsForUser(context, userB);
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]?.id).toBe(saved.id);
  });

  it("leaves the first account's other tokens untouched", async () => {
    const userA = await seedUser(context);
    const userB = await seedUser(context);
    await saveDevice(context.db, cipher, nativeInput(userA, 'kept-token', 'fcm'));
    await saveDevice(context.db, cipher, nativeInput(userA, 'shared-token', 'fcm'));

    await saveDevice(context.db, cipher, nativeInput(userB, 'shared-token', 'fcm'));

    const rowsA = await rowsForUser(context, userA);
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]?.token).toBe('kept-token');
  });

  it('rejects a row whose kind and shape disagree', async () => {
    const userId = await seedUser(context);
    await expect(
      testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO push_subscriptions
              (id, user_id, node, kind, endpoint, p256dh, auth, token, user_agent, created_at)
            VALUES (
              ${randomUUID()},
              ${userId},
              ${randomUUID()},
              ${'fcm'},
              ${'https://push.example.com/mismatched'},
              ${'p256dh'},
              ${'auth'},
              ${null},
              ${null},
              ${NOW}
            )`;
        }),
      ),
    ).rejects.toThrow();
  });

  it('stores an apns row with its own kind', async () => {
    const userId = await seedUser(context);
    const saved = await saveDevice(context.db, cipher, nativeInput(userId, 'apns-token', 'apns'));
    expect(saved.kind).toBe('apns');
    expect(openNativeDevice(saved)).toEqual({ kind: 'apns', token: 'apns-token' });
  });

  it('cascades a device away when its registering session is deleted', async () => {
    const userId = await seedUser(context);
    const sessionA = await seedSession(context, userId);
    const sessionB = await seedSession(context, userId);
    await saveDevice(context.db, cipher, nativeInput(userId, 'token-a', 'fcm', sessionA));
    await saveDevice(context.db, cipher, nativeInput(userId, 'token-b', 'fcm', sessionB));

    await deleteSession(context, sessionA);

    const rows = await rowsForUser(context, userId);
    expect(rows.map((row) => row.token)).toEqual(['token-b']);
  });

  it('moves a re-registered device to the session that registered it last', async () => {
    const userId = await seedUser(context);
    const sessionA = await seedSession(context, userId);
    const sessionB = await seedSession(context, userId);
    await saveDevice(context.db, cipher, nativeInput(userId, 'shared-token', 'fcm', sessionA));
    await saveDevice(context.db, cipher, nativeInput(userId, 'shared-token', 'fcm', sessionB));

    expect(await sessionIdForToken(context, userId, 'shared-token')).toBe(sessionB);
    // The device followed its token to B: deleting A leaves it in place.
    await deleteSession(context, sessionA);
    expect(await rowsForUser(context, userId)).toHaveLength(1);
  });

  it('leaves a legacy NULL-session row untouched by a session delete', async () => {
    const userId = await seedUser(context);
    const sessionA = await seedSession(context, userId);
    await saveDevice(context.db, cipher, nativeInput(userId, 'legacy-token', 'fcm'));

    await deleteSession(context, sessionA);

    const rows = await rowsForUser(context, userId);
    expect(rows.map((row) => row.token)).toEqual(['legacy-token']);
  });
});
