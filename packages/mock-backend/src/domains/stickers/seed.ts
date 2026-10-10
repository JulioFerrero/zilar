// The stickers seed (T-1046): the two demo packs web and mobile already ship
// (`apps/web/src/mock/helpers.ts:110`, `apps/mobile/src/mock/stickers.ts:46`),
// as contract `StickerPack` rows. Sticker files are generated SVG art served
// from the in-memory `GET /stickers/:stickerId/file` route, so a panel renders
// with no network and never a peer-supplied address.
import type { MockSeed } from '../../data';
import { currentUser } from '../../data/people';

/** One sticker row, mirroring the contract's `Sticker` (plus the file route). */
export interface MockSticker {
  id: string;
  packId: string;
  emoji: string | null;
  mime: 'image/webp' | 'image/png';
  width: number;
  height: number;
  bytes: number;
  url: string;
  /** The Telegram `file_unique_id` of an imported sticker; absent otherwise. */
  sourceId?: string;
}

/** One sticker pack row, mirroring the contract's `StickerPack`. */
export interface MockStickerPack {
  id: string;
  ownerId: string;
  title: string;
  visibility: 'private' | 'server';
  /** `telegram:<name>` for imported packs; absent otherwise. */
  importedFrom?: string;
  stickers: MockSticker[];
  createdAt: string;
  updatedAt: string;
}

const CATS_ID = '11111111-1111-4111-8111-111111111111';
const MOODS_ID = '11111111-1111-4111-8111-111111111222';

const CATS: ReadonlyArray<readonly [id: string, emoji: string]> = [
  ['21111111-1111-4111-8111-111111111111', '🐱'],
  ['21111111-1111-4111-8111-111111111112', '😹'],
  ['21111111-1111-4111-8111-111111111113', '🙀'],
  ['21111111-1111-4111-8111-111111111114', '😻'],
  ['21111111-1111-4111-8111-111111111115', '🐈'],
  ['21111111-1111-4111-8111-111111111116', '😺'],
];

const MOODS: ReadonlyArray<readonly [id: string, emoji: string]> = [
  ['21111111-1111-4111-8111-111111111221', '😂'],
  ['21111111-1111-4111-8111-111111111222', '🔥'],
  ['21111111-1111-4111-8111-111111111223', '😎'],
  ['21111111-1111-4111-8111-111111111224', '🎉'],
  ['21111111-1111-4111-8111-111111111225', '❤️'],
  ['21111111-1111-4111-8111-111111111226', '👍'],
];

/** The gradient and glyph behind each demo sticker, keyed by its id. */
const STICKER_ART: Readonly<Record<string, readonly [from: string, to: string, glyph: string]>> = {
  '21111111-1111-4111-8111-111111111111': ['#fbbf24', '#f97316', '🐱'],
  '21111111-1111-4111-8111-111111111112': ['#a78bfa', '#7c3aed', '😹'],
  '21111111-1111-4111-8111-111111111113': ['#6ee7b7', '#059669', '🙀'],
  '21111111-1111-4111-8111-111111111114': ['#fda4af', '#e11d48', '😻'],
  '21111111-1111-4111-8111-111111111115': ['#7dd3fc', '#0284c7', '🐈'],
  '21111111-1111-4111-8111-111111111116': ['#fde68a', '#d97706', '😺'],
  '21111111-1111-4111-8111-111111111221': ['#fde047', '#ca8a04', '😂'],
  '21111111-1111-4111-8111-111111111222': ['#fca5a5', '#dc2626', '🔥'],
  '21111111-1111-4111-8111-111111111223': ['#c4b5fd', '#6d28d9', '😎'],
  '21111111-1111-4111-8111-111111111224': ['#86efac', '#16a34a', '🎉'],
  '21111111-1111-4111-8111-111111111225': ['#93c5fd', '#1d4ed8', '❤️'],
  '21111111-1111-4111-8111-111111111226': ['#fdba74', '#ea580c', '👍'],
};

/** The SVG art behind one demo sticker, keyed by its id; `undefined` when gone. */
export function stickerArt(stickerId: string): string | undefined {
  const cell = STICKER_ART[stickerId];
  if (cell === undefined) {
    return undefined;
  }
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">',
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
    `<stop offset="0" stop-color="${cell[0]}"/><stop offset="1" stop-color="${cell[1]}"/>`,
    '</linearGradient></defs>',
    '<rect width="200" height="200" rx="40" fill="url(#g)"/>',
    `<text x="100" y="135" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="88">${cell[2]}</text>`,
    '</svg>',
  ].join('');
}

/** The same-origin file URL the renderer auto-loads, like web's demo packs. */
export function mockStickerFileUrl(stickerId: string): string {
  return `/api/stickers/${stickerId}/file`;
}

/**
 * A stable UUID-shaped id from a sequence. `StickerSchema` requires a UUID, so
 * a user-created pack or upload is addressable and sendable like a real one
 * without depending on `crypto.randomUUID` (Hermes has no Web Crypto).
 */
export function mockStickerId(sequence: number): string {
  const hex = sequence.toString(16).padStart(12, '0').slice(-12);
  return `00000000-0000-4000-8000-${hex}`;
}

function pack(
  id: string,
  title: string,
  cells: ReadonlyArray<readonly [id: string, emoji: string]>,
): MockStickerPack {
  const now = '2026-09-20T10:00:00.000Z';
  return {
    id,
    ownerId: currentUser.id,
    title,
    visibility: 'server',
    stickers: cells.map(([stickerId, emoji]) => ({
      id: stickerId,
      packId: id,
      emoji,
      mime: 'image/png',
      width: 200,
      height: 200,
      bytes: 1024,
      url: mockStickerFileUrl(stickerId),
    })),
    createdAt: now,
    updatedAt: now,
  };
}

/** The seeded packs, the panel order and the (empty) favorite list. */
export function seedStickerPacks(): Partial<MockSeed> {
  return {
    stickerPacks: [pack(CATS_ID, 'Cats', CATS), pack(MOODS_ID, 'Moods', MOODS)],
    stickerPanel: [CATS_ID, MOODS_ID],
    stickerFavorites: [],
  };
}
