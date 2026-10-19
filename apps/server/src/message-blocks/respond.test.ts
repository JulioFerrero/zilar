import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { BlocksData } from '@zilar/protocol';
import type { RoutineRow } from '../db/rows';
import { createAuditRecorder } from '../audit/recorder';
import { listAuditForAi } from '../audit/api';
import { createPromptRoutine } from '../tools/routine-adapters';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedGroup, seedUser } from '../test-support/seed';
import { findCard, listResponses, recordCard } from './cards';
import {
  respondToCard,
  myPicks,
  type CardRespondDeps,
  type CorrectCardInput,
  AlertLinkTaken,
  linkAlertCard,
} from './respond';

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

  const pollData: BlocksData = {
    fallback: 'Lunch',
    blocks: [
      {
        kind: 'poll',
        id: 'poll-1',
        question: 'Where do we eat?',
        multiple: true,
        options: [
          { id: 'a', label: 'Pizza' },
          { id: 'b', label: 'Tacos' },
        ],
      },
    ],
  };

  const alertData: BlocksData = {
    fallback: 'Spend alert',
    blocks: [
      {
        kind: 'alert',
        id: 'alert-1',
        title: 'Tell me when spending passes',
        field: { label: 'Threshold', value: '100' },
        on: true,
      },
    ],
  };

  async function readRoutine(id: string): Promise<RoutineRow> {
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

  async function setup(): Promise<{
    deps: CardRespondDeps;
    aiId: string;
    ownerId: string;
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
    await recordCard(context.db, {
      originId: 'poll-origin',
      aiId,
      groupId,
      topicId: generalTopicId,
      roomJid,
      data: pollData,
    });
    await recordCard(context.db, {
      originId: 'alert-origin',
      aiId,
      groupId,
      topicId: generalTopicId,
      roomJid,
      data: alertData,
    });
    return {
      deps: {
        db: context.db,
        logger: context.logger,
        correctInRoom,
        audit: createAuditRecorder({ db: context.db }),
      },
      aiId,
      ownerId,
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

  it('lets only the AI owner answer a DM card; a group member gets the same 404', async () => {
    const { deps, aiId, ownerId, memberId, outsiderId } = await setup();
    const dmJid = 'owner@zilar.localhost';
    await recordCard(context.db, {
      originId: 'dm-origin',
      aiId,
      roomJid: dmJid,
      data: cardData,
    });
    const dmTick = { ...tick, messageId: 'dm-origin' };

    const result = await respondToCard(deps, ownerId, dmTick);
    const [block] = result.data.blocks;
    if (block?.kind !== 'checklist') {
      throw new Error('expected a checklist block');
    }
    expect(block.items[0]).toMatchObject({ id: 'item-1', done: true, by: 'Owner' });
    expect(correctInRoom).toHaveBeenCalledWith({
      aiId,
      roomJid: dmJid,
      originalId: 'dm-origin',
      text: 'Packing list',
      payload: { v: 0, type: 'blocks', data: result.data },
    });

    for (const userId of [memberId, outsiderId]) {
      await expect(respondToCard(deps, userId, dmTick)).rejects.toMatchObject({
        status: 404,
        code: 'card_not_found',
      });
    }
    expect(await listResponses(context.db, 'dm-origin')).toHaveLength(1);
  });

  it('records a member alert answer and merges the switch and the threshold', async () => {
    const { deps, memberId } = await setup();
    const answer = { messageId: 'alert-origin', blockId: 'alert-1' };

    const result = await respondToCard(deps, memberId, {
      ...answer,
      value: { done: false, fields: { value: '$95,000' } },
    });

    const [block] = result.data.blocks;
    if (block?.kind !== 'alert') {
      throw new Error('expected an alert block');
    }
    expect(block).toMatchObject({ on: false, field: { label: 'Threshold', value: '$95,000' } });

    const rows = await listResponses(context.db, 'alert-origin');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      cardId: 'alert-origin',
      blockId: 'alert-1',
      itemId: '',
      actorId: memberId,
      value: { on: false, threshold: '$95,000' },
    });

    await expect(
      respondToCard(deps, memberId, { ...answer, value: { fields: { value: 'soon' } } }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_response' });
    await expect(respondToCard(deps, memberId, { ...answer, value: {} })).rejects.toMatchObject({
      status: 400,
      code: 'invalid_response',
    });
    expect(await listResponses(context.db, 'alert-origin')).toHaveLength(1);
  });

  it('drives the linked routine from the alert answer and refuses a second link', async () => {
    const { deps, aiId, ownerId } = await setup();
    const createRoutine = (title: string) =>
      createPromptRoutine(
        context.db,
        {
          aiId,
          groupId: null,
          topicId: null,
          title,
          schedule: { kind: 'interval', everyMinutes: 60 },
          prompt: 'Tell me when spending passes the threshold',
          userId: ownerId,
        },
        new Date('2026-10-17T12:00:00.000Z'),
      );
    const routine = await createRoutine('Spend alert');
    await linkAlertCard(context.db, routine.id, 'alert-origin', 'alert-1');
    const answer = { messageId: 'alert-origin', blockId: 'alert-1' };

    await respondToCard(deps, ownerId, {
      ...answer,
      value: { done: false, fields: { value: '$95,000' } },
    });

    const paused = await readRoutine(routine.id);
    expect(paused).toMatchObject({ status: 'paused', pausedReason: 'user' });
    expect(paused.input).toMatchObject({ threshold: 95000 });

    await respondToCard(deps, ownerId, { ...answer, value: { done: true } });

    const resumed = await readRoutine(routine.id);
    expect(resumed).toMatchObject({ status: 'active', pausedReason: null });
    expect(resumed.input).toMatchObject({ threshold: 95000 });

    const other = await createRoutine('Other alert');
    await expect(
      linkAlertCard(context.db, other.id, 'alert-origin', 'alert-1'),
    ).rejects.toBeInstanceOf(AlertLinkTaken);
  });

  it('lets only the routine manager answer a linked alert and audits the pause', async () => {
    const { deps, aiId, ownerId, memberId } = await setup();
    const routine = await createPromptRoutine(
      context.db,
      {
        aiId,
        groupId: null,
        topicId: null,
        title: 'Spend alert',
        schedule: { kind: 'interval', everyMinutes: 60 },
        prompt: 'Tell me when spending passes the threshold',
        userId: ownerId,
      },
      new Date('2026-10-17T12:00:00.000Z'),
    );
    await linkAlertCard(context.db, routine.id, 'alert-origin', 'alert-1');
    const answer = { messageId: 'alert-origin', blockId: 'alert-1' };

    await expect(
      respondToCard(deps, memberId, { ...answer, value: { done: false } }),
    ).rejects.toMatchObject({
      status: 404,
      code: 'card_not_found',
    });

    expect(await listResponses(context.db, 'alert-origin')).toEqual([]);
    expect(await readRoutine(routine.id)).toMatchObject({ status: 'active' });
    expect(correctInRoom).not.toHaveBeenCalled();

    await respondToCard(deps, ownerId, { ...answer, value: { done: false } });

    expect(await readRoutine(routine.id)).toMatchObject({
      status: 'paused',
      pausedReason: 'user',
    });
    const audit = await listAuditForAi(context.db, aiId, ownerId);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({
      action: 'routine.paused',
      subjectId: routine.id,
      actorUserId: ownerId,
    });
  });

  it('returns the viewer own poll picks, never another member and 404 for a stranger', async () => {
    const { deps, ownerId, memberId, outsiderId } = await setup();
    const vote = (userId: string, optionIds: string[]) =>
      respondToCard(deps, userId, {
        messageId: 'poll-origin',
        blockId: 'poll-1',
        value: { optionIds },
      });

    await vote(memberId, ['a', 'b']);
    await vote(ownerId, ['b']);

    await expect(myPicks(context.db, memberId, 'poll-origin')).resolves.toEqual({
      picks: { 'poll-1': ['a', 'b'] },
    });
    await expect(myPicks(context.db, ownerId, 'poll-origin')).resolves.toEqual({
      picks: { 'poll-1': ['b'] },
    });
    await expect(myPicks(context.db, outsiderId, 'poll-origin')).rejects.toMatchObject({
      status: 404,
      code: 'card_not_found',
    });
  });
});
