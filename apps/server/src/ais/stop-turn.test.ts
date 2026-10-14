// T-1422: the stop-turn route is owner only. The owner gets the gateway's
// answer; anyone else gets the same 404 as an unknown AI, and the gateway is
// never reached.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { TurnStopper } from '../agents/gateway/stop-types';
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

describe('stop-turn route (T-1422)', () => {
  let context: TestContext;
  let app: TestApp;
  let stopper: TurnStopper | null;
  let calls: Array<{ aiId: string; chatJid: string }>;

  beforeEach(async () => {
    context = await createTestContext();
    stopper = null;
    calls = [];
    app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      ais: { cipher: createKeyCipher(MASTER_KEY) },
      getGateway: () => stopper,
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
        yield* sql`INSERT INTO provider_connections (id, owner, provider, encrypted_key, label)
          VALUES (${id}, ${ownerId}, 'openai', ${createKeyCipher(MASTER_KEY).encrypt(PROVIDER_KEY)}, ${null})`;
      }),
    );
    return id;
  }

  function stopRequest(cookie: string, aiId: string, chatJid: string): Promise<Response> {
    return app.request(`${TEST_BASE_URL}/api/ais/${aiId}/turns/stop`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ chatJid }),
    });
  }

  it('answers the owner and hides the route from everyone else', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');
    const connectionId = await addConnection(owner.id);
    const created = await app.request(`${TEST_BASE_URL}/api/ais`, {
      method: 'POST',
      headers: { cookie: owner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Dev-1',
        template: 'dev',
        providerConnectionId: connectionId,
        model: 'gpt-4o-mini',
        limits: { perDayUsd: 1, perMonthUsd: 20 },
      }),
    });
    expect(created.status).toBe(201);
    const ai = (await created.json()) as { id: string };

    stopper = {
      stopTurn: (aiId, chatJid) => {
        calls.push({ aiId, chatJid });
        return true;
      },
    };

    const ok = await stopRequest(owner.cookie, ai.id, 'ai-dev-1@zilar.test');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ stopped: true });
    expect(calls).toEqual([{ aiId: ai.id, chatJid: 'ai-dev-1@zilar.test' }]);

    // A stranger gets the same 404 as an unknown AI and never reaches the gateway.
    const foreign = await stopRequest(stranger.cookie, ai.id, 'ai-dev-1@zilar.test');
    expect(foreign.status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it('answers stopped:false when no turn is running', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const connectionId = await addConnection(owner.id);
    const created = await app.request(`${TEST_BASE_URL}/api/ais`, {
      method: 'POST',
      headers: { cookie: owner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Dev-2',
        template: 'dev',
        providerConnectionId: connectionId,
        model: 'gpt-4o-mini',
        limits: { perDayUsd: 1, perMonthUsd: 20 },
      }),
    });
    const ai = (await created.json()) as { id: string };
    stopper = { stopTurn: () => false };

    const response = await stopRequest(owner.cookie, ai.id, 'nothing-running@zilar.test');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stopped: false });
  });
});
