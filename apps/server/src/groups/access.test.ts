import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findGroupMembership, isGroupManagerRole } from './access';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testApp,
  TEST_BASE_URL,
  type TestApp,
  type TestContext,
} from '../test-support';

describe('group access (T-1110)', () => {
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
    return (await response.json()) as { id: string };
  }

  it('reads the membership row, or undefined when there is none', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');
    const group = await createGroup(owner.cookie, 'Team', [member.id]);

    expect(await findGroupMembership(context.db, group.id, owner.id)).toEqual({
      groupId: group.id,
      userId: owner.id,
      role: 'owner',
    });
    expect(await findGroupMembership(context.db, group.id, member.id)).toEqual({
      groupId: group.id,
      userId: member.id,
      role: 'member',
    });
    // No row at all: a stranger is not in the group.
    expect(await findGroupMembership(context.db, group.id, stranger.id)).toBeUndefined();
    // A missing group has no row either.
    expect(await findGroupMembership(context.db, 'group-does-not-exist', owner.id)).toBeUndefined();
  });

  it('treats owners and admins as managers, and members not', () => {
    expect(isGroupManagerRole('owner')).toBe(true);
    expect(isGroupManagerRole('admin')).toBe(true);
    expect(isGroupManagerRole('member')).toBe(false);
  });
});
