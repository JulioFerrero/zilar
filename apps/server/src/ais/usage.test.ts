import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { LitellmAdminClient, VirtualKeyInfo } from '../ai/litellm-client';
import { createKeyCipher } from '../connections/crypto';
import {
  aiDailySpend,
  aiLimits,
  ais,
  llmVirtualKeys,
  providerConnections,
  user,
} from '../db/schema';
import { createTestContext, TEST_XMPP_DOMAIN, type TestContext } from '../test-support';
import { getAiUsage, utcDayString, type AiUsageDeps } from './usage';

const MASTER_KEY = 'test-master-key-0000000000000000000000';
const PROVIDER_KEY = 'sk-provider-key-do-not-leak';

// A LiteLLM stand-in whose key spend the test sets directly. Failures are
// toggled per test, so the fail-open path is covered without the network.
class FakeLitellm implements LitellmAdminClient {
  spendByKey = new Map<string, number>();
  failKeyInfo = false;
  readonly seenKeys: string[] = [];

  getKeyInfo(key: string): Promise<VirtualKeyInfo> {
    this.seenKeys.push(key);
    if (this.failKeyInfo) {
      return Promise.reject(new Error('LiteLLM is down'));
    }
    return Promise.resolve({
      keyAlias: null,
      maxBudget: 20,
      spend: this.spendByKey.get(key) ?? 0,
      tpmLimit: null,
      rpmLimit: null,
      blocked: null,
      models: [],
    });
  }

  generateKey(): Promise<never> {
    throw new Error('generateKey is not used by usage');
  }

  updateKey(): Promise<never> {
    throw new Error('updateKey is not used by usage');
  }

  revokeKey(): Promise<void> {
    return Promise.resolve();
  }

  addModel(): Promise<never> {
    throw new Error('addModel is not used by usage');
  }

  deleteModel(): Promise<void> {
    return Promise.resolve();
  }

  listModels(): Promise<[]> {
    return Promise.resolve([]);
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

describe('getAiUsage', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  async function seedAi(keyId: string | null = 'tok-usage-1'): Promise<string> {
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
      name: 'Spendy AI',
      template: 'dev',
      persona: 'A persona',
      providerConnectionId: connectionId,
      model: 'gpt-4o-mini',
      localpart: `ai-${aiId}`,
      jid: `ai-${aiId}@${TEST_XMPP_DOMAIN}`,
      status: 'active',
    });
    await context.db.insert(aiLimits).values({ aiId, perDayUsd: '2.00', perMonthUsd: '20.00' });
    await context.db.insert(llmVirtualKeys).values({
      aiId,
      litellmKeyId: keyId,
      litellmModelId: 'model-1',
      encryptedKey: createKeyCipher(MASTER_KEY).encrypt('sk-virtual-usage-do-not-leak'),
      budgetUsd: '20.00',
      budgetDuration: '30d',
    });
    return aiId;
  }

  function depsFor(
    litellm: FakeLitellm,
    now: () => Date = () => new Date('2026-09-28T12:00:00Z'),
    logger = captureLogger(),
  ): { deps: AiUsageDeps; logger: ReturnType<typeof captureLogger> } {
    return { deps: { db: context.db, litellm, logger, now }, logger };
  }

  async function baselineFor(aiId: string, day: string): Promise<string | null> {
    const [row] = await context.db
      .select({ baselineUsd: aiDailySpend.baselineUsd })
      .from(aiDailySpend)
      .where(and(eq(aiDailySpend.aiId, aiId), eq(aiDailySpend.day, day)))
      .limit(1);
    return row?.baselineUsd ?? null;
  }

  it('records the baseline on the first read of the day and answers today 0', async () => {
    const litellm = new FakeLitellm();
    litellm.spendByKey.set('tok-usage-1', 1.5);
    const aiId = await seedAi();
    const { deps } = depsFor(litellm);

    const usage = await getAiUsage(deps, aiId);

    expect(usage).toEqual({
      todayUsd: 0,
      windowUsd: 1.5,
      perDayUsd: 2,
      perMonthUsd: 20,
      dailyLimitReached: false,
    });
    expect(await baselineFor(aiId, '2026-09-28')).toBe('1.50');
    // The token id addresses the key: the usable secret never travels.
    expect(litellm.seenKeys).toEqual(['tok-usage-1']);
  });

