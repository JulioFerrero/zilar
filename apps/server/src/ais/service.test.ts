import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type {
  AddModelInput,
  GenerateVirtualKeyInput,
  LitellmAdminClient,
  ModelListing,
  UpdateVirtualKeyInput,
  VirtualKey,
  VirtualKeyInfo,
} from '../ai/litellm-client';
import { createKeyCipher } from '../connections/crypto';
import { aiLimits, ais, llmVirtualKeys, providerConnections, user } from '../db/schema';
import { createTestContext, TEST_XMPP_DOMAIN, type TestContext } from '../test-support';
import { ensureAiModel, changeAiModel, updateAi, type AiServiceDeps } from './service';

const MASTER_KEY = 'test-master-key-0000000000000000000000';
const PROVIDER_KEY = 'sk-provider-key-do-not-leak';

class FakeLitellm implements LitellmAdminClient {
  readonly added: AddModelInput[] = [];
  readonly updated: UpdateVirtualKeyInput[] = [];
  readonly deleted: string[] = [];
  /** Every model/key call in order, so tests can assert the swap ordering. */
  readonly order: string[] = [];
  /** Models `listModels` returns, so tests can plant a stray `ai-<id>`. */
  listed: ModelListing[] = [];
  failAdd = false;
  failUpdate = false;
  private modelCounter = 0;

  addModel(input: AddModelInput): Promise<string> {
    this.added.push(input);
    this.order.push('addModel');
    if (this.failAdd) {
      return Promise.reject(new Error('gateway down'));
    }
    this.modelCounter += 1;
    return Promise.resolve(`model-${this.modelCounter}`);
  }

  deleteModel(modelId: string): Promise<void> {
    this.deleted.push(modelId);
    this.order.push('deleteModel');
    return Promise.resolve();
  }

  listModels(): Promise<ModelListing[]> {
    return Promise.resolve([...this.listed]);
  }

  generateKey(_input: GenerateVirtualKeyInput): Promise<VirtualKey> {
    throw new Error('generateKey is not used by ensureAiModel');
  }

  getKeyInfo(_key: string): Promise<VirtualKeyInfo> {
    throw new Error('getKeyInfo is not used by ensureAiModel');
  }

  updateKey(input: UpdateVirtualKeyInput): Promise<VirtualKeyInfo> {
    this.updated.push(input);
    this.order.push('updateKey');
    if (this.failUpdate) {
      return Promise.reject(new Error('gateway down'));
    }
    return Promise.resolve({
      keyAlias: null,
      maxBudget: null,
      spend: 0,
      tpmLimit: null,
      rpmLimit: null,
      blocked: null,
      models: input.models ?? [],
    });
  }

  revokeKey(_key: string): Promise<void> {
    throw new Error('revokeKey is not used by ensureAiModel');
  }
}

function depsFor(context: TestContext, litellm: FakeLitellm): AiServiceDeps {
  return {
    db: context.db,
    adminClient: context.adminClient,
    litellm,
    cipher: createKeyCipher(MASTER_KEY),
    logger: context.logger,
    domain: context.xmppConfig.domain,
  };
}

// An AI as T-0030 created it: a key row with no registered model, so its key
// allowlist still points at the raw model name.
async function seedOldAi(context: TestContext): Promise<string> {
  const ownerId = randomUUID();
  await context.db
    .insert(user)
    .values({ id: ownerId, name: 'Owner', email: `${ownerId}@example.com` });

  const connectionId = randomUUID();
  await context.db.insert(providerConnections).values({
    id: connectionId,
    owner: ownerId,
    provider: 'openai',
    encryptedKey: createKeyCipher(MASTER_KEY).encrypt(PROVIDER_KEY),
    label: null,
  });

  const aiId = randomUUID();
  await context.db.insert(ais).values({
    id: aiId,
    owner: ownerId,
    name: 'Old AI',
    template: 'dev',
    persona: 'A persona',
    providerConnectionId: connectionId,
    model: 'gpt-4o-mini',
    localpart: `ai-${aiId}`,
    jid: `ai-${aiId}@${TEST_XMPP_DOMAIN}`,
    status: 'active',
  });
  await context.db.insert(aiLimits).values({ aiId, perDayUsd: '1.00', perMonthUsd: '20.00' });
  await context.db.insert(llmVirtualKeys).values({
    aiId,
    litellmKeyId: 'old-token-1',
    litellmModelId: null,
    encryptedKey: createKeyCipher(MASTER_KEY).encrypt('sk-virtual-old'),
    budgetUsd: '20.00',
    budgetDuration: '30d',
  });
  return aiId;
}

