// The contact-requests case of the contract drift detector (T-0894): the
// client derived from `@zilar/api-contract` runs against the real app. The
// create answers 201 for a new request and 200 `incoming: true` for a reverse
// one, so both declared statuses are exercised.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { claimHandle } from '../handles/store';
import { bootstrapUser } from '../test-support';

describe('api contract smoke: contact requests (T-0894)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  async function withHandle(email: string, handle: string) {
    const user = await bootstrapUser(harness.context, harness.app, email);
    await claimHandle(harness.context.db, user.id, handle);
    return user;
  }

  it('creates, lists, looks up, accepts and answers a reverse request', async () => {
    const alice = await withHandle('alice@example.com', 'alice_w');
    const bob = await withHandle('bob@example.com', 'bob_b');
    const aliceWeb = harness.cookieClient(alice.cookie);
    const bobMobile = harness.bearerClient(bob.bearer);

    const profile = await runApi(
      aliceWeb.contactRequests.byHandle({ params: { handle: 'bob_b' } }),
    );
    expect(profile).toMatchObject({ userId: bob.id, handle: 'bob_b', relation: 'none' });

    const created = await runApi(aliceWeb.contactRequests.create({ payload: { handle: 'bob_b' } }));
    expect(created).not.toHaveProperty('incoming');
    expect(created.request).toMatchObject({ fromUserId: alice.id, status: 'pending' });

    const reverse = await runApi(
      bobMobile.contactRequests.create({ payload: { handle: 'alice_w' } }),
    );
    expect(reverse).toMatchObject({ incoming: true });

    const listed = await runApi(bobMobile.contactRequests.list());
    expect(listed.incoming.map((view) => view.id)).toEqual([created.request.id]);

    const accepted = await runApi(
      bobMobile.contactRequests.accept({ params: { id: created.request.id } }),
    );
    expect(accepted.request.status).toBe('accepted');
  });

  it('maps an unknown handle, an invalid payload and a missing session', async () => {
    const alice = await withHandle('alice@example.com', 'alice_w');
    const web = harness.cookieClient(alice.cookie);

    const unknown = await runApi(
      web.contactRequests.byHandle({ params: { handle: 'nobody_x' } }),
    ).catch((error: unknown) => error);
    expect(unknown).toBeInstanceOf(ApiError);
    expect(unknown).toMatchObject({ status: 404 });

    const before = harness.requestCount();
    const invalid = await runApi(web.contactRequests.create({ payload: { handle: '' } })).catch(
      (error: unknown) => error,
    );
    expect(invalid).toMatchObject({ status: 400, code: 'invalid_request' });
    expect(harness.requestCount()).toBe(before);

    const anonymous = await runApi(harness.cookieClient('').contactRequests.list()).catch(
      (error: unknown) => error,
    );
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });
  });
});
