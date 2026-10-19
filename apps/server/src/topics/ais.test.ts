import { randomBytes, randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_GROUP_MEMBERS } from '../groups/schemas';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedGroup, seedUser } from '../test-support/seed';
import { addTopicAi } from './service';
import type { TopicServiceDeps } from './schemas';

function depsFor(context: TestContext): TopicServiceDeps {
  return {
    db: context.db,
    adminClient: context.adminClient,
    domain: context.config.xmpp.domain,
    logger: context.logger,
  };
}

async function seedOwnedTopic(
  context: TestContext,
  groupId: string,
  createdBy: string,
  ownerAiId: string | null,
): Promise<string> {
  const id = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO topics ${sql.insert({
        id,
        group_id: groupId,
        name: 'Owned',
        glyph: 'O',
        room_localpart: `t${randomBytes(12).toString('hex')}`,
        visibility: 'public',
        kind: 'chat',
        status: 'open',
        owner_ai_id: ownerAiId,
        is_general: false,
        created_by: createdBy,
      })}`;
    }),
  );
  return id;
}

async function inGroupAis(context: TestContext, groupId: string, aiId: string): Promise<boolean> {
  const [row] = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ aiId: string }>`SELECT ai_id FROM group_ais
        WHERE group_id = ${groupId} AND ai_id = ${aiId} LIMIT 1`;
    }),
  );
  return row !== undefined;
}

async function inTopicAis(context: TestContext, topicId: string, aiId: string): Promise<boolean> {
  const [row] = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ aiId: string }>`SELECT ai_id FROM topic_ais
        WHERE topic_id = ${topicId} AND ai_id = ${aiId} LIMIT 1`;
    }),
  );
  return row !== undefined;
}

describe('addTopicAi adds the AI to the group first (T-1769)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('answers 200 for both of two concurrent adds at a full group', async () => {
    const owner = await seedUser(context);
    const { aiId } = await seedAi(context, owner);
    // One short of the cap: the one add fits, a racing second must be a no-op.
    const others = await Promise.all(
      Array.from({ length: MAX_GROUP_MEMBERS - 2 }, () => seedUser(context)),
    );
    const { groupId } = await seedGroup(
      context,
      owner,
      [
        { userId: owner, role: 'owner' },
        ...others.map((userId) => ({ userId, role: 'member' as const })),
      ],
      [],
    );
    const topicId = await seedOwnedTopic(context, groupId, owner, null);

    // The loser must not recount the winner's AI a second time and answer 400:
    // both calls are the same membership, so both resolve.
    await Promise.all([
      addTopicAi(depsFor(context), { topicId, actorId: owner, aiId }),
      addTopicAi(depsFor(context), { topicId, actorId: owner, aiId }),
    ]);

    const [count] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ total: number }>`SELECT (
          SELECT count(*)::int FROM group_members WHERE group_id = ${groupId}
        ) + (
          SELECT count(*)::int FROM group_ais WHERE group_id = ${groupId}
        ) AS total`;
      }),
    );
    expect(count!.total).toBe(MAX_GROUP_MEMBERS);
    expect(await inGroupAis(context, groupId, aiId)).toBe(true);
    expect(await inTopicAis(context, topicId, aiId)).toBe(true);
  });
});
