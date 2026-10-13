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
import { createPushApi } from './api';
import type { FcmSender, FcmWakeData } from './fcm';

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

// The native test route (T-1208): `POST /api/push/test` on an fcm row sends
// a data-only `{ chatId: 'zilar:test', serverId }` wake through the injected
// native sender and answers `{ sent: true }`; a `{ gone: true }` answer
// removes the row and answers 410 `device_gone`.
//
// Both tests build the push API directly with `createPushApi({ ...,
// nativeSender: fake })` and call its handler, the way
// `apps/server/src/files/routes.test.ts:166-188` builds `createFilesApi` and
// calls `api.handler(new Request(...))`. The session still comes from the
// full app: user sign-up and the subscribes below need the auth routes.
describe('POST /api/push/test on a native device', () => {
  let context: TestContext;
  let app: ReturnType<typeof createApp>;

  interface PushRequest {
    request(url: string, init?: RequestInit): Promise<Response>;
  }

  interface NativeCall {
    token: string;
    data: FcmWakeData;
  }

  function fakeNativeSender(result: { gone: boolean } = { gone: false }): {
    sender: FcmSender;
    calls: NativeCall[];
  } {
    const calls: NativeCall[] = [];
    return {
      sender: {
        send: (token, data) => {
          calls.push({ token, data });
          return Promise.resolve(result);
        },
      },
      calls,
    };
  }

  // The push API mounted on its own, with the fake native sender injected.
  function nativePushApp(fake: FcmSender): PushRequest {
    const api = createPushApi({
      auth: context.auth,
      db: context.db,
      config: context.config,
      push: loadPushConfig(PUSH_ENV),
      adminClient: context.adminClient,
      logger: context.logger,
      nativeSender: fake,
    });
    return {
      request(url: string, init?: RequestInit): Promise<Response> {
        return api.handler(new Request(url, init));
      },
    };
  }

  async function deviceIdFor(cookie: string, token: string): Promise<string> {
    const response = await app.request(`${TEST_BASE_URL}/api/push/subscriptions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ kind: 'fcm', token }),
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { id: string }).id;
  }

  async function testPush(target: PushRequest, cookie: string | undefined, subscriptionId: string) {
    const response = await target.request(`${TEST_BASE_URL}/api/push/test`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cookie === undefined ? {} : { cookie }),
      },
      body: JSON.stringify({ subscriptionId }),
    });
    const json: unknown = await response.json().catch(() => null);
    return { status: response.status, json };
  }

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

  it('sends a zilar:test wake and answers { sent: true }', async () => {
    const { sender, calls } = fakeNativeSender();
    const target = nativePushApp(sender);
    const user = await bootstrapUser(context, app, 'alice@example.com');
    const subscriptionId = await deviceIdFor(user.cookie, 'fcm-token-1');

    const { status, json } = await testPush(target, user.cookie, subscriptionId);

    expect(status).toBe(200);
    expect(json).toEqual({ sent: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.token).toBe('fcm-token-1');
    expect(calls[0]?.data).toEqual({
      chatId: 'zilar:test',
      chatKind: 'group',
      serverId: context.config.xmpp.domain,
    });
  });

  it('removes the row and answers 410 device_gone when the token is gone', async () => {
    const { sender } = fakeNativeSender({ gone: true });
    const target = nativePushApp(sender);
    const user = await bootstrapUser(context, app, 'alice@example.com');
    const subscriptionId = await deviceIdFor(user.cookie, 'fcm-token-2');

    const { status, json } = await testPush(target, user.cookie, subscriptionId);

    expect(status).toBe(410);
    expect((json as { error: { code: string } }).error.code).toBe('device_gone');
    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ id: string }>`SELECT id FROM push_subscriptions
          WHERE id = ${subscriptionId}`;
      }),
    );
    expect([...rows]).toHaveLength(0);
  });
});
