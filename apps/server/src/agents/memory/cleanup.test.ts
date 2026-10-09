import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { sqlRuntimeFor } from '../../effect/sql';
import {
  bootstrapUser,
  createTestContext,
  testApp,
  testSql,
  TEST_XMPP_DOMAIN,
  type TestApp,
  type TestContext,
} from '../../test-support';
import { deleteRoomMemoryEffect } from './store';

const DM_CHAT_KEY = 'dm:owner';
const NOW = new Date('2026-06-01T12:00:00Z');

function roomLocalpart(): string {
  return `g${randomBytes(15).toString('hex').slice(0, 15)}`;
}

function roomChatKey(localpart: string): string {
  return `room:${localpart}@${TEST_XMPP_DOMAIN}`;
}

async function seedAi(context: TestContext, ownerId: string): Promise<string> {
  const connectionId = randomUUID();
  const aiId = randomUUID();
  const localpart = `ai-${aiId}`;
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO provider_connections ${sql.insert({
        id: connectionId,
        owner: ownerId,
        provider: 'openai',
        encrypted_key: 'sealed-placeholder',
        label: null,
      })}`;
      yield* sql`INSERT INTO ais ${sql.insert({
        id: aiId,
        owner: ownerId,
        name: 'Helper AI',
        template: 'dev',
        persona: 'A persona',
        provider_connection_id: connectionId,
        model: 'gpt-4o-mini',
        localpart,
        jid: `${localpart}@${TEST_XMPP_DOMAIN}`,
        status: 'active',
      })}`;
      yield* sql`INSERT INTO ai_limits ${sql.insert({
        ai_id: aiId,
        per_day_usd: '1.00',
        per_month_usd: '20.00',
      })}`;
    }),
  );
  return aiId;
}

// One row in each of the four memory tables for the (AI, chat) pair, so a
// delete that misses a table is visible.
async function seedMemory(
  context: TestContext,
  aiId: string,
  chatKey: string,
  tag: string,
): Promise<void> {
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO ai_memory_messages ${sql.insert({
        ai_id: aiId,
        chat_key: chatKey,
        seq: 0,
        message_id: `${tag}-m0`,
        at: NOW,
        sender: 'Bob',
        text: 'hello',
        deleted: false,
      })}`;
      yield* sql`INSERT INTO ai_memory_nodes ${sql.insert({
        ai_id: aiId,
        chat_key: chatKey,
        lo: 0,
        hi: 16,
        summary: `${tag} summary`,
      })}`;
      yield* sql`INSERT INTO ai_memory_facts ${sql.insert({
        id: randomUUID(),
        ai_id: aiId,
        chat_key: chatKey,
        text: `${tag} fact`,
        created_at: NOW,
      })}`;
      yield* sql`INSERT INTO ai_memory_state ${sql.insert({
        ai_id: aiId,
        chat_key: chatKey,
        floor_seq: 0,
      })}`;
    }),
  );
}

interface MemoryCounts {
  messages: number;
  nodes: number;
  facts: number;
  state: number;
}

async function countMemory(
  context: TestContext,
  aiId: string,
  chatKey: string,
): Promise<MemoryCounts> {
  return testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [messages] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
        FROM ai_memory_messages WHERE ai_id = ${aiId} AND chat_key = ${chatKey}`;
      const [nodes] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
        FROM ai_memory_nodes WHERE ai_id = ${aiId} AND chat_key = ${chatKey}`;
      const [facts] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
        FROM ai_memory_facts WHERE ai_id = ${aiId} AND chat_key = ${chatKey}`;
      const [state] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
        FROM ai_memory_state WHERE ai_id = ${aiId} AND chat_key = ${chatKey}`;
      return {
        messages: messages?.total ?? 0,
        nodes: nodes?.total ?? 0,
        facts: facts?.total ?? 0,
        state: state?.total ?? 0,
      };
    }),
  );
}

const GONE: MemoryCounts = { messages: 0, nodes: 0, facts: 0, state: 0 };
const KEPT: MemoryCounts = { messages: 1, nodes: 1, facts: 1, state: 1 };

interface SeededGroup {
  groupId: string;
  roomLocalpart: string;
  generalTopicId: string;
  generalRoomLocalpart: string;
}

async function seedGroup(
  context: TestContext,
  ownerId: string,
  aiId: string,
): Promise<SeededGroup> {
  const groupId = randomUUID();
  const groupRoomLocalpart = roomLocalpart();
  const generalTopicId = randomUUID();
  const generalRoomLocalpart = roomLocalpart();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO groups ${sql.insert({
        id: groupId,
        room_localpart: groupRoomLocalpart,
        title: 'Trip',
        created_by: ownerId,
      })}`;
      yield* sql`INSERT INTO group_members ${sql.insert({
        group_id: groupId,
        user_id: ownerId,
        role: 'owner',
      })}`;
      yield* sql`INSERT INTO group_ais ${sql.insert({
        group_id: groupId,
        ai_id: aiId,
        added_by: ownerId,
      })}`;
      yield* sql`INSERT INTO topics ${sql.insert({
        id: generalTopicId,
        group_id: groupId,
        name: 'General',
        glyph: 'G',
        room_localpart: generalRoomLocalpart,
        visibility: 'public',
        kind: 'chat',
        status: 'open',
        is_general: true,
        created_by: ownerId,
      })}`;
    }),
  );
  return {
    groupId,
    roomLocalpart: groupRoomLocalpart,
    generalTopicId,
    generalRoomLocalpart,
  };
}

async function seedTopic(
  context: TestContext,
  ownerId: string,
  groupId: string,
  aiId: string,
): Promise<{ topicId: string; roomLocalpart: string }> {
  const topicId = randomUUID();
  const localpart = roomLocalpart();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO topics ${sql.insert({
        id: topicId,
        group_id: groupId,
        name: `work-${topicId.slice(0, 8)}`,
        glyph: 'W',
        room_localpart: localpart,
        visibility: 'public',
        kind: 'chat',
        status: 'open',
        is_general: false,
        created_by: ownerId,
      })}`;
      yield* sql`INSERT INTO topic_ais ${sql.insert({
        topic_id: topicId,
        ai_id: aiId,
        added_by: ownerId,
      })}`;
    }),
  );
  return { topicId, roomLocalpart: localpart };
}

