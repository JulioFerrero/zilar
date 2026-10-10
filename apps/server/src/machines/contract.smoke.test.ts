// The machines case of the contract drift detector (T-0895): the client
// derived from `@zilar/api-contract` runs against the real app. A route whose
// status or body drifts from the contract fails here with `invalid_response`.
// `rename` and `pair` declare no payload (the server reads their bodies by
// hand), so they are not called here.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser } from '../test-support';

describe('api contract smoke: machines (T-0895)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  it('mints a pairing code (201) and lists no machines yet', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = harness.cookieClient(owner.cookie);
    const mobile = harness.bearerClient(owner.bearer);

    const code = await runApi(web.machines.createPairingCode());
    expect(code.code).toMatch(/\S+/);
    expect(Number.isNaN(Date.parse(code.expiresAt))).toBe(false);

    expect(await runApi(mobile.machines.list())).toEqual([]);
  });

  it('maps the error envelope and a missing session', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = harness.cookieClient(owner.cookie);

    const missing = await runApi(web.machines.approve({ params: { id: 'nope' } })).catch(
      (error: unknown) => error,
    );
    expect(missing).toBeInstanceOf(ApiError);
    expect(missing).toMatchObject({ status: 404, code: 'not_found' });

    const anonymous = await runApi(harness.cookieClient('').machines.list()).catch(
      (error: unknown) => error,
    );
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });
  });
});
