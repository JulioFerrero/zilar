// The contacts case of the contract drift detector (T-0894): the client derived
// from `@zilar/api-contract` runs against the real app.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser, contactOf } from '../test-support';

describe('api contract smoke: contacts (T-0894)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  it('lists the contacts through the derived client', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');

    const listed = await runApi(harness.cookieClient(owner.cookie).contacts.list());
    expect(listed.map((contact) => contact.userId)).toEqual([member.id]);
  });

  it('answers 401 without a session', async () => {
    const anonymous = await runApi(harness.cookieClient('').contacts.list()).catch(
      (error: unknown) => error,
    );
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });
  });
});