describe('ensureAiModel', () => {
  it('registers the model, fixes an old key allowlist and stores the id', async () => {
    const context = await createTestContext();
    try {
      const litellm = new FakeLitellm();
      const aiId = await seedOldAi(context);

      await ensureAiModel(depsFor(context, litellm), aiId);

      expect(litellm.added).toEqual([
        {
          modelName: `ai-${aiId}`,
          litellmModel: 'openai/gpt-4o-mini',
          apiKey: PROVIDER_KEY,
          metadata: { ai_id: aiId },
        },
      ]);
      expect(litellm.updated).toEqual([{ key: 'old-token-1', models: [`ai-${aiId}`] }]);

      const [row] = await context.db.select().from(llmVirtualKeys);
      expect(row?.litellmModelId).toBe('model-1');
    } finally {
      await context.close();
    }
  });

  it('is idempotent: a second call does nothing', async () => {
    const context = await createTestContext();
    try {
      const litellm = new FakeLitellm();
      const aiId = await seedOldAi(context);
      const deps = depsFor(context, litellm);

      await ensureAiModel(deps, aiId);
      const afterFirst = await context.db.select().from(llmVirtualKeys);
      expect(afterFirst[0]?.litellmModelId).toBe('model-1');

      await ensureAiModel(deps, aiId);

      expect(litellm.added).toHaveLength(1);
      expect(litellm.updated).toHaveLength(1);
      expect(litellm.deleted).toHaveLength(0);
      const afterSecond = await context.db.select().from(llmVirtualKeys);
      expect(afterSecond[0]?.litellmModelId).toBe('model-1');
    } finally {
      await context.close();
    }
  });

  it('deletes the model it registered when the allowlist cannot be fixed', async () => {
    const context = await createTestContext();
    try {
      const litellm = new FakeLitellm();
      litellm.failUpdate = true;
      const aiId = await seedOldAi(context);

      await expect(ensureAiModel(depsFor(context, litellm), aiId)).rejects.toThrow('gateway down');

      expect(litellm.deleted).toEqual(['model-1']);
      const [row] = await context.db.select().from(llmVirtualKeys);
      expect(row?.litellmModelId).toBeNull();
    } finally {
      await context.close();
    }
  });

  it('rejects an unknown AI and one with no virtual key', async () => {
    const context = await createTestContext();
    try {
      const litellm = new FakeLitellm();
      const deps = depsFor(context, litellm);

      await expect(ensureAiModel(deps, randomUUID())).rejects.toThrow('not found');

      const aiId = await seedOldAi(context);
      await context.db.delete(llmVirtualKeys);
      await expect(ensureAiModel(deps, aiId)).rejects.toThrow('no virtual key');
      expect(litellm.added).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  it('registers only one model when called twice at once', async () => {
    const context = await createTestContext();
    try {
      const litellm = new FakeLitellm();
      const aiId = await seedOldAi(context);
      const deps = depsFor(context, litellm);

      await Promise.all([ensureAiModel(deps, aiId), ensureAiModel(deps, aiId)]);

      expect(litellm.added).toHaveLength(1);
      expect(litellm.updated).toEqual([{ key: 'old-token-1', models: [`ai-${aiId}`] }]);
      const [row] = await context.db.select().from(llmVirtualKeys);
      expect(row?.litellmModelId).toBe('model-1');
    } finally {
      await context.close();
    }
  });

  it('deletes a stray model left behind by an earlier attempt', async () => {
    const context = await createTestContext();
    try {
      const litellm = new FakeLitellm();
      const aiId = await seedOldAi(context);
      litellm.listed = [{ id: 'stray-model-9', name: `ai-${aiId}` }];

      await ensureAiModel(depsFor(context, litellm), aiId);

      expect(litellm.deleted).toEqual(['stray-model-9']);
      expect(litellm.added).toHaveLength(1);
      const [row] = await context.db.select().from(llmVirtualKeys);
      expect(row?.litellmModelId).toBe('model-1');
    } finally {
      await context.close();
    }
  });
});

// An AI with a registered model and its owner, for the model-swap tests.
// Registration runs through the caller's fake so model ids stay in one
// sequence; tests clear the fake's call lists after seeding.
async function seedSwappableAi(
  context: TestContext,
  litellm: FakeLitellm,
  provider = 'openai',
): Promise<{ aiId: string; ownerId: string; connectionId: string }> {
  const ownerId = randomUUID();
  await context.db
    .insert(user)
    .values({ id: ownerId, name: 'Owner', email: `${ownerId}@example.com` });

  const connectionId = randomUUID();
  await context.db.insert(providerConnections).values({
    id: connectionId,
    owner: ownerId,
    provider,
    encryptedKey: createKeyCipher(MASTER_KEY).encrypt(PROVIDER_KEY),
    label: null,
  });

  const aiId = randomUUID();
  await context.db.insert(ais).values({
    id: aiId,
    owner: ownerId,
    name: 'Swappable AI',
    template: 'dev',
    persona: 'A persona',
    providerConnectionId: connectionId,
    model: 'gpt-4o-mini',
    localpart: `ai-${aiId}`,
    jid: `ai-${aiId}@${TEST_XMPP_DOMAIN}`,
    status: 'active',
  });
  await context.db.insert(aiLimits).values({ aiId, perDayUsd: '1.00', perMonthUsd: '20.00' });
  await context.db.insert(llmVirtualKeys).values({
    aiId,
    litellmKeyId: 'swap-token-1',
    litellmModelId: null,
    encryptedKey: createKeyCipher(MASTER_KEY).encrypt('sk-virtual-swap'),
    budgetUsd: '20.00',
    budgetDuration: '30d',
  });

  await ensureAiModel(
    {
      db: context.db,
      adminClient: context.adminClient,
      litellm,
      cipher: createKeyCipher(MASTER_KEY),
      logger: context.logger,
      domain: context.xmppConfig.domain,
    },
    aiId,
  );
  litellm.added.length = 0;
  litellm.updated.length = 0;
  litellm.deleted.length = 0;
  litellm.order.length = 0;
  return { aiId, ownerId, connectionId };
}

async function addOwnedConnection(
  context: TestContext,
  ownerId: string,
  provider: string,
): Promise<string> {
  const id = randomUUID();
  await context.db.insert(providerConnections).values({
    id,
    owner: ownerId,
    provider,
    encryptedKey: createKeyCipher(MASTER_KEY).encrypt(PROVIDER_KEY),
    label: null,
  });
  return id;
}

describe('changeAiModel', () => {
  it('swaps delete-old → add-new → updateKey → DB row under the lock', async () => {
    const context = await createTestContext();
    try {
      const litellm = new FakeLitellm();
      const { aiId, ownerId, connectionId } = await seedSwappableAi(context, litellm);
      const deps = depsFor(context, litellm);

      await changeAiModel(deps, {
        id: aiId,
        ownerId,
        model: 'gpt-4o',
        providerConnectionId: connectionId,
      });

      expect(litellm.order).toEqual(['deleteModel', 'addModel', 'updateKey']);
      expect(litellm.deleted).toEqual(['model-1']);
      expect(litellm.added).toEqual([
        {
          modelName: `ai-${aiId}`,
          litellmModel: 'openai/gpt-4o',
          apiKey: PROVIDER_KEY,
          metadata: { ai_id: aiId },
        },
      ]);
      expect(litellm.updated).toEqual([{ key: 'swap-token-1', models: [`ai-${aiId}`] }]);

      const [aiRow] = await context.db.select().from(ais).where(eq(ais.id, aiId));
      expect(aiRow?.model).toBe('gpt-4o');
      expect(aiRow?.providerConnectionId).toBe(connectionId);
      const [keyRow] = await context.db.select().from(llmVirtualKeys);
      expect(keyRow?.litellmModelId).toBe('model-2');
    } finally {
      await context.close();
    }
  });

  it('moves the AI to a new connection and model together', async () => {
    const context = await createTestContext();
    try {
      const litellm = new FakeLitellm();
      const { aiId, ownerId } = await seedSwappableAi(context, litellm);
      const anthropicId = await addOwnedConnection(context, ownerId, 'anthropic');

      const updated = await updateAi(depsFor(context, litellm), {
        id: aiId,
        ownerId,
        model: 'claude-sonnet-5',
        providerConnectionId: anthropicId,
      });

      expect(updated.model).toBe('claude-sonnet-5');
      expect(updated.providerConnectionId).toBe(anthropicId);
      expect(litellm.added).toEqual([
        {
          modelName: `ai-${aiId}`,
          litellmModel: 'anthropic/claude-sonnet-5',
          apiKey: PROVIDER_KEY,
          metadata: { ai_id: aiId },
        },
      ]);
    } finally {
      await context.close();
    }
  });

  it('is a no-op when the model and connection are unchanged', async () => {
    const context = await createTestContext();
    try {
      const litellm = new FakeLitellm();
      const { aiId, ownerId, connectionId } = await seedSwappableAi(context, litellm);

      await updateAi(depsFor(context, litellm), {
        id: aiId,
        ownerId,
        model: 'gpt-4o-mini',
        providerConnectionId: connectionId,
      });

      expect(litellm.order).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it('on addModel failure leaves the row unchanged, nulls the model id, and ensure re-registers the old model', async () => {
    const context = await createTestContext();
    try {
      const litellm = new FakeLitellm();
      const { aiId, ownerId, connectionId } = await seedSwappableAi(context, litellm);
      litellm.failAdd = true;
      const deps = depsFor(context, litellm);

      await expect(
        changeAiModel(deps, {
          id: aiId,
          ownerId,
          model: 'gpt-4o',
          providerConnectionId: connectionId,
        }),
      ).rejects.toMatchObject({ status: 502 });

      const [aiRow] = await context.db.select().from(ais).where(eq(ais.id, aiId));
      expect(aiRow?.model).toBe('gpt-4o-mini');
      expect(aiRow?.providerConnectionId).toBe(connectionId);
      const [keyRow] = await context.db.select().from(llmVirtualKeys);
      expect(keyRow?.litellmModelId).toBeNull();

      // The next gateway turn re-registers the old model, so the AI works.
      litellm.failAdd = false;
      litellm.order.length = 0;
      await ensureAiModel(deps, aiId);
      expect(litellm.added.at(-1)).toMatchObject({
        modelName: `ai-${aiId}`,
        litellmModel: 'openai/gpt-4o-mini',
      });
      const [recovered] = await context.db.select().from(llmVirtualKeys);
      expect(recovered?.litellmModelId).not.toBeNull();
    } finally {
      await context.close();
    }
  });

  it('on updateKey failure deletes the new model and leaves the row unchanged', async () => {
    const context = await createTestContext();
    try {
      const litellm = new FakeLitellm();
      const { aiId, ownerId, connectionId } = await seedSwappableAi(context, litellm);
      litellm.failUpdate = true;

      await expect(
        changeAiModel(depsFor(context, litellm), {
          id: aiId,
          ownerId,
          model: 'gpt-4o',
          providerConnectionId: connectionId,
        }),
      ).rejects.toMatchObject({ status: 502 });

      // The old model is gone and the new one is cleaned up: no orphans.
      expect(litellm.deleted).toEqual(['model-1', 'model-2']);
      const [aiRow] = await context.db.select().from(ais).where(eq(ais.id, aiId));
      expect(aiRow?.model).toBe('gpt-4o-mini');
      const [keyRow] = await context.db.select().from(llmVirtualKeys);
      expect(keyRow?.litellmModelId).toBeNull();
    } finally {
      await context.close();
    }
  });

  it('serializes a concurrent ensureAiModel and changeAiModel with no orphans', async () => {
    const context = await createTestContext();
    try {
      // An old AI: a key row with no registered model yet.
      const aiId = await seedOldAi(context);
      const [aiRow] = await context.db.select().from(ais).where(eq(ais.id, aiId));
      const litellm = new FakeLitellm();
      const deps = depsFor(context, litellm);

      await Promise.all([
        ensureAiModel(deps, aiId),
        changeAiModel(deps, {
          id: aiId,
          ownerId: aiRow!.owner,
          model: 'gpt-4o',
          providerConnectionId: aiRow!.providerConnectionId,
        }),
      ]);

      const [finalAi] = await context.db.select().from(ais).where(eq(ais.id, aiId));
      expect(finalAi?.model).toBe('gpt-4o');
      const [keyRow] = await context.db.select().from(llmVirtualKeys);
      expect(keyRow?.litellmModelId).not.toBeNull();
      expect(litellm.updated.at(-1)).toEqual({ key: 'old-token-1', models: [`ai-${aiId}`] });
      // Every registered model but the live one was deleted.
      const liveId = keyRow?.litellmModelId;
      const registered = litellm.added.map((_, index) => `model-${index + 1}`);
      for (const id of registered) {
        if (id !== liveId) {
          expect(litellm.deleted).toContain(id);
        }
      }
    } finally {
      await context.close();
    }
  });

  it('rejects a foreign connection with 404 and a connection without a model with 400', async () => {
    const context = await createTestContext();
    try {
      const litellm = new FakeLitellm();
      const { aiId, ownerId } = await seedSwappableAi(context, litellm);
      const deps = depsFor(context, litellm);

      await expect(
        changeAiModel(deps, {
          id: aiId,
          ownerId: 'someone-else',
          model: 'gpt-4o',
          providerConnectionId: 'nope',
        }),
      ).rejects.toMatchObject({ status: 404 });

      const strangerId = randomUUID();
      await context.db
        .insert(user)
        .values({ id: strangerId, name: 'Stranger', email: `${strangerId}@example.com` });
      const strangerConnection = await addOwnedConnection(context, strangerId, 'openai');
      await expect(
        changeAiModel(deps, {
          id: aiId,
          ownerId,
          model: 'gpt-4o',
          providerConnectionId: strangerConnection,
        }),
      ).rejects.toMatchObject({ status: 404 });

      await expect(
        updateAi(deps, { id: aiId, ownerId, providerConnectionId: strangerConnection }),
      ).rejects.toMatchObject({ status: 400 });

      expect(litellm.order).toEqual([]);
      const [aiRow] = await context.db.select().from(ais).where(eq(ais.id, aiId));
      expect(aiRow?.model).toBe('gpt-4o-mini');
    } finally {
      await context.close();
    }
  });

  it('never logs key material', async () => {
    const context = await createTestContext();
    try {
      const litellm = new FakeLitellm();
      const { aiId, ownerId, connectionId } = await seedSwappableAi(context, litellm);
      litellm.failAdd = true;
      const deps = depsFor(context, litellm);

      await changeAiModel(deps, {
        id: aiId,
        ownerId,
        model: 'gpt-4o',
        providerConnectionId: connectionId,
      }).catch(() => undefined);

      const logs = context.logOutput();
      expect(logs).not.toContain(PROVIDER_KEY);
      expect(logs).not.toContain('sk-virtual');
      expect(logs).toContain(aiId);
    } finally {
      await context.close();
    }
  });
});
