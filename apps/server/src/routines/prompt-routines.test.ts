import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../test-support';
import { seedAi, seedGroup, seedUser } from '../test-support/seed';
import { createPromptRoutine } from '../tools/routine-adapters';
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

describe('createPromptRoutine', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
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
});
