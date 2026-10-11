import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import {
  bootstrapUser,
  createTestContext,
  testSql,
  TEST_BASE_URL,
  type TestContext,
} from '../test-support';
import { loadPushConfig } from './config';

// Push must clear `requirePush`: the flag, the VAPID keys, the component
// credentials and a 32+ character storage key. None of these are real.
const PUSH_ENV = {
  PUSH_ENABLED: 'true',
  PUSH_VAPID_PUBLIC_KEY: 'test-vapid-public',
  PUSH_VAPID_PRIVATE_KEY: 'test-vapid-private',
  PUSH_VAPID_SUBJECT: 'mailto:test@example.com',
  PUSH_COMPONENT_JID: 'push@zilar.localhost',
  PUSH_COMPONENT_SECRET: 'test-component-secret',
  PUSH_STORAGE_KEY: 'test-push-storage-key-0000000000000000',
};

interface DeviceRow {
  kind: string;
  token: string | null;
  endpoint: string | null;
  userAgent: string | null;
  node: string;
}

describe('POST /api/push/subscriptions', () => {
  let context: TestContext;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    context = await createTestContext();
    app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      push: loadPushConfig(PUSH_ENV),
    });
  });

  afterEach(async () => {
    await context.close();
  });

  async function subscribe(cookie: string | undefined, body: unknown) {
    const response = await app.request(`${TEST_BASE_URL}/api/push/subscriptions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cookie === undefined ? {} : { cookie }),
      },
      body: JSON.stringify(body),
    });
    const json: unknown = await response.json().catch(() => null);
    return { status: response.status, json };
  }

  async function rowsForUser(userId: string): Promise<DeviceRow[]> {
    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<DeviceRow>`SELECT kind, token, endpoint, user_agent, node
          FROM push_subscriptions WHERE user_id = ${userId}`;
      }),
    );
    return [...rows];
  }

  function errorCode(json: unknown): string | undefined {
    if (typeof json !== 'object' || json === null || !('error' in json)) {
      return undefined;
    }
    const error = (json as { error: unknown }).error;
    if (typeof error !== 'object' || error === null || !('code' in error)) {
      return undefined;
    }
    return (error as { code: unknown }).code as string;
  }

  it('stores an fcm row and answers { id, node, jid }', async () => {
    const user = await bootstrapUser(context, app, 'alice@example.com');

    const { status, json } = await subscribe(user.cookie, {
      kind: 'fcm',
      token: 'fcm-token-1',
      userAgent: 'Pixel 8',
    });

    expect(status).toBe(200);
    const device = json as { id: string; node: string; jid: string };
    expect(device.jid).toBe('push@zilar.localhost');
    expect(device.id).toEqual(expect.any(String));
    expect(device.node).toEqual(expect.any(String));

    const rows = await rowsForUser(user.id);
    expect(rows).toEqual([
      {
        kind: 'fcm',
        token: 'fcm-token-1',
        endpoint: null,
        userAgent: 'Pixel 8',
        node: device.node,
      },
    ]);
  });

  it('answers 400 invalid_subscription for an unknown kind', async () => {
    const user = await bootstrapUser(context, app, 'alice@example.com');

    const { status, json } = await subscribe(user.cookie, { kind: 'apns', token: 'token-1' });

    expect(status).toBe(400);
    expect(errorCode(json)).toBe('invalid_subscription');
    expect(await rowsForUser(user.id)).toEqual([]);
  });

  it('still stores a webpush row', async () => {
    const user = await bootstrapUser(context, app, 'alice@example.com');

    const { status } = await subscribe(user.cookie, {
      endpoint: 'https://push.example.com/1',
      keys: { p256dh: 'p256dh-1', auth: 'auth-1' },
      userAgent: 'Firefox',
    });

    expect(status).toBe(200);
    const rows = await rowsForUser(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'webpush',
      token: null,
      endpoint: 'https://push.example.com/1',
      userAgent: 'Firefox',
    });
  });

  it('answers 401 without a session', async () => {
    const { status } = await subscribe(undefined, { kind: 'fcm', token: 'fcm-token-1' });

    expect(status).toBe(401);
  });
});
