import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../errors';
import type { FetchLike } from './proxy';
import { createGitRoutes } from './routes';
import type { GitHubAppTokenClient } from './token';

const BASE = 'http://localhost:3000';
const UPSTREAM = 'https://github.com';
const TOKEN = 'ghs_proxy_token';

type Call = { url: string; init: RequestInit };

function tokenClient(token: string): GitHubAppTokenClient {
  return { getToken: () => Promise.resolve(token) };
}

function createFetch(handler: (call: Call) => Response): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    const call = { url, init };
    calls.push(call);
    return Promise.resolve(handler(call));
  };
  return { fetchImpl, calls };
}

function buildApp(fetchImpl: FetchLike): Hono {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status);
    }
    return c.json({ error: { code: 'internal_error', message: 'Internal server error' } }, 500);
  });
  app.route(
    '/git',
    createGitRoutes({
      aiName: 'alice',
      tokenClient: tokenClient(TOKEN),
      upstreamBaseUrl: UPSTREAM,
      fetch: fetchImpl,
    }),
  );
  return app;
}

function pktLine(text: string): string {
  return (text.length + 4).toString(16).padStart(4, '0') + text;
}

const OLD_OID = '0000000000000000000000000000000000000000';
const NEW_OID = '1111111111111111111111111111111111111111';

function commandLine(ref: string, withCapabilities: boolean): string {
  const line = `${OLD_OID} ${NEW_OID} ${ref}`;
  return withCapabilities ? `${line}\0report-status side-band-64k ofs-delta` : line;
}

function receivePackBody(refs: string[]): Uint8Array {
  const commands = refs.map((ref, index) => commandLine(ref, index === 0));
  const body = commands.map((command) => pktLine(command)).join('') + '0000PACK';
  return new TextEncoder().encode(body);
}

function receivePackBodyFromCommands(commands: string[]): Uint8Array {
  const body = commands.map((command) => pktLine(command)).join('') + '0000PACK';
  return new TextEncoder().encode(body);
}

describe('git proxy', () => {
  it('forwards a push to an allowed branch with the injected token', async () => {
    const { fetchImpl, calls } = createFetch(() => new Response('ok', { status: 200 }));
    const app = buildApp(fetchImpl);

    const res = await app.request(`${BASE}/git/acme/repo.git/git-receive-pack`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-git-receive-pack-request',
        authorization: 'Basic c21pZnVsOmNyZWRz',
      },
      body: receivePackBody(['refs/heads/agent/alice/feature']),
    });

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://github.com/acme/repo.git/git-receive-pack');
    expect(call.init.method).toBe('POST');
    const headers = new Headers(call.init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('refuses a push to main and never calls the upstream', async () => {
    const { fetchImpl, calls } = createFetch(() => new Response('nope', { status: 200 }));
    const app = buildApp(fetchImpl);

    const res = await app.request(`${BASE}/git/acme/repo.git/git-receive-pack`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-git-receive-pack-request' },
      body: receivePackBody(['refs/heads/main']),
    });

    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
    expect(await res.json()).toMatchObject({ error: { code: 'push_rejected' } });
  });

  it("refuses a push to another AI's branch", async () => {
    const { fetchImpl, calls } = createFetch(() => new Response('nope', { status: 200 }));
    const app = buildApp(fetchImpl);

    const res = await app.request(`${BASE}/git/acme/repo.git/git-receive-pack`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-git-receive-pack-request' },
      body: receivePackBody(['refs/heads/agent/bob/feature']),
    });

    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('refuses a tag push', async () => {
    const { fetchImpl, calls } = createFetch(() => new Response('nope', { status: 200 }));
    const app = buildApp(fetchImpl);

    const res = await app.request(`${BASE}/git/acme/repo.git/git-receive-pack`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-git-receive-pack-request' },
      body: receivePackBody(['refs/tags/v1.0.0']),
    });

    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('refuses an unreadable receive-pack body and never calls the upstream', async () => {
    const { fetchImpl, calls } = createFetch(() => new Response('nope', { status: 200 }));
    const app = buildApp(fetchImpl);

    const res = await app.request(`${BASE}/git/acme/repo.git/git-receive-pack`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-git-receive-pack-request' },
      body: new TextEncoder().encode('not a pkt-line'),
    });

    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
    expect(await res.json()).toMatchObject({ error: { code: 'push_rejected' } });
  });

  it('refuses a receive-pack body that yields no refs', async () => {
    const { fetchImpl, calls } = createFetch(() => new Response('nope', { status: 200 }));
    const app = buildApp(fetchImpl);

    const res = await app.request(`${BASE}/git/acme/repo.git/git-receive-pack`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-git-receive-pack-request' },
      body: new TextEncoder().encode('0000PACK'),
    });

    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('refuses a body with one good and one malformed ref', async () => {
    const { fetchImpl, calls } = createFetch(() => new Response('nope', { status: 200 }));
    const app = buildApp(fetchImpl);

    const res = await app.request(`${BASE}/git/acme/repo.git/git-receive-pack`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-git-receive-pack-request' },
      body: receivePackBodyFromCommands([
        commandLine('refs/heads/agent/alice/feature', true),
        `${OLD_OID} ${NEW_OID}`,
      ]),
    });

    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('allows a clone/fetch (git-upload-pack)', async () => {
    const { fetchImpl, calls } = createFetch(() => new Response('ok', { status: 200 }));
    const app = buildApp(fetchImpl);

    const res = await app.request(`${BASE}/git/acme/repo.git/info/refs?service=git-upload-pack`);

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://github.com/acme/repo.git/info/refs?service=git-upload-pack');
    expect(new Headers(call.init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
  });
});
