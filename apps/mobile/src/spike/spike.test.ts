import { describe, expect, it, vi } from 'vitest';

import { readSpikeEnv } from './config';
import { requestXmppToken, XmppTokenError } from './fetch-token';
import { atobPolyfill, btoaPolyfill, randomUuid } from './polyfills';

describe('readSpikeEnv', () => {
  it('applies defaults when nothing is set', () => {
    expect(readSpikeEnv({})).toEqual({
      service: 'ws://127.0.0.1:5280/ws',
      domain: 'galena.localhost',
      apiUrl: 'http://127.0.0.1:3188',
      selfJid: '',
      selfToken: '',
      peerJid: '',
      peerToken: '',
    });
  });

  it('reads every variable', () => {
    expect(
      readSpikeEnv({
        EXPO_PUBLIC_SPIKE_SERVICE: 'wss://example.com/ws',
        EXPO_PUBLIC_SPIKE_DOMAIN: 'example.com',
        EXPO_PUBLIC_SPIKE_API_URL: 'http://example.com:9999',
        EXPO_PUBLIC_SPIKE_SELF_JID: 'me@example.com',
        EXPO_PUBLIC_SPIKE_SELF_TOKEN: 'tok',
        EXPO_PUBLIC_SPIKE_PEER_JID: 'you@example.com',
        EXPO_PUBLIC_SPIKE_PEER_TOKEN: 'peer-tok',
      }),
    ).toEqual({
      service: 'wss://example.com/ws',
      domain: 'example.com',
      apiUrl: 'http://example.com:9999',
      selfJid: 'me@example.com',
      selfToken: 'tok',
      peerJid: 'you@example.com',
      peerToken: 'peer-tok',
    });
  });
});

describe('requestXmppToken', () => {
  const response = {
    jid: 'me@galena.localhost',
    token: 'jwt',
    expiresAt: '2026-01-01T00:00:00.000Z',
    service: 'ws://127.0.0.1:5280/ws',
    domain: 'galena.localhost',
    mucDomain: 'rooms.galena.localhost',
  };

  it('POSTs with the bearer token and returns the parsed body', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => response,
    })) as unknown as typeof globalThis.fetch;

    const result = await requestXmppToken('http://localhost:3188', 'session', fetch);

    expect(fetch).toHaveBeenCalledWith('http://localhost:3188/api/xmpp/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer session',
      },
    });
    expect(result).toEqual(response);
  });

  it('rejects a non-2xx with the server error message', async () => {
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: 'unauthorized', message: 'Authentication required' } }),
    })) as unknown as typeof globalThis.fetch;

    await expect(requestXmppToken('http://localhost:3188', 'bad', fetch)).rejects.toMatchObject({
      name: 'XmppTokenError',
      status: 401,
    });
  });

  it('rejects an unexpected body shape', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ nope: true }),
    })) as unknown as typeof globalThis.fetch;

    await expect(
      requestXmppToken('http://localhost:3188', 'session', fetch),
    ).rejects.toBeInstanceOf(XmppTokenError);
  });
});

describe('base64 polyfill', () => {
  it('round-trips a SASL-like payload', () => {
    const input = '\u0000me@galena.localhost\u0000secret-token';
    expect(atobPolyfill(btoaPolyfill(input))).toBe(input);
  });

  it('matches known base64', () => {
    expect(btoaPolyfill('hello')).toBe('aGVsbG8=');
    expect(atobPolyfill('aGVsbG8=')).toBe('hello');
  });
});

describe('randomUuid', () => {
  it('returns a v4 UUID without recursing', () => {
    const value = randomUuid();
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