function topicDeps(context: TestContext) {
  return {
    db: context.db,
    adminClient: context.adminClient,
    domain: TEST_XMPP_DOMAIN,
    logger: { warn: () => undefined },
  };
}

describe('AI memory room cleanup (T-0442)', () => {
  let context: TestContext;
  let authApp: TestApp;
  let emailCounter = 0;

  beforeEach(async () => {
    emailCounter += 1;
    context = await createTestContext();
    authApp = testApp(context);
  });

  afterEach(async () => {
    await context.close();
  });

  async function ownerWithAi(email: string) {
    const owner = await bootstrapUser(context, authApp, email);
    const aiId = await seedAi(context, owner.id);
    return { owner, aiId };
  }

  it('deleteRoomMemoryEffect deletes only one AI and only the named rooms', async () => {
    const { owner, aiId } = await ownerWithAi(`cleanup-effect-${emailCounter}@example.com`);
    const otherAiId = await seedAi(context, owner.id);
    const roomA = roomLocalpart();
    const roomB = roomLocalpart();
    await seedMemory(context, aiId, roomChatKey(roomA), 'a');
    await seedMemory(context, aiId, roomChatKey(roomB), 'b');
    await seedMemory(context, aiId, DM_CHAT_KEY, 'dm');
    await seedMemory(context, otherAiId, roomChatKey(roomA), 'other');

    await sqlRuntimeFor(context.db).runPromise(deleteRoomMemoryEffect(aiId, [roomA]));

    expect(await countMemory(context, aiId, roomChatKey(roomA))).toEqual(GONE);
    expect(await countMemory(context, aiId, roomChatKey(roomB))).toEqual(KEPT);
    expect(await countMemory(context, aiId, DM_CHAT_KEY)).toEqual(KEPT);
    expect(await countMemory(context, otherAiId, roomChatKey(roomA))).toEqual(KEPT);
  });

  it('deleteRoomMemoryEffect does nothing for an empty list', async () => {
    const { aiId } = await ownerWithAi(`cleanup-effect-empty-${emailCounter}@example.com`);
    const roomA = roomLocalpart();
    await seedMemory(context, aiId, roomChatKey(roomA), 'a');

    await sqlRuntimeFor(context.db).runPromise(deleteRoomMemoryEffect(aiId, []));

    expect(await countMemory(context, aiId, roomChatKey(roomA))).toEqual(KEPT);
  });

  it('removeGroupAi deletes the group and topic room memory, keeping the DM', async () => {
    const { owner, aiId } = await ownerWithAi(`cleanup-group-${emailCounter}@example.com`);
    const group = await seedGroup(context, owner.id, aiId);
    const topic = await seedTopic(context, owner.id, group.groupId, aiId);
    await seedMemory(context, aiId, roomChatKey(group.roomLocalpart), 'group');
    await seedMemory(context, aiId, roomChatKey(group.generalRoomLocalpart), 'general');
    await seedMemory(context, aiId, roomChatKey(topic.roomLocalpart), 'topic');
    await seedMemory(context, aiId, DM_CHAT_KEY, 'dm');

    const { removeGroupAi } = await import('../../groups/service');
    await removeGroupAi(context.db, context.adminClient, {
      groupId: group.groupId,
      actorId: owner.id,
      aiId,
      domain: TEST_XMPP_DOMAIN,
      logger: { warn: () => undefined },
    });

    expect(await countMemory(context, aiId, roomChatKey(group.roomLocalpart))).toEqual(GONE);
    expect(await countMemory(context, aiId, roomChatKey(group.generalRoomLocalpart))).toEqual(GONE);
    expect(await countMemory(context, aiId, roomChatKey(topic.roomLocalpart))).toEqual(GONE);
    expect(await countMemory(context, aiId, DM_CHAT_KEY)).toEqual(KEPT);
  });

  it('removeTopicAi deletes only that topic room memory', async () => {
    const { owner, aiId } = await ownerWithAi(`cleanup-topic-${emailCounter}@example.com`);
    const group = await seedGroup(context, owner.id, aiId);
    const topic = await seedTopic(context, owner.id, group.groupId, aiId);
    await seedMemory(context, aiId, roomChatKey(topic.roomLocalpart), 'topic');
    await seedMemory(context, aiId, roomChatKey(group.roomLocalpart), 'group');
    await seedMemory(context, aiId, DM_CHAT_KEY, 'dm');

    const { removeTopicAi } = await import('../../topics/service');
    await removeTopicAi(topicDeps(context), topic.topicId, owner.id, aiId);

    expect(await countMemory(context, aiId, roomChatKey(topic.roomLocalpart))).toEqual(GONE);
    expect(await countMemory(context, aiId, roomChatKey(group.roomLocalpart))).toEqual(KEPT);
    expect(await countMemory(context, aiId, DM_CHAT_KEY)).toEqual(KEPT);
  });
});
