import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { aiLocalpart } from '../ais/service';
import {
  aiLimits,
  ais,
  auditLog,
  groupAis,
  groupMembers,
  groups,
  providerConnections,
  topicAis,
  topicMembers,
  topics,
} from '../db/schema';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  expectedJid,
  testApp,
  TEST_BASE_URL,
  TEST_XMPP_DOMAIN,
  TEST_XMPP_MUC_DOMAIN,
  type TestApp,
  type TestContext,
} from '../test-support';
import type { TopicView } from './access';

interface TopicsBody {
  topics: TopicView[];
}

interface DetailBody {
  id: string;
  title: string;
  createdBy: string;
  membersCanCreateTopics: boolean;
}

describe('topics', () => {
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

  async function createTopic(
    cookie: string,
    groupId: string,
    body: unknown,
  ): Promise<{ status: number; body: TopicView & { error?: { code: string; message: string } } }> {
    const response = await app.request(`${TEST_BASE_URL}/api/groups/${groupId}/topics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      body: (await response.json()) as TopicView & { error?: { code: string; message: string } },
    };
  }

  async function setup() {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const other = await contactOf(context, app, owner.id, 'other@example.com');
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');
    const group = await createGroup(owner.cookie, 'Team', [member.id, other.id]);
    return { owner, member, other, stranger, group };
  }

  async function patchTopic(cookie: string, topicId: string, body: unknown) {
    return app.request(`${TEST_BASE_URL}/api/topics/${topicId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  }

  async function generalOf(groupId: string) {
    const rows = await context.db.select().from(topics).where(eq(topics.groupId, groupId));
    const general = rows.find((row) => row.isGeneral);
    if (!general) {
      throw new Error('no General topic');
    }
    return general;
  }

  it('creates a General topic with the group room when the group is created', async () => {
    const { group } = await setup();
    const general = await generalOf(group.id);
    const [groupRow] = await context.db.select().from(groups).where(eq(groups.id, group.id));
    expect(general.roomLocalpart).toBe(groupRow?.roomLocalpart);
    expect(general.name).toBe('General');
    expect(general.visibility).toBe('public');
    expect(general.isGeneral).toBe(true);

    const response = await app.request(`${TEST_BASE_URL}/api/chats`, {
      headers: { cookie: '' },
    });
    expect(response.status).toBe(401);

    const chatsResponse = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}/topics`, {
      headers: { cookie: (await bootstrapUser(context, app, 'x@example.com')).cookie },
    });
    expect(chatsResponse.status).toBe(200);
    expect(((await chatsResponse.json()) as TopicsBody).topics).toEqual([]);
  });

  it('creates public and private topics with rooms and invitations', async () => {
    const { owner, member, group } = await setup();
    const created = await createTopic(owner.cookie, group.id, { name: 'Backend' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Backend');
    expect(created.body.glyph).toBe('B');
    expect(created.body.visibility).toBe('public');
    expect(created.body.chatJid.endsWith(`@${TEST_XMPP_MUC_DOMAIN}`)).toBe(true);

    const room = created.body.chatJid.split('@')[0]!;
    expect(context.adminClient.roomsCreated).toContain(room);
    expect(context.adminClient.directInvitations.some((invite) => invite.roomId === room)).toBe(
      true,
    );

    const privateCreated = await createTopic(owner.cookie, group.id, {
      name: 'Hiring',
      visibility: 'private',
      memberIds: [member.id],
    });
    expect(privateCreated.status).toBe(201);
    expect(privateCreated.body.visibility).toBe('private');
    expect(privateCreated.body.memberCount).toBe(2);

    const rows = await context.db.select().from(topicMembers);
    expect(
      rows
        .filter((row) => row.topicId === privateCreated.body.id)
        .map((row) => row.userId)
        .sort(),
    ).toEqual([member.id, owner.id].sort());
  });

  it('rejects bad names and non-member creators', async () => {
    const { owner, stranger, group } = await setup();
    expect((await createTopic(owner.cookie, group.id, { name: '' })).status).toBe(400);
    expect((await createTopic(owner.cookie, group.id, { name: 'a'.repeat(81) })).status).toBe(400);
    expect((await createTopic(owner.cookie, group.id, { name: 'bad\u0007name' })).status).toBe(400);
    expect((await createTopic(stranger.cookie, group.id, { name: 'Nope' })).status).toBe(404);
    expect(
      (await createTopic(owner.cookie, group.id, { name: 'Backend', memberIds: [owner.id] }))
        .status,
    ).toBe(400);
  });

  it('rejects duplicate names case-insensitively while active', async () => {
    const { owner, group } = await setup();
    expect((await createTopic(owner.cookie, group.id, { name: 'Backend' })).status).toBe(201);
    expect((await createTopic(owner.cookie, group.id, { name: 'backend' })).status).toBe(409);

    const created = await createTopic(owner.cookie, group.id, { name: 'Temp' });
    expect(created.status).toBe(201);
    const archived = await patchTopic(owner.cookie, created.body.id, { archived: true });
    expect(archived.status).toBe(200);
    expect((await createTopic(owner.cookie, group.id, { name: 'temp' })).status).toBe(201);
  });

  it('hides private topics from non-members, including group admins who were not added', async () => {
    const { owner, member, other, stranger, group } = await setup();
    // `other` becomes a group admin but is not in the private topic.
    await context.db
      .update(groupMembers)
      .set({ role: 'admin' })
      .where(eq(groupMembers.userId, other.id));
    const privateCreated = await createTopic(owner.cookie, group.id, {
      name: 'Hiring',
      visibility: 'private',
      memberIds: [member.id],
    });
    expect(privateCreated.status).toBe(201);
    const topicId = privateCreated.body.id;

    const listFor = async (cookie: string) => {
      const response = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}/topics`, {
        headers: { cookie },
      });
      expect(response.status).toBe(200);
      return ((await response.json()) as TopicsBody).topics.map((topic) => topic.id);
    };
    expect(await listFor(owner.cookie)).toContain(topicId);
    expect(await listFor(member.cookie)).toContain(topicId);
    expect(await listFor(other.cookie)).not.toContain(topicId);
    expect(await listFor(stranger.cookie)).toEqual([]);

    const missing = await app.request(`${TEST_BASE_URL}/api/topics/does-not-exist`, {
      headers: { cookie: stranger.cookie },
    });
    const hidden = await app.request(`${TEST_BASE_URL}/api/topics/${topicId}`, {
      headers: { cookie: other.cookie },
    });
    expect(hidden.status).toBe(404);
    // Same code and message apart from the per-request requestId, so a
    // hidden id cannot be told apart from a missing one.
    const hiddenBody = (await hidden.json()) as { error: { code: string; message: string } };
    const missingBody = (await missing.json()) as { error: { code: string; message: string } };
    expect({ code: hiddenBody.error.code, message: hiddenBody.error.message }).toEqual({
      code: missingBody.error.code,
      message: missingBody.error.message,
    });
    expect(missing.status).toBe(404);

    // The chats list hides it too, and keeps chatJid on General.
    const chats = await app.request(`${TEST_BASE_URL}/api/chats`, {
      headers: { cookie: other.cookie },
    });
    expect(chats.status).toBe(200);
    const chatsBody = (await chats.json()) as {
      chats: Array<{ groupId?: string; chatJid: string; topics: TopicView[] }>;
    };
    const entry = chatsBody.chats.find((chat) => chat.groupId === group.id);
    expect(entry?.topics.map((topic) => topic.id)).not.toContain(topicId);
    const general = await generalOf(group.id);
    expect(entry?.chatJid).toBe(`${general.roomLocalpart}@${TEST_XMPP_MUC_DOMAIN}`);
  });

  it('syncs public rooms with every group member and private rooms with members only', async () => {
    const { owner, member, other, group } = await setup();
    const created = await createTopic(owner.cookie, group.id, { name: 'Backend' });
    expect(created.status).toBe(201);
    const privateCreated = await createTopic(owner.cookie, group.id, {
      name: 'Hiring',
      visibility: 'private',
      memberIds: [member.id],
    });
    expect(privateCreated.status).toBe(201);

    const publicRoom = created.body.chatJid.split('@')[0]!;
    const privateRoom = privateCreated.body.chatJid.split('@')[0]!;
    const publicState = context.adminClient.affiliationState.get(publicRoom);
    expect(publicState?.get(expectedJid(owner.id))).toBe('owner');
    expect(publicState?.get(expectedJid(member.id))).toBe('member');
    expect(publicState?.get(expectedJid(other.id))).toBe('member');
    const privateState = context.adminClient.affiliationState.get(privateRoom);
    expect(privateState?.get(expectedJid(owner.id))).toBe('owner');
    expect(privateState?.get(expectedJid(member.id))).toBe('member');
    expect(privateState?.has(expectedJid(other.id))).toBe(false);
  });

  it('adds group members to public rooms only, and removes them from every room', async () => {
    const { owner, member, group } = await setup();
    const created = await createTopic(owner.cookie, group.id, { name: 'Backend' });
    const privateCreated = await createTopic(owner.cookie, group.id, {
      name: 'Hiring',
      visibility: 'private',
      memberIds: [member.id],
    });
    const publicRoom = created.body.chatJid.split('@')[0]!;
    const privateRoom = privateCreated.body.chatJid.split('@')[0]!;
    const late = await contactOf(context, app, owner.id, 'late@example.com');

    const added = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ userIds: [late.id] }),
    });
    expect(added.status).toBe(200);
    expect(context.adminClient.affiliationState.get(publicRoom)?.get(expectedJid(late.id))).toBe(
      'member',
    );
    expect(context.adminClient.affiliationState.get(privateRoom)?.has(expectedJid(late.id))).toBe(
      false,
    );

    const removed = await app.request(
      `${TEST_BASE_URL}/api/groups/${group.id}/members/${member.id}`,
      { method: 'DELETE', headers: { cookie: owner.cookie } },
    );
    expect(removed.status).toBe(200);
    expect(context.adminClient.affiliationState.get(publicRoom)?.has(expectedJid(member.id))).toBe(
      false,
    );
    expect(context.adminClient.affiliationState.get(privateRoom)?.has(expectedJid(member.id))).toBe(
      false,
    );
    const rows = await context.db
      .select()
      .from(topicMembers)
      .where(eq(topicMembers.topicId, privateCreated.body.id));
    expect(rows.map((row) => row.userId)).not.toContain(member.id);
  });

  it('rolls back the row and the room when the room sync fails', async () => {
    const { owner, member, group } = await setup();
    context.adminClient.failAffiliation = true;
    const created = await createTopic(owner.cookie, group.id, {
      name: 'Backend',
      visibility: 'private',
      memberIds: [member.id],
    });
    expect(created.status).toBe(502);
    const rows = await context.db.select().from(topics).where(eq(topics.groupId, group.id));
    expect(rows.filter((row) => row.name === 'Backend')).toHaveLength(0);
    expect(context.adminClient.destroyedRooms.length).toBeGreaterThan(0);
  });

  it('requires confirmation to expose a private topic, then syncs everyone in', async () => {
    const { owner, member, other, group } = await setup();
    const privateCreated = await createTopic(owner.cookie, group.id, {
      name: 'Hiring',
      visibility: 'private',
      memberIds: [member.id],
    });
    const topicId = privateCreated.body.id;
    const room = privateCreated.body.chatJid.split('@')[0]!;

    const refused = await patchTopic(owner.cookie, topicId, { visibility: 'public' });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'confirmation_required',
    );

    const exposed = await patchTopic(owner.cookie, topicId, {
      visibility: 'public',
      confirmExposeHistory: true,
    });
    expect(exposed.status).toBe(200);
    expect(context.adminClient.affiliationState.get(room)?.get(expectedJid(other.id))).toBe(
      'member',
    );
  });

  it('needs memberIds including the manager to go public back to private', async () => {
    const { owner, member, other, group } = await setup();
    const privateCreated = await createTopic(owner.cookie, group.id, {
      name: 'Hiring',
      visibility: 'private',
      memberIds: [member.id],
    });
    const topicId = privateCreated.body.id;
    await patchTopic(owner.cookie, topicId, {
      visibility: 'public',
      confirmExposeHistory: true,
    });
    const refused = await patchTopic(owner.cookie, topicId, { visibility: 'private' });
    expect(refused.status).toBe(400);
    const back = await patchTopic(owner.cookie, topicId, {
      visibility: 'private',
      memberIds: [other.id],
    });
    expect(back.status).toBe(200);
    expect(((await back.json()) as TopicView).memberCount).toBe(2);
  });

  it('refuses to archive General or make it private', async () => {
    const { owner, group } = await setup();
    const general = await generalOf(group.id);
    const archived = await patchTopic(owner.cookie, general.id, { archived: true });
    expect(archived.status).toBe(400);
    const privatised = await patchTopic(owner.cookie, general.id, {
      visibility: 'private',
      memberIds: [owner.id],
    });
    expect(privatised.status).toBe(400);
    // Renaming General is allowed.
    const renamed = await patchTopic(owner.cookie, general.id, { name: 'Lobby' });
    expect(renamed.status).toBe(200);
  });

  it('archives a private topic when its last member leaves', async () => {
    const { owner, member, group } = await setup();
    const privateCreated = await createTopic(owner.cookie, group.id, {
      name: 'Hiring',
      visibility: 'private',
      memberIds: [member.id],
    });
    const topicId = privateCreated.body.id;
    const room = privateCreated.body.chatJid.split('@')[0] as string;
    const leave = await app.request(`${TEST_BASE_URL}/api/topics/${topicId}/members/${member.id}`, {
      method: 'DELETE',
      headers: { cookie: member.cookie },
    });
    expect(leave.status).toBe(200);
    const removed = await app.request(
      `${TEST_BASE_URL}/api/topics/${topicId}/members/${owner.id}`,
      { method: 'DELETE', headers: { cookie: owner.cookie } },
    );
    // Gone: the topic archived itself, so it answers the missing-topic 404.
    expect(removed.status).toBe(404);
    const [row] = await context.db.select().from(topics).where(eq(topics.id, topicId));
    expect(row?.archivedAt).not.toBeNull();
    // The archived room keeps nobody: the last removal synced everyone out.
    expect(context.adminClient.affiliationState.get(room)?.size ?? 0).toBe(0);
  });

  it('lets any visible member edit the strip, but only managers rename', async () => {
    const { owner, member, group } = await setup();
    const created = await createTopic(owner.cookie, group.id, { name: 'Backend' });
    const topicId = created.body.id;
    const strip = await patchTopic(member.cookie, topicId, {
      status: 'in_progress',
      kind: 'task',
    });
    expect(strip.status).toBe(200);
    expect(((await strip.json()) as TopicView).status).toBe('in_progress');
    const rename = await patchTopic(member.cookie, topicId, { name: 'Frontend' });
    expect(rename.status).toBe(403);
  });

  it('validates the owner and the link fields', async () => {
    const { owner, member, stranger, group } = await setup();
    const owned = await createTopic(owner.cookie, group.id, {
      name: 'Owned',
      owner: { kind: 'user', id: member.id },
      linkUrl: 'https://example.com/pr/42',
      linkLabel: 'PR #42',
    });
    expect(owned.status).toBe(201);
    expect(owned.body.owner).toMatchObject({ kind: 'user', id: member.id });
    expect(owned.body.linkUrl).toBe('https://example.com/pr/42');
    expect(owned.body.linkLabel).toBe('PR #42');

    expect(
      (
        await createTopic(owner.cookie, group.id, {
          name: 'Bad owner',
          owner: { kind: 'user', id: stranger.id },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await createTopic(owner.cookie, group.id, {
          name: 'Bad link',
          linkUrl: 'http://example.com/x',
          linkLabel: 'x',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await createTopic(owner.cookie, group.id, {
          name: 'Half link',
          linkUrl: 'https://example.com/x',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await patchTopic(owner.cookie, owned.body.id, {
          linkUrl: 'javascript:alert(1)',
          linkLabel: 'x',
        })
      ).status,
    ).toBe(400);
  });

  it('lets members create topics only when the group allows it', async () => {
    const { owner, member, group } = await setup();
    expect((await createTopic(member.cookie, group.id, { name: 'Side' })).status).toBe(403);
    const patched = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ membersCanCreateTopics: true }),
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as DetailBody).membersCanCreateTopics).toBe(true);
    expect((await createTopic(member.cookie, group.id, { name: 'Side' })).status).toBe(201);
  });

  it('manages private members with the right rules', async () => {
    const { owner, member, other, stranger, group } = await setup();
    const privateCreated = await createTopic(owner.cookie, group.id, {
      name: 'Hiring',
      visibility: 'private',
      memberIds: [member.id],
    });
    const topicId = privateCreated.body.id;
    const room = privateCreated.body.chatJid.split('@')[0]!;

    // A stranger (not a group member) cannot be added.
    const strangerAdd = await app.request(`${TEST_BASE_URL}/api/topics/${topicId}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ userId: stranger.id }),
    });
    expect(strangerAdd.status).toBe(400);

    const added = await app.request(`${TEST_BASE_URL}/api/topics/${topicId}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ userId: other.id }),
    });
    expect(added.status).toBe(200);
    expect(context.adminClient.affiliationState.get(room)?.get(expectedJid(other.id))).toBe(
      'member',
    );

    const listed = await app.request(`${TEST_BASE_URL}/api/topics/${topicId}/members`, {
      headers: { cookie: other.cookie },
    });
    expect(listed.status).toBe(200);
    expect(
      ((await listed.json()) as { members: Array<{ userId: string }> }).members
        .map((m) => m.userId)
        .sort(),
    ).toEqual([member.id, other.id, owner.id].sort());

    // Public topics answer not_private.
    const general = await generalOf(group.id);
    const publicMembers = await app.request(`${TEST_BASE_URL}/api/topics/${general.id}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ userId: other.id }),
    });
    expect(publicMembers.status).toBe(400);
    expect(((await publicMembers.json()) as { error: { code: string } }).error.code).toBe(
      'not_private',
    );
    const publicListed = await app.request(`${TEST_BASE_URL}/api/topics/${general.id}/members`, {
      headers: { cookie: member.cookie },
    });
    expect(publicListed.status).toBe(200);

    // A non-manager member cannot add or remove others, but can remove self.
    const forbidden = await app.request(`${TEST_BASE_URL}/api/topics/${topicId}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: member.cookie },
      body: JSON.stringify({ userId: other.id }),
    });
    expect(forbidden.status).toBe(403);
    const selfLeave = await app.request(
      `${TEST_BASE_URL}/api/topics/${topicId}/members/${member.id}`,
      { method: 'DELETE', headers: { cookie: member.cookie } },
    );
    expect(selfLeave.status).toBe(200);
  });

  it('never puts a private topic name in an audit row, and hides entries from outsiders', async () => {
    const { owner, member, other, group } = await setup();
    await context.db
      .update(groupMembers)
      .set({ role: 'admin' })
      .where(eq(groupMembers.userId, other.id));
    const privateCreated = await createTopic(owner.cookie, group.id, {
      name: 'Secret Hiring Plans',
      visibility: 'private',
      memberIds: [member.id],
    });
    const topicId = privateCreated.body.id;
    await patchTopic(owner.cookie, topicId, { status: 'done' });

    const rows = await context.db.select().from(auditLog);
    const topicRows = rows.filter((row) => row.action.startsWith('topic.'));
    expect(topicRows.length).toBeGreaterThan(0);
    for (const row of topicRows) {
      expect(JSON.stringify(row.detail ?? {})).not.toContain('Secret Hiring Plans');
    }

    const hidden = await app.request(`${TEST_BASE_URL}/api/audit?groupId=${group.id}`, {
      headers: { cookie: other.cookie },
    });
    expect(hidden.status).toBe(200);
    expect(((await hidden.json()) as { entries: unknown[] }).entries).toEqual([]);
    const shown = await app.request(`${TEST_BASE_URL}/api/audit?groupId=${group.id}`, {
      headers: { cookie: owner.cookie },
    });
    expect(shown.status).toBe(200);
    expect(((await shown.json()) as { entries: unknown[] }).entries.length).toBeGreaterThan(0);
  });

  it('rate-limits topic creation per user', async () => {
    const { owner, group } = await setup();
    for (let index = 0; index < 30; index += 1) {
      const created = await createTopic(owner.cookie, group.id, { name: `Topic ${index}` });
      expect(created.status).toBe(201);
    }
    expect((await createTopic(owner.cookie, group.id, { name: 'One more' })).status).toBe(429);
  });

  it('backfills one General topic per pre-existing group', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const groupA = randomUUID();
    const groupB = randomUUID();
    await context.db.insert(groups).values({
      id: groupA,
      roomLocalpart: 'gbackfillroomaaaaa',
      title: 'Old A',
      createdBy: alice.id,
    });
    await context.db.insert(groups).values({
      id: groupB,
      roomLocalpart: 'gbackfillroombbbbb',
      title: 'Old B',
      createdBy: alice.id,
    });
    await context.client.query(
      `INSERT INTO "topics" ("id", "group_id", "name", "glyph", "room_localpart", "visibility", "kind", "status", "is_general", "created_by")
       SELECT md5('topic-general-' || "groups"."id"), "groups"."id", 'General', 'G', "groups"."room_localpart", 'public', 'chat', 'open', TRUE, "groups"."created_by"
       FROM "groups" ON CONFLICT DO NOTHING`,
    );
    const rows = await context.db.select().from(topics);
    const generals = rows.filter((row) => row.isGeneral);
    expect(generals.map((row) => row.groupId).sort()).toEqual([groupA, groupB].sort());
    expect(generals.every((row) => row.name === 'General')).toBe(true);
  });

  it('requires authentication on every topic route', async () => {
    for (const init of [
      { url: '/api/groups/x/topics', method: 'GET' },
      { url: '/api/groups/x/topics', method: 'POST' },
      { url: '/api/topics/x', method: 'GET' },
      { url: '/api/topics/x', method: 'PATCH' },
      { url: '/api/topics/x/members', method: 'GET' },
      { url: '/api/topics/x/members', method: 'POST' },
      { url: '/api/topics/x/ais', method: 'GET' },
      { url: '/api/topics/x/ais', method: 'POST' },
    ]) {
      const response = await app.request(`${TEST_BASE_URL}${init.url}`, { method: init.method });
      expect(response.status, `${init.method} ${init.url}`).toBe(401);
    }
    const remove = await app.request(`${TEST_BASE_URL}/api/topics/x/members/y`, {
      method: 'DELETE',
    });
    expect(remove.status).toBe(401);
    const removeAi = await app.request(`${TEST_BASE_URL}/api/topics/x/ais/y`, {
      method: 'DELETE',
    });
    expect(removeAi.status).toBe(401);
  });

  describe('topic AIs (T-0109)', () => {
    async function seedAi(
      ownerId: string,
      name = 'Helper AI',
    ): Promise<{ aiId: string; jid: string }> {
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
      return { aiId, jid };
    }

    async function addGroupAi(cookie: string, groupId: string, aiId: string) {
      return app.request(`${TEST_BASE_URL}/api/groups/${groupId}/ais`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ aiId }),
      });
    }

    async function addTopicAi(cookie: string, topicId: string, aiId: string) {
      const response = await app.request(`${TEST_BASE_URL}/api/topics/${topicId}/ais`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ aiId }),
      });
      return {
        status: response.status,
        body: (await response.json()) as TopicView & { error?: { code: string } },
      };
    }

    async function removeTopicAi(cookie: string, topicId: string, aiId: string) {
      const response = await app.request(`${TEST_BASE_URL}/api/topics/${topicId}/ais/${aiId}`, {
        method: 'DELETE',
        headers: { cookie },
      });
      return {
        status: response.status,
        body: (await response.json()) as TopicView & { error?: { code: string } },
      };
    }

    async function topicAisOf(cookie: string, topicId: string) {
      const response = await app.request(`${TEST_BASE_URL}/api/topics/${topicId}/ais`, {
        headers: { cookie },
      });
      return {
        status: response.status,
        body: (await response.json()) as { ais: Array<{ id: string; name: string }> },
      };
    }

    it('lets the AI owner who sees the topic add it, and lists it on the topic', async () => {
      const { owner, member, group } = await setup();
      const { aiId, jid } = await seedAi(owner.id);
      expect((await addGroupAi(owner.cookie, group.id, aiId)).status).toBe(200);
      const created = await createTopic(owner.cookie, group.id, { name: 'Backend' });
      expect(created.status).toBe(201);

      const added = await addTopicAi(owner.cookie, created.body.id, aiId);
      expect(added.status).toBe(200);
      expect(added.body.ais).toEqual([{ id: aiId, name: 'Helper AI' }]);

      const listed = await topicAisOf(owner.cookie, created.body.id);
      expect(listed.status).toBe(200);
      expect(listed.body.ais).toEqual([{ id: aiId, name: 'Helper AI' }]);

      // The AI's JID is now a member of the topic room.
      const room = created.body.chatJid.split('@')[0]!;
      expect(context.adminClient.affiliationState.get(room)?.get(jid)).toBe('member');

      // The topic view carries the AI too.
      const detail = await app.request(`${TEST_BASE_URL}/api/topics/${created.body.id}`, {
        headers: { cookie: member.cookie },
      });
      expect(detail.status).toBe(200);
      expect(((await detail.json()) as TopicView).ais).toEqual([{ id: aiId, name: 'Helper AI' }]);
    });

    it('answers 404 for a non-owner, and for an owner who cannot see a private topic', async () => {
      const { owner, member, other, group } = await setup();
      const { aiId } = await seedAi(owner.id);
      expect((await addGroupAi(owner.cookie, group.id, aiId)).status).toBe(200);
      const privateCreated = await createTopic(owner.cookie, group.id, {
        name: 'Hiring',
        visibility: 'private',
        memberIds: [member.id],
      });
      const topicId = privateCreated.body.id;

      // A plain member who is not the AI owner gets the missing-id 404.
      const foreign = await addTopicAi(member.cookie, topicId, aiId);
      expect(foreign.status).toBe(404);

      // Another owner's AI is a 404 too, so AI ids cannot be probed.
      const strangerAi = await seedAi(other.id);
      expect((await addGroupAi(owner.cookie, group.id, strangerAi.aiId)).status).toBe(404);

      // The AI owner cannot see this private topic: same 404.
      const ownerOnly = await seedAi(other.id);
      await context.db
        .insert(groupAis)
        .values({ groupId: group.id, aiId: ownerOnly.aiId, addedBy: owner.id });
      const blind = await addTopicAi(other.cookie, topicId, ownerOnly.aiId);
      expect(blind.status).toBe(404);
      expect(blind.body.error).toBeDefined();

      const missing = await app.request(`${TEST_BASE_URL}/api/topics/does-not-exist/ais`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({ aiId }),
      });
      expect(missing.status).toBe(404);
      // A stranger's 404 is the same code and message as a missing id (the
      // body also carries a request id, so compare the stable fields).
      const missingBody = (await missing.json()) as { error: { code: string; message: string } };
      const blindBody = blind.body.error as unknown as { code: string; message: string };
      expect({ code: missingBody.error.code, message: missingBody.error.message }).toEqual({
        code: blindBody.code,
        message: blindBody.message,
      });
      expect(missingBody.error).toMatchObject({ code: 'not_found', message: 'Topic not found' });
    });

    it('answers 400 when the AI is not in the group, and for General', async () => {
      const { owner, group } = await setup();
      const { aiId } = await seedAi(owner.id);
      const created = await createTopic(owner.cookie, group.id, { name: 'Backend' });

      const notInGroup = await addTopicAi(owner.cookie, created.body.id, aiId);
      expect(notInGroup.status).toBe(400);

      expect((await addGroupAi(owner.cookie, group.id, aiId)).status).toBe(200);
      const general = await generalOf(group.id);
      const generalAdd = await addTopicAi(owner.cookie, general.id, aiId);
      expect(generalAdd.status).toBe(400);
      expect(generalAdd.body.error?.code).toBe('already_in_general');
    });

    it('removes by owner or manager, and the room affiliation goes with it', async () => {
      const { owner, member, group } = await setup();
      const { aiId, jid } = await seedAi(owner.id);
      expect((await addGroupAi(owner.cookie, group.id, aiId)).status).toBe(200);
      const created = await createTopic(owner.cookie, group.id, { name: 'Backend' });
      const topicId = created.body.id;
      const room = created.body.chatJid.split('@')[0]!;
      expect((await addTopicAi(owner.cookie, topicId, aiId)).status).toBe(200);
      expect(context.adminClient.affiliationState.get(room)?.get(jid)).toBe('member');

      // A plain member who is not the owner cannot remove: same 404.
      const foreign = await removeTopicAi(member.cookie, topicId, aiId);
      expect(foreign.status).toBe(404);

      // The AI owner may remove.
      const removed = await removeTopicAi(owner.cookie, topicId, aiId);
      expect(removed.status).toBe(200);
      expect(removed.body.ais).toEqual([]);
      expect(context.adminClient.affiliationState.get(room)?.get(jid)).toBeUndefined();

      // Removing again answers 404.
      expect((await removeTopicAi(owner.cookie, topicId, aiId)).status).toBe(404);
    });

    it('lets a topic manager who is not the AI owner remove it', async () => {
      const { owner, other, group } = await setup();
      await context.db
        .update(groupMembers)
        .set({ role: 'admin' })
        .where(eq(groupMembers.userId, other.id));
      const { aiId } = await seedAi(owner.id);
      expect((await addGroupAi(owner.cookie, group.id, aiId)).status).toBe(200);
      const privateCreated = await createTopic(owner.cookie, group.id, {
        name: 'Hiring',
        visibility: 'private',
        memberIds: [other.id],
      });
      expect((await addTopicAi(owner.cookie, privateCreated.body.id, aiId)).status).toBe(200);
      const removed = await removeTopicAi(other.cookie, privateCreated.body.id, aiId);
      expect(removed.status).toBe(200);
      expect(removed.body.ais).toEqual([]);
    });

    it('group removal deletes every topic row and the room affiliations', async () => {
      const { owner, group } = await setup();
      const { aiId, jid } = await seedAi(owner.id);
      expect((await addGroupAi(owner.cookie, group.id, aiId)).status).toBe(200);
      const first = await createTopic(owner.cookie, group.id, { name: 'Backend' });
      const second = await createTopic(owner.cookie, group.id, {
        name: 'Hiring',
        visibility: 'private',
      });
      expect((await addTopicAi(owner.cookie, first.body.id, aiId)).status).toBe(200);
      expect((await addTopicAi(owner.cookie, second.body.id, aiId)).status).toBe(200);
      const firstRoom = first.body.chatJid.split('@')[0]!;
      const secondRoom = second.body.chatJid.split('@')[0]!;

      const removed = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}/ais/${aiId}`, {
        method: 'DELETE',
        headers: { cookie: owner.cookie },
      });
      expect(removed.status).toBe(200);
      const rows = await context.db.select().from(topicAis).where(eq(topicAis.aiId, aiId));
      expect(rows).toEqual([]);
      expect(context.adminClient.affiliationState.get(firstRoom)?.get(jid)).toBeUndefined();
      expect(context.adminClient.affiliationState.get(secondRoom)?.get(jid)).toBeUndefined();
    });

    it('never gives a private room an AI that was not added to it', async () => {
      const { owner, member, group } = await setup();
      const { aiId, jid } = await seedAi(owner.id);
      expect((await addGroupAi(owner.cookie, group.id, aiId)).status).toBe(200);
      const privateCreated = await createTopic(owner.cookie, group.id, {
        name: 'Hiring',
        visibility: 'private',
        memberIds: [member.id],
      });
      const room = privateCreated.body.chatJid.split('@')[0]!;
      expect(context.adminClient.affiliationState.get(room)?.get(jid)).toBeUndefined();

      // General keeps every group AI.
      const general = await generalOf(group.id);
      const generalState = context.adminClient.affiliationState.get(general.roomLocalpart);
      expect(generalState?.get(jid)).toBe('member');
    });

    it('drops the AI from a private room when its owner loses the topic, and brings it back', async () => {
      const { owner, member, group } = await setup();
      const { aiId, jid } = await seedAi(owner.id);
      expect((await addGroupAi(owner.cookie, group.id, aiId)).status).toBe(200);
      const privateCreated = await createTopic(owner.cookie, group.id, {
        name: 'Hiring',
        visibility: 'private',
        memberIds: [member.id],
      });
      const topicId = privateCreated.body.id;
      const room = privateCreated.body.chatJid.split('@')[0]!;
      expect((await addTopicAi(owner.cookie, topicId, aiId)).status).toBe(200);
      expect(context.adminClient.affiliationState.get(room)?.get(jid)).toBe('member');

      // The owner removes themselves: the AI loses its room affiliation, but
      // the `topic_ais` row stays.
      const selfLeave = await app.request(
        `${TEST_BASE_URL}/api/topics/${topicId}/members/${owner.id}`,
        { method: 'DELETE', headers: { cookie: owner.cookie } },
      );
      expect(selfLeave.status).toBe(200);
      expect(context.adminClient.affiliationState.get(room)?.get(jid)).toBeUndefined();
      const rows = await context.db
        .select()
        .from(topicAis)
        .where(and(eq(topicAis.topicId, topicId), eq(topicAis.aiId, aiId)));
      expect(rows).toHaveLength(1);

      // Adding the owner back brings the AI back into the room, with no new
      // `topic.ai_added` row needed. The remaining member is not a manager,
      // so insert the membership row directly (the route would 403): the
      // derived rule is what the test pins, not the add-member permission.
      await context.db.insert(topicMembers).values({
        topicId,
        userId: owner.id,
        addedBy: member.id,
      });
      const [revived] = await context.db.select().from(topics).where(eq(topics.id, topicId));
      const { syncTopicRoom } = await import('./rooms');
      await syncTopicRoom(
        {
          db: context.db,
          adminClient: context.adminClient,
          domain: context.config.xmpp.domain,
          logger: context.logger,
        },
        revived!,
      );
      expect(context.adminClient.affiliationState.get(room)?.get(jid)).toBe('member');
    });

    it('making a public topic with an AI private without its owner drops the AI from the room', async () => {
      const { owner, member, other, group } = await setup();
      // `other` is a group admin so they can manage the topic the owner
      // created, while the owner stays out of the new private member list.
      await context.db
        .update(groupMembers)
        .set({ role: 'admin' })
        .where(eq(groupMembers.userId, other.id));
      const { aiId, jid } = await seedAi(owner.id);
      expect((await addGroupAi(owner.cookie, group.id, aiId)).status).toBe(200);
      const created = await createTopic(owner.cookie, group.id, { name: 'Backend' });
      const topicId = created.body.id;
      const room = created.body.chatJid.split('@')[0]!;
      expect((await addTopicAi(owner.cookie, topicId, aiId)).status).toBe(200);
      expect(context.adminClient.affiliationState.get(room)?.get(jid)).toBe('member');

      // The admin makes the topic private with only the other member: the
      // AI's owner is not in `memberIds`, so the AI drops out (row stays).
      const patched = await patchTopic(other.cookie, topicId, {
        visibility: 'private',
        memberIds: [member.id],
      });
      expect(patched.status).toBe(200);
      expect(context.adminClient.affiliationState.get(room)?.get(jid)).toBeUndefined();
      const rows = await context.db
        .select()
        .from(topicAis)
        .where(and(eq(topicAis.topicId, topicId), eq(topicAis.aiId, aiId)));
      expect(rows).toHaveLength(1);
    });

    it('keeps a public topic AI in the room regardless of owner membership', async () => {
      const { owner, group } = await setup();
      const { aiId, jid } = await seedAi(owner.id);
      expect((await addGroupAi(owner.cookie, group.id, aiId)).status).toBe(200);
      const created = await createTopic(owner.cookie, group.id, { name: 'Backend' });
      const topicId = created.body.id;
      const room = created.body.chatJid.split('@')[0]!;
      expect((await addTopicAi(owner.cookie, topicId, aiId)).status).toBe(200);
      expect(context.adminClient.affiliationState.get(room)?.get(jid)).toBe('member');

      // The owner is not in `topic_members` (public topics have no rows) and
      // the AI still belongs in the room.
      const members = await context.db
        .select()
        .from(topicMembers)
        .where(eq(topicMembers.topicId, topicId));
      expect(members).toEqual([]);
      expect(context.adminClient.affiliationState.get(room)?.get(jid)).toBe('member');
    });

    it('records topic.ai_added and topic.ai_removed without private names', async () => {
      const { owner, group } = await setup();
      const { aiId } = await seedAi(owner.id);
      expect((await addGroupAi(owner.cookie, group.id, aiId)).status).toBe(200);
      const privateCreated = await createTopic(owner.cookie, group.id, {
        name: 'Secret Hiring Plans',
        visibility: 'private',
      });
      expect((await addTopicAi(owner.cookie, privateCreated.body.id, aiId)).status).toBe(200);
      expect((await removeTopicAi(owner.cookie, privateCreated.body.id, aiId)).status).toBe(200);

      const rows = await context.db.select().from(auditLog);
      const added = rows.find((row) => row.action === 'topic.ai_added');
      const removedRow = rows.find((row) => row.action === 'topic.ai_removed');
      expect(added).toBeDefined();
      expect(removedRow).toBeDefined();
      expect(added?.subjectId).toBe(privateCreated.body.id);
      for (const row of [added, removedRow]) {
        expect(JSON.stringify(row?.detail ?? {})).not.toContain('Secret Hiring Plans');
      }

      // The AI row is gone from the database after removal.
      const remaining = await context.db
        .select()
        .from(topicAis)
        .where(and(eq(topicAis.topicId, privateCreated.body.id), eq(topicAis.aiId, aiId)));
      expect(remaining).toEqual([]);
    });
  });
});
