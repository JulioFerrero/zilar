import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  aiMemoryFacts,
  aiMemoryMessages,
  aiMemoryState,
  ais,
  providerConnections,
} from '../../db/schema';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  expectedJid,
  testApp,
  TEST_BASE_URL,
  TEST_XMPP_DOMAIN,
  type TestApp,
  type TestContext,
} from '../../test-support';
import type { TopicView } from '../../topics/access';

interface MemoryBody {
  facts: { id: string; text: string }[];
  lines: string[];
  canChange: boolean;
}

interface AiRef {
  id: string;
  jid: string;
}

describe('ai-memory routes', () => {
  let context: TestContext;
  let app: TestApp;

  beforeEach(async () => {
    context = await createTestContext();
    app = testApp(context);
  });

  afterEach(async () => {
    await context.close();
  });

  async function createGroup(cookie: string, title: string, memberIds: string[]) {
    const response = await app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title, memberIds }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string };
  }

  async function createTopic(cookie: string, groupId: string, body: unknown) {
    const response = await app.request(`${TEST_BASE_URL}/api/groups/${groupId}/topics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as TopicView;
  }

  async function makeAi(ownerId: string): Promise<AiRef> {
    const connectionId = randomUUID();
    await context.db.insert(providerConnections).values({
      id: connectionId,
      owner: ownerId,
      provider: 'openai',
      encryptedKey: 'not-a-real-key',
      label: null,
    });
    const id = randomUUID();
    const localpart = `ai-${id}`;
    const jid = `${localpart}@${TEST_XMPP_DOMAIN}`;
    await context.db.insert(ais).values({
      id,
      owner: ownerId,
      name: 'Helper',
      template: 'dev',
      persona: 'A persona',
      providerConnectionId: connectionId,
      model: 'gpt-4o-mini',
      localpart,
      jid,
      status: 'active',
    });
    return { id, jid };
  }

  async function seedFact(aiId: string, chatKey: string, text: string): Promise<string> {
    const id = randomUUID();
    await context.db.insert(aiMemoryFacts).values({ id, aiId, chatKey, text });
    return id;
  }

  async function seedMessages(aiId: string, chatKey: string, count: number): Promise<void> {
    const at = new Date('2026-01-01T00:00:00.000Z');
    await context.db.insert(aiMemoryMessages).values(
      Array.from({ length: count }, (_, seq) => ({
        aiId,
        chatKey,
        seq,
        messageId: `m-${seq}`,
        at,
        sender: 'Owner',
        text: `message ${seq}`,
      })),
    );
  }

  function dmKey(userId: string): string {
    return `dm:${expectedJid(userId).toLowerCase()}`;
  }

  async function getMemory(cookie: string, chat: string, ai: string) {
    return app.request(
      `${TEST_BASE_URL}/api/ai-memory?chat=${encodeURIComponent(chat)}&ai=${encodeURIComponent(ai)}`,
      { headers: { cookie } },
    );
  }

  async function deleteFactRequest(cookie: string, chat: string, ai: string, id: string) {
    return app.request(
      `${TEST_BASE_URL}/api/ai-memory/facts/${encodeURIComponent(id)}?chat=${encodeURIComponent(chat)}&ai=${encodeURIComponent(ai)}`,
      { method: 'DELETE', headers: { cookie } },
    );
  }

  async function clearMemoryRequest(cookie: string, chat: string, ai: string) {
    return app.request(`${TEST_BASE_URL}/api/ai-memory/clear`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ chat, ai }),
    });
  }

  it('shows a DM memory to its owner, with facts and cover lines', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const other = await contactOf(context, app, owner.id, 'other@example.com');
    const ai = await makeAi(owner.id);
    const factId = await seedFact(ai.id, dmKey(owner.id), 'likes mangoes');
    await seedMessages(ai.id, dmKey(owner.id), 51);

    const response = await getMemory(owner.cookie, ai.jid, ai.id);
    expect(response.status).toBe(200);
    const body = (await response.json()) as MemoryBody;
    expect(body.canChange).toBe(true);
    expect(body.facts).toEqual([{ id: factId, text: 'likes mangoes' }]);
    expect(body.lines).toEqual(['#0 2026-01-01 Owner: message 0']);

    // Another signed-in user and the owner naming a different chat both get 404.
    expect((await getMemory(other.cookie, ai.jid, ai.id)).status).toBe(404);
    expect((await getMemory(owner.cookie, expectedJid(other.id), ai.id)).status).toBe(404);
  });

  it('lets the DM owner delete a fact and clear the memory', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const ai = await makeAi(owner.id);
    const chatKey = dmKey(owner.id);
    const factId = await seedFact(ai.id, chatKey, 'likes mangoes');

    const removed = await deleteFactRequest(owner.cookie, ai.jid, ai.id, factId);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });
    // Deleting it a second time is the same 404 as a fact that never existed.
    expect((await deleteFactRequest(owner.cookie, ai.jid, ai.id, factId)).status).toBe(404);

    const keptId = await seedFact(ai.id, chatKey, 'another fact');
    await seedMessages(ai.id, chatKey, 3);
    const cleared = await clearMemoryRequest(owner.cookie, ai.jid, ai.id);
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ ok: true });

    const [state] = await context.db
      .select({ floorSeq: aiMemoryState.floorSeq })
      .from(aiMemoryState)
      .where(eq(aiMemoryState.aiId, ai.id));
    expect(state?.floorSeq).toBe(3);
    const facts = await context.db.select().from(aiMemoryFacts).where(eq(aiMemoryFacts.id, keptId));
    expect(facts).toHaveLength(0);
  });

  it('applies the DM rules to every route', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const other = await contactOf(context, app, owner.id, 'other@example.com');
    const ai = await makeAi(owner.id);
    const factId = await seedFact(ai.id, dmKey(owner.id), 'secret fact');

    // A stranger cannot read, delete or clear.
    expect((await getMemory(other.cookie, ai.jid, ai.id)).status).toBe(404);
    expect((await deleteFactRequest(other.cookie, ai.jid, ai.id, factId)).status).toBe(404);
    expect((await clearMemoryRequest(other.cookie, ai.jid, ai.id)).status).toBe(404);
    // Nothing was deleted by the failed attempts.
    expect(
      await context.db.select().from(aiMemoryFacts).where(eq(aiMemoryFacts.id, factId)),
    ).toHaveLength(1);
  });

  it('lets a room member view but only managers and the AI owner change', async () => {
    const admin = await bootstrapUser(context, app, 'admin@example.com');
    const member = await contactOf(context, app, admin.id, 'member@example.com');
    const aiOwner = await contactOf(context, app, admin.id, 'aiowner@example.com');
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');
    const group = await createGroup(admin.cookie, 'Team', [member.id, aiOwner.id]);
    const ai = await makeAi(aiOwner.id);
    const topic = await createTopic(admin.cookie, group.id, { name: 'Backend' });
    const chatKey = `room:${topic.chatJid.toLowerCase()}`;

    const plainFact = await seedFact(ai.id, chatKey, 'shared fact');

    // A plain member sees the memory but may not change it.
    const viewed = await getMemory(member.cookie, topic.chatJid, ai.id);
    expect(viewed.status).toBe(200);
    const viewBody = (await viewed.json()) as MemoryBody;
    expect(viewBody.canChange).toBe(false);
    expect(viewBody.facts).toEqual([{ id: plainFact, text: 'shared fact' }]);
    expect((await deleteFactRequest(member.cookie, topic.chatJid, ai.id, plainFact)).status).toBe(
      403,
    );
    expect((await clearMemoryRequest(member.cookie, topic.chatJid, ai.id)).status).toBe(403);

    // A group admin (the topic manager) can delete and clear.
    const adminFact = await seedFact(ai.id, chatKey, 'admin fact');
    expect((await deleteFactRequest(admin.cookie, topic.chatJid, ai.id, adminFact)).status).toBe(
      200,
    );
    await seedFact(ai.id, chatKey, 'before clear');
    expect((await clearMemoryRequest(admin.cookie, topic.chatJid, ai.id)).status).toBe(200);

    // The AI's owner is only a plain member, but owns the AI: it can clear.
    await seedFact(ai.id, chatKey, 'owner clear');
    expect((await clearMemoryRequest(aiOwner.cookie, topic.chatJid, ai.id)).status).toBe(200);

    // A non-member gets the same 404 as for an unknown chat.
    expect((await getMemory(stranger.cookie, topic.chatJid, ai.id)).status).toBe(404);
    expect((await clearMemoryRequest(stranger.cookie, topic.chatJid, ai.id)).status).toBe(404);
  });

  it('hides a private topic room from a group member who is not in it', async () => {
    const admin = await bootstrapUser(context, app, 'admin@example.com');
    const member = await contactOf(context, app, admin.id, 'member@example.com');
    const aiOwner = await contactOf(context, app, admin.id, 'aiowner@example.com');
    const group = await createGroup(admin.cookie, 'Team', [member.id, aiOwner.id]);
    const ai = await makeAi(aiOwner.id);
    const privateTopic = await createTopic(admin.cookie, group.id, {
      name: 'Hiring',
      visibility: 'private',
      memberIds: [admin.id],
    });
    await seedFact(ai.id, `room:${privateTopic.chatJid.toLowerCase()}`, 'private fact');

    expect((await getMemory(member.cookie, privateTopic.chatJid, ai.id)).status).toBe(404);
    expect((await clearMemoryRequest(member.cookie, privateTopic.chatJid, ai.id)).status).toBe(404);
  });

  it('validates the query and refuses an unknown AI or another AI fact', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const ai = await makeAi(owner.id);
    const otherAi = await makeAi(owner.id);
    const chatKey = dmKey(owner.id);

    const missing = await app.request(
      `${TEST_BASE_URL}/api/ai-memory?chat=${encodeURIComponent(ai.jid)}`,
      { headers: { cookie: owner.cookie } },
    );
    expect(missing.status).toBe(400);

    expect((await getMemory(owner.cookie, ai.jid, randomUUID())).status).toBe(404);

    const otherFact = await seedFact(otherAi.id, chatKey, 'another AI fact');
    expect((await deleteFactRequest(owner.cookie, ai.jid, ai.id, otherFact)).status).toBe(404);
    expect(
      await context.db.select().from(aiMemoryFacts).where(eq(aiMemoryFacts.id, otherFact)),
    ).toHaveLength(1);
  });

  it('requires a session on every route', async () => {
    const get = await app.request(`${TEST_BASE_URL}/api/ai-memory?chat=a%40b&ai=x`, {
      method: 'GET',
    });
    expect(get.status).toBe(401);

    const del = await app.request(`${TEST_BASE_URL}/api/ai-memory/facts/x?chat=a%40b&ai=x`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(401);

    const clear = await app.request(`${TEST_BASE_URL}/api/ai-memory/clear`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat: 'a@b', ai: 'x' }),
    });
    expect(clear.status).toBe(401);
  });
});
