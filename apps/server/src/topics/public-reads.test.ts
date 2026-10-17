// T-1757: the reads follow the new rule — only General is "the whole group".
// Every other topic, public or private, reads its people from `topic_members`
// plus role holders and its AIs from `topic_ais`. Setup copied from
// public-members.test.ts.
import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TopicRow } from '../db/rows';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedGroup, seedUser } from '../test-support/seed';
import { jidFor, localpartFor } from '../xmpp/provisioning';
// T-1764: the helper lives in `@zilar/chat-core`, which the server test package
// does not depend on, so the unit check reaches its source by path.
import { isTopicJoined } from '../../../../packages/chat-core/src/topics';
import {
  aiMayBeInTopic,
  allowedTopicAiIds,
  canSeeTopic,
  countTopicMembers,
  toTopicViews,
} from './access';
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

// The group's General topic row, for the reads that check it (T-1764).
async function generalTopicOf(context: TestContext, groupId: string): Promise<TopicRow> {
  const [row] = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics
        WHERE group_id = ${groupId} AND is_general = true LIMIT 1`;
    }),
  );
  if (row === undefined) {
    throw new Error('general topic missing');
  }
  return row;
}

// A group of four with a public non-General topic that has two direct members
// (its creator and one more) and one AI. The other two are group members with
// no `topic_members` row.
interface PublicFixture {
  topic: TopicRow;
  owner: string;
  joined: string;
  outsider: string;
  other: string;
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
  // These reads need a topic that only some of the group belongs to: the
  // creator and `joined`, while `outsider` and `other` stay out.
  await addTopicMember(context, topic.id, joined, owner);
  await addTopicAi(context, topic.id, aiId, owner);
  return { topic, owner, joined, outsider, other, aiId };
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

describe('topic member ids carry on every read (T-1764)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('reads its direct members plus role holders, and the whole group for General', async () => {
    const { topic, owner, joined, outsider, other } = await seedPublicTopic(context);

    // One group role attached to the topic, held by a member who has no direct
    // `topic_members` row: a role holder is a person of the topic (T-0116).
    const roleId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO group_roles (id, group_id, name, created_by)
          VALUES (${roleId}, ${topic.groupId}, 'Readers', ${owner})`;
        yield* sql`INSERT INTO group_member_roles (role_id, user_id, assigned_by)
          VALUES (${roleId}, ${outsider}, ${owner})`;
        yield* sql`INSERT INTO topic_role_access (topic_id, role_id)
          VALUES (${topic.id}, ${roleId})`;
      }),
    );

    const domain = context.config.xmpp.domain;
    const [view] = await toTopicViews(context.db, [topic], domain);
    expect([...(view?.memberIds ?? [])].sort()).toEqual([owner, joined, outsider].sort());
    // Two direct members, one role holder and one AI: the count is unchanged,
    // the same rows the old rule counted.
    expect(view?.memberCount).toBe(4);
    expect(await countTopicMembers(context.db, topic)).toBe(view?.memberCount);

    const [general] = await toTopicViews(
      context.db,
      [await generalTopicOf(context, topic.groupId)],
      domain,
    );
    expect(general?.isGeneral).toBe(true);
    expect([...(general?.memberIds ?? [])].sort()).toEqual([owner, joined, outsider, other].sort());
  });

  it('isTopicJoined: General for everyone, a listed member, never an unlisted one', async () => {
    const { topic, owner, joined, outsider } = await seedPublicTopic(context);
    const domain = context.config.xmpp.domain;
    const [view] = await toTopicViews(context.db, [topic], domain);
    const [general] = await toTopicViews(
      context.db,
      [await generalTopicOf(context, topic.groupId)],
      domain,
    );

    expect(isTopicJoined(general!, owner)).toBe(true);
    expect(isTopicJoined(view!, joined)).toBe(true);
    // A group member who is not in this topic's list stays out.
    expect(isTopicJoined(view!, outsider)).toBe(false);
    // A list an older server omitted reads as not joined.
    expect(isTopicJoined({ isGeneral: false }, owner)).toBe(false);
  });
});
