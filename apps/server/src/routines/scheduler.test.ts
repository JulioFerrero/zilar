// The claim advances `next_run_at` before the run starts, so a routine whose
// previous run is still in flight is not started a second time.
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

describe('createRoutineScheduler', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('does not run a routine again while its previous run is still running', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const toolId = await seedTool(context, aiId, ownerId);
    await seedRoutine(context, {
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
    let clock = NOW;
    const scheduler = createRoutineScheduler({
      db: context.db,
      runTool,
      post: async (input) => {
        posts.push(input.text);
        return true;
      },
      audit: silentAudit,
      logger: context.logger,
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

    release();
    await scheduler.whenIdle();
    expect(posts).toHaveLength(1);
  });
});
