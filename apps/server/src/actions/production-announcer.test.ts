import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Payload } from '@galena/protocol';
import {
  aiLimits,
  ais,
  approvals,
  groupAis,
  groupMembers,
  groups,
  providerConnections,
  topics,
} from '../db/schema';
import { bootstrapUser, createTestContext, testApp, type TestContext } from '../test-support';
import { createProductionAnnouncer, type PostToChatInput } from './production-announcer';

function argsHash(seed: number): string {
  const buf = randomBytes(32);
  buf[0] = seed & 0xff;
  return buf.toString('hex');
}

interface PostedCall extends PostToChatInput {
  payloadRoom: unknown;
}

describe('production announcer (T-0110 topic wiring)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  async function seedGroupWithTopics(
    ownerId: string,
    aiId: string,
  ): Promise<{
    groupId: string;
    generalTopicId: string;
    otherTopicId: string;
    generalRoom: string;
    otherRoom: string;
  }> {
    const groupId = randomUUID();
    const groupRoom = `g${randomBytes(15).toString('hex').slice(0, 15)}`;
    await context.db.insert(groups).values({
      id: groupId,
      roomLocalpart: groupRoom,
      title: 'Crew',
      createdBy: ownerId,
    });
    await context.db.insert(groupMembers).values({ groupId, userId: ownerId, role: 'owner' });
    await context.db.insert(groupAis).values({ groupId, aiId, addedBy: ownerId });
    const generalTopicId = randomUUID();
    const otherTopicId = randomUUID();
    const generalRoom = `g${randomBytes(15).toString('hex').slice(0, 15)}`;
    const otherRoom = `g${randomBytes(15).toString('hex').slice(0, 15)}`;
    await context.db.insert(topics).values([
      {
        id: generalTopicId,
        groupId,
        name: 'General',
        glyph: 'G',
        roomLocalpart: generalRoom,
        visibility: 'public',
        kind: 'chat',
        status: 'open',
        isGeneral: true,
        createdBy: ownerId,
      },
      {
        id: otherTopicId,
        groupId,
        name: 'Build',
        glyph: 'B',
        roomLocalpart: otherRoom,
        visibility: 'public',
        kind: 'chat',
        status: 'open',
        isGeneral: false,
        createdBy: ownerId,
      },
    ]);
    return { groupId, generalTopicId, otherTopicId, generalRoom, otherRoom };
  }

  async function harness(): Promise<{
    aiId: string;
    posts: PostedCall[];
    announcer: ReturnType<typeof createProductionAnnouncer>;
  }> {
    const authApp = testApp(context);
    const owner = await bootstrapUser(context, authApp, `announcer-${randomUUID()}@example.com`);
    const connectionId = randomUUID();
    await context.db.insert(providerConnections).values({
      id: connectionId,
      owner: owner.id,
      provider: 'openai',
      encryptedKey: 'sealed-placeholder',
      label: null,
    });
    const aiId = randomUUID();
    const localpart = `ai-${aiId}`;
    const aiJid = `${localpart}@galena.localhost`;
    await context.db.insert(ais).values({
      id: aiId,
      owner: owner.id,
      name: 'Helper',
      template: 'dev',
      persona: 'A persona',
      providerConnectionId: connectionId,
      model: 'gpt-4o-mini',
      localpart,
      jid: aiJid,
      status: 'active',
    });
    await context.db.insert(aiLimits).values({ aiId, perDayUsd: '1.00', perMonthUsd: '20.00' });
    const posts: PostedCall[] = [];
    const announcer = createProductionAnnouncer({
      db: context.db,
      domain: context.xmppConfig.domain,
      mucDomain: context.xmppConfig.mucDomain,
      logger: { warn: () => undefined },
      getGateway: () => ({
        postToChat: async (input: PostToChatInput) => {
          const payload = input.payload as { data?: { room?: unknown } } | undefined;
          posts.push({ ...input, payloadRoom: payload?.data?.room });
          return true;
        },
      }),
    });
    return { aiId, posts, announcer };
  }

  it('posts a topic card into that topic room, not General, and passes topicId through', async () => {
    const { aiId, posts, announcer } = await harness();
    const [aiRow] = await context.db.select().from(ais).where(eq(ais.id, aiId));
    const seeded = await seedGroupWithTopics(aiRow?.owner as string, aiId);
    const [approval] = await context.db
      .insert(approvals)
      .values({
        id: randomUUID(),
        aiId,
        groupId: seeded.groupId,
        topicId: seeded.otherTopicId,
        action: 'demo.echo',
        summary: 'Echo hello',
        argsHash: argsHash(1),
        requestedBy: 'ai-bot@galena.localhost',
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();

    await announcer.approvalRequested({
      aiId,
      groupId: seeded.groupId,
      topicId: seeded.otherTopicId,
      approvalId: approval!.id,
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]?.topicId).toBe(seeded.otherTopicId);
    // The card payload names the topic's room, not General's.
    expect(posts[0]?.payloadRoom).toBe(`${seeded.otherRoom}@${context.xmppConfig.mucDomain}`);
    expect(posts[0]?.payloadRoom).not.toBe(`${seeded.generalRoom}@${context.xmppConfig.mucDomain}`);

    await announcer.outcome({
      aiId,
      groupId: seeded.groupId,
      topicId: seeded.otherTopicId,
      status: 'executed',
      summary: 'Echoed: hello',
    });
    expect(posts).toHaveLength(2);
    expect(posts[1]?.topicId).toBe(seeded.otherTopicId);
    expect(posts[1]?.text).toBe('Echoed: hello');
  });

  it('posts a General-topic card into the General room', async () => {
    const { aiId, posts, announcer } = await harness();
    const [aiRow] = await context.db.select().from(ais).where(eq(ais.id, aiId));
    const seeded = await seedGroupWithTopics(aiRow?.owner as string, aiId);
    const [approval] = await context.db
      .insert(approvals)
      .values({
        id: randomUUID(),
        aiId,
        groupId: seeded.groupId,
        topicId: seeded.generalTopicId,
        action: 'demo.echo',
        summary: 'Echo hello',
        argsHash: argsHash(2),
        requestedBy: 'ai-bot@galena.localhost',
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();

    await announcer.approvalRequested({
      aiId,
      groupId: seeded.groupId,
      topicId: seeded.generalTopicId,
      approvalId: approval!.id,
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]?.payloadRoom).toBe(`${seeded.generalRoom}@${context.xmppConfig.mucDomain}`);
  });

  it('posts a personal-chat card into the owner DM with no topic', async () => {
    const { aiId, posts, announcer } = await harness();
    const [approval] = await context.db
      .insert(approvals)
      .values({
        id: randomUUID(),
        aiId,
        groupId: null,
        topicId: null,
        action: 'demo.echo',
        summary: 'Echo hello',
        argsHash: argsHash(3),
        requestedBy: 'ai-bot@galena.localhost',
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();

    await announcer.approvalRequested({ aiId, groupId: null, approvalId: approval!.id });

    expect(posts).toHaveLength(1);
    expect(posts[0]?.topicId).toBeUndefined();
    expect(posts[0]?.groupId).toBeNull();
    const payload = posts[0]?.payload as Payload | undefined;
    expect(payload?.type).toBe('approval.request');
  });

  it('does nothing when the gateway is absent', async () => {
    const authApp = testApp(context);
    await bootstrapUser(context, authApp, `announcer-off-${randomUUID()}@example.com`);
    const silent = createProductionAnnouncer({
      db: context.db,
      domain: context.xmppConfig.domain,
      mucDomain: context.xmppConfig.mucDomain,
      logger: { warn: () => undefined },
      getGateway: () => null,
    });
    await silent.approvalRequested({ aiId: 'no-ai', groupId: null, approvalId: 'no-approval' });
    await silent.outcome({ aiId: 'no-ai', groupId: null, status: 'executed', summary: 'x' });
  });
});
