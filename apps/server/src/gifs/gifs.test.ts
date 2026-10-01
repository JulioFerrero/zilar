import { describe, expect, it } from 'vitest';
import { parseGiphyResponse } from './giphy';
import { createFakeGifProvider } from './giphy';
import { createGifTokenIssuer } from './token';

function gifObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'abc123',
    title: 'A dancing cat',
    images: {
      fixed_width: {
        url: 'https://media1.giphy.com/media/abc123/200w.gif',
        mp4: 'https://media1.giphy.com/media/abc123/200w.mp4',
        width: '200',
        height: '150',
        size: '12345',
        mp4_size: '9999',
      },
      original: {
        url: 'https://media1.giphy.com/media/abc123/giphy.gif',
        width: '480',
        height: '360',
      },
    },
    ...overrides,
  };
}

describe('parseGiphyResponse', () => {
  it('parses one playable item and the next page', () => {
    const page = parseGiphyResponse({
      data: [gifObject()],
      pagination: { offset: 0, count: 1, total_count: 50 },
      meta: { status: 200, msg: 'OK' },
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: 'abc123',
      title: 'A dancing cat',
      previewUrl: 'https://media1.giphy.com/media/abc123/200w.gif',
      mp4Url: 'https://media1.giphy.com/media/abc123/200w.mp4',
      width: 200,
      height: 150,
    });
    expect(page.nextPos).toBe('1');
  });

  it('caps the title at 100 characters', () => {
    const page = parseGiphyResponse({
      data: [gifObject({ title: 'x'.repeat(500) })],
      pagination: { offset: 0, count: 1, total_count: 1 },
    });
    expect(page.items[0]?.title).toHaveLength(100);
  });

  it('drops items whose media URLs are off the allowlist', () => {
    const page = parseGiphyResponse({
      data: [
        gifObject({
          images: {
            fixed_width: {
              url: 'https://evil.example/tracker.gif',
              width: '200',
              height: '150',
            },
          },
        }),
        gifObject({
          id: 'http-only',
          images: {
            fixed_width: {
              url: 'http://media1.giphy.com/media/http-only/200w.gif',
              width: '200',
              height: '150',
            },
          },
        }),
        gifObject({ id: 'kept' }),
      ],
      pagination: { offset: 0, count: 3, total_count: 3 },
    });
    expect(page.items.map((item) => item.id)).toEqual(['kept']);
  });

  it('drops hostile shapes without throwing', () => {
    const page = parseGiphyResponse({
      data: [null, 42, 'gif', { images: null }, gifObject({ id: 'ok' })],
      pagination: {},
    });
    expect(page.items.map((item) => item.id)).toEqual(['ok']);
  });

  it('returns an empty page for a non-object body', () => {
    expect(parseGiphyResponse(null)).toEqual({ items: [] });
    expect(parseGiphyResponse('oops')).toEqual({ items: [] });
  });
});

describe('createFakeGifProvider', () => {
  it('searches and paginates without the network', async () => {
    const provider = createFakeGifProvider();
    expect(provider.name).toBe('fake');
    const first = await provider.search('fake', { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextPos).toBeDefined();
    const trending = await provider.trending({ limit: 10 });
    expect(trending.items.length).toBeGreaterThan(0);
  });
});

describe('createGifTokenIssuer', () => {
  it('round-trips, binds the user and the URL, and expires', () => {
    const now = { value: 1_000_000 };
    const issuer = createGifTokenIssuer({ secret: 'test-secret', now: () => now.value });
    const token = issuer.issue('user-a', 'https://media1.giphy.com/media/x/200w.mp4');
    expect(issuer.verify(token, 'user-a')).toBe('https://media1.giphy.com/media/x/200w.mp4');
    expect(issuer.verify(token, 'user-b')).toBeUndefined();
    expect(issuer.verify(`${token}x`, 'user-a')).toBeUndefined();
    now.value += 15 * 60 * 1000 + 1;
    expect(issuer.verify(token, 'user-a')).toBeUndefined();
  });
});
