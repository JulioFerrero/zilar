import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  GenerateVirtualKeyInput,
  LitellmAdminClient,
  UpdateVirtualKeyInput,
  VirtualKey,
  VirtualKeyInfo,
} from '../ai/litellm-client';
import { createApp } from '../app';
import type { ProbeOutcome, ProviderProbe } from '../connections/probe';
import { createKeyCipher } from '../connections/crypto';
import { aiLimits, ais, llmVirtualKeys, providerConnections } from '../db/schema';
import {
  bootstrapUser,
  createTestContext,
  FakeAdminClient,
  TEST_BASE_URL,
  TEST_XMPP_DOMAIN,
  type TestApp,
  type TestContext,
} from '../test-support';
import { localpartFor } from '../xmpp/provisioning';
import { aiLocalpart } from './service';
import { DEFAULT_PERSONAS } from './templates';

const MASTER_KEY = 'test-master-key-0000000000000000000000';
const PROVIDER_KEY = 'sk-provider-key-do-not-leak';

class FakeProbe implements ProviderProbe {
  testKey(): Promise<ProbeOutcome> {
    return Promise.resolve({ ok: true });
  }
}

// Fails a registration only for a chosen localpart, so the owner's own account
// can be created while the AI's cannot. The shared fake's `failRegister` cannot
// tell the two apart, and the owner is always registered first.
class AiAdminClient extends FakeAdminClient {
  failRegisterFor: (localpart: string) => boolean = () => false;

  override registerUser(localpart: string) {
    if (this.failRegisterFor(localpart)) {
      return Promise.reject(new Error('ejabberd is down'));
    }
    return super.registerUser(localpart);
  }
}

class FakeLitellm implements LitellmAdminClient {
  readonly generated: GenerateVirtualKeyInput[] = [];
  readonly updated: UpdateVirtualKeyInput[] = [];
  readonly revoked: string[] = [];
  failGenerate = false;
  failUpdate = false;
  failRevoke = false;
  private counter = 0;

  generateKey(input: GenerateVirtualKeyInput): Promise<VirtualKey> {
    this.generated.push(input);
    if (this.failGenerate) {
      return Promise.reject(new Error('gateway down, master was sk-master-must-not-leak'));
    }
    this.counter += 1;
    return Promise.resolve({
      id: `tok-${this.counter}-do-not-leak`,
      key: `sk-virtual-${this.counter}-do-not-leak`,
      keyAlias: input.keyAlias ?? null,
      maxBudget: input.maxBudget ?? null,
      spend: 0,
      models: input.models,
    });
  }

  getKeyInfo(): Promise<VirtualKeyInfo> {
    return Promise.reject(new Error('getKeyInfo is not used by the AI routes'));
  }

  updateKey(input: UpdateVirtualKeyInput): Promise<VirtualKeyInfo> {
    this.updated.push(input);
    if (this.failUpdate) {
      return Promise.reject(new Error('gateway down'));
    }
    return Promise.resolve({
      keyAlias: null,
      maxBudget: input.maxBudget ?? null,
      spend: 0,
      tpmLimit: null,
      rpmLimit: null,
      blocked: null,
      models: [],
    });
  }

  revokeKey(key: string): Promise<void> {
    this.revoked.push(key);
    if (this.failRevoke) {
      return Promise.reject(new Error('gateway down'));
    }
    return Promise.resolve();
  }
}

function captureLogger(): {
  warn: (fields: Record<string, unknown>, message: string) => void;
  calls: Array<{ fields: Record<string, unknown>; message: string }>;
} {
  const calls: Array<{ fields: Record<string, unknown>; message: string }> = [];
  return {
    warn: (fields, message) => {
      calls.push({ fields, message });
    },
    calls,
  };
}

