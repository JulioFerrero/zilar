import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { aiLocalpart } from '../ais/service';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  FakeAdminClient,
  testApp,
  testSql,
  TEST_BASE_URL,
  TEST_XMPP_DOMAIN,
  type TestApp,
  type TestContext,
} from '../test-support';
import type { RoomAffiliation } from '../xmpp/admin-client';
import { localpartFor } from '../xmpp/provisioning';
import type { TopicRow } from '../topics/access';
import { onGroupAi, type GroupAiEvent } from './events';
import { listGroupsForUser, MAX_GROUP_MEMBERS } from './service';

interface GroupDetailBody {
  id: string;
  title: string;
  createdBy: string;
  members: Array<{ userId: string; name: string; role: string }>;
  ais: Array<{ aiId: string; jid: string; name: string; ownerId: string }>;
  background?: {
    backgroundPreset: string | null;
    backgroundImageId: string | null;
    backgroundDim: number | null;
  };
  listener?: {
    enabled: boolean;
    eagerness: string;
    available: boolean;
  };
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

  async function tableCount(table: string): Promise<number> {
    const [row] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ count: number }>`SELECT count(*)::int AS count FROM ${sql(table)}`;
      }),
    );
    return row?.count ?? 0;
  }

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
    const [row] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ roomLocalpart: string }>`SELECT room_localpart FROM groups
          WHERE id = ${groupId}`;
      }),
    );
    if (!row) {
      throw new Error(`no group ${groupId}`);
    }
    return row.roomLocalpart;
  }

  // The General topic of a group created through HTTP (groups always have
  // one since T-0108; group scope lives on it since T-0110).
  async function generalTopicOf(groupId: string): Promise<string> {
    const [row] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ id: string }>`SELECT id FROM topics
          WHERE group_id = ${groupId} AND is_general = TRUE`;
      }),
    );
    if (!row) {
      throw new Error(`no General topic for group ${groupId}`);
    }
    return row.id;
  }

  async function seedAi(
    ownerId: string,
    name = 'Helper AI',
  ): Promise<{ aiId: string; jid: string }> {
    const aiId = randomUUID();
    const connectionId = randomUUID();
    const localpart = aiLocalpart(aiId);
    const jid = `${localpart}@${TEST_XMPP_DOMAIN}`;
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO provider_connections ${sql.insert({
          id: connectionId,
          owner: ownerId,
          provider: 'openai',
          encrypted_key: 'sealed-placeholder',
          label: null,
        })}`;
        yield* sql`INSERT INTO ais ${sql.insert({
          id: aiId,
          owner: ownerId,
          name,
          template: 'dev',
          persona: 'A helpful persona.',
          provider_connection_id: connectionId,
          model: 'gpt-4o-mini',
          localpart,
          jid,
          status: 'active',
        })}`;
        yield* sql`INSERT INTO ai_limits ${sql.insert({
          ai_id: aiId,
          per_day_usd: '1.00',
          per_month_usd: '20.00',
        })}`;
      }),
    );
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

    const memberRows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{
          userId: string;
          role: string;
        }>`SELECT user_id, role FROM group_members`;
      }),
    );
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
    expect(await tableCount('groups')).toBe(0);
    expect(await tableCount('group_members')).toBe(0);
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
    expect(await tableCount('groups')).toBe(0);
    expect(await tableCount('group_members')).toBe(0);
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
    expect(await tableCount('groups')).toBe(0);
    expect(await tableCount('group_members')).toBe(0);
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

    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE group_members SET role = 'admin'
          WHERE group_id = ${groupId} AND user_id = ${member.id}`;
      }),
    );

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
    const memberRows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ userId: string }>`SELECT user_id FROM group_members`;
      }),
    );
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
      const [groupRow] = await testSql(ownContext)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ roomLocalpart: string }>`SELECT room_localpart FROM groups
            WHERE id = ${groupId}`;
        }),
      );
      flaky.groupRoom = groupRow!.roomLocalpart;

      const removed = await ownApp.request(
        `${TEST_BASE_URL}/api/groups/${groupId}/members/${member.id}`,
        { method: 'DELETE', headers: { cookie: owner.cookie } },
      );
      // Best effort: the database removal commits even though the topic
      // rooms could not be synced, and the failure is logged.
      expect(removed.status).toBe(200);
      expect(
        await testSql(ownContext)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{ userId: string }>`SELECT user_id FROM group_members
              WHERE group_id = ${groupId} AND user_id = ${member.id}`;
          }),
        ),
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

    // T-0115: invite-link management needs a session too; joining needs one
    // as well (a person without an account still needs a sign-up invite).
    const createLink = await app.request(`${TEST_BASE_URL}/api/groups/x/invite-links`, {
      method: 'POST',
    });
    expect(createLink.status).toBe(401);

    const listLinks = await app.request(`${TEST_BASE_URL}/api/groups/x/invite-links`);
    expect(listLinks.status).toBe(401);

    const revokeLink = await app.request(`${TEST_BASE_URL}/api/groups/x/invite-links/y`, {
      method: 'DELETE',
    });
    expect(revokeLink.status).toBe(401);

    const preview = await app.request(`${TEST_BASE_URL}/api/join/${'a'.repeat(64)}`);
    expect(preview.status).toBe(401);

    const join = await app.request(`${TEST_BASE_URL}/api/join/${'a'.repeat(64)}`, {
      method: 'POST',
    });
    expect(join.status).toBe(401);
  });

  describe('group backgrounds (T-0463)', () => {
    function patchGroupRequest(cookie: string, groupId: string, body: unknown) {
      return app.request(`${TEST_BASE_URL}/api/groups/${groupId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      });
    }

    async function seedBackgroundImage(userId: string): Promise<string> {
      const id = randomUUID();
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO chat_backgrounds ${sql.insert({
            id,
            user_id: userId,
            mime: 'image/png',
            width: 64,
            height: 64,
            bytes: 10,
            storage_key: `${id}.png`,
          })}`;
        }),
      );
      return id;
    }

    async function ownedGroup() {
      const owner = await bootstrapUser(context, app, 'owner@example.com');
      const member = await contactOf(context, app, owner.id, 'member@example.com');
      const created = await createGroupRequest(owner.cookie, {
        title: 'Wallpaper club',
        memberIds: [member.id],
      });
      expect(created.status).toBe(201);
      const { id: groupId } = (await created.json()) as GroupDetailBody;
      return { owner, member, groupId };
    }

    async function promote(groupId: string, userId: string): Promise<void> {
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE group_members SET role = 'admin'
            WHERE group_id = ${groupId} AND user_id = ${userId}`;
        }),
      );
    }

    it('lets an admin set a preset and returns it in the detail and the list', async () => {
      const { member, groupId } = await ownedGroup();
      await promote(groupId, member.id);

      const patched = await patchGroupRequest(member.cookie, groupId, {
        background: { backgroundPreset: 'navy' },
      });
      expect(patched.status).toBe(200);
      const body = (await patched.json()) as GroupDetailBody;
      expect(body.background).toEqual({
        backgroundPreset: 'navy',
        backgroundImageId: null,
        backgroundDim: null,
      });

      const detail = (await (
        await groupDetailRequest(member.cookie, groupId)
      ).json()) as GroupDetailBody;
      expect(detail.background).toEqual({
        backgroundPreset: 'navy',
        backgroundImageId: null,
        backgroundDim: null,
      });

      const list = await listGroupsForUser(context.db, member.id);
      expect(list.find((group) => group.id === groupId)?.background).toEqual({
        backgroundPreset: 'navy',
        backgroundImageId: null,
        backgroundDim: null,
      });
    });

    it('refuses a plain member with a 403', async () => {
      const { member, groupId } = await ownedGroup();
      const response = await patchGroupRequest(member.cookie, groupId, {
        background: { backgroundPreset: 'navy' },
      });
      expect(response.status).toBe(403);

      const [row] = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{
            backgroundPreset: string | null;
          }>`SELECT background_preset FROM groups
            WHERE id = ${groupId}`;
        }),
      );
      expect(row?.backgroundPreset).toBeNull();
    });

    it('answers a non-member with the same 404 as a missing group', async () => {
      const { groupId } = await ownedGroup();
      const stranger = await bootstrapUser(context, app, 'stranger@example.com');
      const response = await patchGroupRequest(stranger.cookie, groupId, {
        background: { backgroundPreset: 'navy' },
      });
      expect(response.status).toBe(404);
    });

    it('rejects a preset together with an image', async () => {
      const { owner, groupId } = await ownedGroup();
      const imageId = await seedBackgroundImage(owner.id);
      const response = await patchGroupRequest(owner.cookie, groupId, {
        background: { backgroundPreset: 'navy', backgroundImageId: imageId },
      });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { message: string } }).error.message).toBe(
        'Choose a preset or an image',
      );
    });

    it("rejects an image that is not the actor's", async () => {
      const { owner, groupId } = await ownedGroup();
      const stranger = await bootstrapUser(context, app, 'stranger@example.com');
      const foreignId = await seedBackgroundImage(stranger.id);
      const foreign = await patchGroupRequest(owner.cookie, groupId, {
        background: { backgroundImageId: foreignId },
      });
      expect(foreign.status).toBe(400);
      expect(((await foreign.json()) as { error: { message: string } }).error.message).toBe(
        'Unknown background image',
      );

      const missing = await patchGroupRequest(owner.cookie, groupId, {
        background: { backgroundImageId: randomUUID() },
      });
      expect(missing.status).toBe(400);
      expect(((await missing.json()) as { error: { message: string } }).error.message).toBe(
        'Unknown background image',
      );
    });

    it('saves the owner image with a dim', async () => {
      const { owner, groupId } = await ownedGroup();
      const imageId = await seedBackgroundImage(owner.id);
      const response = await patchGroupRequest(owner.cookie, groupId, {
        background: { backgroundImageId: imageId, backgroundDim: 30 },
      });
      expect(response.status).toBe(200);
      expect(((await response.json()) as GroupDetailBody).background).toEqual({
        backgroundPreset: null,
        backgroundImageId: imageId,
        backgroundDim: 30,
      });
    });

    it('clears the background when the preset is null', async () => {
      const { owner, groupId } = await ownedGroup();
      await patchGroupRequest(owner.cookie, groupId, {
        background: { backgroundPreset: 'forest' },
      });
      const cleared = await patchGroupRequest(owner.cookie, groupId, {
        background: { backgroundPreset: null },
      });
      expect(cleared.status).toBe(200);
      expect(((await cleared.json()) as GroupDetailBody).background).toEqual({
        backgroundPreset: null,
        backgroundImageId: null,
        backgroundDim: null,
      });
    });
  });

  describe('group listener settings (T-0474)', () => {
    function patchGroupRequest(cookie: string, groupId: string, body: unknown) {
      return app.request(`${TEST_BASE_URL}/api/groups/${groupId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      });
    }

    async function ownedGroup() {
      const owner = await bootstrapUser(context, app, 'owner@example.com');
      const member = await contactOf(context, app, owner.id, 'member@example.com');
      const created = await createGroupRequest(owner.cookie, {
        title: 'Listener club',
        memberIds: [member.id],
      });
      expect(created.status).toBe(201);
      const { id: groupId } = (await created.json()) as GroupDetailBody;
      return { owner, member, groupId };
    }

    async function promote(groupId: string, userId: string): Promise<void> {
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE group_members SET role = 'admin'
            WHERE group_id = ${groupId} AND user_id = ${userId}`;
        }),
      );
    }

    it('lets an admin set the switch and eagerness and shows them in the detail', async () => {
      const { member, groupId } = await ownedGroup();
      await promote(groupId, member.id);

      const patched = await patchGroupRequest(member.cookie, groupId, {
        listenerEnabled: true,
        listenerEagerness: 'quiet',
      });
      expect(patched.status).toBe(200);
      expect(((await patched.json()) as GroupDetailBody).listener).toEqual({
        enabled: true,
        eagerness: 'quiet',
        available: false,
      });

      const detail = (await (
        await groupDetailRequest(member.cookie, groupId)
      ).json()) as GroupDetailBody;
      expect(detail.listener).toEqual({ enabled: true, eagerness: 'quiet', available: false });

      const [row] = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{
            listenerEnabled: boolean;
            listenerEagerness: string;
          }>`SELECT listener_enabled, listener_eagerness FROM groups
            WHERE id = ${groupId}`;
        }),
      );
      expect(row?.listenerEnabled).toBe(true);
      expect(row?.listenerEagerness).toBe('quiet');
    });

    it('leaves the listener off and normal by default', async () => {
      const { owner, groupId } = await ownedGroup();
      const detail = (await (
        await groupDetailRequest(owner.cookie, groupId)
      ).json()) as GroupDetailBody;
      expect(detail.listener).toEqual({ enabled: false, eagerness: 'normal', available: false });
    });

    it('refuses a plain member with a 403', async () => {
      const { member, groupId } = await ownedGroup();
      const response = await patchGroupRequest(member.cookie, groupId, { listenerEnabled: true });
      expect(response.status).toBe(403);

      const [row] = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ listenerEnabled: boolean }>`SELECT listener_enabled FROM groups
            WHERE id = ${groupId}`;
        }),
      );
      expect(row?.listenerEnabled).toBe(false);
    });

    it('rejects an unknown eagerness with a 400', async () => {
      const { owner, groupId } = await ownedGroup();
      const response = await patchGroupRequest(owner.cookie, groupId, {
        listenerEagerness: 'loud',
      });
      expect(response.status).toBe(400);
    });

    it('reports listener availability from the server flag', async () => {
      const { owner, groupId } = await ownedGroup();
      const enabledApp = testApp({
        ...context,
        config: { ...context.config, LISTENER_ENABLED: true },
      });
      const detail = await enabledApp.request(`${TEST_BASE_URL}/api/groups/${groupId}`, {
        headers: { cookie: owner.cookie },
      });
      expect(((await detail.json()) as GroupDetailBody).listener?.available).toBe(true);
    });
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
      const rows = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{
            groupId: string;
            aiId: string;
            addedBy: string;
          }>`SELECT group_id, ai_id, added_by FROM group_ais`;
        }),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ groupId, aiId: ai.aiId, addedBy: owner.id });
      expect(seen).toEqual([{ type: 'ai-added', groupId, aiId: ai.aiId }]);
    });

    it('lets an admin with their own AI add it', async () => {
      const { member, groupId } = await groupWithMember();
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE group_members SET role = 'admin'
            WHERE group_id = ${groupId} AND user_id = ${member.id}`;
        }),
      );
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
      expect(await tableCount('group_ais')).toBe(0);
    });

    it('adds an AI idempotently', async () => {
      const { owner, groupId } = await groupWithMember();
      const ai = await seedAi(owner.id);

      expect((await addAiRequest(owner.cookie, groupId, { aiId: ai.aiId })).status).toBe(200);
      const affiliationsBefore = context.adminClient.affiliations.length;
      expect((await addAiRequest(owner.cookie, groupId, { aiId: ai.aiId })).status).toBe(200);

      expect(await tableCount('group_ais')).toBe(1);
      expect(context.adminClient.affiliations).toHaveLength(affiliationsBefore);
      expect((await groupDetailRequest(owner.cookie, groupId)).status).toBe(200);
      expect(
        ((await (await groupDetailRequest(owner.cookie, groupId)).json()) as GroupDetailBody).ais,
      ).toHaveLength(1);
    });

    it('refuses to add a stopped or provisioning AI, but leaves an existing member alone', async () => {
      const { owner, groupId } = await groupWithMember();
      const stopped = await seedAi(owner.id);
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE ais SET status = 'stopped' WHERE id = ${stopped.aiId}`;
        }),
      );

      const refused = await addAiRequest(owner.cookie, groupId, { aiId: stopped.aiId });
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
        'ai_not_active',
      );
      expect(await tableCount('group_ais')).toBe(0);

      const provisioning = await seedAi(owner.id);
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE ais SET status = 'disabled' WHERE id = ${provisioning.aiId}`;
        }),
      );
      expect((await addAiRequest(owner.cookie, groupId, { aiId: provisioning.aiId })).status).toBe(
        409,
      );

      // Already a member when it gets stopped: the add stays idempotent.
      const member = await seedAi(owner.id);
      expect((await addAiRequest(owner.cookie, groupId, { aiId: member.aiId })).status).toBe(200);
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE ais SET status = 'stopped' WHERE id = ${member.aiId}`;
        }),
      );
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
      expect(await tableCount('group_ais')).toBe(1);
    });

    it('counts AIs toward the member cap in both directions', async () => {
      const { owner, groupId } = await groupWithMember();
      // Two people already; fill the rest with people straight in the db.
      const extra = MAX_GROUP_MEMBERS - 2 - 1;
      for (let index = 0; index < extra; index += 1) {
        const id = `cap-user-${index}`;
        await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`INSERT INTO "user" ${sql.insert({
              id,
              name: `Cap ${index}`,
              email: `${id}@example.com`,
            })}`;
            yield* sql`INSERT INTO group_members ${sql.insert({
              group_id: groupId,
              user_id: id,
              role: 'member',
            })}`;
          }),
        );
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

      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE group_members SET role = 'admin'
            WHERE group_id = ${groupId} AND user_id = ${member.id}`;
        }),
      );
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
      expect(await tableCount('group_ais')).toBe(0);
      expect(seen).toEqual([{ type: 'ai-removed', groupId, aiId: ai.aiId }]);
    });

    it('rejects AI removal by a plain member', async () => {
      const { owner, member, groupId } = await groupWithMember();
      const ai = await seedAi(owner.id);
      expect((await addAiRequest(owner.cookie, groupId, { aiId: ai.aiId })).status).toBe(200);

      // A member who is neither an admin nor the AI owner.
      expect((await removeAiRequest(member.cookie, groupId, ai.aiId)).status).toBe(403);
      expect(await tableCount('group_ais')).toBe(1);
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
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE group_members SET role = 'admin'
            WHERE group_id = ${groupId} AND user_id = ${member.id}`;
        }),
      );
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
      expect(await tableCount('topic_ais')).toBe(0);
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
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO group_ais ${sql.insert({
            group_id: otherGroupId,
            ai_id: ai.aiId,
            added_by: owner.id,
          })}`;
        }),
      );

      const ruleNow = new Date('2026-01-01T00:00:00Z');
      const generalTopicId = await generalTopicOf(groupId);
      const otherGeneralTopicId = await generalTopicOf(otherGroupId);
      const groupRuleId = randomUUID();
      const personalRuleId = randomUUID();
      const otherGroupRuleId = randomUUID();
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO approval_rules ${sql.insert({
            id: groupRuleId,
            ai_id: ai.aiId,
            group_id: groupId,
            topic_id: generalTopicId,
            action: 'demo.echo',
            created_by: owner.id,
            created_at: ruleNow,
          })}`;
          yield* sql`INSERT INTO approval_rules ${sql.insert({
            id: personalRuleId,
            ai_id: ai.aiId,
            group_id: null,
            topic_id: null,
            action: 'demo.echo',
            created_by: owner.id,
            created_at: ruleNow,
          })}`;
          yield* sql`INSERT INTO approval_rules ${sql.insert({
            id: otherGroupRuleId,
            ai_id: ai.aiId,
            group_id: otherGroupId,
            topic_id: otherGeneralTopicId,
            action: 'demo.echo',
            created_by: owner.id,
            created_at: ruleNow,
          })}`;
        }),
      );

      const removed = await removeAiRequest(owner.cookie, groupId, ai.aiId);
      expect(removed.status).toBe(200);

      const rows = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{
            id: string;
            revokedAt: Date | null;
          }>`SELECT id, revoked_at FROM approval_rules`;
        }),
      );
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(groupRuleId)?.revokedAt).not.toBeNull();
      expect(byId.get(personalRuleId)?.revokedAt).toBeNull();
      expect(byId.get(otherGroupRuleId)?.revokedAt).toBeNull();
    });

    it('T-0103: removing the AI from the group soft-deletes its group tools only', async () => {
      const { owner, groupId } = await groupWithMember();
      const ai = await seedAi(owner.id);
      expect((await addAiRequest(owner.cookie, groupId, { aiId: ai.aiId })).status).toBe(200);

      const toolNow = new Date('2026-01-01T00:00:00Z');
      const generalTopicId = await generalTopicOf(groupId);
      const groupToolId = randomUUID();
      const personalToolId = randomUUID();
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO ai_tools ${sql.insert({
            id: groupToolId,
            ai_id: ai.aiId,
            group_id: groupId,
            topic_id: generalTopicId,
            name: 'group-tool',
            description: 'A group tool',
            current_version: 1,
            created_by: owner.id,
            created_at: toolNow,
            updated_at: toolNow,
          })}`;
          yield* sql`INSERT INTO ai_tools ${sql.insert({
            id: personalToolId,
            ai_id: ai.aiId,
            group_id: null,
            topic_id: null,
            name: 'personal-tool',
            description: 'A personal tool',
            current_version: 1,
            created_by: owner.id,
            created_at: toolNow,
            updated_at: toolNow,
          })}`;
        }),
      );

      const removed = await removeAiRequest(owner.cookie, groupId, ai.aiId);
      expect(removed.status).toBe(200);

      const rows = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{
            id: string;
            deletedAt: Date | null;
          }>`SELECT id, deleted_at FROM ai_tools`;
        }),
      );
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(groupToolId)?.deletedAt).not.toBeNull();
      expect(byId.get(personalToolId)?.deletedAt).toBeNull();
    });

    it('T-0104: removing the AI from the group soft-deletes its group routines only', async () => {
      const { owner, groupId } = await groupWithMember();
      const ai = await seedAi(owner.id);
      expect((await addAiRequest(owner.cookie, groupId, { aiId: ai.aiId })).status).toBe(200);

      const routineNow = new Date('2026-01-01T00:00:00Z');
      const generalTopicId = await generalTopicOf(groupId);
      const groupToolId = randomUUID();
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO ai_tools ${sql.insert({
            id: groupToolId,
            ai_id: ai.aiId,
            group_id: groupId,
            topic_id: generalTopicId,
            name: 'routine-tool',
            description: 'A tool with a routine',
            current_version: 1,
            created_by: owner.id,
            created_at: routineNow,
            updated_at: routineNow,
          })}`;
        }),
      );
      const groupRoutineId = randomUUID();
      const personalRoutineId = randomUUID();
      const schedule = JSON.stringify({ kind: 'interval', everyMinutes: 60 });
      const approvedHosts = JSON.stringify([]);
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO routines
            (id, ai_id, group_id, topic_id, tool_id, title, schedule, approved_hosts, status,
              next_run_at, consecutive_failures, created_by, created_at, updated_at)
            VALUES (${groupRoutineId}, ${ai.aiId}, ${groupId}, ${generalTopicId}, ${groupToolId},
              ${'Group routine'}, ${schedule}::jsonb, ${approvedHosts}::jsonb, ${'active'},
              ${routineNow}, ${0}, ${owner.id}, ${routineNow}, ${routineNow})`;
          yield* sql`INSERT INTO routines
            (id, ai_id, group_id, topic_id, tool_id, title, schedule, approved_hosts, status,
              next_run_at, consecutive_failures, created_by, created_at, updated_at)
            VALUES (${personalRoutineId}, ${ai.aiId}, ${null}, ${null}, ${groupToolId},
              ${'Personal routine'}, ${schedule}::jsonb, ${approvedHosts}::jsonb, ${'active'},
              ${routineNow}, ${0}, ${owner.id}, ${routineNow}, ${routineNow})`;
        }),
      );

      const removed = await removeAiRequest(owner.cookie, groupId, ai.aiId);
      expect(removed.status).toBe(200);

      const rows = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{
            id: string;
            deletedAt: Date | null;
          }>`SELECT id, deleted_at FROM routines`;
        }),
      );
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(groupRoutineId)?.deletedAt).not.toBeNull();
      expect(byId.get(personalRoutineId)?.deletedAt).toBeNull();
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

  describe('channels', () => {
    interface ChannelDetailBody extends GroupDetailBody {
      kind: string;
      description: string | null;
    }

    async function createChannelRequest(cookie: string, body: unknown) {
      return app.request(`${TEST_BASE_URL}/api/groups`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      });
    }

    function changeRoleRequest(cookie: string, groupId: string, userId: string, role: unknown) {
      return app.request(`${TEST_BASE_URL}/api/groups/${groupId}/members/${userId}/role`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ role }),
      });
    }

    function membersRequest(cookie: string, groupId: string) {
      return app.request(`${TEST_BASE_URL}/api/groups/${groupId}/members`, {
        headers: { cookie },
      });
    }

    async function channelWithSubscriber(): Promise<{
      ownerId: string;
      ownerCookie: string;
      subscriberId: string;
      subscriberCookie: string;
      groupId: string;
    }> {
      const owner = await bootstrapUser(context, app, 'owner@example.com');
      const subscriber = await contactOf(context, app, owner.id, 'sub@example.com');
      const response = await createChannelRequest(owner.cookie, {
        title: 'Releases',
        memberIds: [subscriber.id],
        kind: 'channel',
        description: 'Ship notes',
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as ChannelDetailBody;
      return {
        ownerId: owner.id,
        ownerCookie: owner.cookie,
        subscriberId: subscriber.id,
        subscriberCookie: subscriber.cookie,
        groupId: body.id,
      };
    }

    it('creates the channel room moderated and stores kind + description', async () => {
      const { ownerCookie, subscriberId, groupId } = await channelWithSubscriber();

      const detail = (await (
        await groupDetailRequest(ownerCookie, groupId)
      ).json()) as ChannelDetailBody;
      expect(detail.kind).toBe('channel');
      expect(detail.description).toBe('Ship notes');

      const roomLocalpart = await roomLocalpartOf(groupId);
      expect(context.adminClient.roomOptions).toContainEqual(
        expect.objectContaining({
          roomId: roomLocalpart,
          moderated: true,
          membersByDefault: false,
        }),
      );
      // The owner posts (voice via affiliation `owner`); the subscriber
      // never holds more than `member` (a visitor once inside the room,
      // since the room does not make members participants by default).
      const ownerJid = `${localpartFor(detail.createdBy)}@${TEST_XMPP_DOMAIN}`;
      const subJid = `${localpartFor(subscriberId)}@${TEST_XMPP_DOMAIN}`;
      const affiliations = context.adminClient.affiliationState.get(roomLocalpart);
      expect(affiliations?.get(ownerJid)).toBe('owner');
      expect(affiliations?.get(subJid)).toBe('member');
      // The feed is the General topic, and only it.
      const rows = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ isGeneral: boolean }>`SELECT is_general FROM topics
            WHERE group_id = ${groupId}`;
        }),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.isGeneral).toBe(true);
    });

    it('creates plain groups without the moderated option, as before', async () => {
      const owner = await bootstrapUser(context, app, 'owner@example.com');
      const response = await createChannelRequest(owner.cookie, {
        title: 'Weekend trip',
        memberIds: [],
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as ChannelDetailBody;
      expect(body.kind).toBe('group');
      expect(body.description).toBeNull();

      const roomLocalpart = await roomLocalpartOf(body.id);
      const options = context.adminClient.roomOptions.find(
        (entry) => entry.roomId === roomLocalpart,
      );
      expect(options).toMatchObject({ membersOnly: true, persistent: true, mam: true });
      expect(options).not.toHaveProperty('moderated');
      expect(options).not.toHaveProperty('membersByDefault');
    });

    it('refuses topic creation in a channel with channel_has_no_topics', async () => {
      const { ownerCookie, groupId } = await channelWithSubscriber();
      const response = await app.request(`${TEST_BASE_URL}/api/groups/${groupId}/topics`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ name: 'Extra' }),
      });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'channel_has_no_topics',
      );
    });

    it('hides the audience from subscribers but shows the admins', async () => {
      const { ownerId, ownerCookie, subscriberId, subscriberCookie, groupId } =
        await channelWithSubscriber();

      // The detail carries no audience for subscribers…
      const asSubscriber = (await (
        await groupDetailRequest(subscriberCookie, groupId)
      ).json()) as ChannelDetailBody;
      expect(asSubscriber.members).toEqual([]);

      // …but admins see everyone.
      const asOwner = (await (
        await groupDetailRequest(ownerCookie, groupId)
      ).json()) as ChannelDetailBody;
      expect(asOwner.members.map((member) => member.userId).sort()).toEqual(
        [ownerId, subscriberId].sort(),
      );

      // The members endpoint gives subscribers the admins slice only (who
      // posts is public — every admin post carries its name), never the
      // subscriber audience.
      const listAsSubscriber = await membersRequest(subscriberCookie, groupId);
      expect(listAsSubscriber.status).toBe(200);
      const subscriberSeen = (
        (await listAsSubscriber.json()) as { members: Array<{ userId: string; role: string }> }
      ).members;
      expect(subscriberSeen.map((member) => [member.userId, member.role])).toEqual([
        [ownerId, 'owner'],
      ]);
      expect(subscriberSeen.some((member) => member.userId === subscriberId)).toBe(false);
      const listAsOwner = await membersRequest(ownerCookie, groupId);
      expect(listAsOwner.status).toBe(200);
      expect(
        ((await listAsOwner.json()) as { members: Array<{ userId: string }> }).members,
      ).toHaveLength(2);
    });

    it('promotes a subscriber to admin with voice, and refuses to lose the last admin', async () => {
      const { ownerCookie, ownerId, subscriberId, subscriberCookie, groupId } =
        await channelWithSubscriber();
      const roomLocalpart = await roomLocalpartOf(groupId);
      const subJid = `${localpartFor(subscriberId)}@${TEST_XMPP_DOMAIN}`;

      const promoted = await changeRoleRequest(ownerCookie, groupId, subscriberId, 'admin');
      expect(promoted.status).toBe(200);
      expect(context.adminClient.affiliationState.get(roomLocalpart)?.get(subJid)).toBe('admin');

      // The promotion is audited as `group.role_changed` (ids and roles
      // only — never names). The actor is the owner.
      const audits = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{
            action: string;
            actorUserId: string | null;
            subjectId: string | null;
            detail: unknown;
          }>`SELECT action, actor_user_id, subject_id, detail FROM audit_log
            WHERE group_id = ${groupId}`;
        }),
      );
      expect(audits).toContainEqual({
        action: 'group.role_changed',
        actorUserId: ownerId,
        subjectId: subscriberId,
        detail: {
          groupId,
          subjectUserId: subscriberId,
          from: 'member',
          to: 'admin',
        },
      });

      // The new admin sees the audience list now.
      const list = await membersRequest(ownerCookie, groupId);
      expect(list.status).toBe(200);

      // Demoting the only admin back is refused: the feed must keep a voice.
      const demoted = await changeRoleRequest(ownerCookie, groupId, subscriberId, 'member');
      expect(demoted.status).toBe(409);
      expect(((await demoted.json()) as { error: { code: string } }).error.code).toBe(
        'channel_needs_admin',
      );
      expect(context.adminClient.affiliationState.get(roomLocalpart)?.get(subJid)).toBe('admin');

      // Only the owner may change roles; members and strangers see the
      // same 404, so membership cannot be probed through this route.
      const stranger = await bootstrapUser(context, app, 'stranger@example.com');
      expect(
        (await changeRoleRequest(stranger.cookie, groupId, subscriberId, 'member')).status,
      ).toBe(404);
      expect(
        (await changeRoleRequest(subscriberCookie, groupId, subscriberId, 'member')).status,
      ).toBe(404);
    });

    it('rate-limits role changes like topic creation', async () => {
      const { ownerCookie, subscriberId, groupId } = await channelWithSubscriber();
      // The limiter counts attempts before authorization (same as the topic
      // creation route): 30 rapid role writes go through, the 31st is 429.
      for (let index = 0; index < 30; index += 1) {
        const response = await changeRoleRequest(ownerCookie, groupId, subscriberId, 'member');
        expect([200, 409]).toContain(response.status);
      }
      const limited = await changeRoleRequest(ownerCookie, groupId, subscriberId, 'member');
      expect(limited.status).toBe(429);
      expect(((await limited.json()) as { error: { code: string } }).error.code).toBe(
        'rate_limited',
      );
    });

    it('commits the role row when the room write fails, and reconciles the voice', async () => {
      // The affiliation write fails but the recovery sync succeeds: the
      // response still answers 200 with the committed row, the failure is
      // logged, and the reconcile pass applies the voice mapping.
      class FlakyAffiliationClient extends FakeAdminClient {
        failOnce = false;

        override setAffiliation(
          roomId: string,
          jid: string,
          affiliation: RoomAffiliation,
        ): Promise<void> {
          if (this.failOnce) {
            this.failOnce = false;
            return Promise.reject(new Error('ejabberd is down'));
          }
          return super.setAffiliation(roomId, jid, affiliation);
        }
      }
      const flaky = new FlakyAffiliationClient();
      const ownContext = await createTestContext({ adminClient: flaky });
      const ownApp = testApp(ownContext);
      try {
        const owner = await bootstrapUser(ownContext, ownApp, 'owner@example.com');
        const subscriber = await contactOf(ownContext, ownApp, owner.id, 'sub@example.com');
        const created = await ownApp.request(`${TEST_BASE_URL}/api/groups`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: owner.cookie },
          body: JSON.stringify({
            title: 'Releases',
            memberIds: [subscriber.id],
            kind: 'channel',
          }),
        });
        expect(created.status).toBe(201);
        const groupId = ((await created.json()) as ChannelDetailBody).id;
        const [groupRow] = await testSql(ownContext)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{ roomLocalpart: string }>`SELECT room_localpart FROM groups
              WHERE id = ${groupId}`;
          }),
        );
        const subJid = `${localpartFor(subscriber.id)}@${TEST_XMPP_DOMAIN}`;

        // Arm the failure for the role change's own affiliation write only.
        flaky.failOnce = true;

        const promoted = await ownApp.request(
          `${TEST_BASE_URL}/api/groups/${groupId}/members/${subscriber.id}/role`,
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json', cookie: owner.cookie },
            body: JSON.stringify({ role: 'admin' }),
          },
        );
        // The row commits despite the failed room write.
        expect(promoted.status).toBe(200);
        const [row] = await testSql(ownContext)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{ role: string }>`SELECT role FROM group_members
              WHERE group_id = ${groupId} AND user_id = ${subscriber.id}`;
          }),
        );
        expect(row?.role).toBe('admin');
        expect(ownContext.logOutput()).toContain('could not set the member role affiliation');
        // The reconcile pass healed the affiliation: the new admin has voice.
        expect(flaky.affiliationState.get(groupRow!.roomLocalpart)?.get(subJid)).toBe('admin');
      } finally {
        await ownContext.close();
      }
    });

    it('lets a subscriber join by link and leave the channel', async () => {
      const owner = await bootstrapUser(context, app, 'owner@example.com');
      const created = await createChannelRequest(owner.cookie, {
        title: 'Releases',
        memberIds: [],
        kind: 'channel',
      });
      const { id: groupId } = (await created.json()) as ChannelDetailBody;

      const link = await app.request(`${TEST_BASE_URL}/api/groups/${groupId}/invite-links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({}),
      });
      expect(link.status).toBe(201);
      const { token } = (await link.json()) as { token: string };

      const newcomer = await bootstrapUser(context, app, 'newcomer@example.com');
      const preview = await app.request(`${TEST_BASE_URL}/api/join/${token}`, {
        headers: { cookie: newcomer.cookie },
      });
      expect(preview.status).toBe(200);
      expect(((await preview.json()) as { groupTitle: string }).groupTitle).toBe('Releases');

      const joined = await app.request(`${TEST_BASE_URL}/api/join/${token}`, {
        method: 'POST',
        headers: { cookie: newcomer.cookie },
      });
      expect(joined.status).toBe(200);
      const roomLocalpart = await roomLocalpartOf(groupId);
      const newcomerJid = `${localpartFor(newcomer.id)}@${TEST_XMPP_DOMAIN}`;
      expect(context.adminClient.affiliationState.get(roomLocalpart)?.get(newcomerJid)).toBe(
        'member',
      );

      // The subscriber leaves through the same member route as groups.
      const left = await removeMemberRequest(newcomer.cookie, groupId, newcomer.id);
      expect(left.status).toBe(200);
      expect(context.adminClient.affiliationState.get(roomLocalpart)?.get(newcomerJid)).toBe(
        undefined,
      );
    });

    it('answers 404 on plain groups, like an unknown group', async () => {
      const owner = await bootstrapUser(context, app, 'owner@example.com');
      const member = await contactOf(context, app, owner.id, 'member@example.com');
      const created = await createGroupRequest(owner.cookie, {
        title: 'Weekend trip',
        memberIds: [member.id],
      });
      expect(created.status).toBe(201);
      const { id: groupId } = (await created.json()) as ChannelDetailBody;

      // The role route is channels-only: a plain group answers the same 404
      // as an unknown id, even for its owner.
      const response = await changeRoleRequest(owner.cookie, groupId, member.id, 'admin');
      expect(response.status).toBe(404);
      const unknown = await changeRoleRequest(owner.cookie, 'does-not-exist', member.id, 'admin');
      expect(unknown.status).toBe(404);
      const unknownBody = (await unknown.json()) as { error: { code: string; message: string } };
      const plainBody = (await response.json()) as { error: { code: string; message: string } };
      // Same code and message (requestIds differ by design — one per
      // request — so they are compared field by field).
      expect(unknownBody.error.code).toBe('not_found');
      expect(plainBody.error.code).toBe('not_found');
      expect(unknownBody.error.message).toBe(plainBody.error.message);
    });

    it('lets the owner kick a subscriber in a channel with no admins', async () => {
      // Regression: the last-admin guard must only fire when the target is
      // an admin. A fresh channel has zero admins; kicking a subscriber
      // takes no voice away and must succeed.
      const { ownerCookie, subscriberId, groupId } = await channelWithSubscriber();
      const roomLocalpart = await roomLocalpartOf(groupId);
      const subJid = `${localpartFor(subscriberId)}@${TEST_XMPP_DOMAIN}`;

      const kicked = await removeMemberRequest(ownerCookie, groupId, subscriberId);
      expect(kicked.status).toBe(200);
      expect(context.adminClient.affiliationState.get(roomLocalpart)?.get(subJid)).toBe(undefined);
      expect(
        await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{ userId: string }>`SELECT user_id FROM group_members
              WHERE group_id = ${groupId} AND user_id = ${subscriberId}`;
          }),
        ),
      ).toEqual([]);
    });

    it('keeps an admin voice after a later member joins the channel', async () => {
      const { ownerCookie, ownerId, subscriberId, groupId } = await channelWithSubscriber();
      const roomLocalpart = await roomLocalpartOf(groupId);
      const subJid = `${localpartFor(subscriberId)}@${TEST_XMPP_DOMAIN}`;

      expect((await changeRoleRequest(ownerCookie, groupId, subscriberId, 'admin')).status).toBe(
        200,
      );
      expect(context.adminClient.affiliationState.get(roomLocalpart)?.get(subJid)).toBe('admin');

      // A later join re-syncs the feed room: the admin keeps voice instead
      // of being clobbered back to a subscriber.
      const late = await contactOf(context, app, ownerId, 'late@example.com');
      expect((await addMembersRequest(ownerCookie, groupId, [late.id])).status).toBe(200);
      expect(context.adminClient.affiliationState.get(roomLocalpart)?.get(subJid)).toBe('admin');
      const lateJid = `${localpartFor(late.id)}@${TEST_XMPP_DOMAIN}`;
      expect(context.adminClient.affiliationState.get(roomLocalpart)?.get(lateJid)).toBe('member');
    });

    it('gives an admin-owned AI voice in the feed at add time', async () => {
      const owner = await bootstrapUser(context, app, 'owner@example.com');
      const member = await contactOf(context, app, owner.id, 'member@example.com');
      const created = await createChannelRequest(owner.cookie, {
        title: 'Releases',
        memberIds: [member.id],
        kind: 'channel',
      });
      expect(created.status).toBe(201);
      const { id: groupId } = (await created.json()) as ChannelDetailBody;
      const roomLocalpart = await roomLocalpartOf(groupId);

      // The owner adds their own AI through HTTP: the owner is a channel
      // admin, so the AI lands in the feed room with voice at once
      // (affiliation `admin`), without waiting for an unrelated re-sync.
      const { aiId, jid } = await seedAi(owner.id);
      expect((await addAiRequest(owner.cookie, groupId, { aiId })).status).toBe(200);
      expect(context.adminClient.affiliationState.get(roomLocalpart)?.get(jid)).toBe('admin');

      // A member-owned AI never gets voice: the member cannot add it (403),
      // and even a planted row resolves to a voiceless `member`.
      const foreign = await seedAi(member.id, 'Member AI');
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO group_ais ${sql.insert({
            group_id: groupId,
            ai_id: foreign.aiId,
            added_by: member.id,
          })}`;
        }),
      );
      const { desiredMembers } = await import('../topics/rooms');
      const [general] = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<TopicRow>`SELECT * FROM topics
            WHERE group_id = ${groupId} AND is_general = TRUE`;
        }),
      );
      const voice = await desiredMembers(context.db, general!, TEST_XMPP_DOMAIN);
      expect(voice.get(foreign.jid)).toBe('member');
      expect(voice.get(jid)).toBe('admin');
      const denied = await addAiRequest(member.cookie, groupId, { aiId: foreign.aiId });
      expect(denied.status).toBe(403);
    });

    it('exposes kind and subscriberCount on the chat list', async () => {
      const { subscriberCookie } = await channelWithSubscriber();
      const response = await app.request(`${TEST_BASE_URL}/api/chats`, {
        headers: { cookie: subscriberCookie },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        chats: Array<{
          kind: string;
          title: string;
          chatKind?: string;
          memberCount: number;
          subscriberCount?: number;
          description?: string | null;
        }>;
      };
      const entry = body.chats.find((chat) => chat.title === 'Releases');
      expect(entry).toMatchObject({ kind: 'group', chatKind: 'channel', subscriberCount: 2 });
      expect(entry?.description).toBe('Ship notes');
    });
  });
});
