import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { groupMembers, groups } from '../db/schema';
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
import { localpartFor } from '../xmpp/provisioning';

interface GroupDetailBody {
  id: string;
  title: string;
  createdBy: string;
  members: Array<{ userId: string; name: string; role: string }>;
}

describe('groups', () => {
  let context: TestContext;
  let app: TestApp;

  beforeEach(async () => {
    context = await createTestContext();
    app = testApp(context);
  });

  afterEach(async () => {
    await context.close();
  });

  function createGroupRequest(cookie: string, body: unknown) {
    return app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  }

  function addMembersRequest(cookie: string, groupId: string, userIds: string[]) {
    return app.request(`${TEST_BASE_URL}/api/groups/${groupId}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ userIds }),
    });
  }

  function removeMemberRequest(cookie: string, groupId: string, userId: string) {
    return app.request(`${TEST_BASE_URL}/api/groups/${groupId}/members/${userId}`, {
      method: 'DELETE',
      headers: { cookie },
    });
  }

  async function roomLocalpartOf(groupId: string): Promise<string> {
    const [row] = await context.db.select().from(groups).where(eq(groups.id, groupId));
    if (!row) {
      throw new Error(`no group ${groupId}`);
    }
    return row.roomLocalpart;
  }

  it('creates the room, sets affiliations and makes the creator the owner', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');

    const response = await createGroupRequest(owner.cookie, {
      title: 'Weekend trip',
      memberIds: [member.id],
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as GroupDetailBody;
    expect(body.title).toBe('Weekend trip');
    expect(body.createdBy).toBe(owner.id);
    expect(body.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: owner.id, role: 'owner' }),
        expect.objectContaining({ userId: member.id, role: 'member' }),
      ]),
    );

    const roomLocalpart = await roomLocalpartOf(body.id);
    expect(roomLocalpart).toMatch(/^g[a-z2-7]{16}$/);
    expect(context.adminClient.roomsCreated).toEqual([roomLocalpart]);
    expect(context.adminClient.roomOptions[0]).toMatchObject({
      roomId: roomLocalpart,
      title: 'Weekend trip',
      membersOnly: true,
      persistent: true,
      mam: true,
      anonymous: false,
    });
    expect(context.adminClient.affiliations).toEqual(
      expect.arrayContaining([
        {
          roomId: roomLocalpart,
          jid: `${localpartFor(owner.id)}@${TEST_XMPP_DOMAIN}`,
          affiliation: 'owner',
        },
        {
          roomId: roomLocalpart,
          jid: `${localpartFor(member.id)}@${TEST_XMPP_DOMAIN}`,
          affiliation: 'member',
        },
      ]),
    );

    const memberRows = await context.db.select().from(groupMembers);
    expect(memberRows.map((row) => [row.userId, row.role]).sort()).toEqual(
      [
        [owner.id, 'owner'],
        [member.id, 'member'],
      ].sort(),
    );
  });

  it('rejects a member who is not a contact without naming them', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');

    const response = await createGroupRequest(owner.cookie, {
      title: 'Nope',
      memberIds: [stranger.id],
    });
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain(stranger.id);
    expect(await context.db.select().from(groups)).toHaveLength(0);
    expect(await context.db.select().from(groupMembers)).toHaveLength(0);
    expect(context.adminClient.roomsCreated).toHaveLength(0);
  });

  it('rejects more than 50 members', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const memberIds = Array.from({ length: 51 }, (_, index) => `user-${index}`);

    const response = await createGroupRequest(owner.cookie, { title: 'Big', memberIds });
    expect(response.status).toBe(400);
  });

  it('rejects an empty or over-long title', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');

    expect((await createGroupRequest(owner.cookie, { title: '', memberIds: [] })).status).toBe(400);
    expect((await createGroupRequest(owner.cookie, { title: '   ', memberIds: [] })).status).toBe(
      400,
    );
    expect(
      (await createGroupRequest(owner.cookie, { title: 'a'.repeat(101), memberIds: [] })).status,
    ).toBe(400);
    expect(
      (await createGroupRequest(owner.cookie, { title: 'b'.repeat(100), memberIds: [] })).status,
    ).toBe(201);
  });

  it('returns 503 and leaves no rows when ejabberd cannot create the room', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    context.adminClient.failRoom = true;

    const response = await createGroupRequest(owner.cookie, {
      title: 'Trip',
      memberIds: [member.id],
    });

    expect(response.status).toBe(503);
    expect(await context.db.select().from(groups)).toHaveLength(0);
    expect(await context.db.select().from(groupMembers)).toHaveLength(0);
    expect(context.adminClient.destroyedRooms).toHaveLength(0);
  });

  it('returns 503, rolls back and destroys the room when setting affiliations fails', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    context.adminClient.failAffiliation = true;

    const response = await createGroupRequest(owner.cookie, {
      title: 'Trip',
      memberIds: [member.id],
    });

    expect(response.status).toBe(503);
    expect(await context.db.select().from(groups)).toHaveLength(0);
    expect(await context.db.select().from(groupMembers)).toHaveLength(0);
    expect(context.adminClient.destroyedRooms).toEqual(context.adminClient.roomsCreated);
  });

  it('lets the owner add a contact and rejects members, non-members and non-contacts', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const late = await contactOf(context, app, owner.id, 'late@example.com');
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');

    const created = await createGroupRequest(owner.cookie, {
      title: 'Team',
      memberIds: [member.id],
    });
    expect(created.status).toBe(201);
    const { id: groupId } = (await created.json()) as GroupDetailBody;
    const roomLocalpart = await roomLocalpartOf(groupId);

    expect((await addMembersRequest(member.cookie, groupId, [late.id])).status).toBe(403);
    expect((await addMembersRequest(stranger.cookie, groupId, [owner.id])).status).toBe(403);
    expect((await addMembersRequest(owner.cookie, groupId, [stranger.id])).status).toBe(403);

    const added = await addMembersRequest(owner.cookie, groupId, [late.id]);
    expect(added.status).toBe(200);
    const detail = (await added.json()) as GroupDetailBody;
    expect(detail.members.map((entry) => entry.userId)).toEqual(
      expect.arrayContaining([owner.id, member.id, late.id]),
    );
    expect(context.adminClient.affiliations).toEqual(
      expect.arrayContaining([
        {
          roomId: roomLocalpart,
          jid: `${localpartFor(late.id)}@${TEST_XMPP_DOMAIN}`,
          affiliation: 'member',
        },
      ]),
    );
  });

  it('lets an admin (not just the owner) add their contacts', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const late = await contactOf(context, app, member.id, 'late@example.com');

    const created = await createGroupRequest(owner.cookie, {
      title: 'Team',
      memberIds: [member.id],
    });
    const { id: groupId } = (await created.json()) as GroupDetailBody;

    await context.db
      .update(groupMembers)
      .set({ role: 'admin' })
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, member.id)));

    const added = await addMembersRequest(member.cookie, groupId, [late.id]);
    expect(added.status).toBe(200);
    const detail = (await added.json()) as GroupDetailBody;
    expect(detail.members.map((entry) => entry.userId)).toEqual(expect.arrayContaining([late.id]));
  });

  it('removes members with the right permissions and syncs affiliations', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const other = await contactOf(context, app, owner.id, 'other@example.com');
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');

    const created = await createGroupRequest(owner.cookie, {
      title: 'Team',
      memberIds: [member.id, other.id],
    });
    const { id: groupId } = (await created.json()) as GroupDetailBody;
    const roomLocalpart = await roomLocalpartOf(groupId);

    expect((await removeMemberRequest(member.cookie, groupId, other.id)).status).toBe(403);
    expect((await removeMemberRequest(stranger.cookie, groupId, member.id)).status).toBe(403);
    expect((await removeMemberRequest(owner.cookie, groupId, owner.id)).status).toBe(403);
    expect((await removeMemberRequest(owner.cookie, groupId, stranger.id)).status).toBe(404);

    expect((await removeMemberRequest(member.cookie, groupId, member.id)).status).toBe(200);
    expect(context.adminClient.affiliations).toEqual(
      expect.arrayContaining([
        {
          roomId: roomLocalpart,
          jid: `${localpartFor(member.id)}@${TEST_XMPP_DOMAIN}`,
          affiliation: 'none',
        },
      ]),
    );

    expect((await removeMemberRequest(owner.cookie, groupId, other.id)).status).toBe(200);
    const memberRows = await context.db.select().from(groupMembers);
    expect(memberRows.map((row) => row.userId)).toEqual([owner.id]);
  });

  it('returns a group to its members and hides it from everyone else', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');

    const created = await createGroupRequest(owner.cookie, {
      title: 'Visible',
      memberIds: [member.id],
    });
    const { id: groupId } = (await created.json()) as GroupDetailBody;

    const asOwner = await app.request(`${TEST_BASE_URL}/api/groups/${groupId}`, {
      headers: { cookie: owner.cookie },
    });
    expect(asOwner.status).toBe(200);
    const detail = (await asOwner.json()) as GroupDetailBody;
    expect(detail.members.map((entry) => entry.role).sort()).toEqual(['member', 'owner']);

    const asMember = await app.request(`${TEST_BASE_URL}/api/groups/${groupId}`, {
      headers: { cookie: member.cookie },
    });
    expect(asMember.status).toBe(200);

    const asStranger = await app.request(`${TEST_BASE_URL}/api/groups/${groupId}`, {
      headers: { cookie: stranger.cookie },
    });
    expect(asStranger.status).toBe(404);

    const missing = await app.request(`${TEST_BASE_URL}/api/groups/does-not-exist`, {
      headers: { cookie: owner.cookie },
    });
    expect(missing.status).toBe(404);
  });

  it('requires authentication on every group route', async () => {
    const post = await app.request(`${TEST_BASE_URL}/api/groups`, { method: 'POST' });
    expect(post.status).toBe(401);

    const get = await app.request(`${TEST_BASE_URL}/api/groups/x`);
    expect(get.status).toBe(401);

    const add = await app.request(`${TEST_BASE_URL}/api/groups/x/members`, { method: 'POST' });
    expect(add.status).toBe(401);

    const remove = await app.request(`${TEST_BASE_URL}/api/groups/x/members/y`, {
      method: 'DELETE',
    });
    expect(remove.status).toBe(401);
  });
});
