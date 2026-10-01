import { describe, expect, it } from 'vitest';

import {
  apiOrigin,
  FALLBACK_STICKER_SIZE,
  isSameOriginStickerUrl,
  readRecentStickers,
  recentChoiceFor,
  rememberRecentSticker,
  resolveActivePackId,
  stickerImageSource,
} from './stickers';

const API = 'http://127.0.0.1:3188';
const FILE = '/api/stickers/223e4567-e89b-12d3-a456-426614174001/file';

describe('isSameOriginStickerUrl', () => {
  it('accepts the relative file path and the same-origin absolute URL', () => {
    expect(isSameOriginStickerUrl(FILE, API)).toBe(true);
    expect(isSameOriginStickerUrl(`http://127.0.0.1:3188${FILE}`, API)).toBe(true);
  });

  it('rejects other hosts, other paths, non-http schemes and blanks', () => {
    expect(isSameOriginStickerUrl('https://evil.test/x.webp', API)).toBe(false);
    expect(isSameOriginStickerUrl('https://127.0.0.1:3188/api/other/file', API)).toBe(false);
    expect(isSameOriginStickerUrl('/api/stickers/abc', API)).toBe(false);
    expect(isSameOriginStickerUrl('data:image/svg+xml,hi', API)).toBe(false);
    expect(isSameOriginStickerUrl('javascript:alert(1)', API)).toBe(false);
    expect(isSameOriginStickerUrl('', API)).toBe(false);
    expect(isSameOriginStickerUrl('   ', API)).toBe(false);
  });
});

describe('apiOrigin', () => {
  it('returns the origin of the build-time server URL', () => {
    expect(apiOrigin('http://127.0.0.1:3188')).toBe('http://127.0.0.1:3188');
    expect(apiOrigin('https://chat.example.com/extra')).toBe('https://chat.example.com');
  });
});

describe('stickerImageSource', () => {
  it('resolves the relative path against the API origin with the bearer token', () => {
    expect(stickerImageSource(FILE, API, 'tok')).toEqual({
      uri: `http://127.0.0.1:3188${FILE}`,
      headers: { authorization: 'Bearer tok' },
    });
  });

  it('sends no auth header without a session', () => {
    expect(stickerImageSource(FILE, API, undefined)).toEqual({
      uri: `http://127.0.0.1:3188${FILE}`,
    });
  });

  it('attaches no bearer token to an off-origin URL', () => {
    expect(stickerImageSource('https://evil.test/x.webp', API, 'tok')).toEqual({
      uri: 'https://evil.test/x.webp',
    });
  });
});

describe('recent stickers', () => {
  const entry = {
    stickerId: 's1',
    packId: 'p1',
    url: FILE,
    emoji: '🐱',
    width: 300,
    height: 200,
    mime: 'image/png' as const,
  };

  it('reads an empty list from missing or hostile data', () => {
    expect(readRecentStickers(null)).toEqual([]);
    expect(readRecentStickers('')).toEqual([]);
    expect(readRecentStickers('not json')).toEqual([]);
    expect(readRecentStickers('{"stickerId":"s1"}')).toEqual([]);
    expect(readRecentStickers(JSON.stringify([{ stickerId: 's1' }]))).toEqual([]);
    expect(readRecentStickers(JSON.stringify([{ ...entry, stickerId: '' }]))).toEqual([]);
    expect(readRecentStickers(JSON.stringify([{ ...entry, url: '' }]))).toEqual([]);
  });

  it('keeps valid entries with the emoji trimmed to 8 chars', () => {
    const raw = JSON.stringify([{ ...entry, emoji: '🐱'.repeat(10) }]);
    expect(readRecentStickers(raw)).toEqual([{ ...entry, emoji: '🐱'.repeat(4) }]);
  });

  it('keeps the real non-square dimensions for a re-send from Recent', () => {
    const [recent] = readRecentStickers(JSON.stringify([entry]));
    expect(recent).toEqual(entry);
    expect(recentChoiceFor(recent!)).toEqual({
      stickerId: 's1',
      packId: 'p1',
      url: FILE,
      emoji: '🐱',
      width: 300,
      height: 200,
      mime: 'image/png',
    });
  });

  it('falls back to a square tile for old entries without dimensions', () => {
    const { width: _width, height: _height, mime: _mime, ...old } = entry;
    expect(readRecentStickers(JSON.stringify([old]))).toEqual([
      { ...old, width: FALLBACK_STICKER_SIZE, height: FALLBACK_STICKER_SIZE, mime: 'image/png' },
    ]);
    expect(
      readRecentStickers(JSON.stringify([{ ...entry, width: 9999, height: 0, mime: 'image/gif' }])),
    ).toEqual([
      { ...entry, width: FALLBACK_STICKER_SIZE, height: FALLBACK_STICKER_SIZE, mime: 'image/png' },
    ]);
  });

  it('caps the list at 30 and moves a re-sent sticker first', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      ...entry,
      stickerId: `s${index}`,
    }));
    expect(readRecentStickers(JSON.stringify(many))).toHaveLength(30);
    const next = rememberRecentSticker([{ ...entry, stickerId: 's2' }], entry);
    expect(next.map((item) => item.stickerId)).toEqual(['s1', 's2']);
  });
});

describe('resolveActivePackId', () => {
  const packs = [
    { id: 'p1', title: 'Cats', stickers: [] },
    { id: 'p2', title: 'Moods', stickers: [] },
  ];
  const recents = [
    {
      stickerId: 's1',
      packId: 'p1',
      url: FILE,
      width: 200,
      height: 200,
      mime: 'image/png' as const,
    },
  ];

  it('keeps the current tab while its pack still exists', () => {
    expect(resolveActivePackId('p2', packs, recents)).toBe('p2');
  });

  it('defaults to the first pack for a user with packs but no recents', () => {
    expect(resolveActivePackId(undefined, packs, [])).toBe('p1');
  });

  it('resets a stale tab to Recent when recents exist, else the first pack', () => {
    expect(resolveActivePackId('gone', packs, recents)).toBeUndefined();
    expect(resolveActivePackId('gone', packs, [])).toBe('p1');
    expect(resolveActivePackId(undefined, [], [])).toBeUndefined();
  });
});
