// Replacing a provider key in place (T-1292): the owner swaps the key without
// a new connection, the stored copy stays encrypted, the AIs on the connection
// have their `litellm_model_id` cleared so the model registers again, another
// user sees the same 404 as an unknown id, and the key never reaches a response.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createApp } from '../app';
import { createKeyCipher, type KeyCipher } from './crypto';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testSql,
  TEST_BASE_URL,
  TEST_XMPP_DOMAIN,
  type SignedInUser,
  type TestContext,
} from '../test-support';

const MASTER_KEY = 'test-master-key-0000000000000000000000';
const OLD_KEY = 'sk-old-provider-key-do-not-leak';
const NEW_KEY = 'sk-new-provider-key-do-not-leak';

describe('replacing a provider key', () => {
  let context: TestContext;
  let cipher: KeyCipher;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    context = await createTestContext();
    cipher = createKeyCipher(MASTER_KEY);
    // The base test config has no master key, so the cipher is injected here.
    app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      connections: { cipher },
    });
  });

  afterEach(async () => {
    await context.close();
  });

  async function createConnection(user: SignedInUser): Promise<string> {
    const response = await app.request(`${TEST_BASE_URL}/api/connections`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', key: OLD_KEY }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string };
    return body.id;
  }

  // An AI owned by `ownerId` on `connectionId`, with a registered model id.
  async function seedAi(ownerId: string, connectionId: string): Promise<string> {
    const aiId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status)
          VALUES (${aiId}, ${ownerId}, ${'Keyed AI'}, ${'dev'}, ${'A persona'}, ${connectionId}, ${'gpt-4o-mini'}, ${`ai-${aiId}`}, ${`ai-${aiId}@${TEST_XMPP_DOMAIN}`}, ${'active'})`;
        yield* sql`INSERT INTO llm_virtual_keys (ai_id, litellm_key_id, litellm_model_id, encrypted_key, budget_usd, budget_duration)
          VALUES (${aiId}, ${`tok-${aiId}`}, ${'model-1'}, ${cipher.encrypt('sk-virtual-do-not-leak')}, ${'20.00'}, ${'30d'})`;
      }),
    );
    return aiId;
  }

  async function storedKey(connectionId: string): Promise<string> {
    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ encryptedKey: string }>`SELECT encrypted_key FROM provider_connections
          WHERE id = ${connectionId} LIMIT 1`;
      }),
    );
    return rows[0]!.encryptedKey;
  }

  async function modelIdFor(aiId: string): Promise<string | null> {
    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{
          litellmModelId: string | null;
        }>`SELECT litellm_model_id FROM llm_virtual_keys
          WHERE ai_id = ${aiId} LIMIT 1`;
      }),
    );
    return rows[0]!.litellmModelId;
  }

  function replaceKey(user: SignedInUser, connectionId: string, key: string): Promise<Response> {
    return app.request(`${TEST_BASE_URL}/api/connections/${connectionId}`, {
      method: 'PATCH',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
    });
  }

  it("stores the new key encrypted and clears the AIs' model id", async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const connectionId = await createConnection(owner);
    const aiId = await seedAi(owner.id, connectionId);
    expect(await modelIdFor(aiId)).toBe('model-1');

    const response = await replaceKey(owner, connectionId, NEW_KEY);

    expect(response.status).toBe(200);
    const stored = await storedKey(connectionId);
    expect(stored).not.toBe(OLD_KEY);
    expect(cipher.decrypt(stored)).toBe(NEW_KEY);
    expect(await modelIdFor(aiId)).toBeNull();
  });

  it('answers 404 for a connection owned by someone else', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const connectionId = await createConnection(owner);
    const stranger = await contactOf(context, app, owner.id, 'stranger@example.com');
    const before = await storedKey(connectionId);

    const response = await replaceKey(stranger, connectionId, NEW_KEY);

    expect(response.status).toBe(404);
    expect(await storedKey(connectionId)).toBe(before);
  });

  it('never returns the key in the response', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const connectionId = await createConnection(owner);

    const response = await replaceKey(owner, connectionId, NEW_KEY);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain(NEW_KEY);
    expect(text).not.toContain(OLD_KEY);
    expect(text).not.toContain('encryptedKey');
  });
});
