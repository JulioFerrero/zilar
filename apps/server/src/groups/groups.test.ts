import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  aiLimits,
  ais,
  aiTools,
  approvalRules,
  groupAis,
  groupMembers,
  groups,
  providerConnections,
  topicAis,
} from '../db/schema';
import { user } from '../auth/auth-schema';
import { aiLocalpart } from '../ais/service';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  FakeAdminClient,
  testApp,
  TEST_BASE_URL,
  TEST_XMPP_DOMAIN,
  type TestApp,
  type TestContext,
} from '../test-support';
import type { RoomAffiliation } from '../xmpp/admin-client';
import { localpartFor } from '../xmpp/provisioning';
import { onGroupAi, type GroupAiEvent } from './events';
import { MAX_GROUP_MEMBERS } from './service';

interface GroupDetailBody {
  id: string;
  title: string;
  createdBy: string;
  members: Array<{ userId: string; name: string; role: string }>;
  ais: Array<{ aiId: string; jid: string; name: string; ownerId: string }>;
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

  function addAiRequest(cookie: string, groupId: string, body: unknown) {
    return app.request(`${TEST_BASE_URL}/api/groups/${groupId}/ais`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  }

  function removeAiRequest(cookie: string, groupId: string, aiId: string) {
    return app.request(`${TEST_BASE_URL}/api/groups/${groupId}/ais/${aiId}`, {
      method: 'DELETE',
      headers: { cookie },
    });
  }

  function groupDetailRequest(cookie: string, groupId: string) {
    return app.request(`${TEST_BASE_URL}/api/groups/${groupId}`, {
      headers: { cookie },
    });
  }

  // An admin client whose room writes fail everywhere except the group's own
  // room: the in-transaction removal succeeds while the post-commit topic
  // sync fails, proving the failure is logged and the database still commits.
  class TopicRoomsDownClient extends FakeAdminClient {
    groupRoom = '';

    override setAffiliation(
      roomId: string,
      jid: string,
      affiliation: RoomAffiliation,
    ): Promise<void> {
      if (this.groupRoom !== '' && roomId !== this.groupRoom) {
        return Promise.reject(new Error('ejabberd is down'));
      }
      return super.setAffiliation(roomId, jid, affiliation);
    }
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

  it('sends a direct invitation from the room to the new members, never the creator', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');

    const response = await createGroupRequest(owner.cookie, {
      title: 'Weekend trip',
      memberIds: [member.id],
    });
    const { id: groupId } = (await response.json()) as GroupDetailBody;
    const roomLocalpart = await roomLocalpartOf(groupId);

    expect(context.adminClient.directInvitations).toEqual([
      {
        roomId: roomLocalpart,
        users: [`${localpartFor(member.id)}@${TEST_XMPP_DOMAIN}`],
      },
    ]);
  });

  it('never fails the request when the invitation cannot be sent, and logs a warning', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    context.adminClient.failDirectInvitation = true;

    const response = await createGroupRequest(owner.cookie, {
      title: 'Trip',
      memberIds: [member.id],
    });

    expect(response.status).toBe(201);
    expect(context.logOutput()).toContain('could not send the group invitations');
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

  it('invites only the newly added members, not existing members or the actor', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const late = await contactOf(context, app, owner.id, 'late@example.com');

    const created = await createGroupRequest(owner.cookie, {
      title: 'Team',
      memberIds: [member.id],
    });
    const { id: groupId } = (await created.json()) as GroupDetailBody;
    const roomLocalpart = await roomLocalpartOf(groupId);
    context.adminClient.directInvitations.length = 0;

    const added = await addMembersRequest(owner.cookie, groupId, [late.id, member.id]);
    expect(added.status).toBe(200);
    expect(context.adminClient.directInvitations).toEqual([
      {
        roomId: roomLocalpart,
        users: [`${localpartFor(late.id)}@${TEST_XMPP_DOMAIN}`],
      },
    ]);
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

  it('still commits the removal and logs when the post-commit topic sync fails', async () => {
    const flaky = new TopicRoomsDownClient();
    const ownContext = await createTestContext({ adminClient: flaky });
    const ownApp = testApp(ownContext);
    try {
      const owner = await bootstrapUser(ownContext, ownApp, 'owner@example.com');
      const member = await contactOf(ownContext, ownApp, owner.id, 'member@example.com');
      const created = await ownApp.request(`${TEST_BASE_URL}/api/groups`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({ title: 'Team', memberIds: [member.id] }),
      });
      expect(created.status).toBe(201);
      const groupId = ((await created.json()) as GroupDetailBody).id;
      const topic = await ownApp.request(`${TEST_BASE_URL}/api/groups/${groupId}/topics`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({ name: 'Side' }),
      });
      expect(topic.status).toBe(201);
      const [groupRow] = await ownContext.db.select().from(groups).where(eq(groups.id, groupId));
      flaky.groupRoom = groupRow!.roomLocalpart;

      const removed = await ownApp.request(
        `${TEST_BASE_URL}/api/groups/${groupId}/members/${member.id}`,
        { method: 'DELETE', headers: { cookie: owner.cookie } },
      );
      // Best effort: the database removal commits even though the topic
      // rooms could not be synced, and the failure is logged.
      expect(removed.status).toBe(200);
      expect(
        await ownContext.db
          .select()
          .from(groupMembers)
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, member.id))),
      ).toEqual([]);
      expect(ownContext.logOutput()).toContain('could not sync a topic room');
    } finally {
      await ownContext.close();
    }
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

