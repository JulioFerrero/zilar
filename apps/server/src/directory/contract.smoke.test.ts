// The directory case of the contract drift detector (T-0894): the client
// derived from `@zilar/api-contract` runs against the real app.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser, TEST_BASE_URL } from '../test-support';

describe('api contract smoke: directory (T-0894)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  async function publicGroup(cookie: string): Promise<string> {
    const created = await harness.app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Weekend trip', memberIds: [] }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const patched = await harness.app.request(`${TEST_BASE_URL}/api/groups/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ visibility: 'public', handle: 'weekend_trip' }),
    });
    expect(patched.status).toBe(200);
    return id;
  }

  it('searches and looks up a public group through the derived client', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');
    const id = await publicGroup(owner.cookie);

    const page = await runApi(
      harness.bearerClient(stranger.bearer).directory.search({ query: { q: 'weekend' } }),
    );
    expect(page.entries.map((entry) => entry.id)).toEqual([id]);
    expect(page.next).toBeNull();

    const entry = await runApi(
      harness
        .cookieClient(stranger.cookie)
        .directory.byHandle({ params: { handle: 'WEEKEND_TRIP' } }),
    );
    expect(entry).toMatchObject({ id, kind: 'group', handle: 'weekend_trip', joined: false });
  });

  it('maps an unknown handle, an invalid query and a missing session', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = harness.cookieClient(owner.cookie);

    const unknown = await runApi(web.directory.byHandle({ params: { handle: 'nobody_x' } })).catch(
      (error: unknown) => error,
    );
    expect(unknown).toBeInstanceOf(ApiError);
    expect(unknown).toMatchObject({ status: 404 });

    const before = harness.requestCount();
    const invalid = await runApi(web.directory.search({ query: { q: 'x'.repeat(101) } })).catch(
      (error: unknown) => error,
    );
    expect(invalid).toMatchObject({ status: 400, code: 'invalid_request' });
    expect(harness.requestCount()).toBe(before);

    const anonymous = await runApi(harness.cookieClient('').directory.search({ query: {} })).catch(
      (error: unknown) => error,
    );
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });
  });
});
