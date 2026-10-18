// T-1753: `listVisibleTopicRoutines` backs `GET /api/topics/:id/routines`
// (the "In this topic" row). A private topic the caller may not see answers
// null, exactly like a missing topic, so the route can reply the same 404.
import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedGroup, seedUser } from '../test-support/seed';
import { createPromptRoutine } from '../tools/routine-adapters';
import { listVisibleTopicRoutines } from './reads';

const NOW = new Date('2026-01-05T12:00:00.000Z');
const SCHEDULE = { kind: 'interval', everyMinutes: 60 };

async function seedPrivateTopic(
  context: TestContext,
  groupId: string,
  ownerId: string,
): Promise<string> {
  const id = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO topics ${sql.insert({
        id,
        group_id: groupId,
        name: 'Secret',
        glyph: 'S',
        room_localpart: `t${randomBytes(15).toString('hex').slice(0, 15)}`,
        visibility: 'private',
        kind: 'chat',
        status: 'open',
        is_general: false,
        created_by: ownerId,
      })}`;
      // Creating a private topic adds its creator to `topic_members`; the
      // helper mirrors that so the creator can see it.
      yield* sql`INSERT INTO topic_members ${sql.insert({
        topic_id: id,
        user_id: ownerId,
        added_by: ownerId,
      })}`;
    }),
  );
  return id;
}

describe('listVisibleTopicRoutines', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('hides a private topic from a group member and shows it to the creator', async () => {
    const ownerId = await seedUser(context);
    const memberId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const { groupId } = await seedGroup(
      context,
      ownerId,
      [
        { userId: ownerId, role: 'owner' },
        { userId: memberId, role: 'member' },
      ],
      [aiId],
    );
    const privateTopicId = await seedPrivateTopic(context, groupId, ownerId);

    const routine = await createPromptRoutine(
      context.db,
      {
        aiId,
        groupId,
        topicId: privateTopicId,
        title: 'Hidden',
        schedule: SCHEDULE,
        prompt: 'Say hi',
        userId: ownerId,
      },
      NOW,
    );

    expect(await listVisibleTopicRoutines(context.db, privateTopicId, memberId)).toBeNull();

    const visible = await listVisibleTopicRoutines(context.db, privateTopicId, ownerId);
    expect(visible?.map((entry) => entry.id)).toEqual([routine.id]);

    expect(await listVisibleTopicRoutines(context.db, randomUUID(), ownerId)).toBeNull();
  });
});
