import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { ais, providerConnections } from '../db/schema';
import {
  bootstrapUser,
  createTestContext,
  TEST_BASE_URL,
  TEST_XMPP_DOMAIN,
  type TestContext,
} from '../test-support';
import { createKeyCipher } from './crypto';
import type { ProbeOutcome, ProviderProbe } from './probe';
import type { ProviderId } from './providers';

const MASTER_KEY = 'test-master-key-0000000000000000000000';
const KEY = 'sk-test-provider-key-1234567890';

class FakeProbe implements ProviderProbe {
  readonly calls: Array<{ provider: ProviderId; key: string }> = [];
  outcome: ProbeOutcome = { ok: true };
  fail = false;

  async testKey(provider: ProviderId, key: string): Promise<ProbeOutcome> {
    this.calls.push({ provider, key });
    if (this.fail) {
      throw new Error(`network blew up with ${KEY}`);
    }
    return this.outcome;
  }
}

function captureLogger(): {
  warn: (fields: Record<string, unknown>) => void;
  calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  return {
    warn: (fields: Record<string, unknown>) => {
      calls.push(fields);
    },
    calls,
  };
}

describe('connections routes', () => {
  let context: TestContext;
  let testCounter = 0;

  beforeEach(async () => {
    testCounter += 1;
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  function mount(probe: ProviderProbe) {
    return createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      connections: { cipher: createKeyCipher(MASTER_KEY), probe },
    });
  }

  // The real app shape with no master key configured: routes still mount.
  function mountWithoutCipher() {
    return createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
    });
  }

  async function createFor(app: ReturnType<typeof mount>, cookie: string, key = KEY) {
    return app.request(`${TEST_BASE_URL}/api/connections`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', key, label: 'Work' }),
    });
  }

  it('requires a signed-in user on every route', async () => {
    const app = mount(new FakeProbe());
    const noAuth = { 'content-type': 'application/json' };

    const list = await app.request(`${TEST_BASE_URL}/api/connections`);
    const create = await app.request(`${TEST_BASE_URL}/api/connections`, {
      method: 'POST',
      headers: noAuth,
      body: JSON.stringify({ provider: 'openai', key: KEY }),
    });
    const test = await app.request(`${TEST_BASE_URL}/api/connections/does-not-exist/test`, {
      method: 'POST',
      headers: noAuth,
      body: '{}',
    });
    const remove = await app.request(`${TEST_BASE_URL}/api/connections/does-not-exist`, {
      method: 'DELETE',
    });

    expect(list.status).toBe(401);
    expect(create.status).toBe(401);
    expect(test.status).toBe(401);
    expect(remove.status).toBe(401);
  });

  it('creates a connection and stores the key encrypted at rest', async () => {
    const app = mount(new FakeProbe());
    const user = await bootstrapUser(context, app, `create${testCounter}@example.com`);

    const response = await createFor(app, user.cookie);
    expect(response.status).toBe(201);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ provider: 'openai', label: 'Work', status: 'active' });
    expect(Object.hasOwn(body, 'key')).toBe(false);
    expect(JSON.stringify(body)).not.toContain(KEY);

    const rows = await context.db.select().from(providerConnections);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.encryptedKey).not.toContain(KEY);
    expect(createKeyCipher(MASTER_KEY).decrypt(rows[0]!.encryptedKey)).toBe(KEY);
  });

  it('lists only the caller connections and never returns the key', async () => {
    const app = mount(new FakeProbe());
    const alice = await bootstrapUser(context, app, `alice${testCounter}@example.com`);
    const bob = await bootstrapUser(context, app, `bob${testCounter}@example.com`);

    await createFor(app, alice.cookie, 'sk-alice-key-1111');

    const bobList = await app.request(`${TEST_BASE_URL}/api/connections`, {
      headers: { cookie: bob.cookie },
    });
    expect(bobList.status).toBe(200);
    expect(await bobList.json()).toEqual([]);

    const aliceList = await app.request(`${TEST_BASE_URL}/api/connections`, {
      headers: { cookie: alice.cookie },
    });
    const aliceBody = (await aliceList.json()) as Array<Record<string, unknown>>;
    expect(aliceBody).toHaveLength(1);
    expect(aliceBody[0]).toMatchObject({ provider: 'openai', label: 'Work' });
    expect(JSON.stringify(aliceBody)).not.toContain('sk-alice-key-1111');
  });

  it('rejects a create with an unexpected field', async () => {
    const app = mount(new FakeProbe());
    const user = await bootstrapUser(context, app, `strict${testCounter}@example.com`);

    const response = await app.request(`${TEST_BASE_URL}/api/connections`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', key: KEY, status: 'revoked' }),
    });

    expect(response.status).toBe(400);
    expect(await context.db.select().from(providerConnections)).toHaveLength(0);
  });

  it('tests a key by decrypting in memory and passing the plaintext to the probe', async () => {
    const probe = new FakeProbe();
    const app = mount(probe);
    const user = await bootstrapUser(context, app, `test${testCounter}@example.com`);

    const created = await createFor(app, user.cookie, 'sk-test-key-decrypt-me');
    const id = ((await created.json()) as { id: string }).id;

    const response = await app.request(`${TEST_BASE_URL}/api/connections/${id}/test`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(probe.calls).toEqual([{ provider: 'openai', key: 'sk-test-key-decrypt-me' }]);
  });

  it('returns a sanitised message when the probe reports a failure', async () => {
    const probe = new FakeProbe();
    probe.outcome = { ok: false, message: 'The provider rejected the key' };
    const app = mount(probe);
    const user = await bootstrapUser(context, app, `fail${testCounter}@example.com`);

    const created = await createFor(app, user.cookie);
    const id = ((await created.json()) as { id: string }).id;

    const response = await app.request(`${TEST_BASE_URL}/api/connections/${id}/test`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; message?: string };
    expect(body.ok).toBe(false);
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it('sanitises an unexpected probe error in the response and the log', async () => {
    const probe = new FakeProbe();
    probe.fail = true;
    const logger = captureLogger();
    const app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      connections: { cipher: createKeyCipher(MASTER_KEY), probe, logger },
    });
    const user = await bootstrapUser(context, app, `boom${testCounter}@example.com`);

    const created = await createFor(app, user.cookie);
    const id = ((await created.json()) as { id: string }).id;

    const response = await app.request(`${TEST_BASE_URL}/api/connections/${id}/test`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(KEY);
    expect(logger.calls).toHaveLength(1);
    expect(JSON.stringify(logger.calls[0])).not.toContain(KEY);
  });

  it('cannot read, test or delete another user connection (404, not 403)', async () => {
    const probe = new FakeProbe();
    const app = mount(probe);
    const alice = await bootstrapUser(context, app, `owner${testCounter}@example.com`);
    const bob = await bootstrapUser(context, app, `thief${testCounter}@example.com`);

    const created = await createFor(app, alice.cookie);
    const id = ((await created.json()) as { id: string }).id;

    const test = await app.request(`${TEST_BASE_URL}/api/connections/${id}/test`, {
      method: 'POST',
      headers: { cookie: bob.cookie, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(test.status).toBe(404);

    const remove = await app.request(`${TEST_BASE_URL}/api/connections/${id}`, {
      method: 'DELETE',
      headers: { cookie: bob.cookie },
    });
    expect(remove.status).toBe(404);

    // The owner can still see and delete it: Bob's attempts changed nothing.
    const aliceList = await app.request(`${TEST_BASE_URL}/api/connections`, {
      headers: { cookie: alice.cookie },
    });
    expect((await aliceList.json()) as unknown[]).toHaveLength(1);

    const ownerRemove = await app.request(`${TEST_BASE_URL}/api/connections/${id}`, {
      method: 'DELETE',
      headers: { cookie: alice.cookie },
    });
    expect(ownerRemove.status).toBe(204);
  });

  it('returns 404 for a missing id on delete and test', async () => {
    const app = mount(new FakeProbe());
    const user = await bootstrapUser(context, app, `missing${testCounter}@example.com`);

    const test = await app.request(`${TEST_BASE_URL}/api/connections/nope/test`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(test.status).toBe(404);

    const remove = await app.request(`${TEST_BASE_URL}/api/connections/nope`, {
      method: 'DELETE',
      headers: { cookie: user.cookie },
    });
    expect(remove.status).toBe(404);
  });

  it('deletes a connection so it is gone from the list', async () => {
    const app = mount(new FakeProbe());
    const user = await bootstrapUser(context, app, `del${testCounter}@example.com`);

    const created = await createFor(app, user.cookie);
    const id = ((await created.json()) as { id: string }).id;

    const remove = await app.request(`${TEST_BASE_URL}/api/connections/${id}`, {
      method: 'DELETE',
      headers: { cookie: user.cookie },
    });
    expect(remove.status).toBe(204);

    const list = await app.request(`${TEST_BASE_URL}/api/connections`, {
      headers: { cookie: user.cookie },
    });
    expect(await list.json()).toEqual([]);
  });

  it('refuses to delete a connection an AI uses, returning a bare count', async () => {
    const app = mount(new FakeProbe());
    const user = await bootstrapUser(context, app, `inuse${testCounter}@example.com`);

    const created = await createFor(app, user.cookie);
    const id = ((await created.json()) as { id: string }).id;

    const aiId = randomUUID();
    await context.db.insert(ais).values({
      id: aiId,
      owner: user.id,
      name: 'Dev-1',
      template: 'dev',
      persona: 'Concise.',
      providerConnectionId: id,
      model: 'gpt-4o-mini',
      localpart: `ai-${aiId}`,
      jid: `ai-${aiId}@${TEST_XMPP_DOMAIN}`,
      status: 'active',
    });

    const remove = await app.request(`${TEST_BASE_URL}/api/connections/${id}`, {
      method: 'DELETE',
      headers: { cookie: user.cookie },
    });
    expect(remove.status).toBe(409);
    const body = (await remove.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('connection_in_use');
    expect(body.error.message).toContain('1');
    expect(JSON.stringify(body)).not.toContain('Dev-1');

    // The connection is still there.
    const list = await app.request(`${TEST_BASE_URL}/api/connections`, {
      headers: { cookie: user.cookie },
    });
    expect((await list.json()) as unknown[]).toHaveLength(1);
  });

  it('trims whitespace from a pasted key', async () => {
    const app = mount(new FakeProbe());
    const user = await bootstrapUser(context, app, `trim${testCounter}@example.com`);

    const response = await app.request(`${TEST_BASE_URL}/api/connections`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', key: '  fake-key\n', label: 'Work' }),
    });

    expect(response.status).toBe(201);
    const rows = await context.db.select().from(providerConnections);
    expect(rows).toHaveLength(1);
    expect(createKeyCipher(MASTER_KEY).decrypt(rows[0]!.encryptedKey)).toBe('fake-key');
  });

  it('returns 503 connections_unavailable on every route when no cipher is configured', async () => {
    const app = mountWithoutCipher();
    const user = await bootstrapUser(context, app, `nocipher${testCounter}@example.com`);

    const list = await app.request(`${TEST_BASE_URL}/api/connections`, {
      headers: { cookie: user.cookie },
    });
    expect(list.status).toBe(503);
    expect(((await list.json()) as { error: { code: string } }).error.code).toBe(
      'connections_unavailable',
    );

    const create = await app.request(`${TEST_BASE_URL}/api/connections`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', key: KEY }),
    });
    expect(create.status).toBe(503);

    const test = await app.request(`${TEST_BASE_URL}/api/connections/whatever/test`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(test.status).toBe(503);

    const remove = await app.request(`${TEST_BASE_URL}/api/connections/whatever`, {
      method: 'DELETE',
      headers: { cookie: user.cookie },
    });
    expect(remove.status).toBe(503);
  });
});
