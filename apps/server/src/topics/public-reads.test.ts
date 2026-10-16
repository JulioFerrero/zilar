// T-1757: the reads follow the new rule — only General is "the whole group".
// Every other topic, public or private, reads its people from `topic_members`
// plus role holders and its AIs from `topic_ais`. Setup copied from
// public-members.test.ts.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TopicRow } from '../db/rows';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedGroup, seedUser } from '../test-support/seed';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { aiMayBeInTopic, allowedTopicAiIds, canSeeTopic, countTopicMembers } from './access';
import { listTopicMembers } from './queries';
import { desiredMembers } from './room-members';
import type { TopicServiceDeps } from './schemas';
import { createTopic } from './service';

function depsFor(context: TestContext): TopicServiceDeps {
  return {
    db: context.db,
    adminClient: context.adminClient,
    domain: context.config.xmpp.domain,
    logger: context.logger,
  };
}

async function addTopicMember(
  context: TestContext,
  topicId: string,
  userId: string,
  addedBy: string,
): Promise<void> {
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO topic_members (topic_id, user_id, added_by)
        VALUES (${topicId}, ${userId}, ${addedBy})`;
    }),
  );
}

async function removeTopicMember(
  context: TestContext,
  topicId: string,
  userId: string,
): Promise<void> {
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM topic_members WHERE topic_id = ${topicId} AND user_id = ${userId}`;
    }),
  );
}

async function addTopicAi(
  context: TestContext,
  topicId: string,
  aiId: string,
  addedBy: string,
): Promise<void> {
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO topic_ais (topic_id, ai_id, added_by)
        VALUES (${topicId}, ${aiId}, ${addedBy})`;
    }),
  );
}

// A group of four with a public non-General topic that has two direct members
// (its creator and one more) and one AI. The other two are group members with
// no `topic_members` row.
interface PublicFixture {
  topic: TopicRow;
  owner: string;
  joined: string;
  outsider: string;
  aiId: string;
}

async function seedPublicTopic(context: TestContext): Promise<PublicFixture> {
  const owner = await seedUser(context);
  const joined = await seedUser(context);
  const outsider = await seedUser(context);
  const other = await seedUser(context);
  const { aiId } = await seedAi(context, owner);
  const { groupId } = await seedGroup(
    context,
    owner,
    [
      { userId: owner, role: 'owner' },
      { userId: joined, role: 'member' },
      { userId: outsider, role: 'member' },
      { userId: other, role: 'member' },
    ],
    [],
  );
  const topic = await createTopic(depsFor(context), {
    groupId,
    actorId: owner,
    name: 'Announcements',
  });
  // T-1762: the compat default seeds every group member into a new public
  // topic; these reads need a topic that only some of the group belongs to, so
  // drop the two outsiders to reach the T-1757 shape.
  await removeTopicMember(context, topic.id, outsider);
  await removeTopicMember(context, topic.id, other);
  await addTopicAi(context, topic.id, aiId, owner);
  return { topic, owner, joined, outsider, aiId };
}

describe('public topic reads follow the new membership rule (T-1757)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('counts its own members and AIs, and lists only its members', async () => {
    const { topic, owner, joined } = await seedPublicTopic(context);

    // Two human `topic_members` rows plus the one `topic_ais` row.
    expect(await countTopicMembers(context.db, topic)).toBe(3);

    const listed = await listTopicMembers(depsFor(context), topic.id, owner);
    expect(listed.map((row) => row.userId).sort()).toEqual([owner, joined].sort());
  });

  it('keeps an unjoined group member out of the room but able to see the topic', async () => {
    const { topic, owner, joined, outsider, aiId } = await seedPublicTopic(context);
    const domain = context.config.xmpp.domain;

    // Visibility does not change: any group member can still see it.
    expect(await canSeeTopic(context.db, topic, outsider)).toBe(true);

    const wanted = await desiredMembers(context.db, topic, domain);
    expect(wanted.has(jidFor(localpartFor(outsider), domain))).toBe(false);
    expect(wanted.has(jidFor(localpartFor(joined), domain))).toBe(true);

    // T-1757: `aiMayBeInTopic` allows a topic's AI while its owner is a topic
    // member *and* still in the group, like `allowedTopicAiIds`, so a
    // half-finished leave cannot make the two rules disagree. A stale
    // `topic_members` row for a non-member is not enough.
    expect(await aiMayBeInTopic(context.db, topic, { id: aiId, owner, status: 'active' })).toBe(
      true,
    );
    const gone = await seedUser(context);
    const { aiId: goneAiId } = await seedAi(context, gone);
    await addTopicMember(context, topic.id, gone, owner);
    await addTopicAi(context, topic.id, goneAiId, owner);
    expect(
      await aiMayBeInTopic(context.db, topic, { id: goneAiId, owner: gone, status: 'active' }),
    ).toBe(false);
    expect((await allowedTopicAiIds(context.db, topic)).has(goneAiId)).toBe(false);
  });
});
