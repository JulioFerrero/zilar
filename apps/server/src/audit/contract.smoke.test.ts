// The audit case of the contract drift detector (T-0893): the client derived
// from `@zilar/api-contract` runs against the real app.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser } from '../test-support';

describe('api contract smoke: audit (T-0893)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  it('lists an empty page for an unknown scope through the derived client', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = harness.cookieClient(owner.cookie);

    const page = await runApi(web.audit.list({ query: { aiId: 'unknown-ai', limit: 20 } }));
    expect(page).toEqual({ entries: [], next: null });
  });

  it('maps a missing scope, a bad cursor and a missing session to their envelopes', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = harness.cookieClient(owner.cookie);

    const noScope = await runApi(web.audit.list({ query: {} })).catch((error: unknown) => error);
    expect(noScope).toBeInstanceOf(ApiError);
    expect(noScope).toMatchObject({ status: 400, code: 'invalid_request' });

    const badCursor = await runApi(
      web.audit.list({ query: { aiId: 'unknown-ai', before: 'not-a-cursor' } }),
    ).catch((error: unknown) => error);
    expect(badCursor).toMatchObject({ status: 400, code: 'invalid_request' });

    const anonymous = await runApi(
      harness.cookieClient('').audit.list({ query: { aiId: 'x' } }),
    ).catch((error: unknown) => error);
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });
  });
});
