// The gifs case of the contract drift detector (T-0895): the client derived
// from `@zilar/api-contract` runs against the real app. The harness app has no
// GIF provider, so this covers the error envelope: session first, then the
// 501 before the query is decoded. `search` and `trending` declare no query
// (the server decodes it by hand after the provider check), and `media` is raw
// bytes, so the success pages are covered by `routes.test.ts`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, GifResultPage, runApi } from '@zilar/api-contract';
import { Schema } from 'effect';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser } from '../test-support';

describe('api contract smoke: gifs (T-0895)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  it('maps the unconfigured provider to the 501 envelope', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');

    const unavailable = await runApi(
      harness.cookieClient(owner.cookie).gifs.trending({ query: {} }),
    ).catch((error: unknown) => error);
    expect(unavailable).toBeInstanceOf(ApiError);
    expect(unavailable).toMatchObject({ status: 501, code: 'gifs_unavailable' });
  });

  it('lets a repeated query key reach the handler guards (no router 400)', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');

    const unavailable = await runApi(
      harness.cookieClient(owner.cookie).gifs.search({ query: { q: ['a', 'b'] } }),
    ).catch((error: unknown) => error);
    expect(unavailable).toMatchObject({ status: 501, code: 'gifs_unavailable' });
  });

  it('answers a missing session before anything else', async () => {
    const anonymous = await runApi(harness.cookieClient('').gifs.search({ query: {} })).catch(
      (error: unknown) => error,
    );
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });
  });

  it('decodes a page the server shape can produce', () => {
    const page = Schema.decodeUnknownSync(GifResultPage)({
      items: [{ id: 'g1', title: 't', mediaToken: 'tok', kind: 'image', width: 1, height: 1 }],
      nextPos: 'n',
    });
    expect(page.items).toHaveLength(1);
  });
});
