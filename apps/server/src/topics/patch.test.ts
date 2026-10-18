// T-1521: a person marks a topic done (and clears it). Like the task strip,
// `done` is open to anyone who can see the topic; a stranger gets the same 404
// as a missing id.
import { randomBytes, randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedGroup, seedUser } from '../test-support/seed';
import { requirePinManager } from '../pins/access';
import { getTopic, requireManagedTopic } from './access';
import { patchTopic } from './patch';
import type { TopicServiceDeps } from './schemas';

function depsFor(context: TestContext): TopicServiceDeps {
  return {
    db: context.db,
    adminClient: context.adminClient,
    domain: context.config.xmpp.domain,
    logger: context.logger,
  };
}

async function seedPublicTopic(
  context: TestContext,
  groupId: string,
  createdBy: string,
): Promise<string> {
  const id = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO topics ${sql.insert({
        id,
        group_id: groupId,
        name: 'Done flag',
        glyph: 'D',
        room_localpart: `t${randomBytes(12).toString('hex')}`,
        visibility: 'public',
        kind: 'chat',
        status: 'open',
        is_general: false,
        created_by: createdBy,
      })}`;
    }),
  );
  return id;
}

async function doneAtOf(context: TestContext, topicId: string): Promise<Date | null> {
  const [row] = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ doneAt: Date | null }>`
        SELECT done_at FROM topics WHERE id = ${topicId} LIMIT 1`;
    }),
  );
  return row?.doneAt ?? null;
}

describe('patchTopic done flag (T-1521)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('lets a plain member set and clear the done flag', async () => {
    const owner = await seedUser(context);
    const member = await seedUser(context);
    const { groupId } = await seedGroup(
      context,
      owner,
      [
        { userId: owner, role: 'owner' },
        { userId: member, role: 'member' },
      ],
      [],
    );
    const topicId = await seedPublicTopic(context, groupId, owner);

    const marked = await patchTopic(depsFor(context), { topicId, actorId: member, done: true });
    expect(marked.doneAt).not.toBeNull();
    expect(await doneAtOf(context, topicId)).not.toBeNull();

    const cleared = await patchTopic(depsFor(context), { topicId, actorId: member, done: false });
    expect(cleared.doneAt).toBeNull();
    expect(await doneAtOf(context, topicId)).toBeNull();
  });

  it('answers a missing-topic error to someone outside the group', async () => {
    const owner = await seedUser(context);
    const outsider = await seedUser(context);
    const { groupId } = await seedGroup(context, owner, [{ userId: owner, role: 'owner' }], []);
    const topicId = await seedPublicTopic(context, groupId, owner);

    await expect(
      patchTopic(depsFor(context), { topicId, actorId: outsider, done: true }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
    expect(await doneAtOf(context, topicId)).toBeNull();
  });
});

// T-1990: General belongs to the group, not to its creator. A creator who was
// demoted (or handed the group over) no longer renames, manages or pins it;
// the current owner/admin still does.
describe('General manager rights follow the current owner (T-1990)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  async function demotedCreatorGroup(): Promise<{
    ownerId: string;
    creatorId: string;
    generalTopicId: string;
  }> {
    const ownerId = await seedUser(context);
    const creatorId = await seedUser(context);
    const { generalTopicId } = await seedGroup(
      context,
      ownerId,
      [
        { userId: ownerId, role: 'owner' },
        { userId: creatorId, role: 'member' },
      ],
      [],
    );
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE topics SET created_by = ${creatorId} WHERE id = ${generalTopicId}`;
      }),
    );
    return { ownerId, creatorId, generalTopicId };
  }

  it('refuses a rename by the demoted creator and keeps the owner in charge', async () => {
    const { ownerId, creatorId, generalTopicId } = await demotedCreatorGroup();

    await expect(
      patchTopic(depsFor(context), {
        topicId: generalTopicId,
        actorId: creatorId,
        name: 'Renamed',
      }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    await expect(requireManagedTopic(context.db, generalTopicId, creatorId)).rejects.toMatchObject({
      status: 403,
    });

    const renamed = await patchTopic(depsFor(context), {
      topicId: generalTopicId,
      actorId: ownerId,
      name: 'Renamed',
    });
    expect(renamed.name).toBe('Renamed');
  });

  it('refuses a pin by the demoted creator and keeps the owner in charge', async () => {
    const { ownerId, creatorId, generalTopicId } = await demotedCreatorGroup();
    const topic = await getTopic(context.db, generalTopicId);
    if (!topic) {
      throw new Error('seed topic missing');
    }
    const chat = { kind: 'room' as const, chatJid: topic.roomLocalpart, topic };

    await expect(requirePinManager(context.db, chat, creatorId)).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    });
    await expect(requirePinManager(context.db, chat, ownerId)).resolves.toBeUndefined();
  });
});
