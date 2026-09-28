import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { groups } from '../db/schema';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testApp,
  TEST_BASE_URL,
  TEST_XMPP_DOMAIN,
  TEST_XMPP_MUC_DOMAIN,
  type TestApp,
  type TestContext,
} from '../test-support';
import { localpartFor } from '../xmpp/provisioning';
import { UNNAMED_CONTACT_NAME } from '../contacts/service';

interface ChatsBody {
  chats: Array<{
    kind: 'dm' | 'group';
    chatJid: string;
    title: string;
    userId?: string;
    groupId?: string;
    memberCount?: number;
    role?: string;
    avatarUrl?: string;
  }>;
}

describe('GET /api/chats', () => {
  let context: TestContext;
  let app: TestApp;

  beforeEach(async () => {
    context = await createTestContext();
    app = testApp(context);
  });

  afterEach(async () => {
    await context.close();
  });

  async function chatsFor(cookie: string): Promise<Response> {
    return app.request(`${TEST_BASE_URL}/api/chats`, { headers: { cookie } });
  }

  async function createGroup(cookie: string, title: string, memberIds: string[]) {
    const response = await app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title, memberIds }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string };
  }

  it('returns my DMs and groups with the right JIDs and member counts', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const group = await createGroup(alice.cookie, 'Trip', [bob.id]);
    const [groupRow] = await context.db.select().from(groups).where(eq(groups.id, group.id));

    const aliceResponse = await chatsFor(alice.cookie);
    expect(aliceResponse.status).toBe(200);
    const aliceChats = ((await aliceResponse.json()) as ChatsBody).chats;
    expect(aliceChats).toHaveLength(2);

    expect(aliceChats.find((chat) => chat.kind === 'dm')).toMatchObject({
      kind: 'dm',
      chatJid: `${localpartFor(bob.id)}@${TEST_XMPP_DOMAIN}`,
      title: UNNAMED_CONTACT_NAME,
      userId: bob.id,
    });
    expect(aliceChats.find((chat) => chat.kind === 'group')).toMatchObject({
      kind: 'group',
      chatJid: `${groupRow?.roomLocalpart}@${TEST_XMPP_MUC_DOMAIN}`,
      title: 'Trip',
      groupId: group.id,
      memberCount: 2,
      role: 'owner',
    });

    const bobResponse = await chatsFor(bob.cookie);
    const bobChats = ((await bobResponse.json()) as ChatsBody).chats;
    expect(bobChats.find((chat) => chat.kind === 'dm')).toMatchObject({
      chatJid: `${localpartFor(alice.id)}@${TEST_XMPP_DOMAIN}`,
      title: UNNAMED_CONTACT_NAME,
      userId: alice.id,
    });
    expect(bobChats.find((chat) => chat.kind === 'group')).toMatchObject({
      groupId: group.id,
      memberCount: 2,
      role: 'member',
    });
  });

  it("never shows another user's DMs or groups", async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    await createGroup(alice.cookie, 'Private', [bob.id]);

    const carol = await bootstrapUser(context, app, 'carol@example.com');
    const response = await chatsFor(carol.cookie);
    expect(response.status).toBe(200);
    expect(((await response.json()) as ChatsBody).chats).toEqual([]);
  });

  it('sorts chats by title', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const zoe = await contactOf(context, app, alice.id, 'zoe@example.com');
    const amy = await contactOf(context, app, alice.id, 'amy@example.com');

    for (const [signedIn, name] of [
      [zoe, 'Zoe'],
      [amy, 'Amy'],
    ] as const) {
      const response = await app.request(`${TEST_BASE_URL}/api/me`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: signedIn.cookie },
        body: JSON.stringify({ name }),
      });
      expect(response.status).toBe(200);
    }

    const response = await chatsFor(alice.cookie);
    const titles = ((await response.json()) as ChatsBody).chats.map((chat) => chat.title);
    expect(titles).toEqual(['Amy', 'Zoe']);
  });

  it('requires authentication', async () => {
    const response = await app.request(`${TEST_BASE_URL}/api/chats`);
    expect(response.status).toBe(401);
  });

  it('accepts a bearer token as well as a cookie', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');

    const response = await app.request(`${TEST_BASE_URL}/api/chats`, {
      headers: { authorization: `Bearer ${alice.bearer}` },
    });
    expect(response.status).toBe(200);
    expect((await response.json()) as ChatsBody).toEqual({ chats: [] });
  });
});
