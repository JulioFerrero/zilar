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

interface CapturedError {
  fields: Record<string, unknown>;
  message: string;
}

function captureLogger(): SweeperLogger & { calls: CapturedError[] } {
  const calls: CapturedError[] = [];
  return {
    error: (fields, message) => {
      calls.push({ fields, message });
    },
    calls,
  };
}

async function seedPastDueApproval(
  context: TestContext,
  aiId: string,
  hashSeed: number,
  now: Date,
): Promise<{ id: string }> {
  // `createApproval` refuses a past expiry, so write the row directly and
  // pretend the clock has moved past it.
  const expiresAt = new Date(now.getTime() + 60_000);
  const row = await createApproval(
    context.db,
    {
      aiId,
      action: 'send_email',
      summary: 'Send',
      argsHash: argsHash(hashSeed),
      requestedBy: 'ai-bot@zilar.localhost',
      expiresAt,
    },
    now,
  );
  // Roll the stored expiry into the past so the sweeper will see it.
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

function auditRecorder(
  context: TestContext,
  now: Date,
): { record: (entry: AuditEntry) => Promise<void> } {
  return {
    async record(entry) {
      await recordAuditRow(context, entry, now);
    },
  };
}

interface AuditRow {
  action: string;
  actorUserId: string | null;
  aiId: string | null;
  groupId: string | null;
  subjectId: string | null;
  argsHash: string | null;
  result: string;
  detail: unknown;
}

async function listAuditRows(context: TestContext): Promise<readonly AuditRow[]> {
  return testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AuditRow>`SELECT action, actor_user_id, ai_id, group_id, subject_id, args_hash, result, detail FROM audit_log`;
    }),
  );
}

interface ApprovalStatusRow {
  status: string;
  note: string | null;
}

async function approvalStatus(
  context: TestContext,
  id: string,
): Promise<ApprovalStatusRow | undefined> {
  const [row] = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ApprovalStatusRow>`SELECT status, note FROM approvals WHERE id = ${id}`;
    }),
  );
  return row;
}

interface Deferred {
  promise: Promise<void>;
  release(): void;
}

