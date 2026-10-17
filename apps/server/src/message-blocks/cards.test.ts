import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BlocksDataSchema, decodeOrThrow, type BlocksData } from '@zilar/protocol';
import { createTestContext, type TestContext } from '../test-support';
import { seedAi, seedUser } from '../test-support/seed';
import { applyResponses } from './apply';
import { listResponses, recordCard, replacePollVotes, upsertResponse } from './cards';

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

  it('keeps one row for a repeated checklist tick and marks it done by its actor', async () => {
    const aiId = await seedAiId();
    const actorId = await seedUser(context, { name: 'Ana' });
    const data: BlocksData = {
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
    await recordCard(context.db, {
      originId: 'origin-1',
      aiId,
      roomJid: 'room@rooms.zilar.localhost',
      data,
    });

    const tick = { cardId: 'origin-1', blockId: 'check-1', itemId: 'item-1', actorId };
    await upsertResponse(context.db, { ...tick, value: { done: true } });
    await upsertResponse(context.db, { ...tick, value: { done: true } });

    const rows = await listResponses(context.db, 'origin-1');
    expect(rows).toHaveLength(1);

    const applied = applyResponses(data, rows, (id) => (id === actorId ? 'Ana' : undefined));
    const [block] = applied.blocks;
    if (block?.kind !== 'checklist') {
      throw new Error('expected a checklist block');
    }
    expect(block.items[0]).toMatchObject({ id: 'item-1', done: true, by: 'Ana' });
    expect(block.items[1]?.done).toBe(false);
    expect(block.items[1]?.by).toBeUndefined();

    const [original] = data.blocks;
    if (original?.kind !== 'checklist') {
      throw new Error('expected a checklist block');
    }
    expect(original.items[0]?.done).toBe(false);

    expect(() => decodeOrThrow(BlocksDataSchema)(applied)).not.toThrow();
  });

  it('marks a buttons card chosen with the latest action, its actor and the time', async () => {
    const aiId = await seedAiId();
    const ana = await seedUser(context, { name: 'Ana' });
    const data: BlocksData = {
      fallback: 'Plan the trip',
      blocks: [
        {
          kind: 'buttons',
          id: 'buttons-1',
          text: 'When do we leave?',
          actions: [
            { id: 'a-1', label: 'Book it', style: 'dark' },
            { id: 'a-2', label: 'Wait until Monday', style: 'light' },
          ],
        },
      ],
    };
    await recordCard(context.db, {
      originId: 'origin-3',
      aiId,
      roomJid: 'room@rooms.zilar.localhost',
      data,
    });

    await upsertResponse(context.db, {
      cardId: 'origin-3',
      blockId: 'buttons-1',
      itemId: '',
      actorId: ana,
      value: { actionId: 'a-2' },
    });

    const rows = await listResponses(context.db, 'origin-3');
    expect(rows).toHaveLength(1);

    const applied = applyResponses(data, rows, (id) => (id === ana ? 'Ana' : undefined));
    const [block] = applied.blocks;
    if (block?.kind !== 'buttons') {
      throw new Error('expected a buttons block');
    }
    expect(block.chosen).toMatchObject({ actionId: 'a-2', by: 'Ana' });
    if (block.chosen === undefined) {
      throw new Error('expected a chosen action');
    }
    expect(Number.isNaN(Date.parse(block.chosen.at))).toBe(false);

    expect(() => decodeOrThrow(BlocksDataSchema)(applied)).not.toThrow();
  });

  it('marks a form sent with its latest answer in the fields, the actor and the time', async () => {
    const aiId = await seedAiId();
    const ana = await seedUser(context, { name: 'Ana' });
    const data: BlocksData = {
      fallback: 'Book a table',
      blocks: [
        {
          kind: 'form',
          id: 'form-1',
          title: 'Book Dinner Table',
          fields: [
            { id: 'day', label: 'Day', kind: 'date' },
            { id: 'time', label: 'Time', kind: 'text' },
            { id: 'people', label: 'People', kind: 'number' },
          ],
          submit: 'Send',
        },
      ],
    };
    await recordCard(context.db, {
      originId: 'origin-4',
      aiId,
      roomJid: 'room@rooms.zilar.localhost',
      data,
    });

    const longTime = '21:00 and a note that runs well past the forty character cap';
    await upsertResponse(context.db, {
      cardId: 'origin-4',
      blockId: 'form-1',
      itemId: '',
      actorId: ana,
      value: { fields: { day: '2026-10-18', time: longTime, people: '2' } },
    });

    const rows = await listResponses(context.db, 'origin-4');
    expect(rows).toHaveLength(1);

    const applied = applyResponses(data, rows, (id) => (id === ana ? 'Ana' : undefined));
    const [block] = applied.blocks;
    if (block?.kind !== 'form') {
      throw new Error('expected a form block');
    }
    const shortTime = `${longTime.slice(0, 39)}…`;
    expect(block.fields.map((field) => field.value)).toEqual(['2026-10-18', shortTime, '2']);
    expect(shortTime).toHaveLength(40);
    expect(block.sent).toMatchObject({ by: 'Ana' });
    if (block.sent === undefined) {
      throw new Error('expected a sent form');
    }
    expect(Number.isNaN(Date.parse(block.sent.at))).toBe(false);

    expect(() => decodeOrThrow(BlocksDataSchema)(applied)).not.toThrow();
  });

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
