import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { aiLimits, ais, approvals, auditLog, providerConnections, user } from '../db/schema';
import { createTestContext, type TestContext } from '../test-support';
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

async function seedUser(context: TestContext): Promise<string> {
  const id = randomUUID();
  await context.db.insert(user).values({ id, name: 'User', email: `${id}@example.com` });
  return id;
}

async function seedAi(context: TestContext, ownerId: string): Promise<string> {
  const connectionId = randomUUID();
  await context.db.insert(providerConnections).values({
    id: connectionId,
    owner: ownerId,
    provider: 'openai',
    encryptedKey: 'sealed-placeholder',
    label: null,
  });
  const aiId = randomUUID();
  await context.db.insert(ais).values({
    id: aiId,
    owner: ownerId,
    name: 'Helper',
    template: 'dev',
    persona: 'A persona',
    providerConnectionId: connectionId,
    model: 'gpt-4o-mini',
    localpart: `ai-${aiId}`,
    jid: `ai-${aiId}@zilar.localhost`,
    status: 'active',
  });
  await context.db.insert(aiLimits).values({ aiId, perDayUsd: '1.00', perMonthUsd: '20.00' });
  return aiId;
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
  await context.db
    .update(approvals)
    .set({ expiresAt: new Date(now.getTime() - 1) })
    .where(eq(approvals.id, row.id));
  return { id: row.id };
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
    const aiId = await seedAi(context, ownerId);
    await seedPastDueApproval(context, aiId, now);

    const parking = deferred();
    let started = 0;
    const sweeper = startApprovalsSweeper({
      db: context.db,
      audit: {
        async record(entry) {
          started += 1;
          await parking.promise;
          await context.db.insert(auditLog).values({
            id: randomUUID(),
            at: now,
            actorUserId: entry.actorUserId,
            aiId: entry.aiId,
            groupId: entry.groupId,
            action: entry.action,
            subjectId: entry.subjectId,
            argsHash: entry.argsHash,
            costCurrency: entry.costCurrency,
            costAmount: entry.costAmount === null ? null : entry.costAmount.toFixed(2),
            result: entry.result,
            detail: entry.detail,
          });
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

    expect(await context.db.select().from(auditLog)).toHaveLength(1);

    // No further ticks after the interrupt.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(started).toBe(1);
    expect(await context.db.select().from(auditLog)).toHaveLength(1);
  });
});
