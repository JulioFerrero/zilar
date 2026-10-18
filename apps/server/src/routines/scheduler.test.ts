// T-1299 (AI-18): the scheduler's tick no longer blocks, and a run that is
// more than an hour late is recorded as missed instead of firing.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { AuditRecorder } from '../audit/recorder';
import type { ToolRunResult } from '../tools/types';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedUser } from '../test-support/seed';
import { createRoutineScheduler } from './scheduler';

const NOW = new Date('2026-01-05T12:00:00.000Z');
const silentAudit: AuditRecorder = { record: async () => undefined };

interface CapturedLog {
  fields: Record<string, unknown>;
  message: string;
}

function captureLogger(): {
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
  error: (fields: Record<string, unknown>, message: string) => void;
  calls: CapturedLog[];
} {
  const calls: CapturedLog[] = [];
  return {
    info: (fields, message) => calls.push({ fields, message }),
    warn: (fields, message) => calls.push({ fields, message }),
    error: (fields, message) => calls.push({ fields, message }),
    calls,
  };
}

async function seedTool(context: TestContext, aiId: string, createdBy: string): Promise<string> {
  const toolId = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO ai_tools (
        id, ai_id, group_id, name, description, current_version, created_by,
        created_at, updated_at, deleted_at
      ) VALUES (
        ${toolId}, ${aiId}, NULL, 'digest', 'A digest', 1, ${createdBy},
        ${NOW.toISOString()}, ${NOW.toISOString()}, NULL
      )`;
      yield* sql`INSERT INTO ai_tool_versions (
        id, tool_id, version, source, hosts, message, created_by, created_at
      ) VALUES (
        ${randomUUID()}, ${toolId}, 1, 'return 1', '[]'::jsonb, 'v1',
        ${createdBy}, ${NOW.toISOString()}
      )`;
    }),
  );
  return toolId;
}

async function seedRoutine(
  context: TestContext,
  input: {
    aiId: string;
    toolId: string;
    createdBy: string;
    title: string;
    nextRunAt: Date;
    everyMinutes?: number;
  },
): Promise<string> {
  const id = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO routines (
        id, ai_id, group_id, topic_id, tool_id, title, schedule, input,
        approved_hosts, status, paused_reason, next_run_at, last_run_at,
        last_status, consecutive_failures, created_by, created_at, updated_at,
        deleted_at
      ) VALUES (
        ${id}, ${input.aiId}, NULL, NULL, ${input.toolId}, ${input.title},
        ${JSON.stringify({ kind: 'interval', everyMinutes: input.everyMinutes ?? 60 })}::jsonb, NULL,
        '[]'::jsonb, 'active', NULL, ${input.nextRunAt.toISOString()}, NULL,
        NULL, 0, ${input.createdBy}, ${NOW.toISOString()}, ${NOW.toISOString()},
        NULL
      )`;
    }),
  );
  return id;
}

async function readRoutine(
  context: TestContext,
  id: string,
): Promise<{ lastStatus: string | null; nextRunAt: Date; lastRunAt: Date | null }> {
  const rows = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ lastStatus: string | null; nextRunAt: Date; lastRunAt: Date | null }>`
        SELECT last_status, next_run_at, last_run_at FROM routines WHERE id = ${id}`;
    }),
  );
  const row = rows[0];
  if (!row) {
    throw new Error('routine row missing');
  }
  return row;
}

