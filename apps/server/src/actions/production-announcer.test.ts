import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { Payload } from '@zilar/protocol';
import {
  bootstrapUser,
  createTestContext,
  testApp,
  testSql,
  type TestContext,
} from '../test-support';
import { createProductionAnnouncer, type PostToChatInput } from './production-announcer';

function argsHash(seed: number): string {
  const buf = randomBytes(32);
  buf[0] = seed & 0xff;
  return buf.toString('hex');
}

interface PostedCall extends PostToChatInput {
  payloadRoom: unknown;
}

interface AiOwnerRow {
  owner: string;
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
    const generalTopicId = randomUUID();
    const otherTopicId = randomUUID();
    const generalRoom = `g${randomBytes(15).toString('hex').slice(0, 15)}`;
    const otherRoom = `g${randomBytes(15).toString('hex').slice(0, 15)}`;
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO groups (id, room_localpart, title, created_by) VALUES (${groupId}, ${groupRoom}, 'Crew', ${ownerId})`;
        yield* sql`INSERT INTO group_members (group_id, user_id, role) VALUES (${groupId}, ${ownerId}, 'owner')`;
        yield* sql`INSERT INTO group_ais (group_id, ai_id, added_by) VALUES (${groupId}, ${aiId}, ${ownerId})`;
        yield* sql`INSERT INTO topics (id, group_id, name, glyph, room_localpart, visibility, kind, status, is_general, created_by) VALUES (${generalTopicId}, ${groupId}, 'General', 'G', ${generalRoom}, 'public', 'chat', 'open', true, ${ownerId})`;
        yield* sql`INSERT INTO topics (id, group_id, name, glyph, room_localpart, visibility, kind, status, is_general, created_by) VALUES (${otherTopicId}, ${groupId}, 'Build', 'B', ${otherRoom}, 'public', 'chat', 'open', false, ${ownerId})`;
      }),
    );
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
    const aiId = randomUUID();
    const localpart = `ai-${aiId}`;
    const aiJid = `${localpart}@zilar.localhost`;
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO provider_connections (id, owner, provider, encrypted_key, label) VALUES (${connectionId}, ${owner.id}, 'openai', 'sealed-placeholder', NULL)`;
        yield* sql`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status) VALUES (${aiId}, ${owner.id}, 'Helper', 'dev', 'A persona', ${connectionId}, 'gpt-4o-mini', ${localpart}, ${aiJid}, 'active')`;
        yield* sql`INSERT INTO ai_limits (ai_id, per_day_usd, per_month_usd) VALUES (${aiId}, '1.00', '20.00')`;
      }),
    );
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
    const [aiRow] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<AiOwnerRow>`SELECT owner FROM ais WHERE id = ${aiId}`;
      }),
    );
    const seeded = await seedGroupWithTopics(aiRow?.owner as string, aiId);
    const approvalId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO approvals (id, ai_id, group_id, topic_id, action, summary, args_hash, requested_by, expires_at) VALUES (${approvalId}, ${aiId}, ${seeded.groupId}, ${seeded.otherTopicId}, 'demo.echo', 'Echo hello', ${argsHash(1)}, 'ai-bot@zilar.localhost', ${new Date(Date.now() + 60_000).toISOString()})`;
      }),
    );

    await announcer.approvalRequested({
      aiId,
      groupId: seeded.groupId,
      topicId: seeded.otherTopicId,
      approvalId,
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
    const [aiRow] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<AiOwnerRow>`SELECT owner FROM ais WHERE id = ${aiId}`;
      }),
    );
    const seeded = await seedGroupWithTopics(aiRow?.owner as string, aiId);
    const approvalId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO approvals (id, ai_id, group_id, topic_id, action, summary, args_hash, requested_by, expires_at) VALUES (${approvalId}, ${aiId}, ${seeded.groupId}, ${seeded.generalTopicId}, 'demo.echo', 'Echo hello', ${argsHash(2)}, 'ai-bot@zilar.localhost', ${new Date(Date.now() + 60_000).toISOString()})`;
      }),
    );

    await announcer.approvalRequested({
      aiId,
      groupId: seeded.groupId,
      topicId: seeded.generalTopicId,
      approvalId,
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]?.payloadRoom).toBe(`${seeded.generalRoom}@${context.xmppConfig.mucDomain}`);
  });

  it('posts a personal-chat card into the owner DM with no topic', async () => {
    const { aiId, posts, announcer } = await harness();
    const approvalId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO approvals (id, ai_id, group_id, topic_id, action, summary, args_hash, requested_by, expires_at) VALUES (${approvalId}, ${aiId}, NULL, NULL, 'demo.echo', 'Echo hello', ${argsHash(3)}, 'ai-bot@zilar.localhost', ${new Date(Date.now() + 60_000).toISOString()})`;
      }),
    );

    await announcer.approvalRequested({ aiId, groupId: null, approvalId });

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
