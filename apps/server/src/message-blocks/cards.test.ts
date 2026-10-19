import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BlocksDataSchema, decodeOrThrow, type BlocksData } from '@zilar/protocol';
import { createTestContext, type TestContext } from '../test-support';
import { seedAi, seedUser } from '../test-support/seed';
import { applyResponses } from './apply';
import { listResponses, recordCard, replacePollVotes } from './cards';

// T-1790: the message pipeline stores card interactions and merges them into
// the drawn state. Both halves have to agree on the row shape.
describe('interactive cards', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  async function seedAiId(): Promise<string> {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    return aiId;
  }

  it('counts a poll per option and totals distinct voters', async () => {
    const aiId = await seedAiId();
    const alice = await seedUser(context, { name: 'Alice' });
    const bob = await seedUser(context, { name: 'Bob' });
    const data: BlocksData = {
      fallback: 'Lunch poll',
      blocks: [
        {
          kind: 'poll',
          id: 'poll-1',
          question: 'Lunch?',
          options: [
            { id: 'o-1', label: 'Pizza' },
            { id: 'o-2', label: 'Sushi' },
          ],
        },
      ],
    };
    await recordCard(context.db, {
      originId: 'origin-2',
      aiId,
      roomJid: 'room@rooms.zilar.localhost',
      data,
    });

    const vote = { cardId: 'origin-2', blockId: 'poll-1' };
    await replacePollVotes(context.db, { ...vote, actorId: alice, optionIds: ['o-1'] });
    await replacePollVotes(context.db, { ...vote, actorId: bob, optionIds: ['o-2'] });
    await replacePollVotes(context.db, { ...vote, actorId: alice, optionIds: ['o-2'] });

    const rows = await listResponses(context.db, 'origin-2');
    expect(rows).toHaveLength(2);

    const applied = applyResponses(data, rows, () => undefined);
    const [block] = applied.blocks;
    if (block?.kind !== 'poll') {
      throw new Error('expected a poll block');
    }
    expect(block.options).toEqual([
      { id: 'o-1', label: 'Pizza', votes: 0 },
      { id: 'o-2', label: 'Sushi', votes: 2 },
    ]);
    expect(block.votes).toBe(2);

    expect(() => decodeOrThrow(BlocksDataSchema)(applied)).not.toThrow();
  });
});
