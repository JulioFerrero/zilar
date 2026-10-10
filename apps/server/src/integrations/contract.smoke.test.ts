// The integrations case of the contract drift detector (T-0895): the client
// derived from `@zilar/api-contract` runs against the real app. A route whose
// status or body drifts from the contract fails here with `invalid_response`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser, contactOf } from '../test-support';

describe('api contract smoke: integrations (T-0895)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  it('reads the status and removes the Telegram token as the owner', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = harness.cookieClient(owner.cookie);

    const status = await runApi(web.integrations.status());
    expect(status.canManage).toBe(true);
    expect(status.telegram.configured).toBe(false);

    await expect(runApi(web.integrations.removeTelegram())).resolves.toEqual({ ok: true });
  });

  it('answers 404 for a member and rejects a payload before sending', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const mobile = harness.bearerClient(member.bearer);

    const hidden = await runApi(mobile.integrations.status()).catch((error: unknown) => error);
    expect(hidden).toBeInstanceOf(ApiError);
    expect(hidden).toMatchObject({ status: 404, code: 'not_found' });

    const before = harness.requestCount();
    const invalid = await runApi(
      harness.cookieClient(owner.cookie).integrations.setTelegram({
        payload: { botToken: 'has a space' },
      }),
    ).catch((error: unknown) => error);
    expect(invalid).toMatchObject({ status: 400, code: 'invalid_request' });
    expect(harness.requestCount()).toBe(before);
  });
});
