import type { MockSeed } from '../../data';
import type { MockData } from '../../state';
import type { MockSticker, MockStickerPack } from './seed';

function cloneSticker(sticker: MockSticker): MockSticker {
  return { ...sticker };
}

function clonePack(pack: MockStickerPack): MockStickerPack {
  return { ...pack, stickers: pack.stickers.map(cloneSticker) };
}

/**
 * The sticker packs, the panel order, the favorite ids and the sequence that
 * mints new pack/sticker ids. Rows are cloned from the seed, so a caller's seed
 * is never changed and the panel/favorite edits mutate the live copy.
 */
export function createStickersState(seed: MockSeed): Partial<MockData> {
  return {
    stickerPacks: seed.stickerPacks.map(clonePack),
    stickerPanel: [...seed.stickerPanel],
    stickerFavorites: [...seed.stickerFavorites],
    nextStickerSequence: 1,
  };
}
