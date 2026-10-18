import { describe, expect, it } from 'vitest';

import {
  addRecentSticker,
  isStickerFileUrl,
  MAX_RECENT_STICKERS,
  parseRecentStickers,
  type RecentStickerEntry,
} from './sticker-recents';

const API_ORIGIN = 'https://api.zilar.test';

function entry(id: number): RecentStickerEntry {
  return {
    stickerId: `s${id}`,
    packId: 'pack',
    url: `/api/stickers/s${id}/file`,
  };
}

describe('isStickerFileUrl', () => {
  it('refuses a relative path that escapes /api/stickers', () => {
    expect(isStickerFileUrl('/api/stickers/../auth/file', API_ORIGIN)).toBe(false);
    expect(isStickerFileUrl('/api/stickers/%2e%2e/auth/file', API_ORIGIN)).toBe(false);
    expect(isStickerFileUrl('/api/stickers/%252e%252e/auth/file', API_ORIGIN)).toBe(false);
  });

  it('refuses a file URL on another host', () => {
    expect(isStickerFileUrl('https://evil.test/api/stickers/s1/file', API_ORIGIN)).toBe(false);
  });

  it('accepts a valid relative file path', () => {
    expect(isStickerFileUrl('/api/stickers/s1/file', API_ORIGIN)).toBe(true);
  });

  it('accepts a valid absolute file URL on the API origin', () => {
    expect(isStickerFileUrl(`${API_ORIGIN}/api/stickers/s1/file`, API_ORIGIN)).toBe(true);
  });
});

describe('sticker recents', () => {
  it('keeps the newest first and caps the list at 30', () => {
    let recents: RecentStickerEntry[] = [];
    for (let i = 0; i < MAX_RECENT_STICKERS + 5; i += 1) {
      recents = addRecentSticker(recents, entry(i));
    }
    expect(recents).toHaveLength(MAX_RECENT_STICKERS);
    expect(recents[0]?.stickerId).toBe(`s${MAX_RECENT_STICKERS + 4}`);
    expect(recents[MAX_RECENT_STICKERS - 1]?.stickerId).toBe('s5');
  });

  it('parses valid entries and drops hostile ones', () => {
    const raw = JSON.stringify([
      entry(1),
      { stickerId: '', packId: 'pack', url: '/api/stickers/s2/file' },
      entry(2),
    ]);
    expect(parseRecentStickers(raw).map((item) => item.stickerId)).toEqual(['s1', 's2']);
    expect(parseRecentStickers('not json')).toEqual([]);
  });
});
