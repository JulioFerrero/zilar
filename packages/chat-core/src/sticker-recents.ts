// effect-plain: total recents and URL parsing; a failed parse is a value, not an error

import { safeDecode } from './url';

// chat-core has no DOM lib: name the one global the rule uses.
declare const URL: new (
  url: string,
  base?: string,
) => { readonly protocol: string; readonly origin: string; readonly pathname: string };

export const RECENT_STICKERS_KEY = 'zilar:recentStickers';

export const MAX_RECENT_STICKERS = 30;

export interface RecentStickerEntry {
  stickerId: string;
  packId: string;
  url: string;
  emoji?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  mime?: 'image/webp' | 'image/png' | undefined;
}

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

const isSize = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 512;

function entryFrom(value: unknown): RecentStickerEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const { stickerId, packId, url, emoji, width, height, mime } = value as Record<string, unknown>;
  if (!isText(stickerId, 128) || !isText(packId, 128) || !isText(url, 2048)) return null;
  if (emoji !== undefined && typeof emoji !== 'string') return null;
  return {
    stickerId,
    packId,
    url,
    ...(emoji === undefined || emoji === '' ? {} : { emoji: emoji.slice(0, 8) }),
    width: isSize(width) ? width : undefined,
    height: isSize(height) ? height : undefined,
    mime: mime === 'image/webp' || mime === 'image/png' ? mime : undefined,
  };
}

// Hostile or missing data resolves to an empty list.
export function parseRecentStickers(raw: string | null | undefined): RecentStickerEntry[] {
  if (raw === null || raw === undefined || raw === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .slice(0, MAX_RECENT_STICKERS)
    .map(entryFrom)
    .filter((entry): entry is RecentStickerEntry => entry !== null);
}

export function addRecentSticker<T extends RecentStickerEntry>(
  recents: readonly T[],
  entry: T,
): T[] {
  return [entry, ...recents.filter((item) => item.stickerId !== entry.stickerId)].slice(
    0,
    MAX_RECENT_STICKERS,
  );
}

const STICKER_FILE_PATH = /^\/api\/stickers\/(?:[^/]+\/)+file$/;

// React Native's URL concatenates a relative path without normalising it, so decode repeatedly until stable and reject any remaining dot segment.
function decodedPath(path: string): string {
  let current = path;
  for (let i = 0; i < 3; i += 1) {
    const next = safeDecode(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

// Whether `url` may carry the API bearer token: same origin, sticker file path.
export function isStickerFileUrl(url: string, apiOrigin: string): boolean {
  const trimmed = url.trim();
  if (trimmed === '') return false;
  try {
    const resolved = new URL(trimmed, apiOrigin);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return false;
    if (resolved.origin !== new URL(apiOrigin).origin) return false;
    const path = decodedPath(resolved.pathname);
    return STICKER_FILE_PATH.test(path) && !path.includes('..');
  } catch {
    return false;
  }
}
