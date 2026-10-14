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
import { loadModelTarget } from './model-target';

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

  async function seed(provider: string, baseUrl: string | null): Promise<string> {
    const ownerId = randomUUID();
    const connectionId = randomUUID();
    const aiId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO "user" (id, name, email) VALUES (${ownerId}, ${'Owner'}, ${`${ownerId}@example.com`})`;
        yield* sql`INSERT INTO provider_connections (id, owner, provider, encrypted_key, label, base_url)
          VALUES (${connectionId}, ${ownerId}, ${provider}, ${cipher.encrypt(API_KEY)}, ${null}, ${baseUrl})`;
        yield* sql`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status)
          VALUES (${aiId}, ${ownerId}, ${'Catalog AI'}, ${'dev'}, ${'A persona'}, ${connectionId}, ${MODEL}, ${`ai-${aiId}`}, ${`ai-${aiId}@${TEST_XMPP_DOMAIN}`}, ${'active'})`;
      }),
    );
    return aiId;
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
});
