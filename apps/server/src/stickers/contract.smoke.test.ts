// The stickers case of the contract drift detector (T-0895): the client
// derived from `@zilar/api-contract` runs against the real app. A route whose
// status or body drifts from the contract fails here with `invalid_response`.
// `discover`, `removeFavorite` and `importTelegram` declare no query or
// payload (the server decodes them by hand), and `uploadSticker` and
// `serveFile` carry raw bytes, so the derived client is not used for them.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser } from '../test-support';

describe('api contract smoke: stickers (T-0895)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  it('creates (201), renames, lists and deletes a pack', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = harness.cookieClient(owner.cookie);
    const mobile = harness.bearerClient(owner.bearer);

    const created = await runApi(
      web.stickers.createPack({ payload: { title: 'Cats', visibility: 'private' } }),
    );
    expect(created).toMatchObject({ title: 'Cats', ownerId: owner.id, visibility: 'private' });

    const renamed = await runApi(
      mobile.stickers.patchPack({ params: { id: created.id }, payload: { title: 'Dogs' } }),
    );
    expect(renamed).toMatchObject({ id: created.id, title: 'Dogs' });

    const listed = await runApi(web.stickers.listPacks());
    expect(listed.packs.map((pack) => pack.id)).toContain(created.id);

    await expect(runApi(web.stickers.deletePack({ params: { id: created.id } }))).resolves.toEqual(
      expect.objectContaining({ warning: expect.any(String) }),
    );
  });

  it('maps the error envelope, a missing session and a client-side invalid payload', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = harness.cookieClient(owner.cookie);

    const missing = await runApi(
      web.stickers.patchPack({ params: { id: 'nope' }, payload: { title: 'x' } }),
    ).catch((error: unknown) => error);
    expect(missing).toBeInstanceOf(ApiError);
    expect(missing).toMatchObject({ status: 404, code: 'not_found' });

    const anonymous = await runApi(harness.cookieClient('').stickers.listPacks()).catch(
      (error: unknown) => error,
    );
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });

    const before = harness.requestCount();
    const invalid = await runApi(web.stickers.createPack({ payload: { title: '' } })).catch(
      (error: unknown) => error,
    );
    expect(invalid).toMatchObject({ status: 400, code: 'invalid_request' });
    expect(harness.requestCount()).toBe(before);
  });
});
