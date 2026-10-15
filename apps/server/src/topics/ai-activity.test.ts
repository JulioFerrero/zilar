import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { TurnWatcher } from '../agents/gateway/stop-types';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedGroup, seedUser } from '../test-support/seed';
import {
  topicAiActivity,
  withTopicActivity,
  type AiActivityState,
  type AiActivityTopic,
} from './ai-activity';
import type { TopicView } from './access';

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

interface SeedCardInput {
  aiId: string;
  ownerId: string;
  chatJid: string;
  stage: string;
  at: Date;
  taskId: string;
  seq: number;
}

async function seedCard(context: TestContext, input: SeedCardInput): Promise<void> {
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO agent_task_events
          (id, task_id, ai_id, owner_id, chat_jid, seq, kind, at, duration_ms, data)
        VALUES (${randomUUID()}, ${input.taskId}, ${input.aiId}, ${input.ownerId},
          ${input.chatJid}, ${input.seq}, 'status', ${input.at}, null,
          ${JSON.stringify({ stage: input.stage })}::jsonb)`;
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
  activity: Map<string, Array<{ aiId: string; state: AiActivityState }>>,
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

  it('marks a live pending approval waiting, and leaves an expired one out', async () => {
    await seedApproval(fixture.context, {
      aiId: fixture.aiId,
      groupId: fixture.groupId,
      topicId: fixture.secondTopicId,
      requestedBy: fixture.ownerId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await seedApproval(fixture.context, {
      aiId: fixture.aiId,
      groupId: fixture.groupId,
      topicId: fixture.generalTopicId,
      requestedBy: fixture.ownerId,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const activity = await topicAiActivity(
      { db: fixture.context.db, getGateway: () => fakeGateway({}) },
      topicsFor(fixture),
    );

    expect(states(activity, fixture.secondTopicId)).toEqual([
      { aiId: fixture.aiId, state: 'waiting' },
    ]);
    expect(states(activity, fixture.generalTopicId)).toEqual([]);
  });

  it('answers a batch with no General topic, keeping its waiting state', async () => {
    // Finding 1: a general-free batch must not compile `sql.in([])` to `IN ()`
    // and silently drop every pending approval.
    await seedApproval(fixture.context, {
      aiId: fixture.aiId,
      groupId: fixture.groupId,
      topicId: fixture.secondTopicId,
      requestedBy: fixture.ownerId,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const activity = await topicAiActivity(
      { db: fixture.context.db, getGateway: () => fakeGateway({}) },
      topicsFor(fixture).filter((topic) => !topic.isGeneral),
    );

    expect([...activity.keys()]).toEqual([fixture.secondTopicId]);
    expect(states(activity, fixture.secondTopicId)).toEqual([
      { aiId: fixture.aiId, state: 'waiting' },
    ]);
  });

  it('marks an AI done when its latest card_* row is card_done', async () => {
    await seedCard(fixture.context, {
      aiId: fixture.aiId,
      ownerId: fixture.ownerId,
      chatJid: ROOM_SECOND,
      stage: 'card_done',
      at: new Date(Date.now() - 60_000),
      taskId: randomUUID(),
      seq: 1,
    });

    const activity = await topicAiActivity(
      { db: fixture.context.db, getGateway: () => fakeGateway({}) },
      topicsFor(fixture),
    );

    expect(states(activity, fixture.secondTopicId)).toEqual([
      { aiId: fixture.aiId, state: 'done' },
    ]);
    expect(states(activity, fixture.generalTopicId)).toEqual([]);
  });

  it('leaves an AI idle when a later card_failed follows card_done', async () => {
    const taskId = randomUUID();
    await seedCard(fixture.context, {
      aiId: fixture.aiId,
      ownerId: fixture.ownerId,
      chatJid: ROOM_SECOND,
      stage: 'card_done',
      at: new Date(Date.now() - 60_000),
      taskId,
      seq: 1,
    });
    await seedCard(fixture.context, {
      aiId: fixture.aiId,
      ownerId: fixture.ownerId,
      chatJid: ROOM_SECOND,
      stage: 'card_failed',
      at: new Date(Date.now() - 30_000),
      taskId,
      seq: 2,
    });

    const activity = await topicAiActivity(
      { db: fixture.context.db, getGateway: () => fakeGateway({}) },
      topicsFor(fixture),
    );

    expect(states(activity, fixture.secondTopicId)).toEqual([]);
  });

  it('does not attribute a DM-scoped approval to any topic', async () => {
    // A room approval cannot have a NULL topic: migration 0022 backfills it to
    // the General topic and `approvals_topic_scope_check` keeps group_id and
    // topic_id either both set or both NULL. A NULL group_id means a DM, which
    // belongs to no topic in the batch.
    await seedApproval(fixture.context, {
      aiId: fixture.aiId,
      groupId: null,
      topicId: null,
      requestedBy: fixture.ownerId,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const activity = await topicAiActivity(
      { db: fixture.context.db, getGateway: () => fakeGateway({}) },
      topicsFor(fixture),
    );

    expect(states(activity, fixture.generalTopicId)).toEqual([]);
    expect(states(activity, fixture.secondTopicId)).toEqual([]);
  });

  it('treats a throwing gateway as nobody working instead of failing the read', async () => {
    // Finding 1: the gateway call used to sit outside the best-effort guard, so
    // a throwing gateway rejected `topicAiActivity` and lost the waiting/done
    // states the earlier reads had already gathered.
    await seedApproval(fixture.context, {
      aiId: fixture.aiId,
      groupId: fixture.groupId,
      topicId: fixture.secondTopicId,
      requestedBy: fixture.ownerId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await seedCard(fixture.context, {
      aiId: fixture.aiId,
      ownerId: fixture.ownerId,
      chatJid: ROOM_GENERAL,
      stage: 'card_done',
      at: new Date(Date.now() - 60_000),
      taskId: randomUUID(),
      seq: 1,
    });

    const activity = await topicAiActivity(
      {
        db: fixture.context.db,
        getGateway: () => ({
          runningAiIds: () => {
            throw new Error('gateway blew up');
          },
        }),
      },
      topicsFor(fixture),
    );

    expect(states(activity, fixture.secondTopicId)).toEqual([
      { aiId: fixture.aiId, state: 'waiting' },
    ]);
    expect(states(activity, fixture.generalTopicId)).toEqual([
      { aiId: fixture.aiId, state: 'done' },
    ]);
  });

  it('answers two topics in one call', async () => {
    await seedApproval(fixture.context, {
      aiId: fixture.aiId,
      groupId: fixture.groupId,
      topicId: fixture.generalTopicId,
      requestedBy: fixture.ownerId,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const activity = await topicAiActivity(
      { db: fixture.context.db, getGateway: () => fakeGateway({ [ROOM_SECOND]: [fixture.aiId] }) },
      topicsFor(fixture),
    );

    expect([...activity.keys()].sort()).toEqual(
      [fixture.generalTopicId, fixture.secondTopicId].sort(),
    );
    expect(states(activity, fixture.generalTopicId)).toEqual([
      { aiId: fixture.aiId, state: 'waiting' },
    ]);
    expect(states(activity, fixture.secondTopicId)).toEqual([
      { aiId: fixture.aiId, state: 'working' },
    ]);
  });
});

function viewOf(topicId: string, groupId: string, chatJid: string, isGeneral: boolean): TopicView {
  return {
    id: topicId,
    groupId,
    name: isGeneral ? 'General' : 'Second',
    glyph: 'T',
    chatJid,
    visibility: 'public',
    kind: 'chat',
    status: 'open',
    owner: null,
    linkUrl: null,
    linkLabel: null,
    isGeneral,
    archived: false,
    memberCount: 1,
    ais: [],
    roles: [],
    approverRole: null,
  };
}

describe('withTopicActivity (T-1514)', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  afterEach(async () => {
    await fixture.context.close();
  });

  it('adds the names in state order for two views', async () => {
    const { aiId: qaAiId, jid: qaJid } = await seedAi(fixture.context, fixture.ownerId, {
      name: 'QA-1',
    });
    // General: QA-1 waits on an approval, Dev-1's last card is done.
    await seedApproval(fixture.context, {
      aiId: qaAiId,
      groupId: fixture.groupId,
      topicId: fixture.generalTopicId,
      requestedBy: fixture.ownerId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await seedCard(fixture.context, {
      aiId: fixture.aiId,
      ownerId: fixture.ownerId,
      chatJid: ROOM_GENERAL,
      stage: 'card_done',
      at: new Date(Date.now() - 60_000),
      taskId: randomUUID(),
      seq: 1,
    });
    // Second: Dev-1 works, QA-1 waits.
    await seedApproval(fixture.context, {
      aiId: qaAiId,
      groupId: fixture.groupId,
      topicId: fixture.secondTopicId,
      requestedBy: fixture.ownerId,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const views = await withTopicActivity(
      {
        db: fixture.context.db,
        getGateway: () => fakeGateway({ [ROOM_SECOND]: [fixture.aiId] }),
      },
      [
        viewOf(fixture.generalTopicId, fixture.groupId, ROOM_GENERAL, true),
        viewOf(fixture.secondTopicId, fixture.groupId, ROOM_SECOND, false),
      ],
    );

    expect(views[0]?.activity).toEqual([
      { aiId: qaAiId, name: 'QA-1', jid: qaJid, state: 'waiting' },
      { aiId: fixture.aiId, name: 'Helper AI', jid: fixture.aiJid, state: 'done' },
    ]);
    expect(views[1]?.activity).toEqual([
      { aiId: fixture.aiId, name: 'Helper AI', jid: fixture.aiJid, state: 'working' },
      { aiId: qaAiId, name: 'QA-1', jid: qaJid, state: 'waiting' },
    ]);
  });

  it('leaves every view empty when the read fails', async () => {
    const views = await withTopicActivity(
      { db: { kind: 'postgres', url: 'postgres://unused' }, getGateway: () => null },
      [
        viewOf(fixture.generalTopicId, fixture.groupId, ROOM_GENERAL, true),
        viewOf(fixture.secondTopicId, fixture.groupId, ROOM_SECOND, false),
      ],
    );

    expect(views.map((view) => view.activity)).toEqual([[], []]);
  });
});
