// T-1455: removing an AI from a topic also clears it as that topic's owner, so
// the owner chip never names an AI that is no longer there.
import { randomBytes, randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedGroup, seedUser } from '../test-support/seed';
import { removeTopicAi } from './ais';
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

describe('removeTopicAi clears the owner (T-1455)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('clears owner_ai_id when the removed AI owns the topic', async () => {
    const owner = await seedUser(context);
    const { aiId } = await seedAi(context, owner);
    const { groupId } = await seedGroup(context, owner, [{ userId: owner, role: 'owner' }], [aiId]);
    const topicId = await seedOwnedTopic(context, groupId, owner, aiId);
    await addAiToTopic(context, topicId, aiId, owner);

    await removeTopicAi(depsFor(context), topicId, owner, aiId);

    expect(await ownerOf(context, topicId)).toBeNull();
  });

  it('leaves the owner alone when a different AI is removed', async () => {
    const owner = await seedUser(context);
    const { aiId: ownerAiId } = await seedAi(context, owner);
    const { aiId: otherAiId } = await seedAi(context, owner);
    const { groupId } = await seedGroup(
      context,
      owner,
      [{ userId: owner, role: 'owner' }],
      [ownerAiId, otherAiId],
    );
    const topicId = await seedOwnedTopic(context, groupId, owner, ownerAiId);
    await addAiToTopic(context, topicId, ownerAiId, owner);
    await addAiToTopic(context, topicId, otherAiId, owner);

    await removeTopicAi(depsFor(context), topicId, owner, otherAiId);

    expect(await ownerOf(context, topicId)).toBe(ownerAiId);
  });
});
