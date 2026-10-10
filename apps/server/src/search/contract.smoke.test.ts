// The search case of the contract drift detector (T-0894): the client derived
// from `@zilar/api-contract` runs against the real app. The plain smoke
// harness has no archive pool, so this file builds its own app with a fake
// one for the success case and uses the harness for the 501.

import { Effect } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, makeZilarClient, runApi, withFetch } from '@zilar/api-contract';
import { createApp } from '../app';
import { createSmokeHarness, type SmokeHarness } from '../contract-smoke-support';
import { bootstrapUser, TEST_BASE_URL } from '../test-support';
import type { ArchivePool, ArchiveRow } from './service';

const baseHttpClient = Effect.runSync(
  Effect.provide(Effect.service(HttpClient.HttpClient), FetchHttpClient.layer),
);

function hitRow(): ArchiveRow {
  return {
    owner: 'owner',
    peer: 'friend@example.test/r1',
    barePeer: 'friend@example.test',
    kind: 'chat',
    nick: '',
    originId: 'o-1',
    timestamp: 1_785_000_000_000_000,
    headline: '\u0001concert\u0002 tickets are here',
    xml: '<message type="chat"><body>concert tickets are here</body></message>',
  };
}

// Only the main query returns a hit; the edits and fuzzy queries return none.
const archive: ArchivePool = {
  query: (async (text: string) =>
    text.includes('ts_headline') ? [hitRow()] : []) as ArchivePool['query'],
  close: async () => {},
};

describe('api contract smoke: search (T-0894)', () => {
  let harness: SmokeHarness;

  beforeEach(async () => {
    harness = await createSmokeHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  it('searches the archive through the derived client', async () => {
    const { context } = harness;
    const app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      archive,
    });
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const client = Effect.runSync(
      makeZilarClient(
        baseHttpClient.pipe(
          HttpClient.mapRequest(HttpClientRequest.setHeader('cookie', owner.cookie)),
          withFetch((input, init) => app.request(String(input), init)),
        ),
        { baseUrl: TEST_BASE_URL },
      ),
    );

    const page = await runApi(client.search.search({ query: { q: 'concert', limit: 5 } }));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      chatJid: 'friend@example.test',
      messageId: 'o-1',
      snippet: 'concert tickets are here',
      marks: [[0, 7]],
      match: 'exact',
    });
    expect(page.nextBefore).toBeUndefined();
  });

  it('maps the unconfigured archive, an invalid query and a missing session', async () => {
    const { context, app } = harness;
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = harness.cookieClient(owner.cookie);

    const unavailable = await runApi(web.search.search({ query: { q: 'concert' } })).catch(
      (error: unknown) => error,
    );
    expect(unavailable).toBeInstanceOf(ApiError);
    expect(unavailable).toMatchObject({ status: 501, code: 'search_unavailable' });

    const before = harness.requestCount();
    const invalid = await runApi(web.search.search({ query: { q: '', limit: 99 } })).catch(
      (error: unknown) => error,
    );
    expect(invalid).toMatchObject({ status: 400, code: 'invalid_request' });
    expect(harness.requestCount()).toBe(before);

    const anonymous = await runApi(
      harness.cookieClient('').search.search({ query: { q: 'concert' } }),
    ).catch((error: unknown) => error);
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });
  });
});
