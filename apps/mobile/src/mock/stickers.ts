import type { StickerPack } from '../lib/stickers';

/**
 * Two built-in demo packs for mock mode (T-0143, the mobile twin of the web
 * `mockDemoStickerPacks`): relative `/api/stickers/:id/file` URLs, so demo
 * stickers send through the same `StickerSchema` validation as real ones.
 * Mobile renders them from the emoji tile (no server bytes in mock mode),
 * like web's panel does for untrusted URLs.
 */

const CATS: Array<[id: string, emoji: string]> = [
  ['21111111-1111-4111-8111-111111111111', '🐱'],
  ['21111111-1111-4111-8111-111111111112', '😹'],
  ['21111111-1111-4111-8111-111111111113', '🙀'],
  ['21111111-1111-4111-8111-111111111114', '😻'],
  ['21111111-1111-4111-8111-111111111115', '🐈'],
  ['21111111-1111-4111-8111-111111111116', '😺'],
];

const MOODS: Array<[id: string, emoji: string]> = [
  ['21111111-1111-4111-8111-111111111221', '😂'],
  ['21111111-1111-4111-8111-111111111222', '🔥'],
  ['21111111-1111-4111-8111-111111111223', '😎'],
  ['21111111-1111-4111-8111-111111111224', '🎉'],
  ['21111111-1111-4111-8111-111111111225', '❤️'],
  ['21111111-1111-4111-8111-111111111226', '👍'],
];

function pack(id: string, title: string, cells: Array<[string, string]>): StickerPack {
  return {
    id,
    title,
    stickers: cells.map(([stickerId, emoji]) => ({
      id: stickerId,
      packId: id,
      url: `/api/stickers/${stickerId}/file`,
      emoji,
      width: 200,
      height: 200,
      mime: 'image/png' as const,
    })),
  };
}

/** The demo packs, rebuilt per call so tests cannot share mutable rows. */
export function mockDemoStickerPacks(): StickerPack[] {
  return [
    pack('11111111-1111-4111-8111-111111111111', 'Cats', CATS),
    pack('11111111-1111-4111-8111-111111111222', 'Moods', MOODS),
  ];
}
