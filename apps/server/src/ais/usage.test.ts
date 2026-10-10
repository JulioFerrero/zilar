import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createKeyCipher } from '../connections/crypto';
import { createTestContext, TEST_XMPP_DOMAIN, testSql, type TestContext } from '../test-support';
import { getAiUsage, utcDayString, type AiUsageDeps } from './usage';
import { FakeLitellm } from '../agents/gateway.test-harness';

const MASTER_KEY = 'test-master-key-0000000000000000000000';
const PROVIDER_KEY = 'sk-provider-key-do-not-leak';

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
    const connectionId = randomUUID();
    const aiId = randomUUID();
    const encryptedConnection = createKeyCipher(MASTER_KEY).encrypt(PROVIDER_KEY);
    const encryptedVirtual = createKeyCipher(MASTER_KEY).encrypt('sk-virtual-usage-do-not-leak');
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO "user" (id, name, email) VALUES (${ownerId}, ${'Owner'}, ${`${ownerId}@example.com`})`;
        yield* sql`INSERT INTO provider_connections (id, owner, provider, encrypted_key, label)
          VALUES (${connectionId}, ${ownerId}, ${'openai'}, ${encryptedConnection}, ${null})`;
        yield* sql`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status)
          VALUES (${aiId}, ${ownerId}, ${'Spendy AI'}, ${'dev'}, ${'A persona'}, ${connectionId}, ${'gpt-4o-mini'}, ${`ai-${aiId}`}, ${`ai-${aiId}@${TEST_XMPP_DOMAIN}`}, ${'active'})`;
        yield* sql`INSERT INTO ai_limits (ai_id, per_day_usd, per_month_usd) VALUES (${aiId}, ${'2.00'}, ${'20.00'})`;
        yield* sql`INSERT INTO llm_virtual_keys (ai_id, litellm_key_id, litellm_model_id, encrypted_key, budget_usd, budget_duration)
          VALUES (${aiId}, ${keyId}, ${'model-1'}, ${encryptedVirtual}, ${'20.00'}, ${'30d'})`;
      }),
    );
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
    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{
          baselineUsd: string;
        }>`SELECT baseline_usd FROM ai_daily_spend WHERE ai_id = ${aiId} AND day = ${day} LIMIT 1`;
      }),
    );
    return rows[0]?.baselineUsd ?? null;
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
      dailyWarning: false,
      monthlyWarning: false,
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
      dailyWarning: false,
      monthlyWarning: false,
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
      dailyWarning: false,
      monthlyWarning: false,
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
    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{
          aiId: string;
          baselineUsd: string;
        }>`SELECT ai_id, baseline_usd FROM ai_daily_spend`;
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ aiId, baselineUsd: '3.25' });
  });

  it('returns null when LiteLLM fails and logs ids only', async () => {
    const litellm = new FakeLitellm();
    litellm.failKeyInfo = true;
    const aiId = await seedAi();
    const { deps, logger } = depsFor(litellm);

    expect(await getAiUsage(deps, aiId)).toBeNull();
    const spendRows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ aiId: string }>`SELECT ai_id FROM ai_daily_spend`;
      }),
    );
    expect(spendRows).toHaveLength(0);
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
      dailyWarning: false,
      monthlyWarning: false,
    });
    expect(utcDayString(current)).toBe('2026-09-29');
    expect(await baselineFor(aiId, '2026-09-28')).toBe('1.50');
    expect(await baselineFor(aiId, '2026-09-29')).toBe('2.50');
  });

  it('warns at exactly 80% of the daily limit but not just below', async () => {
    const litellm = new FakeLitellm();
    litellm.spendByKey.set('tok-usage-1', 1);
    const aiId = await seedAi();
    const { deps } = depsFor(litellm);

    await getAiUsage(deps, aiId);
    // 1.60 of 2.00 is exactly 80%: cents-safe comparison must warn.
    litellm.spendByKey.set('tok-usage-1', 2.6);
    const atEighty = await getAiUsage(deps, aiId);
    expect(atEighty?.todayUsd).toBeCloseTo(1.6, 10);
    expect(atEighty?.dailyLimitReached).toBe(false);
    expect(atEighty?.dailyWarning).toBe(true);

    // 1.59 of 2.00 is just below 80%: no warning.
    litellm.spendByKey.set('tok-usage-1', 2.59);
    const below = await getAiUsage(deps, aiId);
    expect(below?.dailyLimitReached).toBe(false);
    expect(below?.dailyWarning).toBe(false);
  });

  it('has no daily warning at or above 100%, with the limit reached', async () => {
    const litellm = new FakeLitellm();
    litellm.spendByKey.set('tok-usage-1', 1);
    const aiId = await seedAi();
    const { deps } = depsFor(litellm);

    await getAiUsage(deps, aiId);
    litellm.spendByKey.set('tok-usage-1', 3);
    const over = await getAiUsage(deps, aiId);
    expect(over?.todayUsd).toBe(2);
    expect(over?.dailyLimitReached).toBe(true);
    expect(over?.dailyWarning).toBe(false);
  });

  it('never warns when the daily limit is zero', async () => {
    const litellm = new FakeLitellm();
    litellm.spendByKey.set('tok-usage-1', 1);
    const aiId = await seedAi();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE ai_limits SET per_day_usd = ${'0.00'} WHERE ai_id = ${aiId}`;
      }),
    );
    const { deps } = depsFor(litellm);

    await getAiUsage(deps, aiId);
    litellm.spendByKey.set('tok-usage-1', 5);
    const usage = await getAiUsage(deps, aiId);
    expect(usage?.perDayUsd).toBe(0);
    expect(usage?.dailyWarning).toBe(false);
  });

  it('warns at exactly 80% of the monthly window but not just below or at the cap', async () => {
    const litellm = new FakeLitellm();
    // First read records the baseline; the window spend itself drives the
    // monthly flag.
    litellm.spendByKey.set('tok-usage-1', 16);
    const aiId = await seedAi();
    const { deps } = depsFor(litellm);

    const atEighty = await getAiUsage(deps, aiId);
    expect(atEighty?.windowUsd).toBe(16);
    expect(atEighty?.monthlyWarning).toBe(true);

    litellm.spendByKey.set('tok-usage-1', 15.99);
    // A spend drop counts as a window reset, so seed a fresh AI for the
    // just-below case instead.
    const aiId2 = await seedAi('tok-usage-2');
    litellm.spendByKey.set('tok-usage-2', 15.99);
    const below = await getAiUsage(deps, aiId2);
    expect(below?.monthlyWarning).toBe(false);

    // At the cap there is no warning (the stop path applies instead).
    litellm.spendByKey.set('tok-usage-1', 20);
    const atCap = await getAiUsage(deps, aiId);
    expect(atCap?.windowUsd).toBe(20);
    expect(atCap?.monthlyWarning).toBe(false);

    litellm.spendByKey.set('tok-usage-1', 21);
    const over = await getAiUsage(deps, aiId);
    expect(over?.monthlyWarning).toBe(false);
  });

  it('never warns for a zero monthly cap', async () => {
    const litellm = new FakeLitellm();
    const aiId = await seedAi();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE ai_limits SET per_month_usd = ${'0.00'} WHERE ai_id = ${aiId}`;
      }),
    );
    litellm.spendByKey.set('tok-usage-1', 16);
    const { deps } = depsFor(litellm);

    const usage = await getAiUsage(deps, aiId);
    expect(usage?.perMonthUsd).toBe(0);
    expect(usage?.monthlyWarning).toBe(false);
  });
});
