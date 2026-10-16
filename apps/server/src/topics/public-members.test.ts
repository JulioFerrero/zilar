// T-1754: the write half of "public topics get real members". A public topic
// starts with only its creator as a member, and going public keeps the direct
// members it had as a private topic.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedGroup, seedUser } from '../test-support/seed';
import { patchTopic } from './patch';
import { createTopic } from './service';
import type { TopicServiceDeps } from './schemas';

function depsFor(context: TestContext): TopicServiceDeps {
  return {
    db: context.db,
    adminClient: context.adminClient,
    domain: context.config.xmpp.domain,
    logger: context.logger,
  };
}

async function memberIdsOf(context: TestContext, topicId: string): Promise<string[]> {
  const rows = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`
        SELECT user_id AS "userId" FROM topic_members WHERE topic_id = ${topicId}`;
    }),
  );
  return rows.map((row) => row.userId).sort();
}

describe('public topic members (T-1754)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('starts a public topic with only its creator as a member', async () => {
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

    const topic = await createTopic(depsFor(context), {
      groupId,
      actorId: owner,
      name: 'Announcements',
    });

    expect(await memberIdsOf(context, topic.id)).toEqual([owner]);
  });

  it('keeps both members when a private topic goes public', async () => {
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
    const topic = await createTopic(depsFor(context), {
      groupId,
      actorId: owner,
      name: 'Hiring',
      visibility: 'private',
      memberIds: [member],
    });
    expect(await memberIdsOf(context, topic.id)).toEqual([member, owner].sort());

    await patchTopic(depsFor(context), {
      topicId: topic.id,
      actorId: owner,
      visibility: 'public',
      confirmExposeHistory: true,
    });

    expect(await memberIdsOf(context, topic.id)).toEqual([member, owner].sort());
  });
});
