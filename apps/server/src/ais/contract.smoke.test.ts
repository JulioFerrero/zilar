// The AIs case of the contract drift detector (T-0893): the client derived
// from `@zilar/api-contract` runs against the real app, mounted with a key
// cipher and a fake LiteLLM so an AI can be created.

import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, runApi } from '@zilar/api-contract';
import { FakeLitellm } from '../agents/gateway.test-harness';
import { createApp } from '../app';
import { createKeyCipher } from '../connections/crypto';
import type { ProviderProbe } from '../connections/probe';
import { cookieClientFor } from '../connections/smoke-client';
import { bootstrapUser, createTestContext, testSql, type TestContext } from '../test-support';

const MASTER_KEY = 'test-master-key-0000000000000000000000';

const probe: ProviderProbe = { testKey: async () => ({ ok: true }) };

describe('api contract smoke: ais (T-0893)', () => {
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
      connections: { cipher: createKeyCipher(MASTER_KEY), probe },
      ais: {
        cipher: createKeyCipher(MASTER_KEY),
        litellm: new FakeLitellm({ idSuffix: '-smoke', keyInfoMaxBudget: null }),
      },
    });
  });

  afterEach(async () => {
    await context.close();
  });

  async function addConnection(ownerId: string): Promise<string> {
    const id = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO provider_connections ${sql.insert({
          id,
          owner: ownerId,
          provider: 'openai',
          encrypted_key: createKeyCipher(MASTER_KEY).encrypt('sk-provider-key-smoke'),
          label: null,
          status: 'active',
        })}`;
      }),
    );
    return id;
  }

  it('creates, lists, reads, stops, resumes, patches and deletes an AI through the derived client', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const connectionId = await addConnection(owner.id);
    const web = cookieClientFor(app, owner.cookie);

    const created = await runApi(
      web.ais.create({
        payload: {
          name: 'Dev-1',
          template: 'dev',
          providerConnectionId: connectionId,
          model: 'gpt-4o-mini',
          limits: { perDayUsd: 1, perMonthUsd: 20 },
        },
      }),
    );
    expect(created).toMatchObject({ name: 'Dev-1', status: 'active', machineId: null });
    expect(typeof created.createdAt).toBe('string');

    const listed = await runApi(web.ais.list());
    expect(listed.map((ai) => ai.id)).toEqual([created.id]);
    const detail = await runApi(web.ais.detail({ params: { id: created.id } }));
    expect(detail.id).toBe(created.id);

    const stopped = await runApi(web.ais.stop({ params: { id: created.id } }));
    expect(stopped.status).toBe('stopped');
    const resumed = await runApi(web.ais.resume({ params: { id: created.id } }));
    expect(resumed.status).toBe('active');

    const patched = await runApi(
      web.ais.patch({ params: { id: created.id }, payload: { name: 'Dev-2' } }),
    );
    expect(patched.name).toBe('Dev-2');
    const cleared = await runApi(
      web.ais.assignMachine({ params: { id: created.id }, payload: { machineId: null } }),
    );
    expect(cleared.machineId).toBeNull();

    await runApi(web.ais.remove({ params: { id: created.id } }));
    expect(await runApi(web.ais.list())).toEqual([]);
  });

  it('maps an unknown AI, a client-side invalid payload and a missing session to their envelopes', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = cookieClientFor(app, owner.cookie);

    const missing = await runApi(web.ais.detail({ params: { id: 'nope' } })).catch(
      (error: unknown) => error,
    );
    expect(missing).toBeInstanceOf(ApiError);
    expect(missing).toMatchObject({ status: 404, code: 'not_found' });

    const invalid = await runApi(
      web.ais.create({
        payload: {
          name: 'Dev-1',
          template: 'dev',
          providerConnectionId: 'c',
          model: 'm',
          limits: { perDayUsd: 5, perMonthUsd: 1 },
        },
      }),
    ).catch((error: unknown) => error);
    expect(invalid).toMatchObject({ status: 400, code: 'invalid_request' });

    const anonymous = await runApi(cookieClientFor(app, '').ais.list()).catch(
      (error: unknown) => error,
    );
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });
  });
});
