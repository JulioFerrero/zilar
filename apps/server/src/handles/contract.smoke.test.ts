// The handles case of the contract drift detector (T-0894): the client derived
// from `@zilar/api-contract` runs against the real app.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser } from '../test-support';

describe('api contract smoke: handles (T-0894)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  it('checks and claims a handle through the derived client', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const other = await bootstrapUser(context, app, 'other@example.com');
    const web = harness.cookieClient(owner.cookie);

    expect(await runApi(web.handles.check({ query: { handle: 'ada' } }))).toEqual({
      available: true,
    });
    expect(await runApi(web.handles.check({ query: { handle: 'admin' } }))).toEqual({
      available: false,
      reason: 'reserved',
    });
    expect(await runApi(web.handles.claim({ payload: { handle: 'Ada' } }))).toEqual({
      handle: 'Ada',
    });
    expect(
      await runApi(
        harness
          .bearerClient(other.bearer)
          .handles.check({ query: { handle: 'ada', kind: 'user' } }),
      ),
    ).toEqual({ available: false, reason: 'taken' });
  });

  it('maps a second claim inside the change interval and a missing session', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = harness.cookieClient(owner.cookie);
    await runApi(web.handles.claim({ payload: { handle: 'ada' } }));

    const second = await runApi(web.handles.claim({ payload: { handle: 'grace' } })).catch(
      (error: unknown) => error,
    );
    expect(second).toBeInstanceOf(ApiError);
    expect(second).toMatchObject({ status: 409, code: 'handle_change_too_soon' });

    const anonymous = await runApi(
      harness.cookieClient('').handles.check({ query: { handle: 'ada' } }),
    ).catch((error: unknown) => error);
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });
  });
});
