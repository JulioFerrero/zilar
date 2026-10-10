// The push case of the contract drift detector (T-0895): the client derived
// from `@zilar/api-contract` runs against a real app with push on (the shared
// harness builds an app without it, so this file builds its own). A route whose
// status or body drifts from the contract fails here with `invalid_response`.
// `subscribe`, `updateSettings` and `test` have no declared payload, so the
// subscribe call below is a plain request.

import { Effect } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, makeZilarClient, runApi, withFetch } from '@zilar/api-contract';
import { createApp } from '../app';
import { bootstrapUser, createTestContext, TEST_BASE_URL, type TestContext } from '../test-support';
import { loadPushConfig } from './config';
import { createPushTestTables } from './test-tables';

const PUSH_ENV = {
  PUSH_ENABLED: 'true',
  PUSH_VAPID_PUBLIC_KEY: 'test-vapid-public-key',
  PUSH_VAPID_PRIVATE_KEY: 'test-vapid-private-key',
  PUSH_VAPID_SUBJECT: 'mailto:test@zilar.localhost',
  PUSH_COMPONENT_JID: 'push.zilar.localhost',
  PUSH_COMPONENT_SECRET: 'test-component-secret-0000000000000000',
  PUSH_STORAGE_KEY: 'test-push-storage-key-0000000000000000',
};

const baseHttpClient = Effect.runSync(
  Effect.provide(Effect.service(HttpClient.HttpClient), FetchHttpClient.layer),
);

describe('api contract smoke: push (T-0895)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
    await createPushTestTables(context.db);
  });

  afterEach(async () => {
    await context.close();
  });

  function appWithPush() {
    return createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      push: loadPushConfig({ ...PUSH_ENV }),
    });
  }

  function clientFor(app: ReturnType<typeof appWithPush>, cookie: string) {
    const appFetch: typeof fetch = (input, init) => app.request(String(input), init);
    return Effect.runSync(
      makeZilarClient(
        baseHttpClient.pipe(
          HttpClient.mapRequest(HttpClientRequest.setHeader('cookie', cookie)),
          withFetch(appFetch),
        ),
        { baseUrl: TEST_BASE_URL },
      ),
    );
  }

  it('reads the config and settings, lists and removes a device', async () => {
    const app = appWithPush();
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const client = clientFor(app, ana.cookie);

    await expect(runApi(client.push.config())).resolves.toEqual({
      vapidPublicKey: 'test-vapid-public-key',
      pushJid: 'push.zilar.localhost',
    });
    await expect(runApi(client.push.settings())).resolves.toEqual({ showPreviews: true });

    const subscribe = await app.request(`${TEST_BASE_URL}/api/push/subscriptions`, {
      method: 'POST',
      headers: { cookie: ana.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint: 'https://push.example.com/ana-1',
        keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
        userAgent: 'Ana phone',
      }),
    });
    const registered = (await subscribe.json()) as { id: string };

    const listed = await runApi(client.push.list());
    expect(listed.devices).toMatchObject([{ id: registered.id, userAgent: 'Ana phone' }]);

    await expect(runApi(client.push.remove({ params: { id: registered.id } }))).resolves.toEqual({
      removed: true,
    });
    expect((await runApi(client.push.list())).devices).toEqual([]);
  });

  it('maps the error envelope and a missing session', async () => {
    const app = appWithPush();
    const ana = await bootstrapUser(context, app, 'ana@example.com');

    const missing = await runApi(
      clientFor(app, ana.cookie).push.remove({ params: { id: 'nope' } }),
    ).catch((error: unknown) => error);
    expect(missing).toBeInstanceOf(ApiError);
    expect(missing).toMatchObject({ status: 404, code: 'not_found' });

    const anonymous = await runApi(clientFor(app, '').push.config()).catch(
      (error: unknown) => error,
    );
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });
  });
});
