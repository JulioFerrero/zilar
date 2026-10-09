/**
 * Sticker helpers (T-0143), the mobile twin of `apps/web/src/lib/stickers.ts`.
 *
 * Dependency-free so components can import them without pulling the API
 * client or native modules (Vitest cannot resolve `@/` for component
 * modules — see `apps/mobile` test notes in T-0112).
 */

import { Effect } from 'effect';
import { parseUrl } from '@zilar/chat-core';

/** The sticker packs in a panel list (the server's shape, validated by hand). */
export interface StickerPack {
  id: string;
  title: string;
  /** Absent on older payloads; the panel still renders without it. */
  ownerId?: string | undefined;
  /** Absent on older payloads; treated as private when missing. */
  visibility?: 'private' | 'server' | undefined;
  /** Set by the Telegram importer (`telegram:<name>`); absent otherwise. */
  importedFrom?: string | undefined;
  stickers: StickerItem[];
}

/** One sticker row: the send payload minus the pack id. */
export interface StickerItem {
  id: string;
  packId: string;
  url: string;
  emoji: string | null;
  width: number;
  height: number;
  mime: 'image/webp' | 'image/png';
}

/** The tap-to-send choice the panel hands to the store. */
export interface StickerChoice {
  stickerId: string;
  packId: string;
  url: string;
  emoji?: string | undefined;
  width: number;
  height: number;
  mime: 'image/webp' | 'image/png';
}

/** One recent sticker, kept per device as ids (never bytes). */
export interface RecentStickerEntry {
  stickerId: string;
  packId: string;
  url: string;
  emoji?: string | undefined;
  width: number;
  height: number;
  mime: 'image/webp' | 'image/png';
}

export const MAX_RECENT_STICKERS = 30;

/**
 * Whether a sticker payload `url` may be auto-loaded: only when it is a
 * relative `/api/stickers/…/file` path resolved against the Zilar API origin,
 * or an absolute URL on that same origin. An absolute URL of another host is
 * never loaded — a hostile sender must not make every viewer fetch an
 * arbitrary URL — so it shows the emoji or a placeholder instead.
 *
 * Auth headers are sent only to the API origin (see the image source in
 * `StickerMessage`).
 */
export function isSameOriginStickerUrl(url: string, apiUrl: string): boolean {
  const trimmed = url.trim();
  if (trimmed === '') {
    return false;
  }
  const origin = originOf(apiUrl);
  if (origin === undefined) {
    return false;
  }
  if (trimmed.startsWith('/')) {
    return trimmed.startsWith('/api/stickers/') && trimmed.endsWith('/file');
  }
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return false;
  }
  const parsed = parseUrl(trimmed);
  if (parsed === undefined) {
    return false;
  }
  return (
    parsed.origin === origin &&
    parsed.pathname.startsWith('/api/stickers/') &&
    parsed.pathname.endsWith('/file')
  );
}

/** The API origin a sticker request goes to: the build-time server URL. */
export function apiOrigin(apiUrl: string): string {
  return originOf(apiUrl) ?? apiUrl.replace(/\/+$/, '');
}

function originOf(apiUrl: string): string | undefined {
  return parseUrl(apiUrl)?.origin;
}

/**
 * The `Image` source for a trusted sticker URL. A relative panel path is
 * resolved against the API origin. The bearer token rides along only to the
 * matched API origin: a URL that fails `isSameOriginStickerUrl` gets no
 * headers (and the caller shows a placeholder instead), so a future caller
 * that forgets the check cannot leak the token cross-origin.
 */
export function stickerImageSource(
  url: string,
  apiUrl: string,
  token: string | undefined,
): { uri: string; headers?: { authorization: string } } {
  if (!isSameOriginStickerUrl(url, apiUrl)) {
    return { uri: url.startsWith('/') ? `${apiOrigin(apiUrl)}${url}` : url };
  }
  const uri = url.startsWith('/') ? `${apiOrigin(apiUrl)}${url}` : url;
  return token === undefined ? { uri } : { uri, headers: { authorization: `Bearer ${token}` } };
}