// A manually-released promise. Used by the no-overlap test to keep the
// first sweep in flight while later timers fire.
function deferred(): Deferred {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('approvals sweeper', () => {
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

  it('writes one audit entry per swept row on the first tick', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId, { name: 'Helper' });
    const a = await seedPastDueApproval(context, aiId, 1, now);
    const b = await seedPastDueApproval(context, aiId, 2, now);

    const logger = captureLogger();
    const sweeper = startApprovalsSweeper({
      db: context.db,
      audit: auditRecorder(context, now),
      logger,
      intervalMs: 1000,
      now: () => now,
    });

    // First tick is one interval after start, not at boot.
    expect(await listAuditRows(context)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);

    const rows = await listAuditRows(context);
    expect(rows).toHaveLength(2);
    const subjectIds = rows.map((row) => row.subjectId).sort();
    expect(subjectIds).toEqual([a.id, b.id].sort());
    for (const row of rows) {
      expect(row.action).toBe('approval.expired');
      expect(row.actorUserId).toBeNull();
      expect(row.aiId).toBe(aiId);
      expect(row.groupId).toBeNull();
      expect(row.argsHash).toBeNull();
      expect(row.result).toBe('denied');
      expect(row.detail).toBeNull();
    }
    expect(logger.calls).toEqual([]);

    sweeper.close();
  });

  it('flips swept rows to denied with note=expired', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId, { name: 'Helper' });
    const { id } = await seedPastDueApproval(context, aiId, 3, now);

    const sweeper = startApprovalsSweeper({
      db: context.db,
      audit: auditRecorder(context, now),
      logger: captureLogger(),
      intervalMs: 1000,
      now: () => now,
    });

    await vi.advanceTimersByTimeAsync(1000);

    const stored = await approvalStatus(context, id);
    expect(stored?.status).toBe('denied');
    expect(stored?.note).toBe('expired');

    sweeper.close();
  });

  it('does not write audit entries when nothing is past due', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId, { name: 'Helper' });
    // A still-valid request.
    await createApproval(
      context.db,
      {
        aiId,
        action: 'send_email',
        summary: 'Send',
        argsHash: argsHash(4),
        requestedBy: 'ai-bot@zilar.localhost',
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );

    const sweeper = startApprovalsSweeper({
      db: context.db,
      audit: auditRecorder(context, now),
      logger: captureLogger(),
      intervalMs: 1000,
      now: () => now,
    });

    await vi.advanceTimersByTimeAsync(1000);

    const rows = await listAuditRows(context);
    expect(rows).toEqual([]);

    sweeper.close();
  });

  it('keeps the timer running after a failing sweep', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId, { name: 'Helper' });
    await seedPastDueApproval(context, aiId, 5, now);

    const logger = captureLogger();
    let tickCount = 0;
    // Override the audit recorder to throw on the first call, succeed on
    // the second. The first call's failure must not stop the timer — the
    // second call proves a later tick fired.
    const sweeper = startApprovalsSweeper({
      db: context.db,
      audit: {
        async record(entry) {
          tickCount += 1;
          if (tickCount === 1) {
            throw new Error('database is down');
          }
          await recordAuditRow(context, entry, now);
        },
      },
      logger,
      intervalMs: 1000,
      now: () => now,
    });

    await vi.advanceTimersByTimeAsync(1000);
    // The first tick failed to audit. The row is already denied by
    // `expireStale`, so the next sweep returns nothing.
    expect(logger.calls.length).toBeGreaterThanOrEqual(1);
    expect(logger.calls[0]?.message).toMatch(/approvals sweeper/);
    const auditRowsAfterFirstTick = await listAuditRows(context);
    expect(auditRowsAfterFirstTick).toHaveLength(0);

    // Re-create a past-due row so the next tick has work to do. Then
    // advance one more interval and verify the timer fired (the recorder
    // was called again and succeeded this time).
    await seedPastDueApproval(context, aiId, 9, now);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tickCount).toBeGreaterThanOrEqual(2);
    expect(await listAuditRows(context)).toHaveLength(1);

    sweeper.close();
  });

  it('does not overlap a previous one that has not resolved', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId, { name: 'Helper' });
    await seedPastDueApproval(context, aiId, 6, now);

    let activeTicks = 0;
    let maxActiveTicks = 0;
    // A manually-released promise: every audit write parks here until the
    // test calls the returned `release()`. That guarantees the sweeper never
    // finishes the current tick before we have a chance to fire the next
    // timer.
    const parking = deferred();

    const sweeper = startApprovalsSweeper({
      db: context.db,
      audit: {
        async record(entry) {
          activeTicks += 1;
          maxActiveTicks = Math.max(maxActiveTicks, activeTicks);
          await parking.promise;
          await recordAuditRow(context, entry, now);
          activeTicks -= 1;
        },
      },
      logger: captureLogger(),
      intervalMs: 1000,
      now: () => now,
    });

    // Fire several ticks while the first is still parked.
    await vi.advanceTimersByTimeAsync(5000);
    expect(maxActiveTicks).toBe(1);

    // Release the parking lot and let the timer settle so `close()` does not
    // race the in-flight promise on shutdown.
    parking.release();
    await Promise.resolve();
    await Promise.resolve();
    sweeper.close();
  });

  it('stops firing once close is called', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId, { name: 'Helper' });
    await seedPastDueApproval(context, aiId, 7, now);

    const logger = captureLogger();
    const sweeper = startApprovalsSweeper({
      db: context.db,
      audit: auditRecorder(context, now),
      logger,
      intervalMs: 1000,
      now: () => now,
    });

    await vi.advanceTimersByTimeAsync(1000);
    const afterFirstTick = await listAuditRows(context);
    expect(afterFirstTick).toHaveLength(1);

    sweeper.close();
    await vi.advanceTimersByTimeAsync(10_000);
    const afterClose = await listAuditRows(context);
    expect(afterClose).toHaveLength(1);
    expect(logger.calls).toEqual([]);
  });
});