describe('createRoutineScheduler', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('marks an 8-hour-late run missed with no post, while an on-time run still runs', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const toolId = await seedTool(context, aiId, ownerId);
    const missedId = await seedRoutine(context, {
      aiId,
      toolId,
      createdBy: ownerId,
      title: 'Late digest',
      nextRunAt: new Date(NOW.getTime() - 8 * 3_600_000),
    });
    const onTimeId = await seedRoutine(context, {
      aiId,
      toolId,
      createdBy: ownerId,
      title: 'On time digest',
      nextRunAt: new Date(NOW.getTime() - 60_000),
    });

    const posts: string[] = [];
    const runTool = async (): Promise<ToolRunResult> => ({
      ok: true,
      output: { text: 'ran' },
      logs: '',
      durationMs: 1,
      fetchCount: 0,
    });
    const logger = captureLogger();
    const scheduler = createRoutineScheduler({
      db: context.db,
      runTool,
      post: async (input) => {
        posts.push(input.text);
        return true;
      },
      audit: silentAudit,
      logger,
      now: () => NOW,
    });

    await scheduler.tick();
    await scheduler.whenIdle();

    // The late routine is skipped in the claim, so it never posts.
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain('On time digest');
    expect(posts[0]).not.toContain('Late digest');
    expect(
      logger.calls.some(
        (call) => call.message.includes('missed') && call.fields.routineId === missedId,
      ),
    ).toBe(true);

    const missed = await readRoutine(context, missedId);
    expect(missed.lastStatus).toBe('skipped');
    expect(missed.lastRunAt).not.toBeNull();
    expect(missed.nextRunAt.getTime()).toBeGreaterThan(NOW.getTime());

    const onTime = await readRoutine(context, onTimeId);
    expect(onTime.lastStatus).toBe('ok');
    expect(onTime.nextRunAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('marks a run missed when it goes stale waiting in the queue', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const toolId = await seedTool(context, aiId, ownerId);
    // Two oldest runs claim first and hold the 2-slot pool; the third waits.
    await seedRoutine(context, {
      aiId,
      toolId,
      createdBy: ownerId,
      title: 'First digest',
      nextRunAt: new Date(NOW.getTime() - 10 * 60_000),
    });
    await seedRoutine(context, {
      aiId,
      toolId,
      createdBy: ownerId,
      title: 'Second digest',
      nextRunAt: new Date(NOW.getTime() - 9 * 60_000),
    });
    // On time when claimed (5 min late), but it waits more than 1 h to dequeue.
    const queuedId = await seedRoutine(context, {
      aiId,
      toolId,
      createdBy: ownerId,
      title: 'Queued digest',
      nextRunAt: new Date(NOW.getTime() - 5 * 60_000),
    });

    let clock = NOW;
    let started = 0;
    let releasePool: () => void = () => undefined;
    const poolGate = new Promise<void>((resolve) => {
      releasePool = resolve;
    });
    let signalBothStarted: () => void = () => undefined;
    const bothStarted = new Promise<void>((resolve) => {
      signalBothStarted = resolve;
    });
    const runTool = async (): Promise<ToolRunResult> => {
      started += 1;
      if (started === 2) {
        signalBothStarted();
      }
      await poolGate;
      return { ok: true, output: { text: 'ran' }, logs: '', durationMs: 1, fetchCount: 0 };
    };
    const posts: string[] = [];
    const logger = captureLogger();
    const scheduler = createRoutineScheduler({
      db: context.db,
      runTool,
      post: async (input) => {
        posts.push(input.text);
        return true;
      },
      audit: silentAudit,
      logger,
      now: () => clock,
    });

    await scheduler.tick();
    await bothStarted;
    // Two hours pass while the pool is busy, then the queued run is dequeued.
    clock = new Date(NOW.getTime() + 2 * 3_600_000);
    releasePool();
    await scheduler.whenIdle();

    // The two in-flight runs posted; the stale queued run did not.
    expect(posts).toHaveLength(2);
    expect(posts.some((text) => text.includes('Queued digest'))).toBe(false);
    expect(
      logger.calls.some(
        (call) => call.fields.routineId === queuedId && call.message.includes('missed'),
      ),
    ).toBe(true);

    const queued = await readRoutine(context, queuedId);
    expect(queued.lastStatus).toBe('skipped');
    expect(queued.lastRunAt).not.toBeNull();
    // The claim advanced next_run_at; the missed-at-dequeue path must not move
    // it again.
    expect(queued.nextRunAt.getTime()).toBe(NOW.getTime() + 3_600_000);
  });

  it('does not run a routine again while its previous run is still running', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const toolId = await seedTool(context, aiId, ownerId);
    const routineId = await seedRoutine(context, {
      aiId,
      toolId,
      createdBy: ownerId,
      title: 'Minute digest',
      nextRunAt: new Date(NOW.getTime() - 60_000),
      everyMinutes: 1,
    });

    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalStarted: () => void = () => undefined;
    const runStarted = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const runTool = async (): Promise<ToolRunResult> => {
      calls += 1;
      signalStarted();
      await gate;
      return { ok: true, output: { text: 'ran' }, logs: '', durationMs: 1, fetchCount: 0 };
    };
    const posts: string[] = [];
    const logger = captureLogger();
    let clock = NOW;
    const scheduler = createRoutineScheduler({
      db: context.db,
      runTool,
      post: async (input) => {
        posts.push(input.text);
        return true;
      },
      audit: silentAudit,
      logger,
      now: () => clock,
    });

    await scheduler.tick();
    await runStarted;
    // A minute later the routine is due again, but its first run is still in
    // flight, so the second tick skips it: the claim already advanced
    // `next_run_at`.
    clock = new Date(NOW.getTime() + 60_000);
    await scheduler.tick();

    expect(calls).toBe(1);
    expect(
      logger.calls.some(
        (call) => call.fields.routineId === routineId && call.message.includes('still'),
      ),
    ).toBe(true);

    release();
    await scheduler.whenIdle();
    expect(posts).toHaveLength(1);
  });
});
