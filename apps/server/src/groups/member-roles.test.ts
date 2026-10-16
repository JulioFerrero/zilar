// T-1741: the owner promotes a plain group's member to admin and back. The
// route has served channels since T-0124; plain groups used to answer the same
// 404 as an unknown group, so the group's owner had no admin to appoint.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testApp,
  TEST_BASE_URL,
  type TestApp,
  type TestContext,
} from '../test-support';

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

  async function createGroup(cookie: string, title: string, memberIds: string[]) {
    const response = await app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title, memberIds }),
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
});
