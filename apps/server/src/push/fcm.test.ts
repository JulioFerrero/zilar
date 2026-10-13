import { describe, expect, it } from 'vitest';
import { createFcmSender, FcmSendError } from './fcm';
import type { FcmFetch, FcmFetchInit, FcmTokenProvider } from './fcm-token';

const DATA = {
  chatId: 'ana@zilar.localhost',
  chatKind: 'dm' as const,
  messageId: 'origin-1',
  serverId: 'zilar.localhost',
};

const EXPECTED_BODY = {
  message: {
    token: 'device-token',
    data: {
      chatId: 'ana@zilar.localhost',
      chatKind: 'dm',
      messageId: 'origin-1',
      serverId: 'zilar.localhost',
    },
    android: { priority: 'high', ttl: '3600s' },
  },
};

function stubTokens(token = 'access-token'): FcmTokenProvider {
  return { token: () => Promise.resolve(token) };
}

interface CapturedCall {
  url: string;
  init: FcmFetchInit;
}

function captureFetch(respond: () => Response): { calls: CapturedCall[]; fetch: FcmFetch } {
  const calls: CapturedCall[] = [];
  const fetchImpl: FcmFetch = async (url, init) => {
    calls.push({ url, init });
    return respond();
  };
  return { calls, fetch: fetchImpl };
}

function first<T>(items: T[]): T {
  const value = items[0];
  if (value === undefined) {
    throw new Error('expected one captured call');
  }
  return value;
}

function errorBody(code: string, status = 'X'): string {
  return JSON.stringify({ error: { status, details: [{ errorCode: code }] } });
}

describe('FCM sender', () => {
  it('posts a data-only, high-priority, ids-only message', async () => {
    const { calls, fetch: fetchImpl } = captureFetch(() => new Response(null, { status: 200 }));
    const sender = createFcmSender({
      projectId: 'zilar-dev',
      tokens: stubTokens(),
      fetch: fetchImpl,
    });

    const result = await sender.send('device-token', DATA);

    expect(result).toEqual({ gone: false });
    const call = first(calls);
    expect(call.url).toBe('https://fcm.googleapis.com/v1/projects/zilar-dev/messages:send');
    expect(call.init.method).toBe('POST');
    expect(call.init.headers.authorization).toBe('Bearer access-token');
    expect(call.init.headers['content-type']).toBe('application/json');
    const body: unknown = JSON.parse(call.init.body);
    expect(body).toEqual(EXPECTED_BODY);
    expect(body).not.toHaveProperty('message.notification');
  });

  it('maps 404 UNREGISTERED to gone', async () => {
    const { fetch: fetchImpl } = captureFetch(
      () =>
        new Response(errorBody('UNREGISTERED', 'NOT_FOUND'), {
          status: 404,
        }),
    );
    const sender = createFcmSender({
      projectId: 'zilar-dev',
      tokens: stubTokens(),
      fetch: fetchImpl,
    });

    await expect(sender.send('device-token', DATA)).resolves.toEqual({ gone: true });
  });

  const failures: Array<[number, string]> = [
    [400, 'INVALID_ARGUMENT'],
    [403, 'SENDER_ID_MISMATCH'],
    [503, 'UNAVAILABLE'],
  ];

  it.each(failures)('throws for %i %s without secrets in the message', async (status, code) => {
    const bodyMarker = 'provider-body-text';
    const { fetch: fetchImpl } = captureFetch(
      () => new Response(errorBody(code, bodyMarker), { status }),
    );
    const sender = createFcmSender({
      projectId: 'zilar-dev',
      tokens: stubTokens('bearer-secret'),
      fetch: fetchImpl,
    });

    try {
      await sender.send('device-token', DATA);
      throw new Error('expected the send to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(FcmSendError);
      const sendError = error as FcmSendError;
      expect(sendError.status).toBe(status);
      expect(sendError.code).toBe(code);
      expect(sendError.message).not.toContain('device-token');
      expect(sendError.message).not.toContain('bearer-secret');
      expect(sendError.message).not.toContain(bodyMarker);
    }
  });
});
