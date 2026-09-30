import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLog, groupMemberRoles, groupRoles, topicRoleAccess } from '../db/schema';
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

interface RoleBody {
  id: string;
  name: string;
  members: Array<{ userId: string; name: string }>;
}

interface RolesBody {
  roles: RoleBody[];
}

interface DetailBody {
  id: string;
  title: string;
  createdBy: string;
  members: Array<{ userId: string; name: string; role: string; roles: RoleBody[] }>;
}

interface TopicBody {
  id: string;
  chatJid: string;
  visibility: string;
  memberCount: number;
  roles: Array<{ id: string; name: string; memberCount: number }>;
  approverRole: { id: string; name: string } | null;
}

describe('group roles (T-0116)', () => {
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
    return response;
  }

  async function setup() {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const admin = await contactOf(context, app, owner.id, 'admin@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const other = await contactOf(context, app, owner.id, 'other@example.com');
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');
    const group = await createGroup(owner.cookie, 'Team', [admin.id, member.id, other.id]);
    return { owner, admin, member, other, stranger, group };
  }

  async function createRole(cookie: string, groupId: string, body: unknown) {
    return app.request(`${TEST_BASE_URL}/api/groups/${groupId}/roles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  }

  async function setMembers(cookie: string, groupId: string, roleId: string, userIds: string[]) {
    return app.request(`${TEST_BASE_URL}/api/groups/${groupId}/roles/${roleId}/members`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ userIds }),
    });
  }

  async function setTopicRoles(
    cookie: string,
    topicId: string,
    body: { roleIds: string[]; approverRoleId: string | null },
  ) {
    return app.request(`${TEST_BASE_URL}/api/topics/${topicId}/roles`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  }

  it('creates, renames and deletes roles with manager-only writes and member reads', async () => {
    const { owner, admin, member, stranger, group } = await setup();
    await context.db
      .update((await import('../db/schema')).groupMembers)
      .set({ role: 'admin' })
      .where(eq((await import('../db/schema')).groupMembers.userId, admin.id));

    const created = await createRole(owner.cookie, group.id, { name: 'Designers' });
    expect(created.status).toBe(201);
    const role = (await created.json()) as RoleBody;
    expect(role.name).toBe('Designers');
    expect(role.members).toEqual([]);

    // A plain member cannot create.
    const refused = await createRole(member.cookie, group.id, { name: 'Devs' });
    expect(refused.status).toBe(403);
    // A stranger sees the same 404 as a missing group.
    const hidden = await createRole(stranger.cookie, group.id, { name: 'Devs' });
    expect(hidden.status).toBe(404);

    // Bad names: empty, too long, control characters.
    expect((await createRole(owner.cookie, group.id, { name: '' })).status).toBe(400);
    expect((await createRole(owner.cookie, group.id, { name: 'a'.repeat(31) })).status).toBe(400);
    expect((await createRole(owner.cookie, group.id, { name: 'bad\x07name' })).status).toBe(400);
    // Duplicate ignoring case.
    expect((await createRole(owner.cookie, group.id, { name: 'designers' })).status).toBe(409);

    // An admin can rename; a member cannot.
    const renamed = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}/roles/${role.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ name: 'Design' }),
    });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as RoleBody).name).toBe('Design');
    const memberRename = await app.request(
      `${TEST_BASE_URL}/api/groups/${group.id}/roles/${role.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: member.cookie },
        body: JSON.stringify({ name: 'Nope' }),
      },
    );
    expect(memberRename.status).toBe(403);

    // Every group member can read the list with holders.
    const listed = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}/roles`, {
      headers: { cookie: member.cookie },
    });
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as RolesBody).roles.map((entry) => entry.name)).toEqual([
      'Design',
    ]);
    const strangerList = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}/roles`, {
      headers: { cookie: stranger.cookie },
    });
    expect(strangerList.status).toBe(404);

    // Delete by the owner; deleting again is the missing-role 404.
    const deleted = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}/roles/${role.id}`, {
      method: 'DELETE',
      headers: { cookie: owner.cookie },
    });
    expect(deleted.status).toBe(204);
    const gone = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}/roles/${role.id}`, {
      method: 'DELETE',
      headers: { cookie: owner.cookie },
    });
    expect(gone.status).toBe(404);
  });

  it('caps roles at 20 per group', async () => {
    const { owner, group } = await setup();
    for (let index = 0; index < 20; index += 1) {
      const created = await createRole(owner.cookie, group.id, { name: `Role ${index}` });
      expect(created.status).toBe(201);
    }
    const overflow = await createRole(owner.cookie, group.id, { name: 'One more' });
    expect(overflow.status).toBe(400);
  });

  it('assigns members, replaces the set, and refuses non-members', async () => {
    const { owner, member, other, stranger, group } = await setup();
    const created = await createRole(owner.cookie, group.id, { name: 'Designers' });
    const role = (await created.json()) as RoleBody;

    const assigned = await setMembers(owner.cookie, group.id, role.id, [member.id, other.id]);
    expect(assigned.status).toBe(200);
    expect(
      ((await assigned.json()) as RoleBody).members.map((entry) => entry.userId).sort(),
    ).toEqual([member.id, other.id].sort());

    // Replace the set: `other` drops out.
    const replaced = await setMembers(owner.cookie, group.id, role.id, [member.id]);
    expect(replaced.status).toBe(200);
    expect(((await replaced.json()) as RoleBody).members.map((entry) => entry.userId)).toEqual([
      member.id,
    ]);
    const rows = await context.db.select().from(groupMemberRoles);
    expect(rows.map((row) => row.userId)).toEqual([member.id]);

    // A stranger (not a group member) cannot be assigned.
    const foreign = await setMembers(owner.cookie, group.id, role.id, [stranger.id]);
    expect(foreign.status).toBe(400);

    // `GET members` carries the roles next to each member name, for everyone.
    const detail = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}`, {
      headers: { cookie: member.cookie },
    });
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as DetailBody;
    expect(body.members.find((entry) => entry.userId === member.id)?.roles).toEqual([
      { id: role.id, name: 'Designers' },
    ]);
    expect(body.members.find((entry) => entry.userId === other.id)?.roles).toEqual([]);
  });

  it('gives a private topic to every current and future holder, and removes it when unassigned', async () => {
    const { owner, member, other, group } = await setup();
    const roleResponse = await createRole(owner.cookie, group.id, { name: 'Designers' });
    const role = (await roleResponse.json()) as RoleBody;

    const topicResponse = await createTopic(owner.cookie, group.id, {
      name: 'Hiring',
      visibility: 'private',
    });
    expect(topicResponse.status).toBe(201);
    const topic = (await topicResponse.json()) as TopicBody;
    const room = topic.chatJid.split('@')[0]!;

    // Attach the role: the current holder joins the room.
    expect((await setMembers(owner.cookie, group.id, role.id, [member.id])).status).toBe(200);
    const attached = await setTopicRoles(owner.cookie, topic.id, {
      roleIds: [role.id],
      approverRoleId: null,
    });
    expect(attached.status).toBe(200);
    const attachedBody = (await attached.json()) as TopicBody;
    expect(attachedBody.roles).toEqual([{ id: role.id, name: 'Designers', memberCount: 1 }]);
    expect(context.adminClient.affiliationState.get(room)?.get(expectedJid(member.id))).toBe(
      'member',
    );
    expect(attachedBody.memberCount).toBe(2);

    // A later assignment joins the room too, with no topic call.
    expect((await setMembers(owner.cookie, group.id, role.id, [member.id, other.id])).status).toBe(
      200,
    );
    expect(context.adminClient.affiliationState.get(room)?.get(expectedJid(other.id))).toBe(
      'member',
    );

    // The holder sees the topic; a non-holder does not.
    const seen = await app.request(`${TEST_BASE_URL}/api/topics/${topic.id}`, {
      headers: { cookie: other.cookie },
    });
    expect(seen.status).toBe(200);
    const stranger = await bootstrapUser(context, app, 'late@example.com');
    const hidden = await app.request(`${TEST_BASE_URL}/api/topics/${topic.id}`, {
      headers: { cookie: stranger.cookie },
    });
    expect(hidden.status).toBe(404);

    // Unassigning drops the holder from the room.
    expect((await setMembers(owner.cookie, group.id, role.id, [member.id])).status).toBe(200);
    expect(context.adminClient.affiliationState.get(room)?.has(expectedJid(other.id))).toBe(false);
    const rehidden = await app.request(`${TEST_BASE_URL}/api/topics/${topic.id}`, {
      headers: { cookie: other.cookie },
    });
    expect(rehidden.status).toBe(404);

    // Detaching the role from the topic drops the last holder too.
    const detached = await setTopicRoles(owner.cookie, topic.id, {
      roleIds: [],
      approverRoleId: null,
    });
    expect(detached.status).toBe(200);
    expect(((await detached.json()) as TopicBody).roles).toEqual([]);
    expect(context.adminClient.affiliationState.get(room)?.has(expectedJid(member.id))).toBe(false);
  });

  it('refuses topic roles on public topics and foreign roles', async () => {
    const { owner, group } = await setup();
    const roleResponse = await createRole(owner.cookie, group.id, { name: 'Designers' });
    const role = (await roleResponse.json()) as RoleBody;
    const publicResponse = await createTopic(owner.cookie, group.id, { name: 'Backend' });
    const topic = (await publicResponse.json()) as TopicBody;
    const refused = await setTopicRoles(owner.cookie, topic.id, {
      roleIds: [role.id],
      approverRoleId: null,
    });
    expect(refused.status).toBe(400);

    const privateResponse = await createTopic(owner.cookie, group.id, {
      name: 'Hiring',
      visibility: 'private',
    });
    const privateTopic = (await privateResponse.json()) as TopicBody;
    const foreign = await setTopicRoles(owner.cookie, privateTopic.id, {
      roleIds: ['role-does-not-exist'],
      approverRoleId: null,
    });
    expect(foreign.status).toBe(400);
    const foreignApprover = await setTopicRoles(owner.cookie, privateTopic.id, {
      roleIds: [],
      approverRoleId: 'role-does-not-exist',
    });
    expect(foreignApprover.status).toBe(400);
  });

  it('drops role rows when a member leaves the group and re-syncs', async () => {
    const { owner, member, other, group } = await setup();
    const roleResponse = await createRole(owner.cookie, group.id, { name: 'Designers' });
    const role = (await roleResponse.json()) as RoleBody;
    expect((await setMembers(owner.cookie, group.id, role.id, [member.id, other.id])).status).toBe(
      200,
    );
    const topicResponse = await createTopic(owner.cookie, group.id, {
      name: 'Hiring',
      visibility: 'private',
      memberIds: [member.id],
    });
    const topic = (await topicResponse.json()) as TopicBody;
    expect(
      (await setTopicRoles(owner.cookie, topic.id, { roleIds: [role.id], approverRoleId: null }))
        .status,
    ).toBe(200);
    const room = topic.chatJid.split('@')[0]!;
    expect(context.adminClient.affiliationState.get(room)?.get(expectedJid(other.id))).toBe(
      'member',
    );

    // `other` leaves the group: their role rows vanish and the room drops them.
    const left = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}/members/${other.id}`, {
      method: 'DELETE',
      headers: { cookie: other.cookie },
    });
    expect(left.status).toBe(200);
    const rows = await context.db.select().from(groupMemberRoles);
    expect(rows.map((row) => row.userId)).not.toContain(other.id);
    expect(context.adminClient.affiliationState.get(room)?.has(expectedJid(other.id))).toBe(false);
    // `member` keeps access (direct row and role agree).
    expect(context.adminClient.affiliationState.get(room)?.get(expectedJid(member.id))).toBe(
      'member',
    );
  });

  it('re-syncs every topic when a role is deleted', async () => {
    const { owner, member, group } = await setup();
    const roleResponse = await createRole(owner.cookie, group.id, { name: 'Designers' });
    const role = (await roleResponse.json()) as RoleBody;
    expect((await setMembers(owner.cookie, group.id, role.id, [member.id])).status).toBe(200);
    const first = (await (
      await createTopic(owner.cookie, group.id, { name: 'One', visibility: 'private' })
    ).json()) as TopicBody;
    const second = (await (
      await createTopic(owner.cookie, group.id, { name: 'Two', visibility: 'private' })
    ).json()) as TopicBody;
    for (const topic of [first, second]) {
      expect(
        (await setTopicRoles(owner.cookie, topic.id, { roleIds: [role.id], approverRoleId: null }))
          .status,
      ).toBe(200);
    }
    const firstRoom = first.chatJid.split('@')[0]!;
    const secondRoom = second.chatJid.split('@')[0]!;
    expect(context.adminClient.affiliationState.get(firstRoom)?.get(expectedJid(member.id))).toBe(
      'member',
    );

    const deleted = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}/roles/${role.id}`, {
      method: 'DELETE',
      headers: { cookie: owner.cookie },
    });
    expect(deleted.status).toBe(204);
    expect(await context.db.select().from(topicRoleAccess)).toEqual([]);
    expect(context.adminClient.affiliationState.get(firstRoom)?.has(expectedJid(member.id))).toBe(
      false,
    );
    expect(context.adminClient.affiliationState.get(secondRoom)?.has(expectedJid(member.id))).toBe(
      false,
    );
  });

  it('lets an approver-role holder who sees the topic decide, and nobody else', async () => {
    const { owner, member, other, group } = await setup();
    const roleResponse = await createRole(owner.cookie, group.id, { name: 'Designers' });
    const role = (await roleResponse.json()) as RoleBody;
    expect((await setMembers(owner.cookie, group.id, role.id, [member.id])).status).toBe(200);
    const topicResponse = await createTopic(owner.cookie, group.id, {
      name: 'Hiring',
      visibility: 'private',
      memberIds: [member.id],
    });
    const topic = (await topicResponse.json()) as TopicBody;
    expect(
      (
        await setTopicRoles(owner.cookie, topic.id, {
          roleIds: [role.id],
          approverRoleId: role.id,
        })
      ).status,
    ).toBe(200);

    const detail = await app.request(`${TEST_BASE_URL}/api/topics/${topic.id}`, {
      headers: { cookie: member.cookie },
    });
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as TopicBody).approverRole).toEqual({
      id: role.id,
      name: 'Designers',
    });

    // Seed an AI + approval in the topic (the AI owner is `owner`).
    const { randomUUID } = await import('node:crypto');
    const { aiLocalpart } = await import('../ais/service');
    const connectionId = randomUUID();
    await context.db.insert((await import('../db/schema')).providerConnections).values({
      id: connectionId,
      owner: owner.id,
      provider: 'openai',
      encryptedKey: 'sealed-placeholder',
      label: null,
    });
    const aiId = randomUUID();
    await context.db.insert((await import('../db/schema')).ais).values({
      id: aiId,
      owner: owner.id,
      name: 'Helper',
      template: 'dev',
      persona: 'A helpful persona.',
      providerConnectionId: connectionId,
      model: 'gpt-4o-mini',
      localpart: aiLocalpart(aiId),
      jid: `${aiLocalpart(aiId)}@galena.localhost`,
      status: 'active',
    });
    await context.db.insert((await import('../db/schema')).aiLimits).values({
      aiId,
      perDayUsd: '1.00',
      perMonthUsd: '20.00',
    });
    await context.db.insert((await import('../db/schema')).groupAis).values({
      groupId: group.id,
      aiId,
      addedBy: owner.id,
    });
    const { createApproval } = await import('../approvals/service');
    const approval = await createApproval(
      context.db,
      {
        aiId,
        groupId: group.id,
        topicId: topic.id,
        action: 'demo.echo',
        summary: 'Echo once',
        argsHash: 'a'.repeat(64),
        requestedBy: 'someone@galena.localhost',
        expiresAt: new Date(Date.now() + 60_000),
      },
      new Date(),
    );

    // The role holder (not an admin, not the AI owner) decides.
    const decided = await app.request(`${TEST_BASE_URL}/api/approvals/${approval.id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: member.cookie },
      body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(decided.status).toBe(200);

    // A second approval: `other` (no role, sees nothing) gets the 404.
    const second = await createApproval(
      context.db,
      {
        aiId,
        groupId: group.id,
        topicId: topic.id,
        action: 'demo.echo',
        summary: 'Echo twice',
        argsHash: 'b'.repeat(64),
        requestedBy: 'someone@galena.localhost',
        expiresAt: new Date(Date.now() + 60_000),
      },
      new Date(),
    );
    const blind = await app.request(`${TEST_BASE_URL}/api/approvals/${second.id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: other.cookie },
      body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(blind.status).toBe(404);

    // A holder who cannot see the topic still gets the 404: assign `other`
    // a role that is the approver of another topic they cannot see.
    const outsiderRole = (await (
      await createRole(owner.cookie, group.id, { name: 'Outsiders' })
    ).json()) as RoleBody;
    expect((await setMembers(owner.cookie, group.id, outsiderRole.id, [other.id])).status).toBe(
      200,
    );
    const hiddenTopic = (await (
      await createTopic(owner.cookie, group.id, { name: 'Secret', visibility: 'private' })
    ).json()) as TopicBody;
    expect(
      (
        await setTopicRoles(owner.cookie, hiddenTopic.id, {
          roleIds: [],
          approverRoleId: outsiderRole.id,
        })
      ).status,
    ).toBe(200);
    const third = await createApproval(
      context.db,
      {
        aiId,
        groupId: group.id,
        topicId: hiddenTopic.id,
        action: 'demo.echo',
        summary: 'Echo thrice',
        argsHash: 'c'.repeat(64),
        requestedBy: 'someone@galena.localhost',
        expiresAt: new Date(Date.now() + 60_000),
      },
      new Date(),
    );
    const blindHolder = await app.request(`${TEST_BASE_URL}/api/approvals/${third.id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: other.cookie },
      body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(blindHolder.status).toBe(404);
  });

  it('keeps always-allow admin-only and skips role holders', async () => {
    const { owner, member, group } = await setup();
    const roleResponse = await createRole(owner.cookie, group.id, { name: 'Designers' });
    const role = (await roleResponse.json()) as RoleBody;
    expect((await setMembers(owner.cookie, group.id, role.id, [member.id])).status).toBe(200);
    const topicResponse = await createTopic(owner.cookie, group.id, {
      name: 'Hiring',
      visibility: 'private',
      memberIds: [member.id],
    });
    const topic = (await topicResponse.json()) as TopicBody;
    expect(
      (
        await setTopicRoles(owner.cookie, topic.id, {
          roleIds: [role.id],
          approverRoleId: role.id,
        })
      ).status,
    ).toBe(200);

    const { randomUUID } = await import('node:crypto');
    const { aiLocalpart } = await import('../ais/service');
    const schema = await import('../db/schema');
    const connectionId = randomUUID();
    await context.db.insert(schema.providerConnections).values({
      id: connectionId,
      owner: owner.id,
      provider: 'openai',
      encryptedKey: 'sealed-placeholder',
      label: null,
    });
    const aiId = randomUUID();
    await context.db.insert(schema.ais).values({
      id: aiId,
      owner: owner.id,
      name: 'Helper',
      template: 'dev',
      persona: 'A helpful persona.',
      providerConnectionId: connectionId,
      model: 'gpt-4o-mini',
      localpart: aiLocalpart(aiId),
      jid: `${aiLocalpart(aiId)}@galena.localhost`,
      status: 'active',
    });
    await context.db.insert(schema.aiLimits).values({
      aiId,
      perDayUsd: '1.00',
      perMonthUsd: '20.00',
    });
    await context.db.insert(schema.groupAis).values({ groupId: group.id, aiId, addedBy: owner.id });
    const { createApproval } = await import('../approvals/service');
    const approval = await createApproval(
      context.db,
      {
        aiId,
        groupId: group.id,
        topicId: topic.id,
        action: 'demo.echo',
        summary: 'Echo always',
        argsHash: 'd'.repeat(64),
        requestedBy: 'someone@galena.localhost',
        expiresAt: new Date(Date.now() + 60_000),
      },
      new Date(),
    );
    // The holder may decide once, but `approve_always` needs an admin.
    const always = await app.request(`${TEST_BASE_URL}/api/approvals/${approval.id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: member.cookie },
      body: JSON.stringify({ decision: 'approve_always' }),
    });
    // Nothing is always-eligible in the test app, so the refusal is the
    // eligibility 400 — reached only because `canDecide` passed.
    expect(always.status).toBe(400);
    expect(((await always.json()) as { error: { code: string } }).error.code).toBe(
      'always_not_allowed',
    );
  });

  it('audits role changes with ids only, never names', async () => {
    const { owner, member, group } = await setup();
    const roleResponse = await createRole(owner.cookie, group.id, { name: 'Secret Designers' });
    const role = (await roleResponse.json()) as RoleBody;
    expect((await setMembers(owner.cookie, group.id, role.id, [member.id])).status).toBe(200);
    const topicResponse = await createTopic(owner.cookie, group.id, {
      name: 'Secret Hiring Plans',
      visibility: 'private',
    });
    const topic = (await topicResponse.json()) as TopicBody;
    expect(
      (
        await setTopicRoles(owner.cookie, topic.id, {
          roleIds: [role.id],
          approverRoleId: role.id,
        })
      ).status,
    ).toBe(200);
    const renamed = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}/roles/${role.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(renamed.status).toBe(200);
    const deleted = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}/roles/${role.id}`, {
      method: 'DELETE',
      headers: { cookie: owner.cookie },
    });
    expect(deleted.status).toBe(204);

    const rows = await context.db.select().from(auditLog);
    const roleRows = rows.filter(
      (row) =>
        row.action.startsWith('group.role') ||
        row.action.startsWith('topic.role') ||
        row.action === 'topic.approver_role_set',
    );
    expect(roleRows.length).toBeGreaterThan(0);
    for (const row of roleRows) {
      expect(JSON.stringify(row.detail ?? {})).not.toContain('Secret Designers');
      expect(JSON.stringify(row.detail ?? {})).not.toContain('Secret Hiring Plans');
    }
    const actions = roleRows.map((row) => row.action).sort();
    expect(actions).toEqual(
      expect.arrayContaining([
        'group.role_assigned',
        'group.role_created',
        'group.role_deleted',
        'group.role_renamed',
        'topic.approver_role_set',
        'topic.role_added',
        'topic.role_removed',
      ]),
    );
    const unassigned = await context.db.select().from(groupMemberRoles);
    expect(unassigned).toEqual([]);
    expect(await context.db.select().from(topicRoleAccess)).toEqual([]);
    expect(await context.db.select().from(groupRoles)).toEqual([]);
  });

  it('lists topic members through roles and requires auth on every roles route', async () => {
    const { owner, member, other, group } = await setup();
    const roleResponse = await createRole(owner.cookie, group.id, { name: 'Designers' });
    const role = (await roleResponse.json()) as RoleBody;
    expect((await setMembers(owner.cookie, group.id, role.id, [other.id])).status).toBe(200);
    const topicResponse = await createTopic(owner.cookie, group.id, {
      name: 'Hiring',
      visibility: 'private',
      memberIds: [member.id],
    });
    const topic = (await topicResponse.json()) as TopicBody;
    expect(
      (await setTopicRoles(owner.cookie, topic.id, { roleIds: [role.id], approverRoleId: null }))
        .status,
    ).toBe(200);

    const listed = await app.request(`${TEST_BASE_URL}/api/topics/${topic.id}/members`, {
      headers: { cookie: other.cookie },
    });
    expect(listed.status).toBe(200);
    expect(
      ((await listed.json()) as { members: Array<{ userId: string }> }).members
        .map((entry) => entry.userId)
        .sort(),
    ).toEqual([member.id, other.id, owner.id].sort());

    for (const init of [
      { url: `/api/groups/${group.id}/roles`, method: 'GET' },
      { url: `/api/groups/${group.id}/roles`, method: 'POST' },
      { url: `/api/groups/${group.id}/roles/${role.id}`, method: 'PATCH' },
      { url: `/api/groups/${group.id}/roles/${role.id}`, method: 'DELETE' },
      { url: `/api/groups/${group.id}/roles/${role.id}/members`, method: 'PUT' },
      { url: `/api/topics/${topic.id}/roles`, method: 'PUT' },
    ]) {
      const response = await app.request(`${TEST_BASE_URL}${init.url}`, { method: init.method });
      expect(response.status, `${init.method} ${init.url}`).toBe(401);
    }
  });

  it('pins the 404 shapes for missing groups, roles and hidden topics', async () => {
    const { owner, stranger, group } = await setup();
    // A stranger sees the same "Group not found" as a missing group id.
    const missingGroup = await app.request(`${TEST_BASE_URL}/api/groups/does-not-exist`, {
      headers: { cookie: stranger.cookie },
    });
    expect(missingGroup.status).toBe(404);
    const missingGroupBody = (await missingGroup.json()) as {
      error: { code: string; message: string };
    };
    const hiddenRoles = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}/roles`, {
      headers: { cookie: stranger.cookie },
    });
    expect(hiddenRoles.status).toBe(404);
    const hiddenBody = (await hiddenRoles.json()) as { error: { code: string; message: string } };
    expect({ code: hiddenBody.error.code, message: hiddenBody.error.message }).toEqual({
      code: missingGroupBody.error.code,
      message: missingGroupBody.error.message,
    });

    const missingRole = await app.request(
      `${TEST_BASE_URL}/api/groups/${group.id}/roles/role-does-not-exist`,
      { method: 'DELETE', headers: { cookie: owner.cookie } },
    );
    expect(missingRole.status).toBe(404);
    const missingRoleBody = (await missingRole.json()) as {
      error: { code: string; message: string };
    };
    expect(missingRoleBody.error).toMatchObject({ code: 'not_found', message: 'Role not found' });
  });

  it('leaving one group keeps the role rows of another group (review 1)', async () => {
    const { owner, member, group } = await setup();
    // A second group with the same two people.
    const second = await createGroup(owner.cookie, 'Side', [member.id]);
    const firstRole = (await (
      await createRole(owner.cookie, group.id, {
        name: 'Designers',
      })
    ).json()) as RoleBody;
    const secondRole = (await (
      await createRole(owner.cookie, second.id, {
        name: 'Devs',
      })
    ).json()) as RoleBody;
    expect((await setMembers(owner.cookie, group.id, firstRole.id, [member.id])).status).toBe(200);
    expect((await setMembers(owner.cookie, second.id, secondRole.id, [member.id])).status).toBe(
      200,
    );

    // A private topic in each group, each with its group's role attached.
    const firstTopic = (await (
      await createTopic(owner.cookie, group.id, { name: 'One', visibility: 'private' })
    ).json()) as TopicBody;
    const secondTopic = (await (
      await createTopic(owner.cookie, second.id, { name: 'Two', visibility: 'private' })
    ).json()) as TopicBody;
    expect(
      (
        await setTopicRoles(owner.cookie, firstTopic.id, {
          roleIds: [firstRole.id],
          approverRoleId: null,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await setTopicRoles(owner.cookie, secondTopic.id, {
          roleIds: [secondRole.id],
          approverRoleId: null,
        })
      ).status,
    ).toBe(200);
    const secondRoom = secondTopic.chatJid.split('@')[0]!;
    expect(context.adminClient.affiliationState.get(secondRoom)?.get(expectedJid(member.id))).toBe(
      'member',
    );

    // `member` leaves the first group: their rows there vanish, but the
    // second group's rows — and room affiliation — stay.
    const left = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}/members/${member.id}`, {
      method: 'DELETE',
      headers: { cookie: member.cookie },
    });
    expect(left.status).toBe(200);
    const rows = await context.db.select().from(groupMemberRoles);
    expect(rows.map((row) => [row.roleId, row.userId])).toEqual([[secondRole.id, member.id]]);
    expect(context.adminClient.affiliationState.get(secondRoom)?.get(expectedJid(member.id))).toBe(
      'member',
    );
    const seen = await app.request(`${TEST_BASE_URL}/api/topics/${secondTopic.id}`, {
      headers: { cookie: member.cookie },
    });
    expect(seen.status).toBe(200);
  });

  it('keeps a private topic alive while a role holder remains (review 2)', async () => {
    const { owner, member, other, group } = await setup();
    const role = (await (
      await createRole(owner.cookie, group.id, {
        name: 'Designers',
      })
    ).json()) as RoleBody;
    expect((await setMembers(owner.cookie, group.id, role.id, [other.id])).status).toBe(200);
    const topicResponse = await createTopic(owner.cookie, group.id, {
      name: 'Hiring',
      visibility: 'private',
      memberIds: [member.id],
    });
    const topic = (await topicResponse.json()) as TopicBody;
    expect(
      (
        await setTopicRoles(owner.cookie, topic.id, {
          roleIds: [role.id],
          approverRoleId: null,
        })
      ).status,
    ).toBe(200);

    // Draining the direct rows leaves the role holder: no archive.
    const removed = await app.request(
      `${TEST_BASE_URL}/api/topics/${topic.id}/members/${member.id}`,
      { method: 'DELETE', headers: { cookie: member.cookie } },
    );
    expect(removed.status).toBe(200);
    const selfLeave = await app.request(
      `${TEST_BASE_URL}/api/topics/${topic.id}/members/${owner.id}`,
      { method: 'DELETE', headers: { cookie: owner.cookie } },
    );
    expect(selfLeave.status).toBe(200);
    const [row] = await context.db
      .select()
      .from((await import('../db/schema')).topics)
      .where(eq((await import('../db/schema')).topics.id, topic.id));
    expect(row?.archivedAt).toBeNull();
    const seen = await app.request(`${TEST_BASE_URL}/api/topics/${topic.id}`, {
      headers: { cookie: other.cookie },
    });
    expect(seen.status).toBe(200);

    // Removing `other` from the group drains the last holder through
    // `archiveDrainedPrivateTopics`: now the topic archives.
    const left = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}/members/${other.id}`, {
      method: 'DELETE',
      headers: { cookie: owner.cookie },
    });
    expect(left.status).toBe(200);
    const [archived] = await context.db
      .select()
      .from((await import('../db/schema')).topics)
      .where(eq((await import('../db/schema')).topics.id, topic.id));
    expect(archived?.archivedAt).not.toBeNull();
  });

  it('audits topic role changes even when the room sync fails (review 3)', async () => {
    const { owner, member, group } = await setup();
    const role = (await (
      await createRole(owner.cookie, group.id, {
        name: 'Designers',
      })
    ).json()) as RoleBody;
    // A holder, so the attach really changes the room (otherwise the sync
    // writes nothing and cannot fail).
    expect((await setMembers(owner.cookie, group.id, role.id, [member.id])).status).toBe(200);
    const topic = (await (
      await createTopic(owner.cookie, group.id, { name: 'Hiring', visibility: 'private' })
    ).json()) as TopicBody;

    context.adminClient.failAffiliation = true;
    const attached = await setTopicRoles(owner.cookie, topic.id, {
      roleIds: [role.id],
      approverRoleId: role.id,
    });
    // The room is stale, so the caller sees the 502 — but the database
    // committed, and the audit rows are there anyway.
    expect(attached.status).toBe(502);
    const rows = await context.db.select().from(auditLog);
    const actions = rows.map((row) => row.action).sort();
    expect(actions).toEqual(
      expect.arrayContaining(['topic.approver_role_set', 'topic.role_added']),
    );
    const access = await context.db.select().from(topicRoleAccess);
    expect(access.map((entry) => entry.roleId)).toEqual([role.id]);
  });

  it('answers 409 for a duplicate name differing only by case (review 4)', async () => {
    const { owner, group } = await setup();
    expect((await createRole(owner.cookie, group.id, { name: 'Designers' })).status).toBe(201);
    const clash = await createRole(owner.cookie, group.id, { name: 'dEsIgNeRs' });
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { error: { code: string } }).error.code).toBe('role_exists');
    // The unique index owns the race below the pre-check: renaming onto a
    // case-clashing name answers the same 409.
    const other = (await (
      await createRole(owner.cookie, group.id, {
        name: 'Devs',
      })
    ).json()) as RoleBody;
    const renamed = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}/roles/${other.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ name: 'DESIGNERS' }),
    });
    expect(renamed.status).toBe(409);
  });

  it('ignores a stale approver-role row from another group (review 5)', async () => {
    const { owner, member, group } = await setup();
    const foreign = await createGroup(owner.cookie, 'Foreign', [member.id]);
    const foreignRole = (await (
      await createRole(owner.cookie, foreign.id, {
        name: 'Designers',
      })
    ).json()) as RoleBody;
    // A stale membership row for the foreign role (as if a leave-cleanup
    // missed it): without the group join this would grant decide rights.
    await context.db.insert(groupMemberRoles).values({
      roleId: foreignRole.id,
      userId: member.id,
      assignedBy: owner.id,
    });
    const topic = (await (
      await createTopic(owner.cookie, group.id, {
        name: 'Hiring',
        visibility: 'private',
        memberIds: [member.id],
      })
    ).json()) as TopicBody;
    // Point the topic at the foreign role directly (stale data the service
    // must not trust).
    await context.db
      .update((await import('../db/schema')).topics)
      .set({ approverRoleId: foreignRole.id })
      .where(eq((await import('../db/schema')).topics.id, topic.id));

    const schema = await import('../db/schema');
    const { randomUUID } = await import('node:crypto');
    const { aiLocalpart } = await import('../ais/service');
    const connectionId = randomUUID();
    await context.db.insert(schema.providerConnections).values({
      id: connectionId,
      owner: owner.id,
      provider: 'openai',
      encryptedKey: 'sealed-placeholder',
      label: null,
    });
    const aiId = randomUUID();
    await context.db.insert(schema.ais).values({
      id: aiId,
      owner: owner.id,
      name: 'Helper',
      template: 'dev',
      persona: 'A helpful persona.',
      providerConnectionId: connectionId,
      model: 'gpt-4o-mini',
      localpart: aiLocalpart(aiId),
      jid: `${aiLocalpart(aiId)}@galena.localhost`,
      status: 'active',
    });
    await context.db.insert(schema.aiLimits).values({
      aiId,
      perDayUsd: '1.00',
      perMonthUsd: '20.00',
    });
    await context.db.insert(schema.groupAis).values({ groupId: group.id, aiId, addedBy: owner.id });
    const { createApproval } = await import('../approvals/service');
    const approval = await createApproval(
      context.db,
      {
        aiId,
        groupId: group.id,
        topicId: topic.id,
        action: 'demo.echo',
        summary: 'Echo once',
        argsHash: 'a'.repeat(64),
        requestedBy: 'someone@galena.localhost',
        expiresAt: new Date(Date.now() + 60_000),
      },
      new Date(),
    );
    // `member` sees the topic but the approver role belongs to another
    // group: no decide rights (the owner still has them).
    const { canDecide } = await import('../approvals/service');
    expect(await canDecide(context.db, approval, member.id)).toBe(false);
    expect(await canDecide(context.db, approval, owner.id)).toBe(true);
  });
});
