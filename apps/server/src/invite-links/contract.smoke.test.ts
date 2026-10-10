// The invite-links case of the contract drift detector (T-0892): the client
// derived from `@zilar/api-contract` runs against the real app. A route whose
// status or body drifts from the contract fails here with `invalid_response`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser, contactOf, TEST_BASE_URL } from '../test-support';

describe('api contract smoke: invite-links (T-0892)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  async function groupOf(cookie: string): Promise<string> {
    const response = await harness.app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Team', memberIds: [] }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  }

  it('creates, lists, previews, joins and revokes a link through the derived client', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const guest = await bootstrapUser(context, app, 'guest@example.com');
    const groupId = await groupOf(owner.cookie);
    const web = harness.cookieClient(owner.cookie);
    const mobile = harness.bearerClient(guest.bearer);

    const created = await runApi(
      web['invite-links'].createLink({
        params: { id: groupId },
        payload: { label: 'Friends', maxUses: 5 },
      }),
    );
    expect(created.token).toMatch(/^[0-9a-f]{64}$/);

    const listed = await runApi(web['invite-links'].listLinks({ params: { id: groupId } }));
    expect(listed.links).toMatchObject([{ id: created.id, label: 'Friends', maxUses: 5 }]);

    const preview = await runApi(
      mobile['invite-links'].preview({ params: { token: created.token } }),
    );
    expect(preview).toMatchObject({ groupTitle: 'Team', alreadyMember: false, kind: 'group' });

    const joined = await runApi(mobile['invite-links'].join({ params: { token: created.token } }));
    expect(joined).toEqual({ groupId, alreadyMember: false });

    await runApi(web['invite-links'].revokeLink({ params: { id: groupId, linkId: created.id } }));
    const after = await runApi(web['invite-links'].listLinks({ params: { id: groupId } }));
    expect(after.links[0]).toMatchObject({ revoked: true });
  });

  it('maps a bad token, a refused write, a missing session and a client-side invalid payload', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const groupId = await groupOf(owner.cookie);
    const web = harness.cookieClient(owner.cookie);

    const badToken = await runApi(web['invite-links'].preview({ params: { token: 'nope' } })).catch(
      (error: unknown) => error,
    );
    expect(badToken).toMatchObject({ status: 404, code: 'invalid_link' });

    const refused = await runApi(
      harness.bearerClient(member.bearer)['invite-links'].createLink({
        params: { id: groupId },
        payload: {},
      }),
    ).catch((error: unknown) => error);
    expect(refused).toMatchObject({ status: expect.any(Number) });
    expect((refused as { status: number }).status).toBeGreaterThanOrEqual(400);

    const anonymous = await runApi(
      harness.cookieClient('')['invite-links'].listLinks({ params: { id: groupId } }),
    ).catch((error: unknown) => error);
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });

    const before = harness.requestCount();
    const invalid = await runApi(
      web['invite-links'].createLink({ params: { id: groupId }, payload: { maxUses: 0 } }),
    ).catch((error: unknown) => error);
    expect(invalid).toMatchObject({ status: 400, code: 'invalid_request' });
    expect(harness.requestCount()).toBe(before);
  });
});
