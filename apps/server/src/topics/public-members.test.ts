// T-1754: the write half of "public topics get real members". Going public
// keeps the direct members it had as a private topic. A public topic starts
// with only its creator and the others join it from "Other topics".
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addGroupMembers } from '../groups/members';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedGroup, seedUser } from '../test-support/seed';
import { getTopic } from './access';
import { patchTopic } from './patch';
import { listTopicMembers } from './queries';
import { createTopic } from './service';
import { toTopicViews } from './views';
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

async function makeContacts(context: TestContext, owner: string, contact: string): Promise<void> {
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO contacts (user_id, contact_user_id, source)
        VALUES (${owner}, ${contact}, 'manual')`;
    }),
  );
}

describe('public topic members (T-1754)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await context.close();
  });

  it('starts a public topic with only its creator', async () => {
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

  it('does not add a new group member to public or private topics', async () => {
    const owner = await seedUser(context);
    const existing = await seedUser(context);
    const added = await seedUser(context);
    const { groupId } = await seedGroup(
      context,
      owner,
      [
        { userId: owner, role: 'owner' },
        { userId: existing, role: 'member' },
      ],
      [],
    );
    const publicTopic = await createTopic(depsFor(context), {
      groupId,
      actorId: owner,
      name: 'Announcements',
    });
    const privateTopic = await createTopic(depsFor(context), {
      groupId,
      actorId: owner,
      name: 'Hiring',
      visibility: 'private',
      memberIds: [existing],
    });
    await makeContacts(context, owner, added);

    await addGroupMembers(context.db, context.adminClient, {
      groupId,
      actorId: owner,
      userIds: [added],
      domain: context.config.xmpp.domain,
      logger: context.logger,
    });

    expect(await memberIdsOf(context, publicTopic.id)).toEqual([owner]);
    expect(await memberIdsOf(context, privateTopic.id)).toEqual([owner, existing].sort());
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

  it('shows a channel subscriber only owners and admins in General (T-1992)', async () => {
    const owner = await seedUser(context, { name: 'Owner' });
    const admin = await seedUser(context, { name: 'Admin' });
    const subscriber = await seedUser(context, { name: 'Subscriber' });
    const { groupId, generalTopicId } = await seedGroup(
      context,
      owner,
      [
        { userId: owner, role: 'owner' },
        { userId: admin, role: 'admin' },
        { userId: subscriber, role: 'member' },
      ],
      [],
    );
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE groups SET kind = 'channel' WHERE id = ${groupId}`;
      }),
    );

    const asSubscriber = await listTopicMembers({ db: context.db }, generalTopicId, subscriber);
    expect(asSubscriber.map((entry) => entry.userId).sort()).toEqual([owner, admin].sort());
    // An owner still gets the full audience from the members route.
    const asOwner = await listTopicMembers({ db: context.db }, generalTopicId, owner);
    expect(asOwner.map((entry) => entry.userId).sort()).toEqual([owner, admin, subscriber].sort());

    // The topic views default to the narrowed audience when there is no viewer.
    const topic = await getTopic(context.db, generalTopicId);
    expect(topic).not.toBeNull();
    const [view] = await toTopicViews(context.db, [topic!], context.config.xmpp.domain);
    expect([...(view?.memberIds ?? [])].sort()).toEqual([owner, admin].sort());
    expect(view?.memberCount).toBe(2);
  });

  it('shows a channel owner or admin the full General audience (T-2036)', async () => {
    const owner = await seedUser(context, { name: 'Owner' });
    const admin = await seedUser(context, { name: 'Admin' });
    const subscriber = await seedUser(context, { name: 'Subscriber' });
    const { groupId, generalTopicId } = await seedGroup(
      context,
      owner,
      [
        { userId: owner, role: 'owner' },
        { userId: admin, role: 'admin' },
        { userId: subscriber, role: 'member' },
      ],
      [],
    );
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE groups SET kind = 'channel' WHERE id = ${groupId}`;
      }),
    );

    const topic = await getTopic(context.db, generalTopicId);
    expect(topic).not.toBeNull();
    const everyone = [owner, admin, subscriber].sort();

    const [asSubscriber] = await toTopicViews(
      context.db,
      [topic!],
      context.config.xmpp.domain,
      subscriber,
    );
    expect([...(asSubscriber?.memberIds ?? [])].sort()).toEqual([owner, admin].sort());
    expect(asSubscriber?.memberCount).toBe(2);

    for (const manager of [owner, admin]) {
      const [asManager] = await toTopicViews(
        context.db,
        [topic!],
        context.config.xmpp.domain,
        manager,
      );
      expect([...(asManager?.memberIds ?? [])].sort()).toEqual(everyone);
      expect(asManager?.memberCount).toBe(3);
    }
  });
});
