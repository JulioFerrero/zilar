import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createGalenaAuthClient,
  inviteFetchOptions,
  resolveApiUrl,
  sendSignInCode,
  verifySignInCode,
} from './auth';

interface CapturedRequest {
  url: string;
  headers: Headers;
  body: unknown;
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function capture(requests: CapturedRequest[]): typeof fetch {
  return (async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ url, headers, body });
    if (url.includes('/sign-in/email-otp')) {
      return jsonResponse(
        { token: 'SESSION-TOKEN-abc', user: { id: 'u1', email: 'new@example.com', name: '' } },
        { 'set-auth-token': 'SESSION-TOKEN-abc' },
      );
    }
    return jsonResponse({ success: true });
  }) as typeof fetch;
}

describe('resolveApiUrl', () => {
  it('defaults when the variable is missing or empty', () => {
    expect(resolveApiUrl({})).toBe('http://127.0.0.1:3188');
    expect(resolveApiUrl({ EXPO_PUBLIC_GALENA_API_URL: '' })).toBe('http://127.0.0.1:3188');
  });

  it('uses an explicit server URL', () => {
    expect(resolveApiUrl({ EXPO_PUBLIC_GALENA_API_URL: 'https://chat.example.com' })).toBe(
      'https://chat.example.com',
    );
  });
});

describe('inviteFetchOptions', () => {
  it('adds the invite header only when a code is present', () => {
    expect(inviteFetchOptions(undefined)).toEqual({});
    expect(inviteFetchOptions('')).toEqual({});
    expect(inviteFetchOptions('code-1')).toEqual({ headers: { 'x-galena-invite': 'code-1' } });
  });
});

describe('sign-in requests', () => {
  it('sends the invite header on both the send-code and sign-in calls', async () => {
    const requests: CapturedRequest[] = [];
    const client = createGalenaAuthClient({
      baseURL: 'http://server.test',
      fetchImpl: capture(requests),
    });

    await sendSignInCode(client, 'new@example.com', 'INVITE-123');
    await verifySignInCode(client, 'new@example.com', '123456', 'INVITE-123');

    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toContain('/email-otp/send-verification-otp');
    expect(requests[0]?.headers.get('x-galena-invite')).toBe('INVITE-123');
    expect(requests[1]?.url).toContain('/sign-in/email-otp');
    expect(requests[1]?.headers.get('x-galena-invite')).toBe('INVITE-123');
  });

  it('omits the invite header for an existing user sign-in', async () => {
    const requests: CapturedRequest[] = [];
    const client = createGalenaAuthClient({
      baseURL: 'http://server.test',
      fetchImpl: capture(requests),
    });

    await sendSignInCode(client, 'old@example.com');

    expect(requests[0]?.headers.get('x-galena-invite')).toBeNull();
  });

  it('returns the bearer token from the sign-in response header', async () => {
    const requests: CapturedRequest[] = [];
    const onToken = vi.fn();
    const client = createGalenaAuthClient({
      baseURL: 'http://server.test',
      fetchImpl: capture(requests),
      onToken,
    });

    const result = await verifySignInCode(client, 'new@example.com', '123456', 'INVITE-123');

    expect(result.token).toBe('SESSION-TOKEN-abc');
    expect(onToken).toHaveBeenCalledWith('SESSION-TOKEN-abc');
  });
});

describe('the session token is never logged', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not write the token to the console during verify', async () => {
    const token = 'SESSION-TOKEN-SECRET-abc123';
    const requests: CapturedRequest[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      requests.push({ url, headers: new Headers(init?.headers), body: init?.body });
      return jsonResponse(
        { token, user: { id: 'u1', email: 'new@example.com', name: '' } },
        { 'set-auth-token': token },
      );
    }) as typeof fetch;

    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );

    const client = createGalenaAuthClient({ baseURL: 'http://server.test', fetchImpl });
    await verifySignInCode(client, 'new@example.com', '123456', 'INVITE-123');

    const leaked = spies.some((spy) =>
      spy.mock.calls.some((call) => call.some((argument) => String(argument).includes(token))),
    );
    expect(leaked).toBe(false);
  });
});
