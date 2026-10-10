// The roles case of the contract drift detector (T-0892): the client derived
// from `@zilar/api-contract` runs against the real app. A route whose status
// or body drifts from the contract fails here with `invalid_response`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser, contactOf, TEST_BASE_URL } from '../test-support';

describe('api contract smoke: roles (T-0892)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  async function groupOf(cookie: string, memberIds: string[]): Promise<string> {
    const response = await harness.app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Team', memberIds }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  }

  it('creates, lists, renames, assigns and deletes a role through the derived client', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const groupId = await groupOf(owner.cookie, [member.id]);
    const web = harness.cookieClient(owner.cookie);
    const mobile = harness.bearerClient(member.bearer);

    const created = await runApi(
      web.roles.create({ params: { id: groupId }, payload: { name: 'Designers' } }),
    );
    expect(created).toMatchObject({ name: 'Designers', members: [] });

    const listed = await runApi(mobile.roles.list({ params: { id: groupId } }));
    expect(listed.roles.map((role) => role.id)).toEqual([created.id]);

    const renamed = await runApi(
      web.roles.rename({
        params: { id: groupId, roleId: created.id },
        payload: { name: 'Artists' },
      }),
    );
    expect(renamed.name).toBe('Artists');

    const assigned = await runApi(
      web.roles.setMembers({
        params: { id: groupId, roleId: created.id },
        payload: { userIds: [member.id] },
      }),
    );
    expect(assigned.members.map((holder) => holder.userId)).toEqual([member.id]);

    await runApi(web.roles.remove({ params: { id: groupId, roleId: created.id } }));
    const after = await runApi(web.roles.list({ params: { id: groupId } }));
    expect(after.roles).toEqual([]);
  });

  it('maps a refused write, a missing session and a client-side invalid payload', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const groupId = await groupOf(owner.cookie, [member.id]);
    const mobile = harness.bearerClient(member.bearer);

    const refused = await runApi(
      mobile.roles.create({ params: { id: groupId }, payload: { name: 'Devs' } }),
    ).catch((error: unknown) => error);
    expect(refused).toMatchObject({ status: 403 });

    const anonymous = await runApi(
      harness.cookieClient('').roles.list({ params: { id: groupId } }),
    ).catch((error: unknown) => error);
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });

    const before = harness.requestCount();
    const invalid = await runApi(
      harness.cookieClient(owner.cookie).roles.create({
        params: { id: groupId },
        payload: { name: 'bad\x07name' },
      }),
    ).catch((error: unknown) => error);
    expect(invalid).toMatchObject({ status: 400, code: 'invalid_request' });
    expect(harness.requestCount()).toBe(before);
  });
});
