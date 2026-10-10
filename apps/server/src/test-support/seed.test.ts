import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedGroup, seedUser } from './seed';

interface UserRow {
  name: string;
  email: string;
}

interface AiRow {
  id: string;
  owner: string;
  name: string;
  jid: string;
  status: string;
}

interface LimitRow {
  perDayUsd: string;
  perMonthUsd: string;
}

interface GroupRow {
  id: string;
  title: string;
}

interface MemberRow {
  userId: string;
  role: string;
}

interface TopicRow {
  id: string;
  name: string;
  isGeneral: boolean;
}

describe('seed helpers', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('seedUser inserts a row and applies overrides', async () => {
    const id = await seedUser(context, { name: 'Ada', email: 'ada@example.com' });
    const [row] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<UserRow>`SELECT name, email FROM "user" WHERE id = ${id}`;
      }),
    );
    expect(row).toEqual({ name: 'Ada', email: 'ada@example.com' });

    const defaultId = await seedUser(context);
    const [fallback] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<UserRow>`SELECT name, email FROM "user" WHERE id = ${defaultId}`;
      }),
    );
    expect(fallback).toEqual({ name: 'User', email: `${defaultId}@example.com` });
  });

  it('seedAi inserts an AI and its limits, and returns the JID', async () => {
    const ownerId = await seedUser(context);
    const { aiId, jid } = await seedAi(context, ownerId, { name: 'Scout', status: 'stopped' });
    expect(jid).toBe(`ai-${aiId}@zilar.localhost`);

    const [ai] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<AiRow>`SELECT id, owner, name, jid, status FROM ais WHERE id = ${aiId}`;
      }),
    );
    expect(ai).toEqual({ id: aiId, owner: ownerId, name: 'Scout', jid, status: 'stopped' });

    const [limits] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<LimitRow>`SELECT per_day_usd, per_month_usd FROM ai_limits WHERE ai_id = ${aiId}`;
      }),
    );
    expect(limits).toEqual({ perDayUsd: '1.00', perMonthUsd: '20.00' });
  });

  it('seedGroup inserts members, AIs and a general topic, and applies overrides', async () => {
    const ownerId = await seedUser(context, { name: 'Owner' });
    const memberId = await seedUser(context, { name: 'Member' });
    const { aiId } = await seedAi(context, ownerId);

    const { groupId, generalTopicId } = await seedGroup(
      context,
      ownerId,
      [
        { userId: ownerId, role: 'owner' },
        { userId: memberId, role: 'admin' },
      ],
      [aiId],
      { title: 'Project' },
    );

    const [group] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<GroupRow>`SELECT id, title FROM groups WHERE id = ${groupId}`;
      }),
    );
    expect(group).toEqual({ id: groupId, title: 'Project' });

    const members = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<MemberRow>`SELECT user_id, role FROM group_members WHERE group_id = ${groupId} ORDER BY role`;
      }),
    );
    expect(members).toEqual([
      { userId: memberId, role: 'admin' },
      { userId: ownerId, role: 'owner' },
    ]);

    const ais = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{
          aiId: string;
        }>`SELECT ai_id FROM group_ais WHERE group_id = ${groupId}`;
      }),
    );
    expect(ais).toEqual([{ aiId }]);

    const [topic] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<TopicRow>`SELECT id, name, is_general FROM topics WHERE id = ${generalTopicId}`;
      }),
    );
    expect(topic).toEqual({ id: generalTopicId, name: 'General', isGeneral: true });
  });
});
