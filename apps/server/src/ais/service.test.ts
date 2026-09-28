import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  AddModelInput,
  GenerateVirtualKeyInput,
  LitellmAdminClient,
  UpdateVirtualKeyInput,
  VirtualKey,
  VirtualKeyInfo,
} from '../ai/litellm-client';
import { createKeyCipher } from '../connections/crypto';
import { aiLimits, ais, llmVirtualKeys, providerConnections, user } from '../db/schema';
import { createTestContext, TEST_XMPP_DOMAIN, type TestContext } from '../test-support';
import { ensureAiModel, type AiServiceDeps } from './service';

const MASTER_KEY = 'test-master-key-0000000000000000000000';
const PROVIDER_KEY = 'sk-provider-key-do-not-leak';

class FakeLitellm implements LitellmAdminClient {
  readonly added: AddModelInput[] = [];
  readonly updated: UpdateVirtualKeyInput[] = [];
  readonly deleted: string[] = [];
  failUpdate = false;
  private modelCounter = 0;

  addModel(input: AddModelInput): Promise<string> {
    this.added.push(input);
    this.modelCounter += 1;
    return Promise.resolve(`model-${this.modelCounter}`);
  }

  deleteModel(modelId: string): Promise<void> {
    this.deleted.push(modelId);
    return Promise.resolve();
  }

  generateKey(_input: GenerateVirtualKeyInput): Promise<VirtualKey> {
    throw new Error('generateKey is not used by ensureAiModel');
  }

  getKeyInfo(_key: string): Promise<VirtualKeyInfo> {
    throw new Error('getKeyInfo is not used by ensureAiModel');
  }

  updateKey(input: UpdateVirtualKeyInput): Promise<VirtualKeyInfo> {
    this.updated.push(input);
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
});