  it('answers the delta on a later read', async () => {
    const litellm = new FakeLitellm();
    litellm.spendByKey.set('tok-usage-1', 1.5);
    const aiId = await seedAi();
    const { deps } = depsFor(litellm);

    await getAiUsage(deps, aiId);
    litellm.spendByKey.set('tok-usage-1', 2.5);

    const usage = await getAiUsage(deps, aiId);
    expect(usage).toEqual({
      todayUsd: 1,
      windowUsd: 2.5,
      perDayUsd: 2,
      perMonthUsd: 20,
      dailyLimitReached: false,
    });
  });

  it('marks the daily limit reached at or above the per-day cap', async () => {
    const litellm = new FakeLitellm();
    litellm.spendByKey.set('tok-usage-1', 0.5);
    const aiId = await seedAi();
    const { deps } = depsFor(litellm);

    await getAiUsage(deps, aiId);
    litellm.spendByKey.set('tok-usage-1', 2.5);

    const usage = await getAiUsage(deps, aiId);
    expect(usage?.todayUsd).toBe(2);
    expect(usage?.dailyLimitReached).toBe(true);
  });

  it('resets the baseline when the window spend drops', async () => {
    const litellm = new FakeLitellm();
    litellm.spendByKey.set('tok-usage-1', 5);
    const aiId = await seedAi();
    const { deps } = depsFor(litellm);

    await getAiUsage(deps, aiId);
    // The 30-day window reset: the cumulative spend drops back.
    litellm.spendByKey.set('tok-usage-1', 0.25);

    const reset = await getAiUsage(deps, aiId);
    expect(reset).toEqual({
      todayUsd: 0,
      windowUsd: 0.25,
      perDayUsd: 2,
      perMonthUsd: 20,
      dailyLimitReached: false,
    });
    expect(await baselineFor(aiId, '2026-09-28')).toBe('0.25');

    litellm.spendByKey.set('tok-usage-1', 1.25);
    const later = await getAiUsage(deps, aiId);
    expect(later?.todayUsd).toBe(1);
  });

  it('stores one row and the same answer for two concurrent first reads', async () => {
    const litellm = new FakeLitellm();
    litellm.spendByKey.set('tok-usage-1', 3.25);
    const aiId = await seedAi();
    const { deps } = depsFor(litellm);

    const [first, second] = await Promise.all([getAiUsage(deps, aiId), getAiUsage(deps, aiId)]);

    expect(first?.todayUsd).toBe(0);
    expect(second?.todayUsd).toBe(0);
    const rows = await context.db.select().from(aiDailySpend);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ aiId, baselineUsd: '3.25' });
  });

  it('returns null when LiteLLM fails and logs ids only', async () => {
    const litellm = new FakeLitellm();
    litellm.failKeyInfo = true;
    const aiId = await seedAi();
    const { deps, logger } = depsFor(litellm);

    expect(await getAiUsage(deps, aiId)).toBeNull();
    expect(await context.db.select().from(aiDailySpend)).toHaveLength(0);
    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0]?.fields['aiId']).toBe(aiId);
    const logged = JSON.stringify(logger.calls);
    expect(logged).not.toContain('sk-virtual');
    expect(logged).not.toContain(PROVIDER_KEY);
  });

  it('returns null for a missing AI and one with no virtual key', async () => {
    const litellm = new FakeLitellm();
    const { deps } = depsFor(litellm);

    expect(await getAiUsage(deps, randomUUID())).toBeNull();
    expect(await getAiUsage(deps, await seedAi(null))).toBeNull();
    expect(litellm.seenKeys).toHaveLength(0);
  });

  it('starts a fresh baseline on the next UTC day with an injected clock', async () => {
    const litellm = new FakeLitellm();
    litellm.spendByKey.set('tok-usage-1', 1.5);
    const aiId = await seedAi();
    let current = new Date('2026-09-28T23:30:00Z');
    const { deps } = depsFor(litellm, () => current);

    const first = await getAiUsage(deps, aiId);
    expect(first?.todayUsd).toBe(0);

    litellm.spendByKey.set('tok-usage-1', 2.5);
    const sameDay = await getAiUsage(deps, aiId);
    expect(sameDay?.todayUsd).toBe(1);

    // Just after midnight UTC the same spend starts a new day at 0.
    current = new Date('2026-09-29T00:30:00Z');
    const nextDay = await getAiUsage(deps, aiId);
    expect(nextDay).toEqual({
      todayUsd: 0,
      windowUsd: 2.5,
      perDayUsd: 2,
      perMonthUsd: 20,
      dailyLimitReached: false,
    });
    expect(utcDayString(current)).toBe('2026-09-29');
    expect(await baselineFor(aiId, '2026-09-28')).toBe('1.50');
    expect(await baselineFor(aiId, '2026-09-29')).toBe('2.50');
  });
});
