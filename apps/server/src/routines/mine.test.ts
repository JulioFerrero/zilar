// `listMyRoutines` lists the caller's routines only; another user's AI
// routines never appear.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../test-support';
import { seedAi, seedUser } from '../test-support/seed';
import { createPromptRoutine } from '../tools/routine-adapters';
import { listMyRoutines } from './reads';

const NOW = new Date('2026-01-05T12:00:00.000Z');
const SCHEDULE = { kind: 'interval', everyMinutes: 60 };

describe('listMyRoutines', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it("never returns another user's AI routines", async () => {
    const ownerId = await seedUser(context);
    const otherId = await seedUser(context);
    const { aiId: otherAiId } = await seedAi(context, otherId, { name: 'Other AI' });
    const other = await createPromptRoutine(
      context.db,
      {
        aiId: otherAiId,
        groupId: null,
        topicId: null,
        title: 'Other routine',
        schedule: SCHEDULE,
        prompt: 'Say hi',
        userId: otherId,
      },
      NOW,
    );

    expect(await listMyRoutines(context.db, ownerId)).toEqual([]);

    const otherRoutines = await listMyRoutines(context.db, otherId);
    expect(otherRoutines.map((entry) => entry.routine.id)).toEqual([other.id]);
    expect(otherRoutines[0]?.aiName).toBe('Other AI');
  });
});
