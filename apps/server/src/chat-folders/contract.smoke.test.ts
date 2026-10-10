// The chat-folders case of the contract drift detector (T-0892): the client
// derived from `@zilar/api-contract` runs against the real app. A route whose
// status or body drifts from the contract fails here with `invalid_response`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser } from '../test-support';

describe('api contract smoke: chat-folders (T-0892)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  it('creates, lists, updates, reorders and deletes through the derived client', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = harness.cookieClient(owner.cookie);
    const mobile = harness.bearerClient(owner.bearer);

    const created = await runApi(
      web.chatFolders.create({
        payload: {
          name: 'Work',
          icon: 'briefcase',
          includeTypes: ['dm'],
          includeChats: [],
          excludeChats: [],
          excludeMuted: false,
          excludeRead: false,
        },
      }),
    );
    expect(created.folder).toMatchObject({ name: 'Work', icon: 'briefcase', includeTypes: ['dm'] });

    const listed = await runApi(mobile.chatFolders.list());
    expect(listed.folders.map((folder) => folder.id)).toContain(created.folder.id);

    const updated = await runApi(
      mobile.chatFolders.update({
        params: { id: created.folder.id },
        payload: { name: 'Office', excludeMuted: true },
      }),
    );
    expect(updated.folder).toMatchObject({ name: 'Office', excludeMuted: true });

    const ids = listed.folders.map((folder) => folder.id).reverse();
    const ordered = await runApi(web.chatFolders.order({ payload: { ids } }));
    expect(ordered.folders.map((folder) => folder.id)).toEqual(ids);

    const removed = await runApi(web.chatFolders.remove({ params: { id: created.folder.id } }));
    expect(removed).toEqual({ deleted: true });
  });

  it('maps an unknown folder, a missing session and a client-side invalid payload', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = harness.cookieClient(owner.cookie);

    const missing = await runApi(
      web.chatFolders.update({ params: { id: 'nope' }, payload: { name: 'X' } }),
    ).catch((error: unknown) => error);
    expect(missing).toMatchObject({ status: 404, code: 'not_found' });

    const anonymous = await runApi(harness.cookieClient('').chatFolders.list()).catch(
      (error: unknown) => error,
    );
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });

    const before = harness.requestCount();
    const invalid = await runApi(
      web.chatFolders.update({ params: { id: 'x' }, payload: {} }),
    ).catch((error: unknown) => error);
    expect(invalid).toMatchObject({ status: 400, code: 'invalid_request' });
    expect(harness.requestCount()).toBe(before);
  });
});
