import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { AuditEntry } from '../audit/service';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedUser } from '../test-support/seed';
import { createApproval } from './service';
import { startApprovalsSweeper, type SweeperLogger } from './sweeper';

function argsHash(seed: number): string {
  const buf = randomBytes(32);
  buf[0] = seed & 0xff;
  buf[1] = (seed >> 8) & 0xff;
  return buf.toString('hex');
}

function captureLogger(): SweeperLogger {
  return { error: vi.fn() };
}

async function seedPastDueApproval(
  context: TestContext,
  aiId: string,
  now: Date,
): Promise<{ id: string }> {
  const row = await createApproval(
    context.db,
    {
      aiId,
      action: 'send_email',
      summary: 'Send',
      argsHash: argsHash(1),
      requestedBy: 'ai-bot@zilar.localhost',
      expiresAt: new Date(now.getTime() + 60_000),
    },
    now,
  );
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE approvals SET expires_at = ${new Date(now.getTime() - 1)} WHERE id = ${row.id}`;
    }),
  );
  return { id: row.id };
}

async function recordAuditRow(context: TestContext, entry: AuditEntry, now: Date): Promise<void> {
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const detail =
        entry.detail === null ? sql`NULL` : sql`${JSON.stringify(entry.detail)}::jsonb`;
      yield* sql`INSERT INTO audit_log (
          id, at, actor_user_id, ai_id, group_id, action, subject_id, args_hash,
          cost_currency, cost_amount, result, detail
        ) VALUES (
          ${randomUUID()}, ${now}, ${entry.actorUserId}, ${entry.aiId}, ${entry.groupId},
          ${entry.action}, ${entry.subjectId}, ${entry.argsHash},
          ${entry.costCurrency}, ${entry.costAmount === null ? null : entry.costAmount.toFixed(2)},
          ${entry.result}, ${detail}
        )`;
    }),
  );
}

async function auditRowCount(context: TestContext): Promise<number> {
  const [row] = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM audit_log`;
    }),
  );
  return row?.total ?? 0;
}

interface Deferred {
  promise: Promise<void>;
  release(): void;
}

function deferred(): Deferred {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

// The sweeper's timer is now an Effect fiber. An in-flight tick runs
// uninterruptibly, so `close()` must let it finish and then stop the loop.
describe('approvals sweeper effect loop', () => {
  let context: TestContext;
  let now: Date;

  beforeEach(async () => {
    vi.useFakeTimers();
    context = await createTestContext();
    now = new Date('2026-01-01T00:00:00Z');
  });

  afterEach(async () => {
    vi.useRealTimers();
    await context.close();
  });

  it('lets an in-flight sweep finish after close(), then stops firing', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId, { name: 'Helper' });
    await seedPastDueApproval(context, aiId, now);

    const parking = deferred();
    let started = 0;
    const sweeper = startApprovalsSweeper({
      db: context.db,
      audit: {
        async record(entry) {
          started += 1;
          await parking.promise;
          await recordAuditRow(context, entry, now);
        },
      },
      logger: captureLogger(),
      intervalMs: 1_000,
      now: () => now,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(started).toBe(1);

    // Close while the tick is parked in `audit.record`; the uninterruptible
    // tick must still finish.
    sweeper.close();
    parking.release();
    await vi.advanceTimersByTimeAsync(0);

    expect(await auditRowCount(context)).toBe(1);

    // No further ticks after the interrupt.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(started).toBe(1);
    expect(await auditRowCount(context)).toBe(1);
  });
});
