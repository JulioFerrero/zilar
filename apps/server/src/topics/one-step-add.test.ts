// T-1769: the one-step add. Adding a person to a non-General topic also adds
// them to the group when they are missing, but only an owner or admin may do
// the group half. A plain member who created the topic answers 403 and nothing
// is written.
import { randomBytes, randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedGroup, seedUser } from '../test-support/seed';
import { addTopicMember } from './members';
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
        name: 'Announcements',
        glyph: 'A',
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

async function groupMemberRows(
  context: TestContext,
  groupId: string,
  userId: string,
): Promise<number> {
  const rows = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM group_members
        WHERE group_id = ${groupId} AND user_id = ${userId}`;
    }),
  );
  return rows.length;
}

async function topicMemberRows(
  context: TestContext,
  topicId: string,
  userId: string,
): Promise<number> {
  const rows = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM topic_members
        WHERE topic_id = ${topicId} AND user_id = ${userId}`;
    }),
  );
  return rows.length;
}

describe('the one-step add through a topic (T-1769)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('refuses a plain member adding an outsider, writing no rows', async () => {
    const owner = await seedUser(context);
    const member = await seedUser(context);
    const outsider = await seedUser(context);
    const { groupId } = await seedGroup(
      context,
      owner,
      [
        { userId: owner, role: 'owner' },
        { userId: member, role: 'member' },
      ],
      [],
    );
    const topicId = await seedPublicTopic(context, groupId, member);

    await expect(addTopicMember(depsFor(context), topicId, member, outsider)).rejects.toMatchObject(
      { status: 403, code: 'forbidden' },
    );

    expect(await groupMemberRows(context, groupId, outsider)).toBe(0);
    expect(await topicMemberRows(context, topicId, outsider)).toBe(0);
  });
});
