import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import {
  testApp,
  bootstrapUser,
  createTestContext,
  TEST_BASE_URL,
  type TestContext,
} from '../test-support';
import { guardedGet } from '../web-tools/guarded-fetch';
import { fetchLinkPreview, resetLinkPreviewCache } from './fetch';
import { parseLinkPreview } from './fetch';

describe('parseLinkPreview', () => {
  it('picks og: over twitter: over <title> and caps the lengths', () => {
    const html = `<!doctype html><html><head>
      <title>plain title</title>
      <meta name="twitter:title" content="twitter title">
      <meta property="og:title" content="og title">
      <meta name="description" content="plain description">
      <meta content="${'d'.repeat(400)}" property="og:description">
      <meta property="og:site_name" content="Example Site">
    </head><body>ignored</body></html>`;

    const preview = parseLinkPreview(html);

    expect(preview?.title).toBe('og title');
    expect(preview?.description).toHaveLength(300);
    expect(preview?.description?.startsWith('ddd')).toBe(true);
    expect(preview?.siteName).toBe('Example Site');
  });

  it('falls back to <title> and answers null when there is no title and no description', () => {
    expect(parseLinkPreview('<html><head><title>Fallback &amp; OK</title></head></html>')).toEqual({
      title: 'Fallback & OK',
    });
    expect(
      parseLinkPreview('<html><head><meta name="robots" content="index"></head></html>'),
    ).toBeNull();
  });

  it('resolves an og:image against the page and drops an http image', () => {
    const relative = `<meta property="og:image" content="/cover.png">
      <meta property="og:title" content="A page">`;
    expect(parseLinkPreview(relative, 'https://example.com/post')?.imageUrl).toBe(
      'https://example.com/cover.png',
    );

    const insecure = `<meta property="og:image" content="http://cdn.example.com/a.png">
      <meta property="og:title" content="A page">`;
    expect(parseLinkPreview(insecure, 'https://example.com/post')?.imageUrl).toBeUndefined();
  });
});

describe('fetchLinkPreview', () => {
  it('reads the title of a page larger than the 512 KB cap', async () => {
    resetLinkPreviewCache();
    const html = `<!doctype html><html><head><meta property="og:title" content="Big Page Title"></head><body>${'x'.repeat(600 * 1024)}</body></html>`;
    const fetcher = async () => ({
      ok: true as const,
      body: {
        status: 200,
        contentType: 'text/html',
        location: null,
        text: html,
        bytes: new Uint8Array(0),
      },
    });

    const preview = await Effect.runPromise(
      fetchLinkPreview('https://example.com/big', { fetcher }),
    );

    expect(preview?.title).toBe('Big Page Title');
  });

  it('never exposes the remote image URL', async () => {
    resetLinkPreviewCache();
    const html = `<meta property="og:title" content="A page">
      <meta property="og:image" content="https://cdn.example.com/secret.png">`;
    const fetcher = async () => ({
      ok: true as const,
      body: {
        status: 200,
        contentType: 'text/html',
        location: null,
        text: html,
        bytes: new Uint8Array(0),
      },
    });

    const preview = await Effect.runPromise(
      fetchLinkPreview('https://example.com/page', { fetcher }),
    );

    expect(preview?.image).toMatch(/^\/api\/link-preview\/image\//);
    expect(JSON.stringify(preview)).not.toContain('cdn.example.com');
  });
});

describe('guardedGet with anyPublicHost', () => {
  it('still refuses a host that resolves to a private address', async () => {
    const result = await guardedGet('https://example.com/', {
      allowedHosts: [],
      anyPublicHost: true,
      resolver: async () => ['10.0.0.1'],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.summary).toBe('host not allowed');
    }
  });

  it('refuses an image/svg+xml answer when only image types are allowed', async () => {
    const result = await guardedGet('https://example.com/logo.svg', {
      allowedHosts: [],
      anyPublicHost: true,
      allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      resolver: async () => ['1.1.1.1'],
      fetcher: async () => ({
        response: { status: 200, rawContentType: 'image/svg+xml', location: null },
        raw: new Uint8Array([1, 2, 3]),
      }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.summary).toBe('unsupported content type image/svg+xml');
    }
  });
});

describe('GET /api/link-preview', () => {
  let context: TestContext;
  let app: ReturnType<typeof testApp>;

  beforeEach(async () => {
    context = await createTestContext();
    app = testApp(context);
  });

  afterEach(async () => {
    await context.close();
  });

  it('answers 401 without a session', async () => {
    const response = await app.request(
      `${TEST_BASE_URL}/api/link-preview?url=${encodeURIComponent('https://example.com/')}`,
    );

    expect(response.status).toBe(401);
  });

  it('answers 400 for an http URL', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');

    const response = await app.request(
      `${TEST_BASE_URL}/api/link-preview?url=${encodeURIComponent('http://example.com/')}`,
      { headers: { cookie: alice.cookie } },
    );

    expect(response.status).toBe(400);
  });

  it('answers 401 without a session and 404 for an unknown image key', async () => {
    const noSession = await app.request(`${TEST_BASE_URL}/api/link-preview/image/unknown-key`);
    expect(noSession.status).toBe(401);

    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const unknownKey = await app.request(`${TEST_BASE_URL}/api/link-preview/image/unknown-key`, {
      headers: { cookie: alice.cookie },
    });
    expect(unknownKey.status).toBe(404);
  });
});
