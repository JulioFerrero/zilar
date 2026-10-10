// The auth case of the contract drift detector (T-0895): the client derived
// from `@zilar/api-contract` runs against the real app. A route whose status
// or body drifts from the contract fails here with `invalid_response`.
// Better Auth's own endpoints stay outside the contract.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser } from '../test-support';

describe('api contract smoke: auth (T-0895)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  it('reads and renames the profile, then creates, checks and revokes an invite', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = harness.cookieClient(owner.cookie);
    const mobile = harness.bearerClient(owner.bearer);

    const me = await runApi(web.auth.me());
    expect(me).toMatchObject({ id: owner.id, email: 'owner@example.com' });

    const renamed = await runApi(mobile.auth.patchMe({ payload: { name: 'Julio' } }));
    expect(renamed).toMatchObject({ id: owner.id, name: 'Julio' });

    const invite = await runApi(web.auth.createInvite());
    expect(Number.isNaN(Date.parse(invite.expiresAt ?? ''))).toBe(false);

    // The check is public: no session needed.
    const check = await runApi(
      harness.cookieClient('').authInvitesPublic.checkInvite({ params: { code: invite.code } }),
    );
    expect(check).toEqual({ valid: true });

    await expect(runApi(web.auth.revokeInvite({ params: { code: invite.code } }))).resolves.toEqual(
      { revoked: true },
    );
  });

  it('maps the error envelope, a missing session and a client-side invalid name', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = harness.cookieClient(owner.cookie);

    const missing = await runApi(web.auth.revokeInvite({ params: { code: 'nope' } })).catch(
      (error: unknown) => error,
    );
    expect(missing).toBeInstanceOf(ApiError);
    expect(missing).toMatchObject({ status: 404, code: 'not_found' });

    const anonymous = await runApi(harness.cookieClient('').auth.me()).catch(
      (error: unknown) => error,
    );
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });

    const before = harness.requestCount();
    const invalid = await runApi(web.auth.patchMe({ payload: { name: '' } })).catch(
      (error: unknown) => error,
    );
    expect(invalid).toMatchObject({ status: 400, code: 'invalid_request' });
    expect(harness.requestCount()).toBe(before);
  });
});
