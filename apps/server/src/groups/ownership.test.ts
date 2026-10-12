// SG-4 (T-1187): the owner hands the group over. The route is owner-only and
// the two roles swap in one transaction, so the old owner becomes an admin and
// can then leave.

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

describe('group owner transfer (T-1187)', () => {
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

  function transferRequest(cookie: string, groupId: string, userId: string) {
    return app.request(`${TEST_BASE_URL}/api/groups/${groupId}/owner`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ userId }),
    });
  }

  it('refuses a non-owner with 403', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const other = await contactOf(context, app, owner.id, 'other@example.com');
    const group = await createGroup(owner.cookie, 'Team', [member.id, other.id]);

    const refused = await transferRequest(member.cookie, group.id, other.id);
    expect(refused.status).toBe(403);
  });

  it('swaps the roles and lets the old owner leave', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const group = await createGroup(owner.cookie, 'Team', [member.id]);

    const transferred = await transferRequest(owner.cookie, group.id, member.id);
    expect(transferred.status).toBe(200);
    const detail = (await transferred.json()) as DetailBody;
    const roles = new Map(detail.members.map((entry) => [entry.userId, entry.role]));
    expect(roles.get(member.id)).toBe('owner');
    expect(roles.get(owner.id)).toBe('admin');

    // The old owner is a plain admin now, so leaving is allowed.
    const left = await app.request(`${TEST_BASE_URL}/api/groups/${group.id}/members/${owner.id}`, {
      method: 'DELETE',
      headers: { cookie: owner.cookie },
    });
    expect(left.status).toBe(200);
  });
});
