// T-1984: creating and editing a provider key carry a per-user write budget
// (10 per minute) and a per-user cap (50 active keys), like every other write.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createApp } from '../app';
import { createKeyCipher } from './crypto';
import {
  bootstrapUser,
  createTestContext,
  testSql,
  TEST_BASE_URL,
  type TestContext,
} from '../test-support';

const MASTER_KEY = 'test-master-key-0000000000000000000000';
const KEY = 'sk-provider-key-do-not-leak';

function errorOf(body: unknown): { code: string; message: string } {
  return (body as { error: { code: string; message: string } }).error;
}

describe('connection write limits', () => {
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
      connections: { cipher: createKeyCipher(MASTER_KEY) },
    });
  });

  afterEach(async () => {
    await context.close();
  });

  function create(user: { cookie: string }): Promise<Response> {
    return app.request(`${TEST_BASE_URL}/api/connections`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', key: KEY }),
    });
  }

  function replaceKey(user: { cookie: string }, connectionId: string): Promise<Response> {
    return app.request(`${TEST_BASE_URL}/api/connections/${connectionId}`, {
      method: 'PATCH',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ key: KEY }),
    });
  }

  async function seedConnections(ownerId: string, count: number): Promise<void> {
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        for (let index = 0; index < count; index += 1) {
          yield* sql`INSERT INTO provider_connections
            (id, owner, provider, encrypted_key, label, base_url)
            VALUES (${randomUUID()}, ${ownerId}, 'openai', 'ciphertext', NULL, NULL)`;
        }
      }),
    );
  }

  async function countConnections(ownerId: string): Promise<number> {
    const [row] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ total: number }>`SELECT count(*)::int AS total
          FROM provider_connections WHERE owner = ${ownerId}`;
      }),
    );
    return Number(row?.total ?? 0);
  }

  it('answers 429 on the 11th create in a minute', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');

    for (let index = 0; index < 10; index += 1) {
      expect((await create(owner)).status).toBe(201);
    }

    const blocked = await create(owner);

    expect(blocked.status).toBe(429);
    expect(errorOf(await blocked.json()).code).toBe('rate_limited');
    expect(await countConnections(owner.id)).toBe(10);
  });

  it('answers 429 on the 11th write when create and update share the budget', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const created = (await (await create(owner)).json()) as { id: string };
    const connectionId = created.id;

    for (let index = 0; index < 9; index += 1) {
      expect((await replaceKey(owner, connectionId)).status).toBe(200);
    }

    const blocked = await replaceKey(owner, connectionId);

    expect(blocked.status).toBe(429);
    expect(errorOf(await blocked.json()).code).toBe('rate_limited');
  });

  it('lets a user save the 50th key', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    await seedConnections(owner.id, 49);

    expect((await create(owner)).status).toBe(201);
    expect(await countConnections(owner.id)).toBe(50);
  });

  it('answers 409 at 50 saved keys and inserts nothing', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    await seedConnections(owner.id, 50);

    const blocked = await create(owner);

    expect(blocked.status).toBe(409);
    expect(errorOf(await blocked.json())).toMatchObject({
      code: 'limit_reached',
      message: 'You have too many saved keys. Remove one first.',
    });
    expect(await countConnections(owner.id)).toBe(50);
  });

  it('keeps the cap per user', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    await seedConnections(owner.id, 50);
    const other = await bootstrapUser(context, app, 'other@example.com');

    expect((await create(other)).status).toBe(201);
  });
});