describe('AI routes', () => {
  let context: TestContext;
  let testCounter = 0;

  beforeEach(async () => {
    testCounter += 1;
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  function mount(
    options: {
      litellm?: LitellmAdminClient;
      adminClient?: FakeAdminClient;
      logger?: ReturnType<typeof captureLogger>;
    } = {},
  ): TestApp {
    return createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: options.adminClient ?? context.adminClient,
      connections: { cipher: createKeyCipher(MASTER_KEY), probe: new FakeProbe() },
      ais: {
        cipher: createKeyCipher(MASTER_KEY),
        litellm: options.litellm ?? new FakeLitellm(),
        ...(options.logger === undefined ? {} : { logger: options.logger }),
      },
    });
  }

  async function addConnection(
    ownerId: string,
    overrides: { provider?: string; status?: 'active' | 'revoked' } = {},
  ): Promise<string> {
    const id = randomUUID();
    await context.db.insert(providerConnections).values({
      id,
      owner: ownerId,
      provider: overrides.provider ?? 'openai',
      encryptedKey: createKeyCipher(MASTER_KEY).encrypt(PROVIDER_KEY),
      label: null,
      status: overrides.status ?? 'active',
    });
    return id;
  }

  function createBody(providerConnectionId: string, overrides: Record<string, unknown> = {}) {
    return {
      name: 'Dev-1',
      template: 'dev',
      providerConnectionId,
      model: 'gpt-4o-mini',
      limits: { perDayUsd: 1, perMonthUsd: 20 },
      ...overrides,
    };
  }

  async function postAi(app: TestApp, cookie: string, body: unknown) {
    return app.request(`${TEST_BASE_URL}/api/ais`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('creates, lists, gets, patches and deletes without ever returning a key', async () => {
    const litellm = new FakeLitellm();
    const app = mount({ litellm });
    const user = await bootstrapUser(context, app, `happy${testCounter}@example.com`);
    const connectionId = await addConnection(user.id);

    const created = await postAi(app, user.cookie, createBody(connectionId));
    expect(created.status).toBe(201);
    const ai = (await created.json()) as Record<string, unknown>;
    expect(ai).toMatchObject({
      name: 'Dev-1',
      template: 'dev',
      model: 'gpt-4o-mini',
      status: 'active',
      providerConnectionId: connectionId,
      limits: { perDayUsd: 1, perMonthUsd: 20 },
    });
    expect(typeof ai['id']).toBe('string');
    expect(ai['jid']).toBe(`${aiLocalpart(ai['id'] as string)}@${TEST_XMPP_DOMAIN}`);
    expect(ai['persona']).toBe(DEFAULT_PERSONAS.dev);

    const createdText = JSON.stringify(ai);
    expect(createdText).not.toContain('sk-virtual');
    expect(createdText).not.toContain('tok-');
    expect(createdText).not.toContain(PROVIDER_KEY);
    expect(createdText).not.toContain('encrypted');

    // The key is sealed at rest and the cap was applied by the gateway.
    const keyRows = await context.db.select().from(llmVirtualKeys);
    expect(keyRows).toHaveLength(1);
    expect(keyRows[0]!.encryptedKey).not.toContain('sk-virtual');
    expect(createKeyCipher(MASTER_KEY).decrypt(keyRows[0]!.encryptedKey)).toBe(
      'sk-virtual-1-do-not-leak',
    );
    expect(keyRows[0]!.budgetUsd).toBe('20.00');
    expect(keyRows[0]!.budgetDuration).toBe('30d');
    expect(litellm.generated).toEqual([
      {
        models: ['gpt-4o-mini'],
        maxBudget: 20,
        budgetDuration: '30d',
        keyAlias: `galena-ai-${ai['id'] as string}`,
        metadata: { ai_id: ai['id'] as string },
      },
    ]);

    // The AI XMPP account exists and both roster directions were pushed.
    const localpart = aiLocalpart(ai['id'] as string);
    expect(context.adminClient.registered).toContain(localpart);
    expect(context.adminClient.rosterItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localpart: localpartFor(user.id),
          contactJid: `${localpart}@${TEST_XMPP_DOMAIN}`,
          nick: 'Dev-1',
          groups: ['Galena'],
          subs: 'both',
        }),
        expect.objectContaining({
          localpart,
          contactJid: `${localpartFor(user.id)}@${TEST_XMPP_DOMAIN}`,
          groups: ['Galena'],
          subs: 'both',
        }),
      ]),
    );

    // List and get return the same public shape and no secrets.
    const list = await app.request(`${TEST_BASE_URL}/api/ais`, {
      headers: { cookie: user.cookie },
    });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as Array<Record<string, unknown>>;
    expect(listBody).toHaveLength(1);
    expect(JSON.stringify(listBody)).not.toContain('sk-virtual');
    expect(JSON.stringify(listBody)).not.toContain('tok-');

    const detail = await app.request(`${TEST_BASE_URL}/api/ais/${ai['id'] as string}`, {
      headers: { cookie: user.cookie },
    });
    expect(detail.status).toBe(200);
    expect(JSON.stringify(await detail.json())).not.toContain('sk-virtual');

    // Patch: rename, new persona and a new cap.
    const patched = await app.request(`${TEST_BASE_URL}/api/ais/${ai['id'] as string}`, {
      method: 'PATCH',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Dev-2',
        persona: 'A new persona',
        limits: { perDayUsd: 2, perMonthUsd: 50 },
      }),
    });
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as Record<string, unknown>;
    expect(patchedBody).toMatchObject({
      name: 'Dev-2',
      persona: 'A new persona',
      limits: { perDayUsd: 2, perMonthUsd: 50 },
    });
    expect(JSON.stringify(patchedBody)).not.toContain('sk-virtual');
    expect(litellm.updated).toEqual([{ key: keyRows[0]!.litellmKeyId, maxBudget: 50 }]);
    const limitRows = await context.db.select().from(aiLimits);
    expect(limitRows[0]).toMatchObject({ perDayUsd: '2.00', perMonthUsd: '50.00' });

    // Delete tears down the key and the account, then the row.
    const removed = await app.request(`${TEST_BASE_URL}/api/ais/${ai['id'] as string}`, {
      method: 'DELETE',
      headers: { cookie: user.cookie },
    });
    expect(removed.status).toBe(204);
    expect(litellm.revoked).toEqual([keyRows[0]!.litellmKeyId]);
    expect(context.adminClient.unregistered).toContain(localpart);
    expect(await context.db.select().from(ais)).toHaveLength(0);
    expect(await context.db.select().from(aiLimits)).toHaveLength(0);
    expect(await context.db.select().from(llmVirtualKeys)).toHaveLength(0);

    const empty = await app.request(`${TEST_BASE_URL}/api/ais`, {
      headers: { cookie: user.cookie },
    });
    expect(await empty.json()).toEqual([]);

    // No key or key id ever reaches the log either.
    const logs = context.logOutput();
    expect(logs).not.toContain('sk-virtual');
    expect(logs).not.toContain('tok-');
  });

  it('requires a signed-in user on every route', async () => {
    const app = mount();
    const noAuth = { 'content-type': 'application/json' };

    const list = await app.request(`${TEST_BASE_URL}/api/ais`);
    const detail = await app.request(`${TEST_BASE_URL}/api/ais/nope`);
    const create = await app.request(`${TEST_BASE_URL}/api/ais`, {
      method: 'POST',
      headers: noAuth,
      body: JSON.stringify(createBody('c')),
    });
    const patch = await app.request(`${TEST_BASE_URL}/api/ais/nope`, {
      method: 'PATCH',
      headers: noAuth,
      body: '{}',
    });
    const remove = await app.request(`${TEST_BASE_URL}/api/ais/nope`, { method: 'DELETE' });

    expect([list.status, detail.status, create.status, patch.status, remove.status]).toEqual([
      401, 401, 401, 401, 401,
    ]);
  });

  it('returns the same 404 for a missing and a foreign id on get, patch and delete', async () => {
    const app = mount();
    const alice = await bootstrapUser(context, app, `alice${testCounter}@example.com`);
    const bob = await bootstrapUser(context, app, `bob${testCounter}@example.com`);
    const connectionId = await addConnection(alice.id);
    const created = await postAi(app, alice.cookie, createBody(connectionId));
    const id = ((await created.json()) as { id: string }).id;

    for (const target of [id, 'does-not-exist']) {
      const detail = await app.request(`${TEST_BASE_URL}/api/ais/${target}`, {
        headers: { cookie: bob.cookie },
      });
      const patch = await app.request(`${TEST_BASE_URL}/api/ais/${target}`, {
        method: 'PATCH',
        headers: { cookie: bob.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Stolen' }),
      });
      const remove = await app.request(`${TEST_BASE_URL}/api/ais/${target}`, {
        method: 'DELETE',
        headers: { cookie: bob.cookie },
      });
      expect([detail.status, patch.status, remove.status]).toEqual([404, 404, 404]);
    }

    // Alice's AI is untouched by Bob's attempts.
    expect(await context.db.select().from(ais)).toHaveLength(1);
  });

  it('rejects unknown fields on create and patch', async () => {
    const app = mount();
    const user = await bootstrapUser(context, app, `strict${testCounter}@example.com`);
    const connectionId = await addConnection(user.id);

    const create = await postAi(app, user.cookie, {
      ...createBody(connectionId),
      status: 'active',
    });
    expect(create.status).toBe(400);
    expect(await context.db.select().from(ais)).toHaveLength(0);

    const created = await postAi(app, user.cookie, createBody(connectionId));
    const id = ((await created.json()) as { id: string }).id;
    const patch = await app.request(`${TEST_BASE_URL}/api/ais/${id}`, {
      method: 'PATCH',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'boss' }),
    });
    expect(patch.status).toBe(400);
  });

  it('rejects limits outside the bounds, including a day above the month', async () => {
    const app = mount();
    const user = await bootstrapUser(context, app, `limits${testCounter}@example.com`);
    const connectionId = await addConnection(user.id);

    for (const limits of [
      { perDayUsd: 0, perMonthUsd: 20 },
      { perDayUsd: -1, perMonthUsd: 20 },
      { perDayUsd: 1, perMonthUsd: 0 },
      { perDayUsd: 30, perMonthUsd: 20 },
      { perDayUsd: 1, perMonthUsd: 201 },
      { perDayUsd: 1, perMonthUsd: 1000 },
      { perDayUsd: 1, perMonthUsd: 20, extra: true },
    ]) {
      const response = await postAi(app, user.cookie, createBody(connectionId, { limits }));
      expect(response.status).toBe(400);
    }
    expect(await context.db.select().from(ais)).toHaveLength(0);
  });

  it('rejects a connection that is missing, foreign, inactive or not an LLM provider', async () => {
    const app = mount();
    const alice = await bootstrapUser(context, app, `owner${testCounter}@example.com`);
    const bob = await bootstrapUser(context, app, `thief${testCounter}@example.com`);
    const aliceConnection = await addConnection(alice.id);
    const bobConnection = await addConnection(bob.id);
    const githubConnection = await addConnection(alice.id, { provider: 'github' });
    const revokedConnection = await addConnection(alice.id, { status: 'revoked' });

    const cases: Array<{ id: string; code: string }> = [
      { id: bobConnection, code: 'invalid_connection' },
      { id: 'missing', code: 'invalid_connection' },
      { id: githubConnection, code: 'connection_not_llm' },
      { id: revokedConnection, code: 'connection_inactive' },
    ];
    for (const { id, code } of cases) {
      const response = await postAi(app, alice.cookie, createBody(id));
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(code);
    }
    // The foreign connection still is not usable as a hint that it exists.
    expect(await context.db.select().from(ais)).toHaveLength(0);

    const wrongLlm = await postAi(app, alice.cookie, createBody(aliceConnection));
    expect(wrongLlm.status).toBe(201);
  });

  it('rolls back everything when the AI XMPP account cannot be registered', async () => {
    const litellm = new FakeLitellm();
    const adminClient = new AiAdminClient();
    adminClient.failRegisterFor = (localpart) => localpart.startsWith('ai-');
    const app = mount({ litellm, adminClient });
    const user = await bootstrapUser(context, app, `regfail${testCounter}@example.com`);
    const connectionId = await addConnection(user.id);

    const response = await postAi(app, user.cookie, createBody(connectionId));
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'ai_provisioning_failed',
    );

    expect(await context.db.select().from(ais)).toHaveLength(0);
    expect(await context.db.select().from(aiLimits)).toHaveLength(0);
    expect(litellm.generated).toHaveLength(0);
    expect(adminClient.unregistered).toHaveLength(0);
    expect(adminClient.removedRosterItems).toHaveLength(0);
  });

  it('rolls back the account and rows when the roster cannot be written', async () => {
    const litellm = new FakeLitellm();
    const adminClient = new AiAdminClient();
    adminClient.failRoster = true;
    const app = mount({ litellm, adminClient });
    const user = await bootstrapUser(context, app, `rosterfail${testCounter}@example.com`);
    const connectionId = await addConnection(user.id);

    const response = await postAi(app, user.cookie, createBody(connectionId));
    expect(response.status).toBe(502);

    expect(await context.db.select().from(ais)).toHaveLength(0);
    expect(litellm.generated).toHaveLength(0);
    expect(adminClient.unregistered).toHaveLength(1);
    expect(adminClient.unregistered[0]).toMatch(/^ai-/);
  });

  it('rolls back the XMPP account and rows when the virtual key cannot be issued', async () => {
    const litellm = new FakeLitellm();
    litellm.failGenerate = true;
    const logger = captureLogger();
    const app = mount({ litellm, logger });
    const user = await bootstrapUser(context, app, `keyfail${testCounter}@example.com`);
    const connectionId = await addConnection(user.id);

    const response = await postAi(app, user.cookie, createBody(connectionId));
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain('sk-master-must-not-leak');
    expect(text).not.toContain('gateway down');

    expect(await context.db.select().from(ais)).toHaveLength(0);
    expect(await context.db.select().from(llmVirtualKeys)).toHaveLength(0);
    expect(context.adminClient.unregistered).toHaveLength(1);
    expect(context.adminClient.removedRosterItems).toHaveLength(2);
    expect(litellm.revoked).toHaveLength(0);
    // The rollback logged the failure but never a key.
    const logged = JSON.stringify(logger.calls);
    expect(logged).not.toContain('sk-virtual');
    expect(logged).not.toContain('tok-');
  });

  it('returns 502 and keeps the AI when the gateway is down during delete', async () => {
    const litellm = new FakeLitellm();
    const app = mount({ litellm });
    const user = await bootstrapUser(context, app, `delfail${testCounter}@example.com`);
    const connectionId = await addConnection(user.id);
    const created = await postAi(app, user.cookie, createBody(connectionId));
    const id = ((await created.json()) as { id: string }).id;

    litellm.failRevoke = true;
    const remove = await app.request(`${TEST_BASE_URL}/api/ais/${id}`, {
      method: 'DELETE',
      headers: { cookie: user.cookie },
    });
    expect(remove.status).toBe(502);
    expect(((await remove.json()) as { error: { code: string } }).error.code).toBe(
      'ai_teardown_failed',
    );

    // The AI is still there, and nothing was torn down after the failed revoke.
    expect(await context.db.select().from(ais)).toHaveLength(1);
    expect(await context.db.select().from(llmVirtualKeys)).toHaveLength(1);
    expect(context.adminClient.unregistered).toHaveLength(0);
  });

  it('can retry a delete that failed part way, revoking the key exactly once', async () => {
    const litellm = new FakeLitellm();
    const app = mount({ litellm });
    const user = await bootstrapUser(context, app, `retrydel${testCounter}@example.com`);
    const connectionId = await addConnection(user.id);
    const created = await postAi(app, user.cookie, createBody(connectionId));
    const id = ((await created.json()) as { id: string }).id;
    const keyRows = await context.db.select().from(llmVirtualKeys);
    const localpart = aiLocalpart(id);

    // First attempt: the key is revoked, then the roster delete fails.
    context.adminClient.failRoster = true;
    const failed = await app.request(`${TEST_BASE_URL}/api/ais/${id}`, {
      method: 'DELETE',
      headers: { cookie: user.cookie },
    });
    expect(failed.status).toBe(502);
    expect(litellm.revoked).toEqual([keyRows[0]!.litellmKeyId]);
    // The key row is gone at once, so the retry will not revoke again.
    expect(await context.db.select().from(llmVirtualKeys)).toHaveLength(0);
    expect(await context.db.select().from(ais)).toHaveLength(1);

    // Retry: the roster is removed, the account is unregistered, the row goes.
    context.adminClient.failRoster = false;
    const retried = await app.request(`${TEST_BASE_URL}/api/ais/${id}`, {
      method: 'DELETE',
      headers: { cookie: user.cookie },
    });
    expect(retried.status).toBe(204);
    expect(litellm.revoked).toEqual([keyRows[0]!.litellmKeyId]);
    expect(context.adminClient.unregistered).toContain(localpart);
    expect(await context.db.select().from(ais)).toHaveLength(0);
  });

  it('can delete a disabled AI left behind by a crash, with no key and no account', async () => {
    const litellm = new FakeLitellm();
    const app = mount({ litellm });
    const user = await bootstrapUser(context, app, `crash${testCounter}@example.com`);
    const aiId = randomUUID();
    await context.db.insert(ais).values({
      id: aiId,
      owner: user.id,
      name: 'Half-created',
      template: 'dev',
      persona: 'A persona',
      providerConnectionId: await addConnection(user.id),
      model: 'gpt-4o-mini',
      localpart: `ai-${aiId}`,
      jid: `ai-${aiId}@${TEST_XMPP_DOMAIN}`,
      status: 'disabled',
    });
    await context.db.insert(aiLimits).values({ aiId, perDayUsd: '1.00', perMonthUsd: '20.00' });

    const response = await app.request(`${TEST_BASE_URL}/api/ais/${aiId}`, {
      method: 'DELETE',
      headers: { cookie: user.cookie },
    });
    expect(response.status).toBe(204);
    expect(litellm.revoked).toHaveLength(0);
    expect(context.adminClient.unregistered).toHaveLength(0);
    expect(await context.db.select().from(ais)).toHaveLength(0);
  });

  it('updates the virtual key cap on a limits patch', async () => {
    const litellm = new FakeLitellm();
    const app = mount({ litellm });
    const user = await bootstrapUser(context, app, `patchlimits${testCounter}@example.com`);
    const connectionId = await addConnection(user.id);
    const created = await postAi(app, user.cookie, createBody(connectionId));
    const id = ((await created.json()) as { id: string }).id;
    const keyRows = await context.db.select().from(llmVirtualKeys);

    const response = await app.request(`${TEST_BASE_URL}/api/ais/${id}`, {
      method: 'PATCH',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ limits: { perDayUsd: 1, perMonthUsd: 30 } }),
    });
    expect(response.status).toBe(200);
    expect(litellm.updated).toEqual([{ key: keyRows[0]!.litellmKeyId, maxBudget: 30 }]);
    expect(((await response.json()) as { limits: unknown }).limits).toEqual({
      perDayUsd: 1,
      perMonthUsd: 30,
    });
    const keyAfter = await context.db.select().from(llmVirtualKeys);
    expect(keyAfter[0]!.budgetUsd).toBe('30.00');
  });

  it('updates the owner roster nickname when the AI is renamed', async () => {
    const app = mount();
    const user = await bootstrapUser(context, app, `rename${testCounter}@example.com`);
    const connectionId = await addConnection(user.id);
    const created = await postAi(app, user.cookie, createBody(connectionId));
    const id = ((await created.json()) as { id: string }).id;
    const localpart = aiLocalpart(id);
    context.adminClient.rosterItems.length = 0;

    const response = await app.request(`${TEST_BASE_URL}/api/ais/${id}`, {
      method: 'PATCH',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(response.status).toBe(200);
    expect(context.adminClient.rosterItems).toEqual([
      expect.objectContaining({
        localpart: localpartFor(user.id),
        contactJid: `${localpart}@${TEST_XMPP_DOMAIN}`,
        nick: 'Renamed',
        subs: 'both',
      }),
    ]);
  });

  it('fills a default persona per template and requires one for custom', async () => {
    const app = mount();
    const user = await bootstrapUser(context, app, `persona${testCounter}@example.com`);
    const connectionId = await addConnection(user.id);

    const marketing = await postAi(
      app,
      user.cookie,
      createBody(connectionId, { template: 'marketing' }),
    );
    expect(marketing.status).toBe(201);
    expect(((await marketing.json()) as { persona: string }).persona).toBe(
      DEFAULT_PERSONAS.marketing,
    );

    const customMissing = await postAi(
      app,
      user.cookie,
      createBody(connectionId, { template: 'custom' }),
    );
    expect(customMissing.status).toBe(400);

    const custom = await postAi(
      app,
      user.cookie,
      createBody(connectionId, { template: 'custom', persona: 'Be exactly yourself.' }),
    );
    expect(custom.status).toBe(201);
    expect(((await custom.json()) as { persona: string }).persona).toBe('Be exactly yourself.');
  });

  it('answers 503 for writes when the gateway is not configured', async () => {
    const app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
    });
    const user = await bootstrapUser(context, app, `nogateway${testCounter}@example.com`);

    const create = await postAi(app, user.cookie, createBody('whatever'));
    expect(create.status).toBe(503);
    expect(((await create.json()) as { error: { code: string } }).error.code).toBe(
      'ais_unavailable',
    );

    const patch = await app.request(`${TEST_BASE_URL}/api/ais/whatever`, {
      method: 'PATCH',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    const remove = await app.request(`${TEST_BASE_URL}/api/ais/whatever`, {
      method: 'DELETE',
      headers: { cookie: user.cookie },
    });
    expect([patch.status, remove.status]).toEqual([503, 503]);
  });
});
