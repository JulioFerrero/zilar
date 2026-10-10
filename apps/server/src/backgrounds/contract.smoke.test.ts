// The backgrounds case of the contract drift detector (T-0895): the client
// derived from `@zilar/api-contract` runs against the real app. A route whose
// status or body drifts from the contract fails here with `invalid_response`.
// `upload` and `getFile` carry raw bytes and are outside the client.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser } from '../test-support';

describe('api contract smoke: backgrounds (T-0895)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  it('lists the caller own images (none yet)', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');

    const listed = await runApi(harness.cookieClient(owner.cookie).backgrounds.list());
    expect(listed).toEqual({ backgrounds: [] });
  });

  it('maps the error envelope and a missing session', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const mobile = harness.bearerClient(owner.bearer);

    const missing = await runApi(mobile.backgrounds.remove({ params: { id: 'nope' } })).catch(
      (error: unknown) => error,
    );
    expect(missing).toBeInstanceOf(ApiError);
    expect(missing).toMatchObject({ status: 404, code: 'not_found' });

    const anonymous = await runApi(harness.cookieClient('').backgrounds.list()).catch(
      (error: unknown) => error,
    );
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });
  });
});
