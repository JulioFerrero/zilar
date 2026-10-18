// T-1741: the owner promotes a plain group's member to admin and back. The
// route has served channels since T-0124; plain groups used to answer the same
// 404 as an unknown group, so the group's owner had no admin to appoint.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runSql } from '../effect/sql';
import { desiredMembers } from '../topics/room-members';
import { getTopic } from '../topics/access';
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
import { seedGroup, seedUser } from '../test-support/seed';

interface DetailBody {
  id: string;
  members: Array<{ userId: string; role: string }>;
}

describe('group member roles (T-1741)', () => {
  let context: TestContext;
  let app: TestApp;

  beforeEach(async () => {
    context = await createTestContext();
    app = testApp(context);
  });

  afterEach(async () => {
    await context.close();
  });

  async function createGroup(
    cookie: string,
    title: string,
    memberIds: string[],
    kind: 'group' | 'channel' = 'group',
  ) {
    const response = await app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title, memberIds, kind }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as DetailBody;
  }

  function changeRoleRequest(
    cookie: string,
    groupId: string,
    userId: string,
    role: 'admin' | 'member',
  ) {
    return app.request(`${TEST_BASE_URL}/api/groups/${groupId}/members/${userId}/role`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ role }),
    });
  }

  function rolesOf(detail: DetailBody): Map<string, string> {
    return new Map(detail.members.map((entry) => [entry.userId, entry.role]));
  }

  it('lets the owner make a group member admin and back', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const group = await createGroup(owner.cookie, 'Team', [member.id]);

    const promoted = await changeRoleRequest(owner.cookie, group.id, member.id, 'admin');
    expect(promoted.status).toBe(200);
    expect(rolesOf((await promoted.json()) as DetailBody).get(member.id)).toBe('admin');

    const demoted = await changeRoleRequest(owner.cookie, group.id, member.id, 'member');
    expect(demoted.status).toBe(200);
    expect(rolesOf((await demoted.json()) as DetailBody).get(member.id)).toBe('member');
  });

  it('refuses a non-owner with the same 404 as an unknown group', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const other = await contactOf(context, app, owner.id, 'other@example.com');
    const group = await createGroup(owner.cookie, 'Team', [member.id, other.id]);

    // A plain member sees the same 404 a stranger gets.
    const refused = await changeRoleRequest(member.cookie, group.id, other.id, 'admin');
    expect(refused.status).toBe(404);

    // An unknown group answers the same 404.
    const unknown = await changeRoleRequest(owner.cookie, 'does-not-exist', other.id, 'admin');
    expect(unknown.status).toBe(404);
  });

  // T-1990: the locked transaction refuses to change the owner's role, so no
  // role change can leave the group without an owner.
  it('refuses to change the current owner role', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const group = await createGroup(owner.cookie, 'Team', []);

    const refused = await changeRoleRequest(owner.cookie, group.id, owner.id, 'member');
    expect(refused.status).toBe(403);

    const detail = (await (
      await app.request(`${TEST_BASE_URL}/api/groups/${group.id}`, {
        headers: { cookie: owner.cookie },
      })
    ).json()) as DetailBody;
    expect(rolesOf(detail).get(owner.id)).toBe('owner');
  });

  // T-2010: the creator of a plain group is a plain `member` of its room, not
  // a MUC `owner`.
  it('makes the creator of a plain group a plain member of its room', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    await createGroup(owner.cookie, 'Team', []);

    const [room] = context.adminClient.roomsCreated;
    expect(context.adminClient.affiliationState.get(room!)?.get(expectedJid(owner.id))).toBe(
      'member',
    );
  });

  it('keeps a promoted admin a plain member of a group room and gives a channel admin voice', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const group = await createGroup(owner.cookie, 'Team', [member.id]);
    const channel = await createGroup(owner.cookie, 'News', [member.id], 'channel');
    const [groupRoom, channelRoom] = context.adminClient.roomsCreated;

    await changeRoleRequest(owner.cookie, group.id, member.id, 'admin');
    await changeRoleRequest(owner.cookie, channel.id, member.id, 'admin');

    const jid = expectedJid(member.id);
    expect(context.adminClient.affiliationState.get(groupRoom!)?.get(jid)).toBe('member');
    expect(context.adminClient.affiliationState.get(channelRoom!)?.get(jid)).toBe('admin');
  });
});

describe('wanted room affiliations (T-2002)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  async function insertPrivateTopic(
    groupId: string,
    createdBy: string,
    memberIds: string[],
  ): Promise<string> {
    const topicId = randomUUID();
    await runSql(
      context.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO topics ${sql.insert({
          id: topicId,
          group_id: groupId,
          name: 'Plans',
          glyph: 'P',
          room_localpart: `t${randomUUID().replaceAll('-', '').slice(0, 15)}`,
          visibility: 'private',
          kind: 'chat',
          status: 'open',
          is_general: false,
          created_by: createdBy,
        })}`;
        for (const userId of memberIds) {
          yield* sql`INSERT INTO topic_members ${sql.insert({
            topic_id: topicId,
            user_id: userId,
            added_by: createdBy,
          })}`;
        }
      }),
    );
    return topicId;
  }

  async function makeChannel(groupId: string): Promise<void> {
    await runSql(
      context.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE groups SET kind = 'channel' WHERE id = ${groupId}`;
      }),
    );
  }

  async function wantedFor(topicId: string): Promise<Map<string, string>> {
    const topic = await getTopic(context.db, topicId);
    if (!topic) {
      throw new Error('missing topic');
    }
    return desiredMembers(context.db, topic, 'zilar.localhost');
  }

  async function seedPeople() {
    const ownerId = await seedUser(context, { name: 'Owner' });
    const adminId = await seedUser(context, { name: 'Admin' });
    const memberId = await seedUser(context, { name: 'Member' });
    const seeded = await seedGroup(
      context,
      ownerId,
      [
        { userId: ownerId, role: 'owner' },
        { userId: adminId, role: 'admin' },
        { userId: memberId, role: 'member' },
      ],
      [],
    );
    return { ownerId, adminId, memberId, ...seeded };
  }

  it('makes every person a plain member in a group room and its topics', async () => {
    const { ownerId, adminId, memberId, groupId, generalTopicId } = await seedPeople();
    const topicId = await insertPrivateTopic(groupId, adminId, [adminId, ownerId, memberId]);

    for (const id of [generalTopicId, topicId]) {
      const wanted = await wantedFor(id);
      expect(wanted.get(expectedJid(ownerId))).toBe('member');
      expect(wanted.get(expectedJid(adminId))).toBe('member');
      expect(wanted.get(expectedJid(memberId))).toBe('member');
    }
  });

  it('gives only the channel feed owner and admins voice, and other topics none', async () => {
    const { ownerId, adminId, memberId, groupId, generalTopicId } = await seedPeople();
    await makeChannel(groupId);
    const topicId = await insertPrivateTopic(groupId, adminId, [adminId, ownerId, memberId]);

    const feed = await wantedFor(generalTopicId);
    expect(feed.get(expectedJid(ownerId))).toBe('admin');
    expect(feed.get(expectedJid(adminId))).toBe('admin');
    expect(feed.get(expectedJid(memberId))).toBe('member');

    const other = await wantedFor(topicId);
    expect([...other.values()].every((affiliation) => affiliation === 'member')).toBe(true);
  });
});
