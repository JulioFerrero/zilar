import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import {
  bootstrapUser,
  createTestContext,
  TEST_BASE_URL,
  type SignedInUser,
  type TestContext,
} from '../test-support';
import { createFakeGifProvider } from './giphy';

async function getRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  user: SignedInUser | undefined,
): Promise<Response> {
  return app.request(`${TEST_BASE_URL}${path}`, {
    headers: user === undefined ? {} : { cookie: user.cookie },
  });
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code ?? '';
}

interface GifItemBody {
  id: string;
  title: string;
  mediaToken: string;
  kind: 'image' | 'video';
  width: number;
  height: number;
}

interface GifPageBody {
  items: GifItemBody[];
  nextPos?: string;
}

describe('gifs routes', () => {
  let context: TestContext;
  let app: ReturnType<typeof createApp>;
  let user: SignedInUser;

  beforeEach(async () => {
    context = await createTestContext();
    // Unconfigured by default: no provider, no key, no injected fake.
    app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
    });
    user = await bootstrapUser(context, app, 'owner@example.com');
  });

  afterEach(async () => {
    await context.close();
  });

  it('501s search and trending when the provider is not configured', async () => {
    for (const path of ['/api/gifs/search?q=cat', '/api/gifs/trending']) {
      const response = await getRequest(app, path, user);
      expect(response.status).toBe(501);
      expect(await errorCode(response)).toBe('gifs_unavailable');
    }
  });

  it('501s the media route when unconfigured, even with a token-shaped path', async () => {
    const response = await getRequest(app, '/api/gifs/media/abc.def', user);
    expect(response.status).toBe(501);
    expect(await errorCode(response)).toBe('gifs_unavailable');
  });

  it('requires a session on every route', async () => {
    for (const path of [
      '/api/gifs/search?q=cat',
      '/api/gifs/trending',
      '/api/gifs/media/abc.def',
    ]) {
      const response = await getRequest(app, path, undefined);
      expect(response.status).toBe(401);
    }
  });
});

