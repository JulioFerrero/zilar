/**
 * Recent stickers (T-0120): the last 30 sent, kept in `localStorage` as ids.
 * Hostile stored data (wrong shapes, non-strings, huge arrays) is ignored so
 * a tampered value can never break the panel.
 */
export const RECENT_STICKERS_KEY = 'galena:recentStickers';
export const MAX_RECENT_STICKERS = 30;

export interface RecentStickerEntry {
  stickerId: string;
  packId: string;
  url: string;
  emoji?: string | undefined;
}

function isEntry(value: unknown): value is RecentStickerEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.stickerId === 'string' &&
    record.stickerId.length > 0 &&
    record.stickerId.length <= 128 &&
    typeof record.packId === 'string' &&
    record.packId.length > 0 &&
    record.packId.length <= 128 &&
    typeof record.url === 'string' &&
    record.url.length > 0 &&
    record.url.length <= 2048 &&
    (record.emoji === undefined || typeof record.emoji === 'string')
  );
}

/** Reads the recents; hostile or missing data resolves to an empty list. */
export function readRecentStickers(storage: Storage | null): RecentStickerEntry[] {
  if (storage === null) {
    return [];
  }
  let raw: string | null = null;
  try {
    raw = storage.getItem(RECENT_STICKERS_KEY);
  } catch {
    return [];
  }
  if (raw === null || raw === '') {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const entries: RecentStickerEntry[] = [];
  for (const item of parsed.slice(0, MAX_RECENT_STICKERS)) {
    if (isEntry(item)) {
      entries.push({
        stickerId: item.stickerId,
        packId: item.packId,
        url: item.url,
        ...(item.emoji === undefined || item.emoji === '' ? {} : { emoji: item.emoji.slice(0, 8) }),
      });
    }
  }
  return entries;
}

/** Records a sent sticker first; a failing storage never breaks sending. */
export function rememberRecentSticker(
  storage: Storage | null,
  entry: RecentStickerEntry,
): RecentStickerEntry[] {
  const recents = readRecentStickers(storage).filter((item) => item.stickerId !== entry.stickerId);
  const next = [entry, ...recents].slice(0, MAX_RECENT_STICKERS);
  if (storage !== null) {
    try {
      storage.setItem(RECENT_STICKERS_KEY, JSON.stringify(next));
    } catch {
      // A full or blocked localStorage must never break sending.
    }
  }
  return next;
}

/**
 * Whether a sticker payload `url` may be auto-loaded: only when it is on
 * the same origin as the Galena API. A hostile sender's arbitrary URL shows
 * a placeholder instead, so nobody's browser fetches it.
 */
export function isSameOriginStickerUrl(url: string, apiBase: string = '/api'): boolean {
  if (url.trim() === '') {
    return false;
  }
  try {
    const sticker = new URL(url, window.location.origin);
    if (sticker.protocol !== 'http:' && sticker.protocol !== 'https:') {
      return false;
    }
    // Only sticker file paths auto-load; any other same-origin page (or the
    // app root itself, which an empty string resolves to) shows a
    // placeholder.
    if (!sticker.pathname.startsWith('/api/stickers/') || !sticker.pathname.endsWith('/file')) {
      return false;
    }
    const api = new URL(apiBase, window.location.origin);
    return sticker.origin === api.origin;
  } catch {
    return false;
  }
}

/**
 * Whether the sticker panel may show a thumbnail inline: same-origin file
 * URLs only. Anything else (a hostile URL planted in localStorage recents,
 * or a stale `data:` demo URL from before mock mode served file URLs)
 * shows the emoji tile, so the browser never fetches it.
 */
export function isPanelStickerUrl(url: string): boolean {
  return isSameOriginStickerUrl(url);
}
