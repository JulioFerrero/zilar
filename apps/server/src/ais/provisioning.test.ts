// AI provisioning with the key cipher set and no remote gateway (the
// production shape): creating, editing and deleting an AI works. No provider
// key is read on the write path. The refusals for a foreign connection and a
// non-LLM one survive.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createApp } from '../app';
import { createKeyCipher } from '../connections/crypto';
import {
  bootstrapUser,
  createTestContext,
  testSql,
  TEST_BASE_URL,
  type TestApp,
  type TestContext,
} from '../test-support';

const MASTER_KEY = 'test-master-key-0000000000000000000000';
const PROVIDER_KEY = 'sk-provider-key-do-not-leak';

describe('AI provisioning without a remote gateway', () => {
  let context: TestContext;
  let app: TestApp;

  beforeEach(async () => {
    context = await createTestContext();
    // The cipher is set; no remote gateway is involved.
    app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      ais: { cipher: createKeyCipher(MASTER_KEY) },
    });
  });

  afterEach(async () => {
    await context.close();
  });

  async function addConnection(ownerId: string, provider = 'openai'): Promise<string> {
    const id = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO provider_connections (id, owner, provider, encrypted_key, label)
          VALUES (${id}, ${ownerId}, ${provider}, ${createKeyCipher(MASTER_KEY).encrypt(PROVIDER_KEY)}, ${null})`;
      }),
    );
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

  function postAi(cookie: string, body: unknown): Promise<Response> {
    return app.request(`${TEST_BASE_URL}/api/ais`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function counts(): Promise<{ ais: number; limits: number }> {
    const [row] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ ais: number; limits: number }>`SELECT
          (SELECT count(*)::int FROM ais) AS ais,
          (SELECT count(*)::int FROM ai_limits) AS limits`;
      }),
    );
    return row ?? { ais: 0, limits: 0 };
  }

  it('creates, edits model and limits, then deletes', async () => {
    const user = await bootstrapUser(context, app, 'owner@example.com');
    const connectionId = await addConnection(user.id);
    const otherConnectionId = await addConnection(user.id, 'anthropic');

    const created = await postAi(user.cookie, createBody(connectionId));
    expect(created.status).toBe(201);
    const ai = (await created.json()) as {
      id: string;
      status: string;
      model: string;
      providerConnectionId: string;
    };
    expect(ai).toMatchObject({
      status: 'active',
      model: 'gpt-4o-mini',
      providerConnectionId: connectionId,
    });
    // The write path wrote the AI and its limits rows and nothing else.
    expect(await counts()).toEqual({ ais: 1, limits: 1 });

    // The model swap is a plain row update; the limit change touches only
    // ai_limits.
    const patched = await app.request(`${TEST_BASE_URL}/api/ais/${ai.id}`, {
      method: 'PATCH',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet',
        providerConnectionId: otherConnectionId,
        limits: { perDayUsd: 2, perMonthUsd: 50 },
      }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      model: 'claude-3-5-sonnet',
      providerConnectionId: otherConnectionId,
      limits: { perDayUsd: 2, perMonthUsd: 50 },
    });
    expect(await counts()).toEqual({ ais: 1, limits: 1 });

    const removed = await app.request(`${TEST_BASE_URL}/api/ais/${ai.id}`, {
      method: 'DELETE',
      headers: { cookie: user.cookie },
    });
    expect(removed.status).toBe(204);
    expect(await counts()).toEqual({ ais: 0, limits: 0 });
  });

  it("refuses another user's connection and a non-LLM connection", async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');
    const strangerConnection = await addConnection(stranger.id);
    const githubConnection = await addConnection(owner.id, 'github');
    const ownerConnection = await addConnection(owner.id);

    const foreign = await postAi(owner.cookie, createBody(strangerConnection));
    expect(foreign.status).toBe(400);
    expect(((await foreign.json()) as { error: { code: string } }).error.code).toBe(
      'invalid_connection',
    );

    const github = await postAi(owner.cookie, createBody(githubConnection));
    expect(github.status).toBe(400);
    expect(((await github.json()) as { error: { code: string } }).error.code).toBe(
      'connection_not_llm',
    );

    // Neither refused attempt wrote an AI.
    expect(await counts()).toEqual({ ais: 0, limits: 0 });

    const ok = await postAi(owner.cookie, createBody(ownerConnection));
    expect(ok.status).toBe(201);
  });
});