describe('gifs routes with a fake provider', () => {
  let context: TestContext;
  let user: SignedInUser;
  let other: SignedInUser;
  let now: number;
  let fetcherCalls: Array<{ url: string; address: string }>;
  let fetchBehavior:
    | { kind: 'ok'; contentType: string; body: Uint8Array }
    | { kind: 'throw'; message: string }
    | { kind: 'status'; status: number };

  function buildApp(): ReturnType<typeof createApp> {
    return createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      gifProvider: createFakeGifProvider(),
      gifMediaFetcher: (url, address) => {
        fetcherCalls.push({ url: url.toString(), address });
        if (fetchBehavior.kind === 'throw') {
          return Promise.reject(new Error(fetchBehavior.message));
        }
        if (fetchBehavior.kind === 'status') {
          return Promise.resolve({
            status: fetchBehavior.status,
            contentType: 'video/mp4',
            body: new Uint8Array(),
          });
        }
        return Promise.resolve({
          status: 200,
          contentType: fetchBehavior.contentType,
          body: fetchBehavior.body,
        });
      },
      gifNow: () => now,
    });
  }

  beforeEach(async () => {
    context = await createTestContext();
    now = 1_700_000_000_000;
    fetcherCalls = [];
    fetchBehavior = {
      kind: 'ok',
      contentType: 'video/mp4',
      body: new Uint8Array([1, 2, 3, 4]),
    };
    const plain = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
    });
    user = await bootstrapUser(context, plain, 'owner@example.com');
    const { contactOf } = await import('../test-support');
    other = await contactOf(context, plain, user.id, 'other@example.com');
  });

  afterEach(async () => {
    await context.close();
  });

  it('searches without provider URLs and paginates', async () => {
    const app = buildApp();
    const response = await getRequest(app, '/api/gifs/search?q=cat', user);
    expect(response.status).toBe(200);
    const body = (await response.json()) as GifPageBody;
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(item.mediaToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      expect(JSON.stringify(item)).not.toContain('giphy.com');
      expect(item.kind === 'image' || item.kind === 'video').toBe(true);
    }
  });

  it('answers trending', async () => {
    const app = buildApp();
    const response = await getRequest(app, '/api/gifs/trending', user);
    expect(response.status).toBe(200);
    const body = (await response.json()) as GifPageBody;
    expect(body.items.length).toBeGreaterThan(0);
  });

  it('400s a missing or overlong query', async () => {
    const app = buildApp();
    const missing = await getRequest(app, '/api/gifs/search', user);
    expect(missing.status).toBe(400);
    const long = await getRequest(app, `/api/gifs/search?q=${'x'.repeat(101)}`, user);
    expect(long.status).toBe(400);
  });

  it('rate limits search and trending at 30 requests per minute per user', async () => {
    const app = buildApp();
    for (let index = 0; index < 30; index += 1) {
      const response = await getRequest(app, '/api/gifs/trending', user);
      expect(response.status).toBe(200);
    }
    const limited = await getRequest(app, '/api/gifs/trending', user);
    expect(limited.status).toBe(429);
    expect(await errorCode(limited)).toBe('rate_limited');
    // Another user still has budget.
    const otherResponse = await getRequest(app, '/api/gifs/trending', other);
    expect(otherResponse.status).toBe(200);
  });

  it('gives media fetches their own higher budget outside the search cap', async () => {
    const app = buildApp();
    const first = await getRequest(app, '/api/gifs/search?q=cat', user);
    expect(first.status).toBe(200);
    const second = await getRequest(app, '/api/gifs/search?q=cats', user);
    expect(second.status).toBe(200);
    const body = (await first.json()) as GifPageBody;
    const token = body.items[0]?.mediaToken ?? '';
    expect(token.length).toBeGreaterThan(0);
    const encoded = encodeURIComponent(token);
    for (let index = 0; index < 50; index += 1) {
      const media = await getRequest(app, `/api/gifs/media/${encoded}`, user);
      expect(media.status).toBe(200);
      await media.arrayBuffer();
    }
    // 52 requests in one minute, all through: media never ate the search budget.
    const trending = await getRequest(app, '/api/gifs/trending', user);
    expect(trending.status).toBe(200);
    // The search cap still bites at its own 30.
    for (let index = 0; index < 27; index += 1) {
      await getRequest(app, '/api/gifs/trending', user);
    }
    const limited = await getRequest(app, '/api/gifs/trending', user);
    expect(limited.status).toBe(429);
    expect(await errorCode(limited)).toBe('rate_limited');
  });

  it('never logs a media token in the request log', async () => {
    const app = buildApp();
    const search = await getRequest(app, '/api/gifs/search?q=cat', user);
    const body = (await search.json()) as GifPageBody;
    const token = body.items[0]?.mediaToken ?? '';
    expect(token.length).toBeGreaterThan(0);
    const media = await getRequest(app, `/api/gifs/media/${encodeURIComponent(token)}`, user);
    expect(media.status).toBe(200);
    await media.arrayBuffer();
    const logs = context.logOutput();
    expect(logs).toContain('/api/gifs/media/:token');
    expect(logs).not.toContain(token);
  });

  it('streams media through the proxy with rebuilt headers', async () => {
    const app = buildApp();
    const search = await getRequest(app, '/api/gifs/search?q=cat', user);
    const body = (await search.json()) as GifPageBody;
    const token = body.items[0]?.mediaToken ?? '';
    const media = await getRequest(app, `/api/gifs/media/${encodeURIComponent(token)}`, user);
    expect(media.status).toBe(200);
    expect(media.headers.get('content-type')).toBe('video/mp4');
    expect(media.headers.get('cache-control')).toBe('private, max-age=86400');
    expect(media.headers.get('x-content-type-options')).toBe('nosniff');
    expect(media.headers.get('set-cookie')).toBeNull();
    expect(new Uint8Array(await media.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    // The token bound the exact provider URL: the fetch went there, not
    // wherever the path named.
    expect(fetcherCalls).toHaveLength(1);
    expect(fetcherCalls[0]?.url).toBe('https://media1.giphy.com/media/fake-1/200w.mp4');
  });

  it('refuses a token for another user and an edited token', async () => {
    const app = buildApp();
    const search = await getRequest(app, '/api/gifs/search?q=cat', user);
    const body = (await search.json()) as GifPageBody;
    const token = body.items[0]?.mediaToken ?? '';
    const wrongUser = await getRequest(app, `/api/gifs/media/${encodeURIComponent(token)}`, other);
    expect(wrongUser.status).toBe(404);
    const edited = await getRequest(
      app,
      `/api/gifs/media/${encodeURIComponent(`${token}x`)}`,
      user,
    );
    expect(edited.status).toBe(404);
  });

  it('expires tokens after 15 minutes', async () => {
    const app = buildApp();
    const search = await getRequest(app, '/api/gifs/search?q=cat', user);
    const body = (await search.json()) as GifPageBody;
    const token = body.items[0]?.mediaToken ?? '';
    now += 15 * 60 * 1000 + 1;
    const expired = await getRequest(app, `/api/gifs/media/${encodeURIComponent(token)}`, user);
    expect(expired.status).toBe(404);
  });

  it('502s a wrong content type, a provider error, and a fetch failure', async () => {
    const app = buildApp();
    const search = await getRequest(app, '/api/gifs/search?q=cat', user);
    const body = (await search.json()) as GifPageBody;
    const token = body.items[0]?.mediaToken ?? '';
    const encoded = encodeURIComponent(token);

    fetchBehavior = { kind: 'ok', contentType: 'text/html', body: new Uint8Array([1]) };
    const wrongType = await getRequest(app, `/api/gifs/media/${encoded}`, user);
    expect(wrongType.status).toBe(502);

    fetchBehavior = { kind: 'status', status: 500 };
    const providerError = await getRequest(app, `/api/gifs/media/${encoded}`, user);
    expect(providerError.status).toBe(502);

    fetchBehavior = { kind: 'throw', message: 'redirect refused' };
    const failed = await getRequest(app, `/api/gifs/media/${encoded}`, user);
    expect(failed.status).toBe(502);
  });

  it('never logs the query text or the key', async () => {
    const app = buildApp();
    const secretQuery = 'supercalifragilisticquerytext';
    await getRequest(app, `/api/gifs/search?q=${secretQuery}`, user);
    const search = await getRequest(app, '/api/gifs/search?q=cat', user);
    const body = (await search.json()) as GifPageBody;
    expect(body.items.length).toBeGreaterThan(0);
    const logs = context.logOutput();
    expect(logs).not.toContain(secretQuery);
    expect(logs).not.toContain('test-key');
  });

  it('refuses redirects, caps the body, and times out through the real proxy fetch', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createServer } = await import('node:https');
    const { fetchProxiedMedia } = await import('./routes');
    const dir = mkdtempSync(join(tmpdir(), 'galena-gif-proxy-'));
    try {
      execFileSync('openssl', [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-keyout',
        join(dir, 'k.pem'),
        '-out',
        join(dir, 'c.pem'),
        '-days',
        '1',
        '-nodes',
        '-subj',
        '/CN=media1.giphy.com',
      ]);
      const server = createServer(
        { key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) },
        (req, res) => {
          if (req.url === '/redirect') {
            res.writeHead(302, { location: 'https://evil.example/x' });
            res.end();
            return;
          }
          if (req.url === '/big') {
            res.writeHead(200, { 'content-type': 'video/mp4' });
            res.write(Buffer.alloc(4, 1));
            setTimeout(() => res.end(Buffer.alloc(60, 1)), 50);
            return;
          }
          if (req.url === '/slow') {
            return;
          }
          res.writeHead(200, { 'content-type': 'video/mp4' });
          res.end(Buffer.from([9, 9]));
        },
      );
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const testPort = (server.address() as { port: number }).port;
      const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      try {
        const host = 'media1.giphy.com';
        await expect(
          fetchProxiedMedia(new URL(`https://${host}/redirect`), '127.0.0.1', {
            timeoutMs: 2000,
            maxBytes: 1024,
            port: testPort,
          }),
        ).rejects.toThrow('redirect refused');
        await expect(
          fetchProxiedMedia(new URL(`https://${host}/big`), '127.0.0.1', {
            timeoutMs: 2000,
            maxBytes: 8,
            port: testPort,
          }),
        ).rejects.toThrow('response too large');
        await expect(
          fetchProxiedMedia(new URL(`https://${host}/slow`), '127.0.0.1', {
            timeoutMs: 100,
            maxBytes: 1024,
            port: testPort,
          }),
        ).rejects.toThrow('fetch timeout');
      } finally {
        if (previous === undefined) {
          delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        } else {
          process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
        }
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
