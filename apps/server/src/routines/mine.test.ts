// T-1717: `listMyRoutines` returns the caller's routines across every AI they
// own, with the AI's name and picture and the chat name. It never returns
// another user's routines, and it leaves out a routine in a private topic the
// caller cannot see (the same filter `listForAi` applies).
import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedGroup, seedUser } from '../test-support/seed';
import { createPromptRoutine } from './prompt-routines';
import { listMyRoutines } from './reads';

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
    }),
  );
  return id;
}

async function seedAiAvatar(context: TestContext, aiId: string): Promise<string> {
  const id = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO avatars ${sql.insert({
        id,
        owner_kind: 'ai',
        owner_id: aiId,
        mime: 'image/png',
        storage_key: `${id}.png`,
      })}`;
    }),
  );
  return id;
}

describe('listMyRoutines', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it("returns the caller's routines across their AIs with aiName, aiAvatarUrl and chatName", async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId, { name: 'Helper AI' });
    const avatarId = await seedAiAvatar(context, aiId);
    const { groupId, generalTopicId } = await seedGroup(
      context,
      ownerId,
      [{ userId: ownerId, role: 'owner' }],
      [aiId],
      { title: 'Trip' },
    );

    const personal = await createPromptRoutine(
      context.db,
      {
        aiId,
        groupId: null,
        topicId: null,
        title: 'Personal one',
        schedule: SCHEDULE,
        prompt: 'Say hi',
        userId: ownerId,
      },
      NOW,
    );
    const inGroup = await createPromptRoutine(
      context.db,
      {
        aiId,
        groupId,
        topicId: generalTopicId,
        title: 'Group one',
        schedule: SCHEDULE,
        prompt: 'Say hi',
        userId: ownerId,
      },
      NOW,
    );

    const routines = await listMyRoutines(context.db, ownerId);

    expect(routines.map((entry) => entry.routine.id).sort()).toEqual(
      [personal.id, inGroup.id].sort(),
    );

    const personalEntry = routines.find((entry) => entry.routine.id === personal.id);
    expect(personalEntry?.aiName).toBe('Helper AI');
    expect(personalEntry?.aiAvatarUrl).toBe(`/api/avatars/${avatarId}`);
    expect(personalEntry?.chatName).toBeNull();

    const groupEntry = routines.find((entry) => entry.routine.id === inGroup.id);
    expect(groupEntry?.aiName).toBe('Helper AI');
    expect(groupEntry?.chatName).toBe('Trip');
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

  it('leaves out a routine in a private topic the caller cannot see', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const { groupId } = await seedGroup(
      context,
      ownerId,
      [{ userId: ownerId, role: 'owner' }],
      [aiId],
    );
    const privateTopicId = await seedPrivateTopic(context, groupId, ownerId);

    const visible = await createPromptRoutine(
      context.db,
      {
        aiId,
        groupId: null,
        topicId: null,
        title: 'Visible',
        schedule: SCHEDULE,
        prompt: 'Say hi',
        userId: ownerId,
      },
      NOW,
    );
    await createPromptRoutine(
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

    const routines = await listMyRoutines(context.db, ownerId);
    expect(routines.map((entry) => entry.routine.id)).toEqual([visible.id]);
  });
});
