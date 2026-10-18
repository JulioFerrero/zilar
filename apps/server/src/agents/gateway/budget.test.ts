import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiUsage } from '../../ais/usage';
import { createTestContext, testSql, type TestContext } from '../../test-support';
import { seedAi, seedUser } from '../../test-support/seed';
import { createBudgetGate } from './budget';
import type { AgentGatewayDeps, AiSession, GatewayLogger } from './contracts';

// T-1437 (AI-15): a failing usage read with a spend limit set must fail closed,
// without a limit it keeps failing open. The usage read is mocked to fail; the
// smaller limit read runs against the real test database.
const usage = vi.hoisted(() => ({
  fail: false,
  current: null as AiUsage | null,
}));

vi.mock('../../ais/usage', () => ({
  getAiUsage: async () => {
    if (usage.fail) {
      throw new Error('usage read failed');
    }
    return usage.current;
  },
}));

function sessionFor(aiId: string): AiSession {
  return { aiId } as unknown as AiSession;
}

function gateFor(context: TestContext, logger: GatewayLogger) {
  return createBudgetGate({
    deps: { db: context.db } as unknown as AgentGatewayDeps,
    logger,
    sessionIsLive: () => true,
    secretsFor: () => [],
  });
}

describe('budget gate fail-closed on a usage-read failure (AI-15)', () => {
  let context: TestContext;
  let warnings: string[];
  let logger: GatewayLogger;

  beforeEach(async () => {
    usage.fail = false;
    usage.current = null;
    context = await createTestContext();
    warnings = [];
    logger = {
      info: () => {},
      warn: (_fields, message) => {
        warnings.push(message);
      },
    };
  });

  afterEach(async () => {
    await context.close();
  });

  async function clearLimits(aiId: string): Promise<void> {
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE ai_limits SET per_day_usd = NULL, per_month_usd = NULL WHERE ai_id = ${aiId}`;
      }),
    );
  }

  it('limits a turn when the usage read fails and a daily limit is set', async () => {
    const owner = await seedUser(context);
    const { aiId } = await seedAi(context, owner);
    usage.fail = true;

    const notices: string[] = [];
    const result = await gateFor(context, logger).checkDailyLimit({
      aiId,
      chatKey: 'chat',
      sendNotice: async (text) => {
        notices.push(text);
      },
    });

    expect(result).toEqual({ limited: true, usage: null });
    expect(notices).toHaveLength(1);
    expect(warnings).toContain('AI usage check failed; failing closed (a spend limit is set)');
  });

  it('does not limit a turn when the usage read fails and no limit is set', async () => {
    const owner = await seedUser(context);
    const { aiId } = await seedAi(context, owner);
    await clearLimits(aiId);
    usage.fail = true;

    const notices: string[] = [];
    const result = await gateFor(context, logger).checkDailyLimit({
      aiId,
      chatKey: 'chat',
      sendNotice: async (text) => {
        notices.push(text);
      },
    });

    expect(result).toEqual({ limited: false, usage: null });
    expect(notices).toHaveLength(0);
    expect(warnings).toContain('AI usage check failed; failing open (no spend limit set)');
  });

  it('closes the multi-round gate when the usage read fails and a limit is set', async () => {
    const owner = await seedUser(context);
    const { aiId } = await seedAi(context, owner);
    usage.fail = true;

    const result = await gateFor(context, logger).checkDmRoundGate(sessionFor(aiId));

    expect(result?.limited).toBe(true);
    expect(result?.reply).toContain("today's spending limit");
    expect(warnings.some((message) => message.includes('failing closed'))).toBe(true);
  });

  it('keeps the multi-round gate open when the usage read fails and no limit is set', async () => {
    const owner = await seedUser(context);
    const { aiId } = await seedAi(context, owner);
    await clearLimits(aiId);
    usage.fail = true;

    expect(await gateFor(context, logger).checkDmRoundGate(sessionFor(aiId))).toBeNull();
  });

  it('limits the turn and each round on the monthly cap, with one monthly notice', async () => {
    const owner = await seedUser(context);
    const { aiId } = await seedAi(context, owner);
    const monthlyNotice =
      "I've reached my spending limit for this period ($20.00). My owner can raise it in My AIs.";
    usage.current = {
      todayUsd: 1,
      windowUsd: 20,
      perDayUsd: null,
      perMonthUsd: 20,
      dailyLimitReached: false,
      monthlyLimitReached: true,
      dailyWarning: false,
      monthlyWarning: false,
    };

    const notices: string[] = [];
    const gate = gateFor(context, logger);
    const input = {
      aiId,
      chatKey: 'chat',
      sendNotice: async (text: string) => {
        notices.push(text);
      },
    };

    expect(await gate.checkDailyLimit(input)).toEqual({ limited: true, usage: usage.current });
    expect(await gate.checkDailyLimit(input)).toEqual({ limited: true, usage: usage.current });
    expect(notices).toEqual([monthlyNotice]);

    expect(await gate.checkDmRoundGate(sessionFor(aiId))).toEqual({
      limited: true,
      reply: monthlyNotice,
    });
  });

  it('sends the monthly notice when both limits are reached', async () => {
    const owner = await seedUser(context);
    const { aiId } = await seedAi(context, owner);
    usage.current = {
      todayUsd: 2,
      windowUsd: 20,
      perDayUsd: 2,
      perMonthUsd: 20,
      dailyLimitReached: true,
      monthlyLimitReached: true,
      dailyWarning: false,
      monthlyWarning: false,
    };

    const notices: string[] = [];
    await gateFor(context, logger).checkDailyLimit({
      aiId,
      chatKey: 'chat',
      sendNotice: async (text) => {
        notices.push(text);
      },
    });

    expect(notices).toEqual([
      "I've reached my spending limit for this period ($20.00). My owner can raise it in My AIs.",
    ]);
  });
});
