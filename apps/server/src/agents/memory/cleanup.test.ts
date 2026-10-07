import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  aiLimits,
  aiMemoryFacts,
  aiMemoryMessages,
  aiMemoryNodes,
  aiMemoryState,
  ais,
  groupAis,
  groupMembers,
  groups,
  providerConnections,
  topicAis,
  topics,
} from '../../db/schema';
import {
  bootstrapUser,
  createTestContext,
  testApp,
  TEST_XMPP_DOMAIN,
  type TestApp,
  type TestContext,
} from '../../test-support';
import { deleteRoomMemory } from './store';

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
  await context.db.insert(providerConnections).values({
    id: connectionId,
    owner: ownerId,
    provider: 'openai',
    encryptedKey: 'sealed-placeholder',
    label: null,
  });
  const aiId = randomUUID();
  const localpart = `ai-${aiId}`;
  await context.db.insert(ais).values({
    id: aiId,
    owner: ownerId,
    name: 'Helper AI',
    template: 'dev',
    persona: 'A persona',
    providerConnectionId: connectionId,
    model: 'gpt-4o-mini',
    localpart,
    jid: `${localpart}@${TEST_XMPP_DOMAIN}`,
    status: 'active',
  });
  await context.db.insert(aiLimits).values({ aiId, perDayUsd: '1.00', perMonthUsd: '20.00' });
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
  await context.db.insert(aiMemoryMessages).values({
    aiId,
    chatKey,
    seq: 0,
    messageId: `${tag}-m0`,
    at: NOW,
    sender: 'Bob',
    text: 'hello',
    deleted: false,
  });
  await context.db.insert(aiMemoryNodes).values({
    aiId,
    chatKey,
    lo: 0,
    hi: 16,
    summary: `${tag} summary`,
  });
  await context.db.insert(aiMemoryFacts).values({
    id: randomUUID(),
    aiId,
    chatKey,
    text: `${tag} fact`,
    createdAt: NOW,
  });
  await context.db.insert(aiMemoryState).values({ aiId, chatKey, floorSeq: 0 });
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
  const [messages, nodes, facts, state] = await Promise.all([
    context.db
      .select({ seq: aiMemoryMessages.seq })
      .from(aiMemoryMessages)
      .where(and(eq(aiMemoryMessages.aiId, aiId), eq(aiMemoryMessages.chatKey, chatKey))),
    context.db
      .select({ lo: aiMemoryNodes.lo })
      .from(aiMemoryNodes)
      .where(and(eq(aiMemoryNodes.aiId, aiId), eq(aiMemoryNodes.chatKey, chatKey))),
    context.db
      .select({ id: aiMemoryFacts.id })
      .from(aiMemoryFacts)
      .where(and(eq(aiMemoryFacts.aiId, aiId), eq(aiMemoryFacts.chatKey, chatKey))),
    context.db
      .select({ aiId: aiMemoryState.aiId })
      .from(aiMemoryState)
      .where(and(eq(aiMemoryState.aiId, aiId), eq(aiMemoryState.chatKey, chatKey))),
  ]);
  return {
    messages: messages.length,
    nodes: nodes.length,
    facts: facts.length,
    state: state.length,
  };
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
  await context.db.insert(groups).values({
    id: groupId,
    roomLocalpart: groupRoomLocalpart,
    title: 'Trip',
    createdBy: ownerId,
  });
  await context.db.insert(groupMembers).values({ groupId, userId: ownerId, role: 'owner' });
  await context.db.insert(groupAis).values({ groupId, aiId, addedBy: ownerId });
  const generalTopicId = randomUUID();
  const generalRoomLocalpart = roomLocalpart();
  await context.db.insert(topics).values({
    id: generalTopicId,
    groupId,
    name: 'General',
    glyph: 'G',
    roomLocalpart: generalRoomLocalpart,
    visibility: 'public',
    kind: 'chat',
    status: 'open',
    isGeneral: true,
    createdBy: ownerId,
  });
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
  await context.db.insert(topics).values({
    id: topicId,
    groupId,
    name: `work-${topicId.slice(0, 8)}`,
    glyph: 'W',
    roomLocalpart: localpart,
    visibility: 'public',
    kind: 'chat',
    status: 'open',
    isGeneral: false,
    createdBy: ownerId,
  });
  await context.db.insert(topicAis).values({ topicId, aiId, addedBy: ownerId });
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

  it('deleteRoomMemory deletes only one AI and only the named rooms', async () => {
    const { owner, aiId } = await ownerWithAi(`cleanup-direct-${emailCounter}@example.com`);
    const otherAiId = await seedAi(context, owner.id);
    const roomA = roomLocalpart();
    const roomB = roomLocalpart();
    await seedMemory(context, aiId, roomChatKey(roomA), 'a');
    await seedMemory(context, aiId, roomChatKey(roomB), 'b');
    await seedMemory(context, aiId, DM_CHAT_KEY, 'dm');
    await seedMemory(context, otherAiId, roomChatKey(roomA), 'other');

    await deleteRoomMemory(context.db, aiId, [roomA]);

    expect(await countMemory(context, aiId, roomChatKey(roomA))).toEqual(GONE);
    expect(await countMemory(context, aiId, roomChatKey(roomB))).toEqual(KEPT);
    expect(await countMemory(context, aiId, DM_CHAT_KEY)).toEqual(KEPT);
    expect(await countMemory(context, otherAiId, roomChatKey(roomA))).toEqual(KEPT);
  });

  it('deleteRoomMemory does nothing for an empty list', async () => {
    const { aiId } = await ownerWithAi(`cleanup-empty-${emailCounter}@example.com`);
    const roomA = roomLocalpart();
    await seedMemory(context, aiId, roomChatKey(roomA), 'a');

    await deleteRoomMemory(context.db, aiId, []);

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
