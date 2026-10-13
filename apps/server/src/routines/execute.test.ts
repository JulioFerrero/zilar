// T-1299 (AI-18): a post that fails during the AI's reconnect is retried
// once after the fixed wait before the run is marked `skipped`.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { AuditRecorder } from '../audit/service';
import type { RoutineRow } from '../db/rows';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedUser } from '../test-support/seed';
import { executeRoutine, POST_RETRY_DELAY_MS } from './execute';

const NOW = new Date('2026-01-05T12:00:00.000Z');
const silentAudit: AuditRecorder = { record: async () => undefined };
const silentLogger = { warn: () => undefined };

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
  input: { aiId: string; toolId: string; createdBy: string },
): Promise<RoutineRow> {
  const id = randomUUID();
  const rows = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<RoutineRow>`INSERT INTO routines (
        id, ai_id, group_id, topic_id, tool_id, title, schedule, input,
        approved_hosts, status, paused_reason, next_run_at, last_run_at,
        last_status, consecutive_failures, created_by, created_at, updated_at,
        deleted_at
      ) VALUES (
        ${id}, ${input.aiId}, NULL, NULL, ${input.toolId}, 'Digest',
        ${JSON.stringify({ kind: 'interval', everyMinutes: 60 })}::jsonb, NULL,
        '[]'::jsonb, 'active', NULL, ${NOW.toISOString()}, NULL, NULL, 0,
        ${input.createdBy}, ${NOW.toISOString()}, ${NOW.toISOString()}, NULL
      )
      RETURNING *`;
    }),
  );
  const row = rows[0];
  if (!row) {
    throw new Error('routine row missing');
  }
  return row;
}

describe('executeRoutine post retry', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('retries a failed post once after the wait, then records ok', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const toolId = await seedTool(context, aiId, ownerId);
    const row = await seedRoutine(context, { aiId, toolId, createdBy: ownerId });

    const delays: number[] = [];
    let posts = 0;
    await executeRoutine(
      {
        runTool: async () => ({
          ok: true,
          output: { text: 'ran' },
          logs: '',
          durationMs: 1,
          fetchCount: 0,
        }),
        post: async () => {
          posts += 1;
          return posts > 1;
        },
      },
      row,
      {
        db: context.db,
        now: () => NOW,
        audit: silentAudit,
        logger: silentLogger,
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    expect(posts).toBe(2);
    expect(delays).toEqual([POST_RETRY_DELAY_MS]);

    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ lastStatus: string | null }>`
          SELECT last_status FROM routines WHERE id = ${row.id}`;
      }),
    );
    expect(rows[0]?.lastStatus).toBe('ok');
  });
});
