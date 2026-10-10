// The pins case of the contract drift detector (T-0864): the client derived
// from `@zilar/api-contract` runs against the real app. A route whose status
// or body drifts from the contract fails here with `invalid_response`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser, contactOf, expectedJid } from '../test-support';

describe('api contract smoke: pins (T-0864)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  it('pins, lists and unpins through the derived client', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const web = harness.cookieClient(owner.cookie);
    const mobile = harness.bearerClient(member.bearer);

    const created = await runApi(
      web.pins.create({
        payload: {
          chat: expectedJid(member.id),
          messageId: 'msg-1',
          senderName: 'Owner',
          text: 'hello ✅',
          kind: 'text',
        },
      }),
    );
    expect(created).toMatchObject({ messageId: 'msg-1', text: 'hello ✅', pinnedBy: owner.id });

    const listed = await runApi(mobile.pins.list({ query: { chat: expectedJid(owner.id) } }));
    expect(listed.pins.map((pin) => pin.id)).toEqual([created.id]);

    const removed = await runApi(mobile.pins.remove({ params: { id: created.id } }));
    // The `chat` echo is the caller's form of the address.
    expect(removed).toEqual({ ...created, chat: expectedJid(owner.id) });
    const after = await runApi(web.pins.list({ query: { chat: expectedJid(member.id) } }));
    expect(after.pins).toEqual([]);
  });

  it('maps the error envelope, a missing session and a client-side invalid payload', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = harness.cookieClient(owner.cookie);

    const missing = await runApi(web.pins.remove({ params: { id: 'nope' } })).catch(
      (error: unknown) => error,
    );
    expect(missing).toBeInstanceOf(ApiError);
    expect(missing).toMatchObject({ status: 404, code: 'not_found' });

    const anonymous = await runApi(
      harness.cookieClient('').pins.list({ query: { chat: 'x' } }),
    ).catch((error: unknown) => error);
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });

    const before = harness.requestCount();
    const invalid = await runApi(
      web.pins.create({ payload: { chat: 'x', messageId: 'm', senderName: '' } }),
    ).catch((error: unknown) => error);
    expect(invalid).toMatchObject({ status: 400, code: 'invalid_request' });
    expect(harness.requestCount()).toBe(before);
  });
});
