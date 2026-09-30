import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { HttpError } from '../errors';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  TEST_BASE_URL,
  type TestContext,
} from '../test-support';
import { loadPushConfig, type PushConfig } from './config';
import { createPushRoutes } from './routes';
import { createPushTestTables } from './test-tables';

const PUSH_ENV = {
  PUSH_ENABLED: 'true',
  PUSH_VAPID_PUBLIC_KEY: 'test-vapid-public-key',
  PUSH_VAPID_PRIVATE_KEY: 'test-vapid-private-key',
  PUSH_VAPID_SUBJECT: 'mailto:test@galena.localhost',
  PUSH_COMPONENT_JID: 'push.galena.localhost',
  PUSH_COMPONENT_SECRET: 'test-component-secret-0000000000000000',
  PUSH_STORAGE_KEY: 'test-push-storage-key-0000000000000000',
};

function pushConfig(): PushConfig {
  return loadPushConfig({ ...PUSH_ENV });
}

function deviceBody(endpoint: string, userAgent?: string) {
  return {
    endpoint,
    keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
    ...(userAgent === undefined ? {} : { userAgent }),
  };
}

describe('push routes', () => {
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
      push: pushConfig(),
    });
  }

  it('answers 404 for every push route when push is off', async () => {
    const app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
    });
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const headers = { cookie: ana.cookie };
    const calls = [
      ['GET', '/api/push/config', undefined],
      ['POST', '/api/push/subscriptions', deviceBody('https://push.example.com/a')],
      ['GET', '/api/push/subscriptions', undefined],
      ['DELETE', '/api/push/subscriptions/device-1', undefined],
      ['GET', '/api/push/settings', undefined],
      ['PUT', '/api/push/settings', { showPreviews: false }],
      ['POST', '/api/push/test', { subscriptionId: 'device-1' }],
    ] as const;
    for (const [method, path, body] of calls) {
      const response = await app.request(`${TEST_BASE_URL}${path}`, {
        method,
        headers: { ...headers, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      expect(response.status).toBe(404);
    }
  });

  it('registers, lists and removes own devices', async () => {
    const app = appWithPush();
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const headers = { cookie: ana.cookie, 'content-type': 'application/json' };

    const subscribe = await app.request(`${TEST_BASE_URL}/api/push/subscriptions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(deviceBody('https://push.example.com/ana-1', 'Ana phone')),
    });
    expect(subscribe.status).toBe(200);
    const registered = (await subscribe.json()) as { id: string; node: string; jid: string };
    expect(registered.jid).toBe('push.galena.localhost');
    expect(registered.node).toMatch(/^[A-Za-z0-9._~-]{1,256}$/);

    const listed = await app.request(`${TEST_BASE_URL}/api/push/subscriptions`, { headers });
    expect(listed.status).toBe(200);
    const { devices } = (await listed.json()) as {
      devices: Array<{ id: string; userAgent: string; inactive: boolean }>;
    };
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      id: registered.id,
      userAgent: 'Ana phone',
      inactive: false,
    });
    // Labels and dates only: no endpoint URL, no keys.
    expect(JSON.stringify(devices)).not.toContain('push.example.com');
    expect(JSON.stringify(devices)).not.toContain('p256dh');

    const remove = await app.request(`${TEST_BASE_URL}/api/push/subscriptions/${registered.id}`, {
      method: 'DELETE',
      headers,
    });
    expect(remove.status).toBe(200);
    const relisted = await app.request(`${TEST_BASE_URL}/api/push/subscriptions`, { headers });
    expect(((await relisted.json()) as { devices: unknown[] }).devices).toEqual([]);
  });

  it('rejects invalid subscriptions and 404s other users devices like unknown ones', async () => {
    const app = appWithPush();
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const bob = await contactOf(context, app, ana.id, 'bob@example.com');
    const headers = { cookie: ana.cookie, 'content-type': 'application/json' };

    const bad = await app.request(`${TEST_BASE_URL}/api/push/subscriptions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ endpoint: 'not-a-url', keys: { p256dh: 'p', auth: 'a' } }),
    });
    expect(bad.status).toBe(400);

    const bobHeaders = { cookie: bob.cookie, 'content-type': 'application/json' };
    const registered = await app.request(`${TEST_BASE_URL}/api/push/subscriptions`, {
      method: 'POST',
      headers: bobHeaders,
      body: JSON.stringify(deviceBody('https://push.example.com/bob-1')),
    });
    const { id } = (await registered.json()) as { id: string };

    // Ana cannot remove Bob's device: same 404 as an unknown id.
    const removeOther = await app.request(`${TEST_BASE_URL}/api/push/subscriptions/${id}`, {
      method: 'DELETE',
      headers,
    });
    expect(removeOther.status).toBe(404);
    const removeMissing = await app.request(`${TEST_BASE_URL}/api/push/subscriptions/missing`, {
      method: 'DELETE',
      headers,
    });
    expect(removeMissing.status).toBe(404);
  });

  it('reads and writes the previews setting', async () => {
    const app = appWithPush();
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const headers = { cookie: ana.cookie, 'content-type': 'application/json' };

    const initial = await app.request(`${TEST_BASE_URL}/api/push/settings`, { headers });
    expect(await initial.json()).toEqual({ showPreviews: true });

    const updated = await app.request(`${TEST_BASE_URL}/api/push/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ showPreviews: false }),
    });
    expect(await updated.json()).toEqual({ showPreviews: false });

    const bad = await app.request(`${TEST_BASE_URL}/api/push/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ showPreviews: 'yes' }),
    });
    expect(bad.status).toBe(400);
  });

  it('rate-limits device registration', async () => {
    const app = appWithPush();
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const headers = { cookie: ana.cookie, 'content-type': 'application/json' };
    let limited = 0;
    for (let index = 0; index < 35; index += 1) {
      const response = await app.request(`${TEST_BASE_URL}/api/push/subscriptions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(deviceBody(`https://push.example.com/rate-${index}`)),
      });
      await response.text();
      if (response.status === 429) {
        limited += 1;
      }
    }
    expect(limited).toBeGreaterThan(0);
  });

  it('sends a test notification through the injected sender', async () => {
    const sent: Array<{ endpoint: string; payload: string }> = [];
    const routes = createPushRoutes({
      auth: context.auth,
      db: context.db,
      config: context.config,
      push: pushConfig(),
      adminClient: context.adminClient,
      logger: context.logger,
      sender: {
        send: async (target, payload) => {
          sent.push({ endpoint: target.endpoint, payload });
          return { gone: false };
        },
      },
    });
    const app = new Hono();
    app.route('/api', routes);
    app.onError((error, c) => {
      if (error instanceof HttpError) {
        return c.json({ error: { code: error.code, message: error.message } }, error.status);
      }
      throw error;
    });
    // Sessions live in the shared test database, so the routed app can serve
    // a user signed up through the full app.
    const full = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
    });
    const ana = await bootstrapUser(context, full, 'ana-test@example.com');
    const headers = { cookie: ana.cookie, 'content-type': 'application/json' };

    const registered = await app.request(`${TEST_BASE_URL}/api/push/subscriptions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(deviceBody('https://push.example.com/test-1')),
    });
    expect(registered.status).toBe(200);
    const { id } = (await registered.json()) as { id: string };

    const test = await app.request(`${TEST_BASE_URL}/api/push/test`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ subscriptionId: id }),
    });
    expect(test.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.endpoint).toBe('https://push.example.com/test-1');
    expect(JSON.parse(sent[0]!.payload)).toEqual({
      title: 'Galena',
      body: 'Push notifications work on this device.',
    });

    const unknown = await app.request(`${TEST_BASE_URL}/api/push/test`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ subscriptionId: 'missing' }),
    });
    expect(unknown.status).toBe(404);
  });

  it('deletes the row before answering 410 for an expired test endpoint (F4)', async () => {
    const goneError = Object.assign(new Error('gone'), { statusCode: 410 });
    const routes = createPushRoutes({
      auth: context.auth,
      db: context.db,
      config: context.config,
      push: pushConfig(),
      adminClient: context.adminClient,
      logger: context.logger,
      sender: {
        send: async () => {
          throw goneError;
        },
      },
    });
    const app = new Hono();
    app.route('/api', routes);
    app.onError((error, c) => {
      if (error instanceof HttpError) {
        return c.json({ error: { code: error.code, message: error.message } }, error.status);
      }
      throw error;
    });
    const full = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
    });
    const ana = await bootstrapUser(context, full, 'ana-gone@example.com');
    const bob = await contactOf(context, full, ana.id, 'bob-gone@example.com');
    const headers = { cookie: ana.cookie, 'content-type': 'application/json' };
    const bobHeaders = { cookie: bob.cookie, 'content-type': 'application/json' };

    const registered = await app.request(`${TEST_BASE_URL}/api/push/subscriptions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(deviceBody('https://push.example.com/gone-1')),
    });
    expect(registered.status).toBe(200);
    const { id } = (await registered.json()) as { id: string };

    // Bob cannot burn Ana's device with a forged id: his 404 leaves it intact.
    const forged = await app.request(`${TEST_BASE_URL}/api/push/test`, {
      method: 'POST',
      headers: bobHeaders,
      body: JSON.stringify({ subscriptionId: id }),
    });
    expect(forged.status).toBe(404);

    const test = await app.request(`${TEST_BASE_URL}/api/push/test`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ subscriptionId: id }),
    });
    expect(test.status).toBe(410);
    expect(((await test.json()) as { error: { code: string } }).error.code).toBe('device_gone');
    const { devicesForUser } = await import('./store');
    expect(await devicesForUser(context.db, ana.id)).toEqual([]);
  });

  it('stamps failed_at when the test send fails without expiring', async () => {
    const routes = createPushRoutes({
      auth: context.auth,
      db: context.db,
      config: context.config,
      push: pushConfig(),
      adminClient: context.adminClient,
      logger: context.logger,
      sender: {
        send: async () => {
          throw new Error('relay refused the request');
        },
      },
    });
    const app = new Hono();
    app.route('/api', routes);
    app.onError((error, c) => {
      if (error instanceof HttpError) {
        return c.json({ error: { code: error.code, message: error.message } }, error.status);
      }
      throw error;
    });
    const full = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
    });
    const ana = await bootstrapUser(context, full, 'ana-failed@example.com');
    const headers = { cookie: ana.cookie, 'content-type': 'application/json' };

    const registered = await app.request(`${TEST_BASE_URL}/api/push/subscriptions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(deviceBody('https://push.example.com/failed-1')),
    });
    expect(registered.status).toBe(200);
    const { id } = (await registered.json()) as { id: string };

    const test = await app.request(`${TEST_BASE_URL}/api/push/test`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ subscriptionId: id }),
    });
    expect(test.status).toBe(502);
    const { devicesForUser } = await import('./store');
    const [device] = await devicesForUser(context.db, ana.id);
    expect(device?.failedAt).not.toBeNull();
    expect(device?.lastUsedAt).toBeNull();
  });
});