/** Parses stored JSON; text that does not parse gives `undefined`, never a throw. */
const parseStoredJson = (raw: string): Effect.Effect<unknown> =>
  Effect.try({ try: () => JSON.parse(raw) as unknown, catch: () => undefined }).pipe(
    Effect.catch(() => Effect.succeed(undefined)),
  );

/** Reads the recents; hostile or missing data resolves to an empty list. */
export function readRecentStickers(raw: string | null | undefined): RecentStickerEntry[] {
  if (raw === null || raw === undefined || raw === '') {
    return [];
  }
  const parsed = Effect.runSync(parseStoredJson(raw));
  if (!Array.isArray(parsed)) {
    return [];
  }
  const entries: RecentStickerEntry[] = [];
  for (const item of parsed.slice(0, MAX_RECENT_STICKERS)) {
    const entry = parseRecentEntry(item);
    if (entry !== null) {
      entries.push(entry);
    }
  }
  return entries;
}

function parseRecentEntry(value: unknown): RecentStickerEntry | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const { stickerId, packId, url, emoji } = record;
  if (
    typeof stickerId !== 'string' ||
    stickerId.length === 0 ||
    stickerId.length > 128 ||
    typeof packId !== 'string' ||
    packId.length === 0 ||
    packId.length > 128 ||
    typeof url !== 'string' ||
    url.length === 0 ||
    url.length > 2048 ||
    (emoji !== undefined && typeof emoji !== 'string')
  ) {
    return null;
  }
  // The storage format change (T-0143 review): older entries have no
  // dimensions. Missing or out-of-range values fall back to a square tile
  // instead of dropping the recent — dimensions only shape the aspect ratio,
  // and the send path still validates the payload with `StickerSchema`.
  return {
    stickerId,
    packId,
    url,
    ...(emoji === undefined || emoji === '' ? {} : { emoji: emoji.slice(0, 8) }),
    width: stickerSize(record['width']),
    height: stickerSize(record['height']),
    mime: stickerMime(record['mime']),
  };
}

/** A stored dimension, or the square fallback for old/hostile entries. */
function stickerSize(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 512
    ? value
    : FALLBACK_STICKER_SIZE;
}

/** A stored mime, or `image/png` for old/hostile entries. */
function stickerMime(value: unknown): RecentStickerEntry['mime'] {
  return value === 'image/webp' || value === 'image/png' ? value : 'image/png';
}

/** The fallback tile size for recents stored before dimensions were kept. */
export const FALLBACK_STICKER_SIZE = 200;

/** The tap-to-send choice for a recent: the real stored dimensions go on the wire. */
export function recentChoiceFor(recent: RecentStickerEntry): StickerChoice {
  return {
    stickerId: recent.stickerId,
    packId: recent.packId,
    url: recent.url,
    ...(recent.emoji === undefined ? {} : { emoji: recent.emoji }),
    width: recent.width,
    height: recent.height,
    mime: recent.mime,
  };
}

/**
 * Which pack tab the panel shows: the current one while it still exists, the
 * Recent tab once the user has recents, else the first pack — so a user with
 * packs but no recents sees stickers, not the create-on-web empty state.
 */
export function resolveActivePackId(
  current: string | undefined,
  packs: readonly StickerPack[],
  recents: readonly RecentStickerEntry[],
): string | undefined {
  if (current !== undefined && packs.some((pack) => pack.id === current)) {
    return current;
  }
  return recents.length > 0 ? undefined : packs[0]?.id;
}

/** Records a sent sticker first; the caller persists the returned list. */
export function rememberRecentSticker(
  recents: readonly RecentStickerEntry[],
  entry: RecentStickerEntry,
): RecentStickerEntry[] {
  return [entry, ...recents.filter((item) => item.stickerId !== entry.stickerId)].slice(
    0,
    MAX_RECENT_STICKERS,
  );
}
