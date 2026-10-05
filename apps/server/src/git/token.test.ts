import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createGitHubAppTokenClient,
  createGitHubAppTokenClientFromConfig,
  GitTokenError,
  type FetchLike,
} from './token';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const APP_ID = '123456';
const INSTALLATION_ID = '9876543210';

type Call = { url: string; init: RequestInit };

function createFetch(handler: (call: Call) => Response): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    const call = { url, init };
    calls.push(call);
    return Promise.resolve(handler(call));
  };
  return { fetchImpl, calls };
}

function tokenResponse(token: string, expiresAt: Date): Response {
  return new Response(JSON.stringify({ token, expires_at: expiresAt.toISOString() }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected the promise to reject');
}

describe('createGitHubAppTokenClient', () => {
  it('reuses a cached token instead of re-minting', async () => {
    const minted = 'ghs_fake_token_1';
    const { fetchImpl, calls } = createFetch(() =>
      tokenResponse(minted, new Date(Date.now() + 60 * 60 * 1000)),
    );
    const client = createGitHubAppTokenClient({
      appId: APP_ID,
      privateKey: PRIVATE_KEY_PEM,
      installationId: INSTALLATION_ID,
      fetch: fetchImpl,
    });

    await expect(client.getToken()).resolves.toBe(minted);
    await expect(client.getToken()).resolves.toBe(minted);

    expect(calls).toHaveLength(1);
  });

  it('re-mints a token inside the refresh window', async () => {
    let now = new Date('2026-09-28T00:00:00Z');
    let sequence = 0;
    const { fetchImpl, calls } = createFetch(() => {
      sequence += 1;
      return tokenResponse(`ghs_token_${sequence}`, new Date(now.getTime() + 10 * 60 * 1000));
    });
    const client = createGitHubAppTokenClient({
      appId: APP_ID,
      privateKey: PRIVATE_KEY_PEM,
      installationId: INSTALLATION_ID,
      fetch: fetchImpl,
      now: () => now,
      refreshWindowMs: 5 * 60 * 1000,
    });

    await expect(client.getToken()).resolves.toBe('ghs_token_1');

    now = new Date(now.getTime() + 7 * 60 * 1000);
    await expect(client.getToken()).resolves.toBe('ghs_token_2');

    expect(calls).toHaveLength(2);
  });

  it('mints through the installation access token endpoint', async () => {
    const { fetchImpl, calls } = createFetch(() =>
      tokenResponse('ghs_token_x', new Date(Date.now() + 60 * 60 * 1000)),
    );
    const client = createGitHubAppTokenClient({
      appId: APP_ID,
      privateKey: PRIVATE_KEY_PEM,
      installationId: INSTALLATION_ID,
      fetch: fetchImpl,
    });

    await client.getToken();

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(
      `https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens`,
    );
    expect(call.init.method).toBe('POST');
    const authorization = new Headers(call.init.headers).get('authorization');
    expect(authorization).toMatch(/^Bearer /);
    expect(authorization).not.toContain(PRIVATE_KEY_PEM);
  });

  it('rejects a non-2xx mint without leaking the private key or installation id', async () => {
    const { fetchImpl } = createFetch(() => new Response('denied', { status: 401 }));
    const client = createGitHubAppTokenClient({
      appId: APP_ID,
      privateKey: PRIVATE_KEY_PEM,
      installationId: INSTALLATION_ID,
      fetch: fetchImpl,
    });

    let caught: unknown;
    try {
      await client.getToken();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GitTokenError);
    const message = caught instanceof Error ? caught.message : '';
    expect(message).toContain('GitHub');
    expect(message).toContain('401');
    expect(message).not.toContain(PRIVATE_KEY_PEM);
    expect(message).not.toContain(INSTALLATION_ID);
    expect(message).not.toContain('PRIVATE KEY');
  });

  it('rejects a network failure without leaking the installation id', async () => {
    const { fetchImpl } = createFetch(() => {
      throw new Error(`connect ECONNREFUSED /app/installations/${INSTALLATION_ID}/access_tokens`);
    });
    const client = createGitHubAppTokenClient({
      appId: APP_ID,
      privateKey: PRIVATE_KEY_PEM,
      installationId: INSTALLATION_ID,
      fetch: fetchImpl,
    });

    const message = await rejectionMessage(client.getToken());

    expect(message).toContain('could not mint');
    expect(message).not.toContain(INSTALLATION_ID);
    expect(message).not.toContain(PRIVATE_KEY_PEM);
  });

  it('rejects an unexpected response shape', async () => {
    const { fetchImpl } = createFetch(() => new Response('{"not":"a token"}', { status: 200 }));
    const client = createGitHubAppTokenClient({
      appId: APP_ID,
      privateKey: PRIVATE_KEY_PEM,
      installationId: INSTALLATION_ID,
      fetch: fetchImpl,
    });

    const message = await rejectionMessage(client.getToken());

    expect(message).toContain('unexpected shape');
  });
});

describe('createGitHubAppTokenClientFromConfig', () => {
  it('fails fast when the GitHub App is not configured', () => {
    expect(() => createGitHubAppTokenClientFromConfig({})).toThrow('GitHub App is not configured');
  });
});
