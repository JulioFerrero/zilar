import { StickerSchema } from '@zilar/protocol';
import { describe, expect, it } from 'vitest';

import { mockDemoStickerPacks } from './stickers';

describe('mock demo sticker packs', () => {
  it('ships two packs of relative-URL stickers that pass StickerSchema', () => {
    const packs = mockDemoStickerPacks();
    expect(packs).toHaveLength(2);
    for (const pack of packs) {
      expect(pack.stickers.length).toBeGreaterThan(0);
      for (const sticker of pack.stickers) {
        expect(sticker.url.startsWith('data:')).toBe(false);
        expect(
          StickerSchema.safeParse({
            pack_id: pack.id,
            sticker_id: sticker.id,
            url: sticker.url,
            emoji: sticker.emoji,
            width: sticker.width,
            height: sticker.height,
            mime: sticker.mime,
          }).success,
        ).toBe(true);
      }
    }
  });

  it('rebuilds fresh rows per call', () => {
    const first = mockDemoStickerPacks();
    const second = mockDemoStickerPacks();
    expect(first).toEqual(second);
    expect(first[0]).not.toBe(second[0]);
  });
});
