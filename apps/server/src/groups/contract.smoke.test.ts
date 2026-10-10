// The groups case of the contract drift detector (T-0892): the client derived
// from `@zilar/api-contract` runs against the real app. A route whose status
// or body drifts from the contract fails here with `invalid_response`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser, contactOf } from '../test-support';

describe('api contract smoke: groups (T-0892)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  it('creates, reads, changes and leaves a group through the derived client', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const guest = await contactOf(context, app, owner.id, 'guest@example.com');
    const web = harness.cookieClient(owner.cookie);
    const mobile = harness.bearerClient(member.bearer);

    const created = await runApi(
      web.groups.create({ payload: { title: 'Team', memberIds: [member.id] } }),
    );
    expect(created).toMatchObject({ title: 'Team', createdBy: owner.id, kind: 'group' });
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.members.map((entry) => entry.userId).sort()).toEqual(
      [owner.id, member.id].sort(),
    );

    const detail = await runApi(mobile.groups.detail({ params: { id: created.id } }));
    expect(detail.id).toBe(created.id);

    const added = await runApi(
      web.groups.addMembers({ params: { id: created.id }, payload: { userIds: [guest.id] } }),
    );
    expect(added.members.map((entry) => entry.userId)).toContain(guest.id);

    const patched = await runApi(
      web.groups.patch({ params: { id: created.id }, payload: { membersCanCreateTopics: true } }),
    );
    expect(patched.membersCanCreateTopics).toBe(true);

    const listed = await runApi(mobile.groups.members({ params: { id: created.id } }));
    expect(listed.members.length).toBe(4 - 1);

    const left = await runApi(
      mobile.groups.removeMember({ params: { id: created.id, userId: member.id } }),
    );
    expect(left.members.map((entry) => entry.userId)).not.toContain(member.id);
  });

  it('maps an unknown group, a missing session and a client-side invalid payload', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = harness.cookieClient(owner.cookie);

    const unknown = await runApi(web.groups.detail({ params: { id: 'nope' } })).catch(
      (error: unknown) => error,
    );
    expect(unknown).toMatchObject({ status: 404, code: 'not_found' });

    const anonymous = await runApi(
      harness.cookieClient('').groups.detail({ params: { id: 'x' } }),
    ).catch((error: unknown) => error);
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });

    const before = harness.requestCount();
    const invalid = await runApi(
      web.groups.create({ payload: { title: '', memberIds: [] } }),
    ).catch((error: unknown) => error);
    expect(invalid).toMatchObject({ status: 400, code: 'invalid_request' });
    expect(harness.requestCount()).toBe(before);
  });
});
