import { describe, expect, it } from 'vitest';
import {
  MAX_RECENT_STICKERS,
  readRecentStickers,
  RECENT_STICKERS_KEY,
  rememberRecentSticker,
  type RecentStickerEntry,
} from './stickers';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function entry(id: string): RecentStickerEntry {
  return { stickerId: id, packId: 'pack-1', url: `/api/stickers/${id}/file`, emoji: '🐱' };
}

describe('readRecentStickers', () => {
  it('returns an empty list when nothing is stored', () => {
    expect(readRecentStickers(memoryStorage())).toEqual([]);
    expect(readRecentStickers(null)).toEqual([]);
  });

  it('reads stored recents', () => {
    const storage = memoryStorage({
      [RECENT_STICKERS_KEY]: JSON.stringify([entry('a'), entry('b')]),
    });
    expect(readRecentStickers(storage).map((item) => item.stickerId)).toEqual(['a', 'b']);
  });

  it('ignores hostile stored data', () => {
    for (const hostile of [
      'not json{{{',
      '42',
      '"a string"',
      JSON.stringify({ stickerId: 'a' }),
      JSON.stringify([null, 42, { stickerId: '', packId: 'p', url: 'u' }, { nope: true }]),
      JSON.stringify([{ stickerId: 'a'.repeat(500), packId: 'p', url: 'u' }]),
    ]) {
      expect(readRecentStickers(memoryStorage({ [RECENT_STICKERS_KEY]: hostile }))).toEqual([]);
    }
  });

  it('caps hostile arrays at 30', () => {
    const many = Array.from({ length: 500 }, (_, index) => entry(`s-${index}`));
    const storage = memoryStorage({ [RECENT_STICKERS_KEY]: JSON.stringify(many) });
    expect(readRecentStickers(storage)).toHaveLength(MAX_RECENT_STICKERS);
  });
});

describe('rememberRecentSticker', () => {
  it('records the sent sticker first and dedupes', () => {
    const storage = memoryStorage();
    rememberRecentSticker(storage, entry('a'));
    rememberRecentSticker(storage, entry('b'));
    const next = rememberRecentSticker(storage, entry('a'));
    expect(next.map((item) => item.stickerId)).toEqual(['a', 'b']);
  });

  it('keeps at most 30', () => {
    const storage = memoryStorage();
    for (let index = 0; index < 40; index += 1) {
      rememberRecentSticker(storage, entry(`s-${index}`));
    }
    expect(readRecentStickers(storage)).toHaveLength(MAX_RECENT_STICKERS);
    expect(readRecentStickers(storage)[0]?.stickerId).toBe('s-39');
  });

  it('never throws when storage is blocked', () => {
    const blocked: Storage = {
      get length() {
        return 0;
      },
      clear: () => {},
      getItem: () => {
        throw new Error('blocked');
      },
      key: () => null,
      removeItem: () => {},
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(rememberRecentSticker(blocked, entry('a'))).toEqual([entry('a')]);
  });
});
