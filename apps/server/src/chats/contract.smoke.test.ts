// The chats case of the contract drift detector (T-0894): the client derived
// from `@zilar/api-contract` runs against the real app. The entries are
// declared `Unknown` in the contract, so this also pins the shape the clients
// validate with their own schemas.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser, contactOf, expectedJid, TEST_BASE_URL } from '../test-support';

describe('api contract smoke: chats (T-0894)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  it('lists a DM and a group through the derived client', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const created = await app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ title: 'Weekend trip', memberIds: [member.id] }),
    });
    expect(created.status).toBe(201);

    const listed = await runApi(harness.bearerClient(owner.bearer).chats.list());
    expect(listed.chats).toEqual([
      expect.objectContaining({ kind: 'dm', chatJid: expectedJid(member.id), isAi: false }),
      expect.objectContaining({ kind: 'group', title: 'Weekend trip', role: 'owner' }),
    ]);
  });

  it('answers 401 without a session', async () => {
    const anonymous = await runApi(harness.cookieClient('').chats.list()).catch(
      (error: unknown) => error,
    );
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });
  });
});
