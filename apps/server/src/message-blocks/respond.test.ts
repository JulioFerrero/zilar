import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { BlocksData } from '@zilar/protocol';
import { createTestContext, type TestContext } from '../test-support';
import { seedAi, seedGroup, seedUser } from '../test-support/seed';
import { findCard, listResponses, recordCard } from './cards';
import { respondToCard, type CardRespondDeps, type CorrectCardInput } from './respond';

// T-1792: a member's tap must reach the card, be stored and corrected in the
// room; a stranger must not learn the card exists, and nothing may be written
// before the permission check passes.
describe('card respond', () => {
  let context: TestContext;
  let correctInRoom: Mock<(input: CorrectCardInput) => Promise<boolean>>;

  beforeEach(async () => {
    context = await createTestContext();
    correctInRoom = vi.fn(async () => true);
  });

  afterEach(async () => {
    await context.close();
  });

  const roomJid = 'trip@rooms.zilar.localhost';

  const cardData: BlocksData = {
    fallback: 'Packing list',
    blocks: [
      {
        kind: 'checklist',
        id: 'check-1',
        title: 'Pack',
        items: [
          { id: 'item-1', label: 'Passport', done: false },
          { id: 'item-2', label: 'Charger', done: false },
        ],
      },
    ],
  };

  async function setup(): Promise<{
    deps: CardRespondDeps;
    aiId: string;
    memberId: string;
    outsiderId: string;
  }> {
    const ownerId = await seedUser(context, { name: 'Owner' });
    const memberId = await seedUser(context, { name: 'Ana' });
    const outsiderId = await seedUser(context, { name: 'Outsider' });
    const { aiId } = await seedAi(context, ownerId);
    const { groupId, generalTopicId } = await seedGroup(
      context,
      ownerId,
      [
        { userId: ownerId, role: 'owner' },
        { userId: memberId, role: 'member' },
      ],
      [aiId],
    );
    await recordCard(context.db, {
      originId: 'origin-1',
      aiId,
      groupId,
      topicId: generalTopicId,
      roomJid,
      data: cardData,
    });
    return {
      deps: { db: context.db, logger: context.logger, correctInRoom },
      aiId,
      memberId,
      outsiderId,
    };
  }

  const tick = {
    messageId: 'origin-1',
    blockId: 'check-1',
    itemId: 'item-1',
    value: { done: true },
  };

  it('answers a stranger with the same 404 and records nothing', async () => {
    const { deps, outsiderId } = await setup();

    await expect(respondToCard(deps, outsiderId, tick)).rejects.toMatchObject({
      status: 404,
      code: 'card_not_found',
    });

    expect(await listResponses(context.db, 'origin-1')).toEqual([]);
    expect(correctInRoom).not.toHaveBeenCalled();
    const stored = await findCard(context.db, 'origin-1');
    expect(stored?.data).toEqual(cardData);
  });

  it('stores a member checklist tick, merges their name and corrects the card', async () => {
    const { deps, aiId, memberId } = await setup();

    const result = await respondToCard(deps, memberId, tick);

    const [block] = result.data.blocks;
    if (block?.kind !== 'checklist') {
      throw new Error('expected a checklist block');
    }
    expect(block.items[0]).toMatchObject({ id: 'item-1', done: true, by: 'Ana' });
    expect(block.items[1]).toMatchObject({ id: 'item-2', done: false });

    const rows = await listResponses(context.db, 'origin-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      cardId: 'origin-1',
      blockId: 'check-1',
      itemId: 'item-1',
      actorId: memberId,
      value: { done: true },
    });

    const stored = await findCard(context.db, 'origin-1');
    expect(stored?.data).toMatchObject(result.data);

    expect(correctInRoom).toHaveBeenCalledTimes(1);
    expect(correctInRoom).toHaveBeenCalledWith({
      aiId,
      roomJid,
      originalId: 'origin-1',
      text: 'Packing list',
      payload: { v: 0, type: 'blocks', data: result.data },
    });
  });
});
