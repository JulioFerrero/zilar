import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { guardedGet } from '../web-tools/guarded-fetch';
import { fetchLinkPreview, resetLinkPreviewCache } from './fetch';
import { parseLinkPreview } from './fetch';

describe('parseLinkPreview', () => {
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
