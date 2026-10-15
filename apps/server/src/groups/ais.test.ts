// T-1455: removing an AI from a group also clears it as the owner of any topic
// of that group, General included, so the owner chip never names an AI that is
// no longer there.
import { randomBytes, randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedGroup, seedUser } from '../test-support/seed';
import { removeGroupAi } from './ais';

async function seedTopic(
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

async function setOwner(context: TestContext, topicId: string, aiId: string): Promise<void> {
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE topics SET owner_ai_id = ${aiId} WHERE id = ${topicId}`;
    }),
  );
}

async function addAiToTopic(
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

async function ownerOf(context: TestContext, topicId: string): Promise<string | null> {
  const [row] = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ ownerAiId: string | null }>`
        SELECT owner_ai_id FROM topics WHERE id = ${topicId} LIMIT 1`;
    }),
  );
  return row?.ownerAiId ?? null;
}

function remove(context: TestContext, groupId: string, actorId: string, aiId: string) {
  return removeGroupAi(context.db, context.adminClient, {
    groupId,
    actorId,
    aiId,
    domain: context.config.xmpp.domain,
    logger: context.logger,
  });
}

describe('removeGroupAi clears the owner (T-1455)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('clears the removed AI as the owner of General and of any group topic', async () => {
    const owner = await seedUser(context);
    const { aiId } = await seedAi(context, owner);
    const { groupId, generalTopicId } = await seedGroup(
      context,
      owner,
      [{ userId: owner, role: 'owner' }],
      [aiId],
    );
    const topicId = await seedTopic(context, groupId, owner, aiId);
    await addAiToTopic(context, topicId, aiId, owner);
    await setOwner(context, generalTopicId, aiId);

    await remove(context, groupId, owner, aiId);

    expect(await ownerOf(context, generalTopicId)).toBeNull();
    expect(await ownerOf(context, topicId)).toBeNull();
  });

  it('leaves the owner alone when a different AI is removed', async () => {
    const owner = await seedUser(context);
    const { aiId: ownerAiId } = await seedAi(context, owner);
    const { aiId: otherAiId } = await seedAi(context, owner);
    const { groupId, generalTopicId } = await seedGroup(
      context,
      owner,
      [{ userId: owner, role: 'owner' }],
      [ownerAiId, otherAiId],
    );
    await setOwner(context, generalTopicId, ownerAiId);

    await remove(context, groupId, owner, otherAiId);

    expect(await ownerOf(context, generalTopicId)).toBe(ownerAiId);
  });
});
