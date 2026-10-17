// T-1754: the write half of "public topics get real members". Going public
// keeps the direct members it had as a private topic. T-1762/T-1802: the Join UI
// has shipped, so the compat switch in `public-compat.ts` is on: a public topic
// starts with only its creator and the others join it from "Other topics".
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addGroupMembers } from '../groups/members';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedGroup, seedUser } from '../test-support/seed';
import { patchTopic } from './patch';
import * as publicCompat from './public-compat';
import { initialPublicMemberIds } from './public-compat';
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

  it('gives only the creator when the compat switch is on, every member when off', async () => {
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

    expect(await initialPublicMemberIds(context.db, groupId, owner, true)).toEqual([owner]);
    expect((await initialPublicMemberIds(context.db, groupId, owner, false)).sort()).toEqual(
      [owner, member].sort(),
    );
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

  it('keeps the membership when the public-topic write fails (best effort)', async () => {
    const owner = await seedUser(context);
    const added = await seedUser(context);
    const { groupId } = await seedGroup(context, owner, [{ userId: owner, role: 'owner' }], []);
    const publicTopic = await createTopic(depsFor(context), {
      groupId,
      actorId: owner,
      name: 'Announcements',
    });
    await makeContacts(context, owner, added);

    const warnings: Array<{ fields: Record<string, unknown>; message: string }> = [];
    const logger = {
      warn: (fields: Record<string, unknown>, message: string) => {
        warnings.push({ fields, message });
      },
    };
    // The membership is committed before `addToPublicTopics` runs, so a failure
    // there must not fail the request: a retry would stop at the `toAdd` filter
    // and never write the topic rows.
    const addSpy = vi
      .spyOn(publicCompat, 'addToPublicTopics')
      .mockRejectedValueOnce(new Error('db blip'));

    await addGroupMembers(context.db, context.adminClient, {
      groupId,
      actorId: owner,
      userIds: [added],
      domain: context.config.xmpp.domain,
      logger,
    });

    addSpy.mockRestore();
    const memberRows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ userId: string }>`SELECT user_id AS "userId" FROM group_members
          WHERE group_id = ${groupId}`;
      }),
    );
    expect(memberRows.map((row) => row.userId)).toContain(added);
    expect(warnings.map((entry) => entry.message)).toContain(
      'could not add the new members to the public topics',
    );
    // The failed write left the topic as it was; the membership is unaffected.
    expect(await memberIdsOf(context, publicTopic.id)).toEqual([owner]);
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
