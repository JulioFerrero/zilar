// The blocks case of the contract drift detector (T-0894): the client derived
// from `@zilar/api-contract` runs against the real app.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser, contactOf } from '../test-support';

describe('api contract smoke: blocks (T-0894)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  it('blocks, lists and unblocks through the derived client', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const web = harness.cookieClient(owner.cookie);

    expect(await runApi(web.blocks.block({ params: { userId: member.id } }))).toEqual({
      blocked: true,
    });
    const listed = await runApi(harness.bearerClient(owner.bearer).blocks.list());
    expect(listed.blocked.map((person) => person.userId)).toEqual([member.id]);
    expect(await runApi(web.blocks.unblock({ params: { userId: member.id } }))).toEqual({
      blocked: false,
    });
    expect((await runApi(web.blocks.list())).blocked).toEqual([]);
  });

  it('maps an unknown user, blocking yourself and a missing session', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = harness.cookieClient(owner.cookie);

    const unknown = await runApi(web.blocks.block({ params: { userId: 'nobody' } })).catch(
      (error: unknown) => error,
    );
    expect(unknown).toBeInstanceOf(ApiError);
    expect(unknown).toMatchObject({ status: 404 });

    const self = await runApi(web.blocks.block({ params: { userId: owner.id } })).catch(
      (error: unknown) => error,
    );
    expect(self).toMatchObject({ status: 400 });

    const anonymous = await runApi(harness.cookieClient('').blocks.list()).catch(
      (error: unknown) => error,
    );
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });
  });
});
