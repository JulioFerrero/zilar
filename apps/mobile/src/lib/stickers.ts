/**
 * Sticker helpers (T-0143), the mobile twin of `apps/web/src/lib/stickers.ts`.
 *
 * Dependency-free so components can import them without pulling the API
 * client or native modules (Vitest cannot resolve `@/` for component
 * modules — see `apps/mobile` test notes in T-0112).
 */

import {
  isStickerFileUrl,
  parseRecentStickers,
  parseUrl,
  type RecentStickerEntry as SharedRecentStickerEntry,
} from '@zilar/chat-core';

export { addRecentSticker as rememberRecentSticker, MAX_RECENT_STICKERS } from '@zilar/chat-core';

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

/**
 * One pack by id for its link page (T-1524): the pack fields plus the owner's
 * handle (null when they have none) and whether the caller's own panel holds it.
 */
export interface StickerPackDetail extends StickerPack {
  ownerHandle: string | null;
  inPanel: boolean;
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
export interface RecentStickerEntry extends SharedRecentStickerEntry {
  width: number;
  height: number;
  mime: 'image/webp' | 'image/png';
}

/**
 * Whether a sticker payload `url` may be auto-loaded: only when it is a
 * relative `/api/stickers/…/file` path resolved against the Zilar API origin,
 * or an absolute URL on that same origin. The shared rule resolves through
 * `new URL`, so `/api/stickers/../auth/file` cannot escape the sticker route
 * and receive the bearer token.
 */
export function isSameOriginStickerUrl(url: string, apiUrl: string): boolean {
  return isStickerFileUrl(url, apiOrigin(apiUrl));
}

/** The API origin a sticker request goes to: the build-time server URL. */
export function apiOrigin(apiUrl: string): string {
  return parseUrl(apiUrl)?.origin ?? apiUrl.replace(/\/+$/, '');
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
  const uri = url.startsWith('/') ? `${apiOrigin(apiUrl)}${url}` : url;
  if (!isSameOriginStickerUrl(url, apiUrl)) {
    return { uri };
  }
  return token === undefined ? { uri } : { uri, headers: { authorization: `Bearer ${token}` } };
}

/** The public web host a pack link uses (`app.json` maps `/stickers/`). */
export const STICKER_PACK_HOST = 'chat.zilar.app';

/** The pack link, as copied and shared (T-1524). */
export function stickerPackUrl(packId: string): string {
  return `https://${STICKER_PACK_HOST}/stickers/${encodeURIComponent(packId)}`;
}

/** The pack link as shown: host plus path, without the scheme. */
export function stickerPackUrlText(packId: string): string {
  return `${STICKER_PACK_HOST}/stickers/${packId}`;
}

/** The fallback tile size for recents stored before dimensions were kept. */
export const FALLBACK_STICKER_SIZE = 200;

/** Reads the recents; hostile or missing data resolves to an empty list. */
export function readRecentStickers(raw: string | null | undefined): RecentStickerEntry[] {
  return parseRecentStickers(raw).map((entry) => ({
    ...entry,
    width: entry.width ?? FALLBACK_STICKER_SIZE,
    height: entry.height ?? FALLBACK_STICKER_SIZE,
    mime: entry.mime ?? 'image/png',
  }));
}

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
