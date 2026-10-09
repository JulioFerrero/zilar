import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { randomUUID } from 'node:crypto';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testApp,
  testSql,
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
    isAi?: boolean;
    background?: {
      backgroundPreset: string | null;
      backgroundImageId: string | null;
      backgroundDim: number | null;
    };
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

  // Inserts an AI directly: the chat list only reads the rows, and the AI
  // creation route needs a gateway this test does not mount.
  async function addAi(
    ownerId: string,
    overrides: { name?: string; status?: 'active' | 'disabled' } = {},
  ): Promise<{ id: string; jid: string }> {
    const connectionId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO provider_connections ${sql.insert({
          id: connectionId,
          owner: ownerId,
          provider: 'openai',
          encrypted_key: 'not-a-real-key',
          label: null,
        })}`;
      }),
    );

    const id = randomUUID();
    const jid = `ai-${id}@${TEST_XMPP_DOMAIN}`;
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO ais ${sql.insert({
          id,
          owner: ownerId,
          name: overrides.name ?? 'Helper AI',
          template: 'dev',
          persona: 'A persona',
          provider_connection_id: connectionId,
          model: 'gpt-4o-mini',
          localpart: `ai-${id}`,
          jid,
          status: overrides.status ?? 'active',
        })}`;
        yield* sql`INSERT INTO ai_limits ${sql.insert({ ai_id: id, per_day_usd: '1.00', per_month_usd: '20.00' })}`;
      }),
    );
    return { id, jid };
  }

  it('returns my DMs and groups with the right JIDs and member counts', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const group = await createGroup(alice.cookie, 'Trip', [bob.id]);
    const [groupRow] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{
          roomLocalpart: string;
        }>`SELECT room_localpart FROM groups WHERE id = ${group.id}`;
      }),
    );

    const aliceResponse = await chatsFor(alice.cookie);
    expect(aliceResponse.status).toBe(200);
    const aliceChats = ((await aliceResponse.json()) as ChatsBody).chats;
    expect(aliceChats).toHaveLength(2);

    expect(aliceChats.find((chat) => chat.kind === 'dm')).toMatchObject({
      kind: 'dm',
      chatJid: `${localpartFor(bob.id)}@${TEST_XMPP_DOMAIN}`,
      title: UNNAMED_CONTACT_NAME,
      userId: bob.id,
      isAi: false,
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

  it('carries every group background in the chat list', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const painted = await createGroup(alice.cookie, 'Painted', [bob.id]);
    const plain = await createGroup(alice.cookie, 'Plain', [bob.id]);

    // T-0465: set the group background directly, as the PATCH route does.
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE groups SET background_preset = 'navy' WHERE id = ${painted.id}`;
      }),
    );

    const response = await chatsFor(alice.cookie);
    expect(response.status).toBe(200);
    const chats = ((await response.json()) as ChatsBody).chats;

    expect(chats.find((chat) => chat.groupId === painted.id)?.background).toEqual({
      backgroundPreset: 'navy',
      backgroundImageId: null,
      backgroundDim: null,
    });
    expect(chats.find((chat) => chat.groupId === plain.id)?.background).toEqual({
      backgroundPreset: null,
      backgroundImageId: null,
      backgroundDim: null,
    });
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

  it("lists the caller's active AIs as AI DMs", async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const ai = await addAi(alice.id, { name: 'Dev-1' });

    const response = await chatsFor(alice.cookie);
    expect(response.status).toBe(200);
    const chats = ((await response.json()) as ChatsBody).chats;
    expect(chats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'dm', chatJid: ai.jid, title: 'Dev-1', isAi: true }),
      ]),
    );
    const entry = chats.find((chat) => chat.chatJid === ai.jid);
    expect(entry?.userId).toBeUndefined();
  });

  it("does not list disabled AIs or another user's AIs", async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await bootstrapUser(context, app, 'bob@example.com');
    await addAi(alice.id, { name: 'Paused', status: 'disabled' });
    const bobs = await addAi(bob.id, { name: 'Bobs AI' });

    const response = await chatsFor(alice.cookie);
    const chats = ((await response.json()) as ChatsBody).chats;
    expect(chats).toEqual([]);
    expect(chats.some((chat) => chat.chatJid === bobs.jid)).toBe(false);
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
