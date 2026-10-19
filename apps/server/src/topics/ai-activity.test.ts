import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { TurnWatcher } from '../agents/gateway/stop-types';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedGroup, seedUser } from '../test-support/seed';
import { topicAiActivity, type AiActivityState, type AiActivityTopic } from './ai-activity';

const ROOM_GENERAL = 'general@rooms.zilar.localhost';
const ROOM_SECOND = 'second@rooms.zilar.localhost';

async function seedTopic(
  context: TestContext,
  groupId: string,
  createdBy: string,
  name: string,
): Promise<string> {
  const id = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO topics ${sql.insert({
        id,
        group_id: groupId,
        name,
        glyph: 'T',
        room_localpart: `t${randomBytes(15).toString('hex').slice(0, 15)}`,
        visibility: 'public',
        kind: 'chat',
        status: 'open',
        is_general: false,
        created_by: createdBy,
      })}`;
    }),
  );
  return id;
}

interface SeedApprovalInput {
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  requestedBy: string;
  expiresAt: Date;
}

async function seedApproval(context: TestContext, input: SeedApprovalInput): Promise<void> {
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO approvals ${sql.insert({
        id: randomUUID(),
        ai_id: input.aiId,
        group_id: input.groupId,
        topic_id: input.topicId,
        action: 'spend',
        summary: 'Approve a spend',
        args_hash: randomUUID(),
        requested_by: input.requestedBy,
        status: 'pending',
        expires_at: input.expiresAt,
      })}`;
    }),
  );
}

interface Fixture {
  context: TestContext;
  ownerId: string;
  aiId: string;
  aiJid: string;
  groupId: string;
  generalTopicId: string;
  secondTopicId: string;
}

async function seedFixture(): Promise<Fixture> {
  const context = await createTestContext();
  const ownerId = await seedUser(context, { name: 'Owner' });
  const { aiId, jid: aiJid } = await seedAi(context, ownerId, {});
  const { groupId, generalTopicId } = await seedGroup(
    context,
    ownerId,
    [{ userId: ownerId, role: 'owner' }],
    [aiId],
  );
  const secondTopicId = await seedTopic(context, groupId, ownerId, 'Second');
  return { context, ownerId, aiId, aiJid, groupId, generalTopicId, secondTopicId };
}

function topicsFor(fixture: Fixture): AiActivityTopic[] {
  return [
    {
      topicId: fixture.generalTopicId,
      groupId: fixture.groupId,
      roomJid: ROOM_GENERAL,
      isGeneral: true,
    },
    {
      topicId: fixture.secondTopicId,
      groupId: fixture.groupId,
      roomJid: ROOM_SECOND,
      isGeneral: false,
    },
  ];
}

function fakeGateway(runningByRoom: Record<string, string[]>): TurnWatcher {
  return { runningAiIds: (roomJid: string) => runningByRoom[roomJid] ?? [] };
}

function states(
  activity: Map<string, Array<{ aiId: string; state: AiActivityState; questionId?: string }>>,
  topicId: string,
) {
  return (activity.get(topicId) ?? []).sort((left, right) => left.aiId.localeCompare(right.aiId));
}

describe('topicAiActivity (T-1505)', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  afterEach(async () => {
    await fixture.context.close();
  });

  it('marks a running AI working even when it also has a live pending approval', async () => {
    await seedApproval(fixture.context, {
      aiId: fixture.aiId,
      groupId: fixture.groupId,
      topicId: fixture.secondTopicId,
      requestedBy: fixture.ownerId,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const activity = await topicAiActivity(
      { db: fixture.context.db, getGateway: () => fakeGateway({ [ROOM_SECOND]: [fixture.aiId] }) },
      topicsFor(fixture),
    );

    expect(states(activity, fixture.secondTopicId)).toEqual([
      { aiId: fixture.aiId, state: 'working' },
    ]);
    expect(states(activity, fixture.generalTopicId)).toEqual([]);
  });
});
