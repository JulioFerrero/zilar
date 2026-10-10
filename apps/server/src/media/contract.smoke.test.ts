// The media case of the contract drift detector (T-0895): the client derived
// from `@zilar/api-contract` runs against the real app. The harness app has no
// message archive, so this covers the error envelope: session first, then the
// 501 before the query is decoded. `gallery` declares no query (the server
// decodes it by hand after the archive check), so the success page is covered
// by `routes.test.ts`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Schema } from 'effect';
import { ApiError, MediaPage, runApi } from '@zilar/api-contract';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser } from '../test-support';

describe('api contract smoke: media (T-0895)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  it('maps the missing archive to the 501 envelope', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');

    const unavailable = await runApi(
      harness.bearerClient(owner.bearer).media.gallery({ query: {} }),
    ).catch((error: unknown) => error);
    expect(unavailable).toBeInstanceOf(ApiError);
    expect(unavailable).toMatchObject({ status: 501, code: 'media_unavailable' });
  });

  it('answers a missing session before anything else', async () => {
    const anonymous = await runApi(harness.cookieClient('').media.gallery({ query: {} })).catch(
      (error: unknown) => error,
    );
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });
  });

  it('decodes a page without optional fields', () => {
    const page = Schema.decodeUnknownSync(MediaPage)({
      items: [
        {
          messageId: 'm1',
          chat: 'c',
          at: '2026-01-01T00:00:00.000Z',
          senderName: 'A',
          kind: 'file',
        },
      ],
      next: null,
    });
    expect(page.items[0]?.url).toBeUndefined();
  });
});
