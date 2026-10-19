// T-1429: a catalog connection runs as `openai-compatible` through the pinned
// fetch, while its usage and prices stay keyed by the catalog id
// (`usageProvider`). A native provider is unchanged; a non-model provider with
// no base URL is still skipped.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createKeyCipher } from '../../connections/crypto';
import { createTestContext, TEST_XMPP_DOMAIN, testSql, type TestContext } from '../../test-support';
import { loadModelTarget, loadWebSource } from './model-target';

const MASTER_KEY = 'test-master-key-0000000000000000000000';
const API_KEY = 'sk-catalog-key-do-not-leak';
const MODEL = 'deepseek-ai/DeepSeek-R1';

describe('loadModelTarget', () => {
  let context: TestContext;
  const cipher = createKeyCipher(MASTER_KEY);

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  async function seedOwner(): Promise<string> {
    const ownerId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO "user" (id, name, email) VALUES (${ownerId}, ${'Owner'}, ${`${ownerId}@example.com`})`;
      }),
    );
    return ownerId;
  }

  async function seedConnection(
    ownerId: string,
    provider: string,
    createdAt: string,
  ): Promise<string> {
    const connectionId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO provider_connections (id, owner, provider, encrypted_key, label, base_url, created_at)
          VALUES (${connectionId}, ${ownerId}, ${provider}, ${cipher.encrypt(API_KEY)}, ${null}, ${null}, ${createdAt})`;
      }),
    );
    return connectionId;
  }

  async function seedAi(ownerId: string, connectionId: string): Promise<string> {
    const aiId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status)
          VALUES (${aiId}, ${ownerId}, ${'Catalog AI'}, ${'dev'}, ${'A persona'}, ${connectionId}, ${MODEL}, ${`ai-${aiId}`}, ${`ai-${aiId}@${TEST_XMPP_DOMAIN}`}, ${'active'})`;
      }),
    );
    return aiId;
  }

  async function seed(provider: string, baseUrl: string | null): Promise<string> {
    const ownerId = await seedOwner();
    const connectionId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO provider_connections (id, owner, provider, encrypted_key, label, base_url)
          VALUES (${connectionId}, ${ownerId}, ${provider}, ${cipher.encrypt(API_KEY)}, ${null}, ${baseUrl})`;
      }),
    );
    return seedAi(ownerId, connectionId);
  }

  it('maps a catalog connection to openai-compatible with usageProvider', async () => {
    const aiId = await seed('together', 'https://api.together.xyz/v1');

    const target = await loadModelTarget(context.db, cipher, aiId);

    expect(target).toEqual({
      provider: 'openai-compatible',
      apiKey: API_KEY,
      model: MODEL,
      apiUrl: 'https://api.together.xyz/v1',
      usageProvider: 'together',
    });
  });

  it('keeps a native provider as it is', async () => {
    const aiId = await seed('openai', null);

    const target = await loadModelTarget(context.db, cipher, aiId);

    expect(target).toEqual({ provider: 'openai', apiKey: API_KEY, model: MODEL });
  });

  it('skips a non-model provider with no base URL', async () => {
    const aiId = await seed('github', null);

    expect(await loadModelTarget(context.db, cipher, aiId)).toBeNull();
  });

  it('uses the owner first web key that has the needed capability', async () => {
    const ownerId = await seedOwner();
    const connectionId = await seedConnection(ownerId, 'openai', '2026-01-01T00:00:00Z');
    const aiId = await seedAi(ownerId, connectionId);
    await seedConnection(ownerId, 'brave', '2026-01-02T00:00:00Z');
    await seedConnection(ownerId, 'tavily', '2026-01-03T00:00:00Z');
    const otherOwner = await seedOwner();
    await seedConnection(otherOwner, 'exa', '2026-01-01T00:00:00Z');

    const read = await loadWebSource(context.db, cipher, aiId, 'read');
    expect(read?.provider).toBe('tavily');
    expect(read?.label).toBe('Tavily');

    const search = await loadWebSource(context.db, cipher, aiId, 'search');
    expect(search?.provider).toBe('brave');
    expect(search?.label).toBe('Brave Search');
  });

  it('returns null for read when the owner only has a search-only key', async () => {
    const ownerId = await seedOwner();
    const connectionId = await seedConnection(ownerId, 'openai', '2026-01-01T00:00:00Z');
    const aiId = await seedAi(ownerId, connectionId);
    await seedConnection(ownerId, 'brave', '2026-01-02T00:00:00Z');
    const otherOwner = await seedOwner();
    await seedConnection(otherOwner, 'tavily', '2026-01-01T00:00:00Z');

    expect(await loadWebSource(context.db, cipher, aiId, 'read')).toBeNull();
  });
});
