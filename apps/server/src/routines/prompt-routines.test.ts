// T-1641: `createPromptRoutine` stores a `kind = 'prompt'` routine with the
// same 10-per-topic limit and audit as a tool routine. Nothing calls it yet;
// these tests are the only caller.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { AuditEntry, AuditRecorder } from '../audit/service';
import type { RoutineRow } from '../db/rows';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedGroup, seedUser } from '../test-support/seed';
import { createPromptRoutine } from './prompt-routines';
import { MAX_ROUTINE_PROMPT_CHARS, type CreatePromptRoutineInput } from './schemas';

const NOW = new Date('2026-01-05T12:00:00.000Z');
const SCHEDULE = { kind: 'interval', everyMinutes: 60 };

function promptInput(overrides: Partial<CreatePromptRoutineInput>): CreatePromptRoutineInput {
  return {
    aiId: 'ai',
    groupId: null,
    topicId: null,
    title: 'Morning summary',
    schedule: SCHEDULE,
    prompt: 'Summarise my day',
    userId: 'user',
    ...overrides,
  };
}

async function readRoutine(context: TestContext, id: string): Promise<RoutineRow> {
  const rows = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<RoutineRow>`SELECT * FROM routines WHERE id = ${id} LIMIT 1`;
    }),
  );
  const row = rows[0];
  if (!row) {
    throw new Error('routine row missing');
  }
  return row;
}

describe('createPromptRoutine', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('stores a prompt routine with kind prompt, no tool and the trimmed prompt', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const audits: AuditEntry[] = [];
    const audit: AuditRecorder = {
      record: async (entry) => {
        audits.push(entry);
      },
    };

    const routine = await createPromptRoutine(
      context.db,
      promptInput({
        aiId,
        userId: ownerId,
        prompt: '  Summarise my day  ',
      }),
      NOW,
      audit,
    );

    expect(routine.kind).toBe('prompt');
    expect(routine.toolId).toBeNull();
    expect(routine.prompt).toBe('Summarise my day');
    expect(routine.toolName).toBe('');

    const row = await readRoutine(context, routine.id);
    expect(row.kind).toBe('prompt');
    expect(row.toolId).toBeNull();
    expect(row.prompt).toBe('Summarise my day');
    expect(row.input).toBeNull();
    expect(row.approvedHosts).toEqual([]);
    expect(row.status).toBe('active');

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'routine.created',
      subjectId: routine.id,
      detail: { kind: 'prompt' },
    });
    expect(JSON.stringify(audits[0])).not.toContain('Summarise my day');
  });

  it('rejects an empty prompt and a 2001-character prompt with invalid_request', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);

    await expect(
      createPromptRoutine(context.db, promptInput({ aiId, userId: ownerId, prompt: '   ' }), NOW),
    ).rejects.toMatchObject({ errorCode: 'invalid_request' });

    await expect(
      createPromptRoutine(
        context.db,
        promptInput({ aiId, userId: ownerId, prompt: 'x'.repeat(MAX_ROUTINE_PROMPT_CHARS + 1) }),
        NOW,
      ),
    ).rejects.toMatchObject({ errorCode: 'invalid_request' });
  });

  it('refuses the 11th routine in one topic with the existing limit', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const { groupId, generalTopicId } = await seedGroup(
      context,
      ownerId,
      [{ userId: ownerId, role: 'owner' }],
      [aiId],
    );

    for (let index = 0; index < 10; index += 1) {
      await createPromptRoutine(
        context.db,
        promptInput({ aiId, userId: ownerId, groupId, topicId: generalTopicId }),
        NOW,
      );
    }

    await expect(
      createPromptRoutine(
        context.db,
        promptInput({ aiId, userId: ownerId, groupId, topicId: generalTopicId }),
        NOW,
      ),
    ).rejects.toMatchObject({ errorCode: 'routine_limit' });
  });

  it('refuses a groupId without a topicId', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);

    await expect(
      createPromptRoutine(
        context.db,
        promptInput({ aiId, userId: ownerId, groupId: 'group', topicId: null }),
        NOW,
      ),
    ).rejects.toMatchObject({ errorCode: 'invalid_request' });
  });
});