    const addAi = await app.request(`${TEST_BASE_URL}/api/groups/x/ais`, { method: 'POST' });
    expect(addAi.status).toBe(401);

    const removeAi = await app.request(`${TEST_BASE_URL}/api/groups/x/ais/y`, {
      method: 'DELETE',
    });
    expect(removeAi.status).toBe(401);
  });

  describe('AIs in groups', () => {
    async function groupWithMember(): Promise<{
      owner: Awaited<ReturnType<typeof bootstrapUser>>;
      member: Awaited<ReturnType<typeof bootstrapUser>>;
      groupId: string;
    }> {
      const owner = await bootstrapUser(context, app, 'owner@example.com');
      const member = await contactOf(context, app, owner.id, 'member@example.com');
      const created = await createGroupRequest(owner.cookie, {
        title: 'Team',
        memberIds: [member.id],
      });
      expect(created.status).toBe(201);
      const { id: groupId } = (await created.json()) as GroupDetailBody;
      return { owner, member, groupId };
    }

    it('lets an owner or admin add their own AI: affiliation, row, event', async () => {
      const { owner, member, groupId } = await groupWithMember();
      const ai = await seedAi(owner.id);
      const seen: GroupAiEvent[] = [];
      const unsub = onGroupAi((event) => {
        seen.push(event);
      });
      try {
        const response = await addAiRequest(owner.cookie, groupId, { aiId: ai.aiId });
        expect(response.status).toBe(200);
        const detail = (await response.json()) as GroupDetailBody;
        expect(detail.ais).toEqual([
          { aiId: ai.aiId, jid: ai.jid, name: 'Helper AI', ownerId: owner.id },
        ]);
        expect(detail.members.map((entry) => entry.userId)).toEqual(
          expect.arrayContaining([owner.id, member.id]),
        );
      } finally {
        unsub();
      }

      const roomLocalpart = await roomLocalpartOf(groupId);
      expect(context.adminClient.affiliations).toEqual(
        expect.arrayContaining([{ roomId: roomLocalpart, jid: ai.jid, affiliation: 'member' }]),
      );
      const rows = await context.db.select().from(groupAis);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ groupId, aiId: ai.aiId, addedBy: owner.id });
      expect(seen).toEqual([{ type: 'ai-added', groupId, aiId: ai.aiId }]);
    });

    it('lets an admin with their own AI add it', async () => {
      const { member, groupId } = await groupWithMember();
      await context.db
        .update(groupMembers)
        .set({ role: 'admin' })
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, member.id)));
      const ai = await seedAi(member.id);

      const response = await addAiRequest(member.cookie, groupId, { aiId: ai.aiId });
      expect(response.status).toBe(200);
      expect(((await response.json()) as GroupDetailBody).ais).toHaveLength(1);
    });

    it('rejects members, non-members and foreign AIs, and validates the body', async () => {
      const { owner, member, groupId } = await groupWithMember();
      const stranger = await bootstrapUser(context, app, 'stranger@example.com');
      const ownAi = await seedAi(owner.id);
      const foreignAi = await seedAi(stranger.id);

      expect((await addAiRequest(member.cookie, groupId, { aiId: ownAi.aiId })).status).toBe(403);
      expect((await addAiRequest(stranger.cookie, groupId, { aiId: ownAi.aiId })).status).toBe(403);
      // Someone else's AI answers the same 404 as a missing one.
      expect((await addAiRequest(owner.cookie, groupId, { aiId: foreignAi.aiId })).status).toBe(
        404,
      );
      expect((await addAiRequest(owner.cookie, groupId, { aiId: 'does-not-exist' })).status).toBe(
        404,
      );
      expect(
        (await addAiRequest(owner.cookie, 'does-not-exist', { aiId: ownAi.aiId })).status,
      ).toBe(404);
      expect((await addAiRequest(owner.cookie, groupId, {})).status).toBe(400);
      expect((await addAiRequest(owner.cookie, groupId, { aiId: '' })).status).toBe(400);
      expect(await context.db.select().from(groupAis)).toHaveLength(0);
    });

    it('adds an AI idempotently', async () => {
      const { owner, groupId } = await groupWithMember();
      const ai = await seedAi(owner.id);

      expect((await addAiRequest(owner.cookie, groupId, { aiId: ai.aiId })).status).toBe(200);
      const affiliationsBefore = context.adminClient.affiliations.length;
      expect((await addAiRequest(owner.cookie, groupId, { aiId: ai.aiId })).status).toBe(200);

      expect(await context.db.select().from(groupAis)).toHaveLength(1);
      expect(context.adminClient.affiliations).toHaveLength(affiliationsBefore);
      expect((await groupDetailRequest(owner.cookie, groupId)).status).toBe(200);
      expect(
        ((await (await groupDetailRequest(owner.cookie, groupId)).json()) as GroupDetailBody).ais,
      ).toHaveLength(1);
    });

    it('refuses to add a stopped or provisioning AI, but leaves an existing member alone', async () => {
      const { owner, groupId } = await groupWithMember();
      const stopped = await seedAi(owner.id);
      await context.db.update(ais).set({ status: 'stopped' }).where(eq(ais.id, stopped.aiId));

      const refused = await addAiRequest(owner.cookie, groupId, { aiId: stopped.aiId });
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
        'ai_not_active',
      );
      expect(await context.db.select().from(groupAis)).toHaveLength(0);

      const provisioning = await seedAi(owner.id);
      await context.db.update(ais).set({ status: 'disabled' }).where(eq(ais.id, provisioning.aiId));
      expect((await addAiRequest(owner.cookie, groupId, { aiId: provisioning.aiId })).status).toBe(
        409,
      );

      // Already a member when it gets stopped: the add stays idempotent.
      const member = await seedAi(owner.id);
      expect((await addAiRequest(owner.cookie, groupId, { aiId: member.aiId })).status).toBe(200);
      await context.db.update(ais).set({ status: 'stopped' }).where(eq(ais.id, member.aiId));
      expect((await addAiRequest(owner.cookie, groupId, { aiId: member.aiId })).status).toBe(200);
    });

    it('answers 200 to two concurrent adds with a single row', async () => {
      const { owner, groupId } = await groupWithMember();
      const ai = await seedAi(owner.id);

      const [first, second] = await Promise.all([
        addAiRequest(owner.cookie, groupId, { aiId: ai.aiId }),
        addAiRequest(owner.cookie, groupId, { aiId: ai.aiId }),
      ]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await context.db.select().from(groupAis)).toHaveLength(1);
    });

    it('counts AIs toward the member cap in both directions', async () => {
      const { owner, groupId } = await groupWithMember();
      // Two people already; fill the rest with people straight in the db.
      const extra = MAX_GROUP_MEMBERS - 2 - 1;
      for (let index = 0; index < extra; index += 1) {
        const id = `cap-user-${index}`;
        await context.db
          .insert(user)
          .values({ id, name: `Cap ${index}`, email: `${id}@example.com` });
        await context.db.insert(groupMembers).values({ groupId, userId: id, role: 'member' });
      }
      const first = await seedAi(owner.id);
      expect((await addAiRequest(owner.cookie, groupId, { aiId: first.aiId })).status).toBe(200);

      // 50 of 50 now: one more AI is rejected...
      const second = await seedAi(owner.id, 'Second AI');
      expect((await addAiRequest(owner.cookie, groupId, { aiId: second.aiId })).status).toBe(400);
      // ...and so is one more person.
      const late = await contactOf(context, app, owner.id, 'late@example.com');
      expect((await addMembersRequest(owner.cookie, groupId, [late.id])).status).toBe(400);
    });

    it('removes an AI by the AI owner and by a group admin, and nobody else', async () => {
      const { owner, member, groupId } = await groupWithMember();
      const ai = await seedAi(member.id);
      expect((await addAiRequest(owner.cookie, groupId, { aiId: 'does-not-exist' })).status).toBe(
        404,
      );
      // The group owner does not own this AI: 404, like a missing one.
      expect((await addAiRequest(owner.cookie, groupId, { aiId: ai.aiId })).status).toBe(404);

      await context.db
        .update(groupMembers)
        .set({ role: 'admin' })
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, member.id)));
      expect((await addAiRequest(member.cookie, groupId, { aiId: ai.aiId })).status).toBe(200);

      const stranger = await bootstrapUser(context, app, 'stranger@example.com');
      expect((await removeAiRequest(stranger.cookie, groupId, ai.aiId)).status).toBe(403);
      expect((await removeAiRequest(member.cookie, groupId, 'does-not-exist')).status).toBe(404);

      const seen: GroupAiEvent[] = [];
      const unsub = onGroupAi((event) => {
        seen.push(event);
      });
      try {
        // The AI owner removes it even after leaving the group.
        expect((await removeMemberRequest(member.cookie, groupId, member.id)).status).toBe(200);
        const removed = await removeAiRequest(member.cookie, groupId, ai.aiId);
        expect(removed.status).toBe(200);
        expect(((await removed.json()) as GroupDetailBody).ais).toHaveLength(0);
      } finally {
        unsub();
      }

      const roomLocalpart = await roomLocalpartOf(groupId);
      expect(context.adminClient.affiliations).toEqual(
        expect.arrayContaining([{ roomId: roomLocalpart, jid: ai.jid, affiliation: 'none' }]),
      );
      expect(await context.db.select().from(groupAis)).toHaveLength(0);
      expect(seen).toEqual([{ type: 'ai-removed', groupId, aiId: ai.aiId }]);
    });

    it('rejects AI removal by a plain member', async () => {
      const { owner, member, groupId } = await groupWithMember();
      const ai = await seedAi(owner.id);
      expect((await addAiRequest(owner.cookie, groupId, { aiId: ai.aiId })).status).toBe(200);

      // A member who is neither an admin nor the AI owner.
      expect((await removeAiRequest(member.cookie, groupId, ai.aiId)).status).toBe(403);
      expect(await context.db.select().from(groupAis)).toHaveLength(1);
    });

    it('answers 403 to an unauthorized remover whether or not the AI is in the group', async () => {
      const { owner, member, groupId } = await groupWithMember();
      const inGroup = await seedAi(owner.id);
      const notInGroup = await seedAi(owner.id);
      expect((await addAiRequest(owner.cookie, groupId, { aiId: inGroup.aiId })).status).toBe(200);

      // Same answer both ways, so the status never reveals the group's AIs.
      expect((await removeAiRequest(member.cookie, groupId, inGroup.aiId)).status).toBe(403);
      expect((await removeAiRequest(member.cookie, groupId, notInGroup.aiId)).status).toBe(403);
    });

    it('lets a group owner remove an AI they do not own', async () => {
      const { owner, member, groupId } = await groupWithMember();
      const ai = await seedAi(member.id);
      await context.db
        .update(groupMembers)
        .set({ role: 'admin' })
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, member.id)));
      expect((await addAiRequest(member.cookie, groupId, { aiId: ai.aiId })).status).toBe(200);

      const removed = await removeAiRequest(owner.cookie, groupId, ai.aiId);
      expect(removed.status).toBe(200);
      expect(((await removed.json()) as GroupDetailBody).ais).toHaveLength(0);
    });

    it('T-0109: removing the AI from the group removes it from every topic', async () => {
      const { owner, groupId } = await groupWithMember();
      const ai = await seedAi(owner.id);
      expect((await addAiRequest(owner.cookie, groupId, { aiId: ai.aiId })).status).toBe(200);

      const first = await app.request(`${TEST_BASE_URL}/api/groups/${groupId}/topics`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({ name: 'Backend' }),
      });
      expect(first.status).toBe(201);
      const firstBody = (await first.json()) as { id: string; chatJid: string };
      const second = await app.request(`${TEST_BASE_URL}/api/groups/${groupId}/topics`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({ name: 'Bugs', visibility: 'private' }),
      });
      expect(second.status).toBe(201);
      const secondBody = (await second.json()) as { id: string; chatJid: string };
      for (const topicId of [firstBody.id, secondBody.id]) {
        const added = await app.request(`${TEST_BASE_URL}/api/topics/${topicId}/ais`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: owner.cookie },
          body: JSON.stringify({ aiId: ai.aiId }),
        });
        expect(added.status).toBe(200);
      }
      const firstRoom = firstBody.chatJid.split('@')[0]!;
      const secondRoom = secondBody.chatJid.split('@')[0]!;
      expect(context.adminClient.affiliationState.get(firstRoom)?.get(ai.jid)).toBe('member');
      expect(context.adminClient.affiliationState.get(secondRoom)?.get(ai.jid)).toBe('member');

      const removed = await removeAiRequest(owner.cookie, groupId, ai.aiId);
      expect(removed.status).toBe(200);
      expect(await context.db.select().from(topicAis)).toHaveLength(0);
      expect(context.adminClient.affiliationState.get(firstRoom)?.get(ai.jid)).toBeUndefined();
      expect(context.adminClient.affiliationState.get(secondRoom)?.get(ai.jid)).toBeUndefined();
    });

    it('T-0099: removing the AI from the group revokes its group rules only', async () => {
      const { owner, groupId } = await groupWithMember();
      const ai = await seedAi(owner.id);
      expect((await addAiRequest(owner.cookie, groupId, { aiId: ai.aiId })).status).toBe(200);

      const otherGroupResponse = await createGroupRequest(owner.cookie, {
        title: 'Other',
        memberIds: [],
      });
      expect(otherGroupResponse.status).toBe(201);
      const otherGroupId = ((await otherGroupResponse.json()) as GroupDetailBody).id;
      await context.db
        .insert(groupAis)
        .values({ groupId: otherGroupId, aiId: ai.aiId, addedBy: owner.id });

      const ruleNow = new Date('2026-01-01T00:00:00Z');
      const [groupRule] = await context.db
        .insert(approvalRules)
        .values({
          id: randomUUID(),
          aiId: ai.aiId,
          groupId,
          action: 'demo.echo',
          createdBy: owner.id,
          createdAt: ruleNow,
        })
        .returning();
      const [personalRule] = await context.db
        .insert(approvalRules)
        .values({
          id: randomUUID(),
          aiId: ai.aiId,
          groupId: null,
          action: 'demo.echo',
          createdBy: owner.id,
          createdAt: ruleNow,
        })
        .returning();
      const [otherGroupRule] = await context.db
        .insert(approvalRules)
        .values({
          id: randomUUID(),
          aiId: ai.aiId,
          groupId: otherGroupId,
          action: 'demo.echo',
          createdBy: owner.id,
          createdAt: ruleNow,
        })
        .returning();

      const removed = await removeAiRequest(owner.cookie, groupId, ai.aiId);
      expect(removed.status).toBe(200);

      const rows = await context.db.select().from(approvalRules);
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(groupRule!.id)?.revokedAt).not.toBeNull();
      expect(byId.get(personalRule!.id)?.revokedAt).toBeNull();
      expect(byId.get(otherGroupRule!.id)?.revokedAt).toBeNull();
    });

    it('T-0103: removing the AI from the group soft-deletes its group tools only', async () => {
      const { owner, groupId } = await groupWithMember();
      const ai = await seedAi(owner.id);
      expect((await addAiRequest(owner.cookie, groupId, { aiId: ai.aiId })).status).toBe(200);

      const toolNow = new Date('2026-01-01T00:00:00Z');
      const [groupTool] = await context.db
        .insert(aiTools)
        .values({
          id: randomUUID(),
          aiId: ai.aiId,
          groupId,
          name: 'group-tool',
          description: 'A group tool',
          currentVersion: 1,
          createdBy: owner.id,
          createdAt: toolNow,
          updatedAt: toolNow,
        })
        .returning();
      const [personalTool] = await context.db
        .insert(aiTools)
        .values({
          id: randomUUID(),
          aiId: ai.aiId,
          groupId: null,
          name: 'personal-tool',
          description: 'A personal tool',
          currentVersion: 1,
          createdBy: owner.id,
          createdAt: toolNow,
          updatedAt: toolNow,
        })
        .returning();

      const removed = await removeAiRequest(owner.cookie, groupId, ai.aiId);
      expect(removed.status).toBe(200);

      const rows = await context.db.select().from(aiTools);
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(groupTool!.id)?.deletedAt).not.toBeNull();
      expect(byId.get(personalTool!.id)?.deletedAt).toBeNull();
    });

    it('lists the group AIs in the detail and hides the group from strangers', async () => {
      const { owner, groupId } = await groupWithMember();
      const ai = await seedAi(owner.id);
      expect((await addAiRequest(owner.cookie, groupId, { aiId: ai.aiId })).status).toBe(200);

      const detail = (await (
        await groupDetailRequest(owner.cookie, groupId)
      ).json()) as GroupDetailBody;
      expect(detail.ais).toEqual([
        { aiId: ai.aiId, jid: ai.jid, name: 'Helper AI', ownerId: owner.id },
      ]);

      const stranger = await bootstrapUser(context, app, 'stranger@example.com');
      expect((await groupDetailRequest(stranger.cookie, groupId)).status).toBe(404);
    });
  });
});
