import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedUser } from '../test-support/seed';
import { createAuditRecorder } from '../audit/service';
import type { ActionAnnouncer } from './announce';
import { createActionGateway } from './gateway';
import { buildRegistry, type ActionAdapter } from './registry';

// T-1655: a scheduled run is "unattended". Tier 0/1 run as usual, but a
// tier-2 request without a matching standing rule is refused with
// `needs_approval` instead of parking an approval card nobody will see.
// These tests exercise the gateway directly with two tiny adapters, so no
// network, no provider and no chat is involved.

interface CountRow {
  total: number;
}

const requestedBy = 'ai-bot@zilar.localhost';

const lowAdapter: ActionAdapter<unknown> = {
  name: 'demo.low',
  description: 'Low-tier demo action, runs without approval.',
  tier: 0,
  argsSchema: Schema.Struct({ text: Schema.String }),
  describe: (args) => ({ summary: `Low: ${(args as { text: string }).text}` }),
  execute: async (_ctx, args) => ({ summary: `ran ${(args as { text: string }).text}` }),
};

// Tier 2 and deliberately without `allowAlways`, so no standing rule can
// ever exist for it and the approval path is always the only way it runs.
const highAdapter: ActionAdapter<unknown> = {
  name: 'demo.high',
  description: 'High-tier demo action that needs approval.',
  tier: 2,
  argsSchema: Schema.Struct({ text: Schema.String }),
  describe: (args) => ({ summary: `High: ${(args as { text: string }).text}` }),
  execute: async (_ctx, args) => ({ summary: `ran ${(args as { text: string }).text}` }),
};

describe('scheduled (unattended) action requests (T-1655)', () => {
  let context: TestContext;
  let now: Date;

  beforeEach(async () => {
    context = await createTestContext();
    now = new Date('2026-01-01T00:00:00Z');
  });

  afterEach(async () => {
    await context.close();
  });

  function gatewayFor(adapters: ReturnType<typeof buildRegistry>, announce?: ActionAnnouncer) {
    return createActionGateway({
      db: context.db,
      adapters,
      audit: createAuditRecorder({ db: context.db }),
      logger: { warn: () => undefined, error: () => undefined },
      ...(announce === undefined ? {} : { announce }),
      now: () => now,
    });
  }

  async function countApprovals(): Promise<number> {
    const [row] = (await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<CountRow>`SELECT count(*)::int AS total FROM approvals`;
      }),
    )) as [CountRow];
    return row.total;
  }

  it('runs a tier-0 action in an unattended request', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const gateway = gatewayFor(buildRegistry([lowAdapter]));

    const outcome = await gateway.request({
      aiId,
      action: 'demo.low',
      args: { text: 'hi' },
      requestedBy,
      unattended: true,
    });

    expect(outcome).toEqual({ status: 'executed', summary: 'ran hi' });
  });

  it('refuses an unattended tier-2 action with needs_approval, no card, no announce', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const announces: string[] = [];
    const announce: ActionAnnouncer = {
      approvalRequested: async () => {
        announces.push('approvalRequested');
      },
      outcome: async () => {
        announces.push('outcome');
      },
    };
    const gateway = gatewayFor(buildRegistry([highAdapter]), announce);
    const approvalsBefore = await countApprovals();

    const outcome = await gateway.request({
      aiId,
      action: 'demo.high',
      args: { text: 'scheduled' },
      requestedBy,
      unattended: true,
    });

    expect(outcome).toEqual({ status: 'denied', reason: 'needs_approval' });
    expect(await countApprovals()).toBe(approvalsBefore);
    expect(announces).toEqual([]);
  });

  it('an attended tier-2 action still parks a card (pending_approval)', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const gateway = gatewayFor(buildRegistry([highAdapter]));

    const outcome = await gateway.request({
      aiId,
      action: 'demo.high',
      args: { text: 'watched' },
      requestedBy,
    });

    expect(outcome.status).toBe('pending_approval');
    expect(await countApprovals()).toBe(1);
  });
});
