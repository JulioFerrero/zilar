// The chat-prefs case of the contract drift detector (T-0892): the client
// derived from `@zilar/api-contract` runs against the real app. A route whose
// status or body drifts from the contract fails here with `invalid_response`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser, contactOf, expectedJid } from '../test-support';

describe('api contract smoke: chat-prefs (T-0892)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  it('sets, lists and clears a pref and the default background', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const web = harness.cookieClient(owner.cookie);
    const mobile = harness.bearerClient(owner.bearer);
    const chatJid = expectedJid(member.id);

    const saved = await runApi(
      web.chatPrefs.putPref({ params: { chatJid }, payload: { archived: true } }),
    );
    expect(saved).toMatchObject({ chatJid, archived: true });

    const listed = await runApi(mobile.chatPrefs.list());
    expect(listed.prefs.map((pref) => pref.chatJid)).toEqual([chatJid]);
    expect(listed.defaultBackground?.backgroundPreset).toBeNull();

    const cleared = await runApi(
      web.chatPrefs.putPref({ params: { chatJid }, payload: { archived: false } }),
    );
    expect(cleared).toEqual({ prefs: null });

    const background = await runApi(
      web.chatPrefs.putBackground({ payload: { backgroundPreset: 'gold' } }),
    );
    expect(background.defaultBackground.backgroundPreset).toBe('gold');
    const read = await runApi(mobile.chatPrefs.getBackground());
    expect(read.defaultBackground.backgroundPreset).toBe('gold');
  });

  it('maps an unknown chat, a missing session and a client-side invalid payload', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = harness.cookieClient(owner.cookie);

    const unknown = await runApi(
      web.chatPrefs.putPref({
        params: { chatJid: 'nobody@example.test' },
        payload: { archived: true },
      }),
    ).catch((error: unknown) => error);
    expect(unknown).toMatchObject({ status: 404, code: 'not_found' });

    const anonymous = await runApi(harness.cookieClient('').chatPrefs.list()).catch(
      (error: unknown) => error,
    );
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });

    const before = harness.requestCount();
    const invalid = await runApi(web.chatPrefs.putBackground({ payload: {} })).catch(
      (error: unknown) => error,
    );
    expect(invalid).toMatchObject({ status: 400, code: 'invalid_request' });
    expect(harness.requestCount()).toBe(before);
  });
});
