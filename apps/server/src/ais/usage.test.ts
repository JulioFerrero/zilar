import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createKeyCipher } from '../connections/crypto';
import { createTestContext, TEST_XMPP_DOMAIN, testSql, type TestContext } from '../test-support';
import { getAiUsage, utcDayString, type AiUsageDeps } from './usage';

const MASTER_KEY = 'test-master-key-0000000000000000000000';
const PROVIDER_KEY = 'sk-provider-key-do-not-leak';
const TODAY = '2026-09-28';

describe('getAiUsage', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  async function seedAi(
    perDay: string | null = '2.00',
    perMonth: string | null = '20.00',
  ): Promise<string> {
    const ownerId = randomUUID();
    const connectionId = randomUUID();
    const aiId = randomUUID();
    const encryptedConnection = createKeyCipher(MASTER_KEY).encrypt(PROVIDER_KEY);
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO "user" (id, name, email) VALUES (${ownerId}, ${'Owner'}, ${`${ownerId}@example.com`})`;
        yield* sql`INSERT INTO provider_connections (id, owner, provider, encrypted_key, label)
          VALUES (${connectionId}, ${ownerId}, ${'openai'}, ${encryptedConnection}, ${null})`;
        yield* sql`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status)
          VALUES (${aiId}, ${ownerId}, ${'Spendy AI'}, ${'dev'}, ${'A persona'}, ${connectionId}, ${'gpt-4o-mini'}, ${`ai-${aiId}`}, ${`ai-${aiId}@${TEST_XMPP_DOMAIN}`}, ${'active'})`;
        yield* sql`INSERT INTO ai_limits (ai_id, per_day_usd, per_month_usd)
          VALUES (${aiId}, ${perDay}, ${perMonth})`;
      }),
    );
    return aiId;
  }

  async function addUsage(aiId: string, day: string, costUsd: string): Promise<void> {
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO ai_usage (ai_id, day, cost_usd) VALUES (${aiId}, ${day}, ${costUsd})`;
      }),
    );
  }

  function deps(now: () => Date = () => new Date('2026-09-28T12:00:00Z')): AiUsageDeps {
    return { db: context.db, now };
  }

  it('answers today and the last 30 days from ai_usage', async () => {
    const aiId = await seedAi();
    await addUsage(aiId, TODAY, '1.00');
    await addUsage(aiId, '2026-09-20', '0.50');
    // 30 days back from 2026-09-28 is 2026-08-29: that row is excluded, the
    // 2026-08-30 row (29 days back) is inside the window.
    await addUsage(aiId, '2026-08-30', '0.25');
    await addUsage(aiId, '2026-08-29', '5.00');

    const usage = await getAiUsage(deps(), aiId);

    expect(usage).toEqual({
      todayUsd: 1,
      windowUsd: 1.75,
      perDayUsd: 2,
      perMonthUsd: 20,
      dailyLimitReached: false,
      dailyWarning: false,
      monthlyWarning: false,
    });
  });

  it('returns null for a missing AI and for one with no limits row', async () => {
    expect(await getAiUsage(deps(), randomUUID())).toBeNull();

    const aiId = await seedAi();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM ai_limits WHERE ai_id = ${aiId}`;
      }),
    );
    expect(await getAiUsage(deps(), aiId)).toBeNull();
  });

  it('sets no flags when neither bound is set', async () => {
    const aiId = await seedAi(null, null);
    await addUsage(aiId, TODAY, '5.00');

    const usage = await getAiUsage(deps(), aiId);

    expect(usage).toEqual({
      todayUsd: 5,
      windowUsd: 5,
      perDayUsd: null,
      perMonthUsd: null,
      dailyLimitReached: false,
      dailyWarning: false,
      monthlyWarning: false,
    });
  });

  it('sets no flags for an unset daily bound even with spend', async () => {
    const aiId = await seedAi(null, '20.00');
    await addUsage(aiId, TODAY, '16.00');

    const usage = await getAiUsage(deps(), aiId);

    expect(usage?.perDayUsd).toBeNull();
    expect(usage?.dailyLimitReached).toBe(false);
    expect(usage?.dailyWarning).toBe(false);
    expect(usage?.monthlyWarning).toBe(true);
  });

  it('marks the daily limit reached at or above the per-day cap', async () => {
    const aiId = await seedAi();
    await addUsage(aiId, TODAY, '2.00');

    const usage = await getAiUsage(deps(), aiId);

    expect(usage?.todayUsd).toBe(2);
    expect(usage?.dailyLimitReached).toBe(true);
    expect(usage?.dailyWarning).toBe(false);
  });

  it('warns at exactly 80% of the daily limit but not just below', async () => {
    const atEightyAi = await seedAi();
    await addUsage(atEightyAi, TODAY, '1.60');
    const atEighty = await getAiUsage(deps(), atEightyAi);
    expect(atEighty?.todayUsd).toBeCloseTo(1.6, 10);
    expect(atEighty?.dailyLimitReached).toBe(false);
    expect(atEighty?.dailyWarning).toBe(true);

    const belowAi = await seedAi();
    await addUsage(belowAi, TODAY, '1.59');
    const below = await getAiUsage(deps(), belowAi);
    expect(below?.dailyLimitReached).toBe(false);
    expect(below?.dailyWarning).toBe(false);
  });

  it('never warns when the daily limit is zero', async () => {
    const aiId = await seedAi('0.00', '20.00');
    await addUsage(aiId, TODAY, '1.00');

    const usage = await getAiUsage(deps(), aiId);

    expect(usage?.perDayUsd).toBe(0);
    expect(usage?.dailyWarning).toBe(false);
  });

  it('warns at exactly 80% of the 30-day window but not at or over the cap', async () => {
    const atEightyAi = await seedAi();
    await addUsage(atEightyAi, TODAY, '16.00');
    const atEighty = await getAiUsage(deps(), atEightyAi);
    expect(atEighty?.windowUsd).toBe(16);
    expect(atEighty?.monthlyWarning).toBe(true);

    const atCapAi = await seedAi();
    await addUsage(atCapAi, TODAY, '20.00');
    const atCap = await getAiUsage(deps(), atCapAi);
    expect(atCap?.windowUsd).toBe(20);
    expect(atCap?.monthlyWarning).toBe(false);

    const overAi = await seedAi();
    await addUsage(overAi, TODAY, '21.00');
    const over = await getAiUsage(deps(), overAi);
    expect(over?.monthlyWarning).toBe(false);
  });

  it('never warns for a zero monthly cap', async () => {
    const aiId = await seedAi('2.00', '0.00');
    await addUsage(aiId, TODAY, '16.00');

    const usage = await getAiUsage(deps(), aiId);

    expect(usage?.perMonthUsd).toBe(0);
    expect(usage?.monthlyWarning).toBe(false);
  });

  it('derives the UTC day from the clock', () => {
    expect(utcDayString(new Date('2026-09-29T00:30:00Z'))).toBe('2026-09-29');
    expect(utcDayString(new Date('2026-09-28T23:30:00Z'))).toBe('2026-09-28');
  });
});
