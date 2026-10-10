import { describe, expect, it } from 'vitest';
import { Effect, Schema } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { ApiError, apiErrorFromBody } from './errors';
import { makeZilarClient, runApi, toApiError, withFetch } from './client';
import { Pin } from './pins';

const PIN = {
  id: 'pin-1',
  chat: 'ana@zilar.test',
  messageId: 'm-1',
  senderName: 'Ana',
  text: 'hi',
  kind: 'text',
  pinnedBy: 'u-1',
  pinnedAt: '2026-10-09T00:00:00Z',
};

const baseHttpClient = Effect.runSync(
  Effect.provide(Effect.service(HttpClient.HttpClient), FetchHttpClient.layer),
);

function clientAnswering(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return respond(String(input), init);
  };
  const client = Effect.runSync(
    makeZilarClient(baseHttpClient.pipe(withFetch(fetch)), { baseUrl: 'http://zilar.test' }),
  );
  return { client, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('apiErrorFromBody', () => {
  it('keeps code, message and detail, minus the requestId', () => {
    const error = apiErrorFromBody(429, {
      error: { code: 'rate_limited', message: 'Slow down', requestId: 'r-1', retryAfter: 3 },
    });
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: 'rate_limited', message: 'Slow down' });
    expect(error.detail).toEqual({ retryAfter: 3 });
  });

  it('falls back to request_failed for a body that is not the envelope', () => {
    expect(apiErrorFromBody(502, '<html>')).toMatchObject({
      status: 502,
      code: 'request_failed',
      message: 'Request failed (502)',
    });
  });
});

describe('the derived client', () => {
  it('sends the JSON payload as a string with the json headers', async () => {
    const { client, calls } = clientAnswering(() => json(PIN, 201));
    const created = await runApi(
      client.pins.create({
        payload: { chat: 'ana@zilar.test', messageId: 'm-1', senderName: 'Ana' },
      }),
    );
    expect(created).toEqual(PIN);
    expect(calls[0]?.url).toBe('http://zilar.test/api/pins');
    expect(calls[0]?.init.body).toBe(
      '{"chat":"ana@zilar.test","messageId":"m-1","senderName":"Ana"}',
    );
    expect(calls[0]?.init.headers).toMatchObject({
      accept: 'application/json',
      'content-type': 'application/json',
    });
  });

  it('maps an error status, a transport failure and an undeclared status', async () => {
    const failed = clientAnswering(() =>
      json({ error: { code: 'pin_limit', message: 'Full' } }, 400),
    );
    await expect(runApi(failed.client.pins.list({ query: { chat: 'x' } }))).rejects.toMatchObject({
      status: 400,
      code: 'pin_limit',
      message: 'Full',
    });

    const offline = clientAnswering(() => Promise.reject(new Error('offline')));
    await expect(runApi(offline.client.pins.list({ query: { chat: 'x' } }))).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
    });

    const drifted = clientAnswering(() => json(PIN, 200));
    await expect(
      runApi(
        drifted.client.pins.create({ payload: { chat: 'x', messageId: 'm', senderName: 'A' } }),
      ),
    ).rejects.toMatchObject({ status: 200, code: 'invalid_response' });
  });

  it('rejects a malformed success body as invalid_response', async () => {
    const { client } = clientAnswering(() => json({ pins: [{ ...PIN, messageId: 7 }] }));
    await expect(runApi(client.pins.list({ query: { chat: 'x' } }))).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('rejects an invalid payload before sending it', async () => {
    const { client, calls } = clientAnswering(() => json(PIN, 201));
    await expect(
      runApi(client.pins.create({ payload: { chat: '', messageId: 'm', senderName: 'A' } })),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
    expect(calls).toHaveLength(0);
  });
});

describe('the lenient pin kind', () => {
  it('decodes an unknown kind to text and encodes only known kinds', () => {
    expect(Schema.decodeUnknownSync(Pin)({ ...PIN, kind: 'sticker' }).kind).toBe('text');
    expect(Schema.decodeUnknownSync(Pin)({ ...PIN, kind: 'voice' }).kind).toBe('voice');
    expect(() => Schema.encodeUnknownSync(Pin)({ ...PIN, kind: 'sticker' })).toThrow();
  });
});

describe('toApiError', () => {
  it('passes an ApiError through and maps anything else to request_failed', () => {
    const error = new ApiError(409, 'pin_exists', 'Already pinned');
    expect(toApiError(error)).toBe(error);
    expect(toApiError(new Error('boom'))).toMatchObject({ status: 0, code: 'request_failed' });
  });
});
