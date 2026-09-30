import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ais, aiLimits, chatPrefs, providerConnections } from '../db/schema';
import { aiLocalpart } from '../ais/service';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testApp,
  TEST_BASE_URL,
  TEST_XMPP_DOMAIN,
  type TestApp,
  type TestContext,
} from '../test-support';

interface PrefView {
  chatJid: string;
  mutedUntil: string | null;
  archived: boolean;
  pinnedAt: string | null;
  updatedAt: string;
}

describe('chat prefs', () => {
  let context: TestContext;
  let app: TestApp;

  beforeEach(async () => {
    context = await createTestContext();
    app = testApp(context);
  });

  afterEach(async () => {
    await context.close();
  });

  function listPrefs(cookie: string) {
    return app.request(`${TEST_BASE_URL}/api/chat-prefs`, { headers: { cookie } });
  }

  function putPref(cookie: string, chatJid: string, body: unknown) {
    return app.request(`${TEST_BASE_URL}/api/chat-prefs/${encodeURIComponent(chatJid)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  }

  async function setupPair() {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    return { alice, bob };
  }

  async function seedAi(ownerId: string, name = 'Helper AI'): Promise<{ jid: string }> {
    const aiId = randomUUID();
    const connectionId = randomUUID();
    await context.db.insert(providerConnections).values({
      id: connectionId,
      owner: ownerId,
      provider: 'openai',
      encryptedKey: 'sealed-placeholder',
      label: null,
    });
    const localpart = aiLocalpart(aiId);
    const jid = `${localpart}@${TEST_XMPP_DOMAIN}`;
    await context.db.insert(ais).values({
      id: aiId,
      owner: ownerId,
      name,
      template: 'dev',
      persona: 'A helpful persona.',
      providerConnectionId: connectionId,
      model: 'gpt-4o-mini',
      localpart,
      jid,
      status: 'active',
    });
    await context.db.insert(aiLimits).values({ aiId, perDayUsd: '1.00', perMonthUsd: '20.00' });
    return { jid };
  }

  async function createGroup(ownerCookie: string, title: string, memberIds: string[]) {
    const response = await app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ title, memberIds }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string };
  }

  async function generalJid(cookie: string): Promise<string> {
    const response = await app.request(`${TEST_BASE_URL}/api/chats`, { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      chats: Array<{ kind: string; chatJid: string; groupId?: string }>;
    };
    const group = body.chats.find((entry) => entry.kind === 'group');
    if (!group) {
      throw new Error('no group in the chat list');
    }
    return group.chatJid;
  }

  it('CRUDs a DM pref with partial updates', async () => {
    const { alice, bob } = await setupPair();
    const chats = await (
      await app.request(`${TEST_BASE_URL}/api/chats`, { headers: { cookie: alice.cookie } })
    ).json();
    const dm = (chats as { chats: Array<{ kind: string; chatJid: string }> }).chats.find(
      (entry) => entry.kind === 'dm',
    );
    if (!dm) {
      throw new Error('no DM in the chat list');
    }

    expect(((await (await listPrefs(alice.cookie)).json()) as { prefs: PrefView[] }).prefs).toEqual(
      [],
    );

    const muted = await putPref(alice.cookie, dm.chatJid, {
      mutedUntil: '2027-01-01T00:00:00.000Z',
    });
    expect(muted.status).toBe(200);
    expect(((await muted.json()) as PrefView).mutedUntil).toBe('2027-01-01T00:00:00.000Z');

    // Partial update keeps the mute and adds the archive flag.
    const archived = await putPref(alice.cookie, dm.chatJid, { archived: true });
    expect(archived.status).toBe(200);
    const archivedView = (await archived.json()) as PrefView;
    expect(archivedView.archived).toBe(true);
    expect(archivedView.mutedUntil).toBe('2027-01-01T00:00:00.000Z');

    // Clearing every field deletes the row.
    const cleared = await putPref(alice.cookie, dm.chatJid, {
      mutedUntil: null,
      archived: false,
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ prefs: null });
    expect(await context.db.select().from(chatPrefs)).toEqual([]);
    expect(bob.id.length).toBeGreaterThan(0);
  });

  it('pins with a server timestamp and unpins back to defaults', async () => {
    const { alice } = await setupPair();
    const chats = await (
      await app.request(`${TEST_BASE_URL}/api/chats`, { headers: { cookie: alice.cookie } })
    ).json();
    const dm = (chats as { chats: Array<{ kind: string; chatJid: string }> }).chats.find(
      (entry) => entry.kind === 'dm',
    );
    if (!dm) {
      throw new Error('no DM in the chat list');
    }
    const pinned = await putPref(alice.cookie, dm.chatJid, { pinned: true });
    expect(pinned.status).toBe(200);
    const view = (await pinned.json()) as PrefView;
    expect(typeof view.pinnedAt).toBe('string');

    const again = await putPref(alice.cookie, dm.chatJid, { pinned: true });
    expect(((await again.json()) as PrefView).pinnedAt).toBe(view.pinnedAt);

    const unpinned = await putPref(alice.cookie, dm.chatJid, { pinned: false });
    expect(unpinned.status).toBe(200);
    expect(await unpinned.json()).toEqual({ prefs: null });
  });

  it('rejects invalid bodies', async () => {
    const { alice } = await setupPair();
    expect((await putPref(alice.cookie, 'someone@example.com', {})).status).toBe(400);
    expect(
      (await putPref(alice.cookie, 'someone@example.com', { mutedUntil: 'not-a-date' })).status,
    ).toBe(400);
    expect(
      (await putPref(alice.cookie, 'someone@example.com', { pinned: true, nope: 1 })).status,
    ).toBe(400);
  });

  it('404s a DM with a stranger and a group room the caller cannot see', async () => {
    const { alice, bob } = await setupPair();
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');
    void stranger.id;
    const strangerJid = `stranger-unknown@${TEST_XMPP_DOMAIN}`;
    const strangerPut = await putPref(alice.cookie, strangerJid, { archived: true });
    expect(strangerPut.status).toBe(404);

    // Another user's AI is not mine.
    const { jid: aiJid } = await seedAi(bob.id);
    expect((await putPref(alice.cookie, aiJid, { archived: true })).status).toBe(404);

    // My own AI works.
    const { jid: ownAiJid } = await seedAi(alice.id);
    expect((await putPref(alice.cookie, ownAiJid, { archived: true })).status).toBe(200);

    // A group room for a group I am not in.
    const group = await createGroup(bob.cookie, 'Secret club', []);
    const unknownRoom = `nope-${group.id.slice(0, 8)}@rooms.galena.localhost`;
    expect((await putPref(alice.cookie, unknownRoom, { archived: true })).status).toBe(404);
  });

  it('404s a private topic the caller cannot see but allows a visible one', async () => {
    const { alice, bob } = await setupPair();
    const carol = await contactOf(context, app, alice.id, 'carol@example.com');
    const group = await createGroup(alice.cookie, 'Hiring', [bob.id, carol.id]);
    const groupRoom = await generalJid(alice.cookie);
    expect((await putPref(alice.cookie, groupRoom, { pinned: true })).status).toBe(200);

    const created = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}/topics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ name: 'Secret', visibility: 'private', memberIds: [bob.id] }),
    });
    expect(created.status).toBe(201);
    const topic = (await created.json()) as { id: string; chatJid: string };

    // Carol is in the group but not in the private topic.
    expect((await putPref(carol.cookie, topic.chatJid, { archived: true })).status).toBe(404);
    // Bob can see it.
    expect((await putPref(bob.cookie, topic.chatJid, { archived: true })).status).toBe(200);
    // The creator sees it too.
    expect((await putPref(alice.cookie, topic.chatJid, { archived: true })).status).toBe(200);
  });

  it('keeps prefs per user: reads are own-rows only', async () => {
    const { alice, bob } = await setupPair();
    const chats = await (
      await app.request(`${TEST_BASE_URL}/api/chats`, { headers: { cookie: alice.cookie } })
    ).json();
    const dm = (chats as { chats: Array<{ kind: string; chatJid: string }> }).chats.find(
      (entry) => entry.kind === 'dm',
    );
    if (!dm) {
      throw new Error('no DM in the chat list');
    }
    expect((await putPref(alice.cookie, dm.chatJid, { archived: true })).status).toBe(200);
    expect(
      ((await (await listPrefs(alice.cookie)).json()) as { prefs: PrefView[] }).prefs,
    ).toHaveLength(1);
    expect(((await (await listPrefs(bob.cookie)).json()) as { prefs: PrefView[] }).prefs).toEqual(
      [],
    );
    // Bob cannot write prefs for the DM JID from Alice's side… both directions
    // of the contact see their own rows; the stored JID is Alice's.
  });

  it('enforces the row and pin caps', async () => {
    const { alice } = await setupPair();
    for (let index = 0; index < 20; index += 1) {
      const response = await putPref(alice.cookie, `room${index}@rooms.galena.localhost`, {
        pinned: true,
      });
      // These rooms do not exist, so they 404 before the cap matters.
      expect(response.status).toBe(404);
    }
    // Seed 20 pins directly, then the 21st pin is refused.
    for (let index = 0; index < 20; index += 1) {
      await context.db.insert(chatPrefs).values({
        userId: alice.id,
        chatJid: `seed${index}@example.com`,
        archived: false,
        pinnedAt: new Date('2026-01-01T00:00:00Z'),
        mutedUntil: null,
      });
    }
    const chats = await (
      await app.request(`${TEST_BASE_URL}/api/chats`, { headers: { cookie: alice.cookie } })
    ).json();
    const dm = (chats as { chats: Array<{ kind: string; chatJid: string }> }).chats.find(
      (entry) => entry.kind === 'dm',
    );
    if (!dm) {
      throw new Error('no DM in the chat list');
    }
    expect((await putPref(alice.cookie, dm.chatJid, { pinned: true })).status).toBe(409);

    // Row cap: 200 rows, then a new chat is refused.
    await context.db.delete(chatPrefs);
    for (let index = 0; index < 200; index += 1) {
      await context.db.insert(chatPrefs).values({
        userId: alice.id,
        chatJid: `row${index}@example.com`,
        archived: true,
        pinnedAt: null,
        mutedUntil: null,
      });
    }
    expect((await putPref(alice.cookie, dm.chatJid, { archived: true })).status).toBe(409);
  });

  it('rate-limits writes per user', async () => {
    const { alice } = await setupPair();
    const chats = await (
      await app.request(`${TEST_BASE_URL}/api/chats`, { headers: { cookie: alice.cookie } })
    ).json();
    const dm = (chats as { chats: Array<{ kind: string; chatJid: string }> }).chats.find(
      (entry) => entry.kind === 'dm',
    );
    if (!dm) {
      throw new Error('no DM in the chat list');
    }
    for (let index = 0; index < 60; index += 1) {
      const response = await putPref(alice.cookie, dm.chatJid, { archived: index % 2 === 0 });
      expect(response.status).toBe(200);
    }
    expect((await putPref(alice.cookie, dm.chatJid, { archived: true })).status).toBe(429);
  });

  it('answers 401 without a session', async () => {
    const noCookie = await app.request(`${TEST_BASE_URL}/api/chat-prefs`);
    expect(noCookie.status).toBe(401);
    const noCookiePut = await app.request(
      `${TEST_BASE_URL}/api/chat-prefs/${encodeURIComponent('a@b.c')}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      },
    );
    expect(noCookiePut.status).toBe(401);
  });

  it('stores JIDs case-insensitively and rejects malformed ones', async () => {
    const { alice } = await setupPair();
    const chats = await (
      await app.request(`${TEST_BASE_URL}/api/chats`, { headers: { cookie: alice.cookie } })
    ).json();
    const dm = (chats as { chats: Array<{ kind: string; chatJid: string }> }).chats.find(
      (entry) => entry.kind === 'dm',
    );
    if (!dm) {
      throw new Error('no DM in the chat list');
    }
    const upper = await putPref(alice.cookie, dm.chatJid.toUpperCase(), { archived: true });
    expect(upper.status).toBe(200);
    expect(((await upper.json()) as PrefView).chatJid).toBe(dm.chatJid.toLowerCase());
    expect((await putPref(alice.cookie, 'not-a-jid', { archived: true })).status).toBe(404);
    expect((await putPref(alice.cookie, 'a@b@c', { archived: true })).status).toBe(404);
    expect((await putPref(alice.cookie, '  spaced@x.y', { archived: true })).status).toBe(404);
    const malformed = await app.request(`${TEST_BASE_URL}/api/chat-prefs/%E0%A4%A`, {
      method: 'PUT',
      headers: { cookie: alice.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
    expect(malformed.status).toBe(404);
    expect(
      await context.db.select().from(chatPrefs).where(eq(chatPrefs.userId, alice.id)),
    ).toHaveLength(1);
  });
});
