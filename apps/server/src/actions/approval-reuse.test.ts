// T-1737: a second identical tier-2 request (same AI, action, topic and
// summary) reuses the open approval card instead of parking a second one.
// The gateway runs against two tiny adapters, so no network, provider or
// chat is involved.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedUser } from '../test-support/seed';
import { createAuditRecorder } from '../audit/recorder';
import type { ActionAnnouncer } from './announce';
import { createActionGateway } from './gateway';
import { buildRegistry, type ActionAdapter } from './registry';

interface CountRow {
  total: number;
}

const requestedBy = 'ai-bot@zilar.localhost';

// Tier 2 and without `allowAlways`, so the approval path is the only way it
// runs and no standing rule can interfere.
const highAdapter: ActionAdapter<unknown> = {
  name: 'demo.high',
  description: 'High-tier demo action that needs approval.',
  tier: 2,
  argsSchema: Schema.Struct({ text: Schema.String }),
  describe: (args) => ({ summary: `High: ${(args as { text: string }).text}` }),
  execute: async (_ctx, args) => ({ summary: `ran ${(args as { text: string }).text}` }),
};

describe('approval request dedupe (T-1737)', () => {
  let context: TestContext;
  let now: Date;

  beforeEach(async () => {
    context = await createTestContext();
    now = new Date('2026-01-01T00:00:00Z');
  });

  afterEach(async () => {
    await context.close();
  });

  function gatewayFor(): { gateway: ReturnType<typeof createActionGateway>; announces: string[] } {
    const announces: string[] = [];
    const announce: ActionAnnouncer = {
      approvalRequested: async () => {
        announces.push('approvalRequested');
      },
      outcome: async () => {
        announces.push('outcome');
      },
    };
    const gateway = createActionGateway({
      db: context.db,
      adapters: buildRegistry([highAdapter]),
      audit: createAuditRecorder({ db: context.db }),
      logger: { warn: () => undefined, error: () => undefined },
      announce,
      now: () => now,
    });
    return { gateway, announces };
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

  it('returns the open approval and posts one card for a second identical request', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const { gateway, announces } = gatewayFor();
    const request = { aiId, action: 'demo.high', args: { text: 'prices' }, requestedBy };

    const first = await gateway.request(request);
    const second = await gateway.request(request);

    expect(first.status).toBe('pending_approval');
    expect(second.status).toBe('pending_approval');
    expect(second).toEqual(first);
    expect(await countApprovals()).toBe(1);
    expect(announces).toEqual(['approvalRequested']);
  });
});
