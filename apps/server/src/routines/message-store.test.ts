// T-1713: the routine message store, on the real test database. Seed a prompt
// routine the way execute-prompt.test.ts does, then record and load the id of
// its single live message.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedUser } from '../test-support/seed';
import { loadRoutineMessage, recordRoutineMessage } from '../agents/gateway/routine-send';
import { type RoutineRow } from '../db/rows-agents';

const NOW = new Date('2026-01-05T12:00:00.000Z');

async function seedPromptRoutine(
  context: TestContext,
  input: { aiId: string; createdBy: string },
): Promise<RoutineRow> {
  const id = randomUUID();
  const rows = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<RoutineRow>`INSERT INTO routines (
        id, ai_id, group_id, topic_id, kind, tool_id, prompt, title, schedule,
        input, approved_hosts, status, paused_reason, next_run_at, last_run_at,
        last_status, consecutive_failures, created_by, created_at, updated_at,
        deleted_at
      ) VALUES (
        ${id}, ${input.aiId}, NULL, NULL, 'prompt', NULL, 'hi', 'Morning summary',
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

describe('routine message store', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('records a message and loads back its id and time', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const row = await seedPromptRoutine(context, { aiId, createdBy: ownerId });
    const AT = new Date('2026-01-05T13:00:00.000Z');

    await recordRoutineMessage(context.db, row.id, 'message-1', AT);

    expect(await loadRoutineMessage(context.db, row.id)).toEqual({
      messageId: 'message-1',
      at: AT,
    });
  });
});
