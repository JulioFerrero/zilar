import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLog, groupMembers, pinnedMessages, topics } from '../db/schema';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  expectedJid,
  testApp,
  TEST_BASE_URL,
  type TestApp,
  type TestContext,
} from '../test-support';
import type { TopicView } from '../topics/access';

interface PinBody {
  id: string;
  chat: string;
  messageId: string;
  senderName: string;
  text: string;
  kind: string;
  pinnedBy: string;
  pinnedAt: string;
}

interface DetailBody {
  id: string;
  title: string;
  createdBy: string;
  membersCanCreateTopics: boolean;
}

describe('pins', () => {
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
    return (await response.json()) as DetailBody;
  }

  async function createTopic(cookie: string, groupId: string, body: unknown) {
    const response = await app.request(`${TEST_BASE_URL}/api/groups/${groupId}/topics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as TopicView };
  }

  async function listPins(cookie: string, chat: string) {
    return app.request(`${TEST_BASE_URL}/api/pins?chat=${encodeURIComponent(chat)}`, {
      headers: { cookie },
    });
  }

  async function pin(cookie: string, body: unknown) {
    return app.request(`${TEST_BASE_URL}/api/pins`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  }

  async function unpin(cookie: string, id: string) {
    return app.request(`${TEST_BASE_URL}/api/pins/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { cookie },
    });
  }

  async function setup() {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const other = await contactOf(context, app, owner.id, 'other@example.com');
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');
    const group = await createGroup(owner.cookie, 'Team', [member.id, other.id]);
    return { owner, member, other, stranger, group };
  }

  function pinBody(chat: string, messageId = 'msg-1', kind = 'text', text = 'hello') {
    return { chat, messageId, senderName: 'Owner', text, kind };
  }

  it('lets either side of a DM pin, list and unpin; both share one list', async () => {
    const { owner, member, stranger } = await setup();
    const ownerJid = expectedJid(owner.id);
    const memberJid = expectedJid(member.id);

    const created = await pin(owner.cookie, pinBody(memberJid));
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as PinBody;
    expect(createdBody.messageId).toBe('msg-1');
    expect(createdBody.pinnedBy).toBe(owner.id);
    expect(typeof createdBody.pinnedAt).toBe('string');

    // The other side names the chat from their own side and sees the pin.
    const listed = await listPins(member.cookie, ownerJid);
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as { pins: PinBody[] };
    expect(listedBody.pins.map((entry) => entry.messageId)).toEqual(['msg-1']);

    // Newest first.
    await pin(member.cookie, pinBody(ownerJid, 'msg-2', 'text', 'second'));
    const relisted = (await (await listPins(owner.cookie, memberJid)).json()) as {
      pins: PinBody[];
    };
    expect(relisted.pins.map((entry) => entry.messageId)).toEqual(['msg-2', 'msg-1']);

    // A stranger gets the same 404 as for an unknown chat.
    expect((await listPins(stranger.cookie, memberJid)).status).toBe(404);
    const strangerPin = await pin(stranger.cookie, pinBody(memberJid));
    expect(strangerPin.status).toBe(404);

    // Either side can unpin.
    const unpinned = await unpin(member.cookie, createdBody.id);
    expect(unpinned.status).toBe(200);
    // The echo is the caller's peer, never the stored pair key.
    expect(((await unpinned.json()) as PinBody).chat).toBe(ownerJid);
    const after = (await (await listPins(owner.cookie, memberJid)).json()) as {
      pins: PinBody[];
    };
    expect(after.pins.map((entry) => entry.messageId)).toEqual(['msg-2']);
  });

  it('lets a group admin who can see the topic pin; plain members read but may not write', async () => {
    const { owner, member, stranger, group } = await setup();
    const created = await createTopic(owner.cookie, group.id, { name: 'Backend' });
    expect(created.status).toBe(201);
    const chatJid = created.body.chatJid;

    // Plain member reads (empty) but cannot pin.
    expect((await listPins(member.cookie, chatJid)).status).toBe(200);
    const forbidden = await pin(member.cookie, pinBody(chatJid));
    expect(forbidden.status).toBe(403);

    // The owner pins and the member reads it.
    const pinned = await pin(owner.cookie, pinBody(chatJid));
    expect(pinned.status).toBe(201);
    const memberList = (await (await listPins(member.cookie, chatJid)).json()) as {
      pins: PinBody[];
    };
    expect(memberList.pins.map((entry) => entry.messageId)).toEqual(['msg-1']);

    // The member cannot unpin either.
    const pinId = ((await pinned.json()) as PinBody).id;
    expect((await unpin(member.cookie, pinId)).status).toBe(403);

    // A stranger gets 404 everywhere, like for an unknown chat.
    expect((await listPins(stranger.cookie, chatJid)).status).toBe(404);
    expect((await pin(stranger.cookie, pinBody(chatJid))).status).toBe(404);
    expect((await unpin(stranger.cookie, pinId)).status).toBe(404);
  });

  it('lets the topic creator pin even as a plain member; hides private topics from non-member admins', async () => {
    const { owner, member, other, group } = await setup();
    const created = await createTopic(owner.cookie, group.id, {
      name: 'Hiring',
      visibility: 'private',
      memberIds: [member.id],
    });
    expect(created.status).toBe(201);
    const chatJid = created.body.chatJid;

    // `other` becomes a real group admin (direct row update, like
    // groups.test.ts) who still cannot see the private topic: the admin path
    // below is the "cannot see" path, not the stranger path.
    await context.db
      .update(groupMembers)
      .set({ role: 'admin' })
      .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, other.id)));
    // The creator is demoted to a plain member after creating the topic
    // (T-0116 will do this through the API): the `createdBy` branch is what
    // lets them pin, not any current role.
    await context.db
      .update(topics)
      .set({ createdBy: member.id })
      .where(eq(topics.id, created.body.id));

    // A plain member of the private topic who did not create it cannot pin.
    expect((await pin(other.cookie, pinBody(chatJid, 'msg-x'))).status).toBe(404);
    // The demoted creator still can.
    expect((await pin(member.cookie, pinBody(chatJid))).status).toBe(201);
    // The non-member admin sees the same 404 as for a missing chat, on every
    // route.
    expect((await listPins(other.cookie, chatJid)).status).toBe(404);
    expect((await pin(other.cookie, pinBody(chatJid, 'msg-9'))).status).toBe(404);
  });

  it('rejects duplicate pins, enforces the 20-pin cap, and validates snapshots', async () => {
    const { owner, member } = await setup();
    const memberJid = expectedJid(member.id);

    expect((await pin(owner.cookie, pinBody(memberJid))).status).toBe(201);
    expect((await pin(owner.cookie, pinBody(memberJid))).status).toBe(409);

    for (let index = 2; index <= 20; index += 1) {
      const response = await pin(owner.cookie, pinBody(memberJid, `msg-${index}`));
      expect(response.status, `pin ${index}`).toBe(201);
    }
    const over = await pin(owner.cookie, pinBody(memberJid, 'msg-21'));
    expect(over.status).toBe(400);
    expect(((await over.json()) as { error: { code: string } }).error.code).toBe('pin_limit');

    // Validation runs on a fresh DM (the pair above is already at the cap,
    // and the pair key is symmetric, so any pin there would hit `pin_limit`).
    const fresh = await contactOf(context, app, member.id, 'fresh@example.com');
    const freshJid = expectedJid(member.id);
    const long = await pin(fresh.cookie, {
      chat: freshJid,
      messageId: 'x',
      senderName: 'M',
      text: 'a'.repeat(301),
      kind: 'text',
    });
    expect(long.status).toBe(400);
    const control = await pin(fresh.cookie, {
      chat: freshJid,
      messageId: 'x',
      senderName: 'M',
      text: 'bad\u0007name',
      kind: 'text',
    });
    expect(control.status).toBe(400);
    const longName = await pin(fresh.cookie, {
      chat: freshJid,
      messageId: 'x',
      senderName: 'n'.repeat(81),
      text: '',
      kind: 'text',
    });
    expect(longName.status).toBe(400);
    const badKind = await pin(fresh.cookie, {
      chat: freshJid,
      messageId: 'x',
      senderName: 'M',
      text: '',
      kind: 'video',
    });
    expect(badKind.status).toBe(400);
    // Attachment snapshots carry no text.
    const attachmentText = await pin(fresh.cookie, {
      chat: freshJid,
      messageId: 'x',
      senderName: 'M',
      text: 'nope',
      kind: 'image',
    });
    expect(attachmentText.status).toBe(400);
    const attachment = await pin(fresh.cookie, {
      chat: freshJid,
      messageId: 'img-1',
      senderName: 'M',
      text: '',
      kind: 'image',
    });
    expect(attachment.status).toBe(201);
  });

  it('pins a multiline message: tabs and newlines are kept, other control chars rejected', async () => {
    const { owner, member } = await setup();
    const memberJid = expectedJid(member.id);
    const text = 'Agenda:\n1.\ttabu\u0007lated\n2. done';
    const response = await pin(owner.cookie, {
      chat: memberJid,
      messageId: 'multi-1',
      senderName: 'Owner',
      text,
      kind: 'text',
    });
    // BEL (0x07) is rejected; the same text without it pins fine.
    expect(response.status).toBe(400);
    const clean = await pin(owner.cookie, {
      chat: memberJid,
      messageId: 'multi-1',
      senderName: 'Owner',
      text: 'Agenda:\n1.\ttabulated\n2. done',
      kind: 'text',
    });
    expect(clean.status).toBe(201);
    expect(((await clean.json()) as PinBody).text).toBe('Agenda:\n1.\ttabulated\n2. done');
    const listed = (await (await listPins(member.cookie, expectedJid(owner.id))).json()) as {
      pins: PinBody[];
    };
    expect(listed.pins.map((entry) => entry.text)).toEqual(['Agenda:\n1.\ttabulated\n2. done']);
  });

  it('holds the 20-pin cap under concurrent writes', async () => {
    const { owner, member } = await setup();
    const memberJid = expectedJid(member.id);
    // PGlite runs every query on one connection, so these interleave rather
    // than truly racing; the advisory lock is what serializes the same chat
    // on real Postgres. Either way the chat must never hold more than 20.
    const attempts = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        pin(owner.cookie, pinBody(memberJid, `race-${index}`)),
      ),
    );
    const created = attempts.filter((response) => response.status === 201);
    const limited = attempts.filter((response) => response.status === 400);
    expect(created).toHaveLength(20);
    expect(limited).toHaveLength(5);
    const stored = await context.db.select().from(pinnedMessages);
    expect(stored).toHaveLength(20);
  });

  it('audits pin and unpin with ids only, and keeps private-topic pins out of group activity', async () => {
    const { owner, member, group } = await setup();
    const memberJid = expectedJid(member.id);
    const created = await pin(owner.cookie, pinBody(memberJid));
    const pinId = ((await created.json()) as PinBody).id;
    await unpin(owner.cookie, pinId);

    const publicTopic = await createTopic(owner.cookie, group.id, { name: 'Backend' });
    const publicPin = await pin(owner.cookie, pinBody(publicTopic.body.chatJid));
    const publicPinId = ((await publicPin.json()) as PinBody).id;

    const privateTopic = await createTopic(owner.cookie, group.id, {
      name: 'Hiring',
      visibility: 'private',
      memberIds: [member.id],
    });
    await pin(owner.cookie, pinBody(privateTopic.body.chatJid, 'secret-msg'));

    const rows = await context.db.select().from(auditLog);
    const pinned = rows.filter((row) => row.action === 'message.pinned');
    const unpinned = rows.filter((row) => row.action === 'message.unpinned');
    expect(pinned.length).toBe(3);
    expect(unpinned.length).toBe(1);
    for (const row of [...pinned, ...unpinned]) {
      expect(JSON.stringify(row.detail)).not.toContain('hello');
      expect(JSON.stringify(row.detail)).not.toContain('Owner');
    }
    // DM pins carry no group; the public-topic pin does; the private-topic
    // pin carries none either, so group activity never shows it.
    const bySubject = new Map(rows.map((row) => [row.subjectId, row]));
    expect(bySubject.get(pinId)?.groupId).toBeNull();
    expect(bySubject.get(publicPinId)?.groupId).toBe(group.id);
    const secret = pinned.find(
      (row) => (row.detail as Record<string, unknown>)?.['messageId'] === 'secret-msg',
    );
    expect(secret?.groupId).toBeNull();

    // The pin rows themselves exist with the canonical DM pair key shared
    // by both sides (re-pin, since the DM pin above was unpinned again).
    await pin(owner.cookie, pinBody(memberJid, 'msg-kept'));
    const stored = await context.db.select().from(pinnedMessages);
    expect(stored.some((row) => row.chatJid.includes('|'))).toBe(true);
  });

  it('rate-limits pin writes at 60 per minute per user', async () => {
    const { owner, member } = await setup();
    const memberJid = expectedJid(member.id);
    // 30 pins + 30 unpins stay under the 20-pin cap while using the write
    // budget; the 61st write in the same window is refused.
    for (let index = 0; index < 30; index += 1) {
      const response = await pin(owner.cookie, pinBody(memberJid, `rl-${index}`));
      expect(response.status, `pin ${index}`).toBe(201);
      const pinId = ((await response.json()) as PinBody).id;
      expect((await unpin(owner.cookie, pinId)).status, `unpin ${index}`).toBe(200);
    }
    const limited = await pin(owner.cookie, pinBody(memberJid, 'rl-60'));
    expect(limited.status).toBe(429);
    // Reads are not rate-limited.
    expect((await listPins(owner.cookie, memberJid)).status).toBe(200);
  });

  it('requires authentication on every pin route', async () => {
    const list = await app.request(`${TEST_BASE_URL}/api/pins?chat=x`);
    expect(list.status).toBe(401);
    const created = await app.request(`${TEST_BASE_URL}/api/pins`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(created.status).toBe(401);
    const removed = await app.request(`${TEST_BASE_URL}/api/pins/x`, { method: 'DELETE' });
    expect(removed.status).toBe(401);
  });

  it('answers 404 for unknown pins and chats with the same message and body', async () => {
    const { owner, member } = await setup();
    const missing = await unpin(owner.cookie, 'missing');
    expect(missing.status).toBe(404);
    const missingBody = (await missing.json()) as { error: { code: string; message: string } };
    expect(missingBody.error.code).toBe('not_found');
    expect(missingBody.error.message).toBe('Chat not found');
    // Unknown chat answers the identical message and body (requestId
    // aside), so pin ids cannot be told apart from invisible chats.
    const sameBody = (body: unknown): { code: string; message: string } => {
      const parsed = body as { error: { code: string; message: string } };
      return { code: parsed.error.code, message: parsed.error.message };
    };
    const unknownChat = await listPins(owner.cookie, 'not-a-jid');
    expect(unknownChat.status).toBe(404);
    expect(sameBody(await unknownChat.json())).toEqual(sameBody(missingBody));
    const unknownRoom = await listPins(owner.cookie, 'room@unknown.example');
    expect(unknownRoom.status).toBe(404);
    expect(sameBody(await unknownRoom.json())).toEqual(sameBody(missingBody));
    expect((await pin(owner.cookie, pinBody('not-a-jid'))).status).toBe(404);
    expect(sameBody(await (await pin(owner.cookie, pinBody('not-a-jid'))).json())).toEqual(
      sameBody(missingBody),
    );
    expect((await listPins(owner.cookie, expectedJid(member.id))).status).toBe(200);
  });
});
