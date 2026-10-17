// T-1760: joining and leaving. A group member joins a public topic themselves;
// on a public topic only the person themselves can leave, and an emptied public
// topic stays live (a private one archives). General is never joined or left.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedGroup, seedUser } from '../test-support/seed';
import { joinTopic, removeTopicMember } from './members';
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

async function archivedAtOf(context: TestContext, topicId: string): Promise<string | null> {
  const [row] = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ archivedAt: string | null }>`
        SELECT archived_at AS "archivedAt" FROM topics WHERE id = ${topicId}`;
    }),
  );
  return row?.archivedAt ?? null;
}

describe('topic join and leave (T-1760)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('lets a plain group member join a public topic', async () => {
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

    await joinTopic(depsFor(context), topic.id, member);

    expect(await memberIdsOf(context, topic.id)).toEqual([member, owner].sort());
  });

  it('keeps one row when the same member joins twice', async () => {
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

    await joinTopic(depsFor(context), topic.id, member);
    await joinTopic(depsFor(context), topic.id, member);

    expect(await memberIdsOf(context, topic.id)).toEqual([member, owner].sort());
  });

  it('refuses to join General', async () => {
    const owner = await seedUser(context);
    const { generalTopicId } = await seedGroup(
      context,
      owner,
      [{ userId: owner, role: 'owner' }],
      [],
    );

    await expect(joinTopic(depsFor(context), generalTopicId, owner)).rejects.toMatchObject({
      status: 400,
      code: 'is_general',
    });
  });

  it('refuses a manager removing someone else from a public topic', async () => {
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
    await joinTopic(depsFor(context), topic.id, member);

    await expect(
      removeTopicMember(depsFor(context), topic.id, owner, member),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    // The refused removal must leave the topic untouched.
    expect(await memberIdsOf(context, topic.id)).toEqual([owner, member].sort());
  });

  it('keeps an emptied public topic live', async () => {
    const owner = await seedUser(context);
    const { groupId } = await seedGroup(context, owner, [{ userId: owner, role: 'owner' }], []);
    const topic = await createTopic(depsFor(context), {
      groupId,
      actorId: owner,
      name: 'Announcements',
    });

    const updated = await removeTopicMember(depsFor(context), topic.id, owner, owner);

    expect(updated.archivedAt).toBeNull();
    expect(await memberIdsOf(context, topic.id)).toEqual([]);
    expect(await archivedAtOf(context, topic.id)).toBeNull();
  });
});
