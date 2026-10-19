/**
 * Dependency-free, so components import it without the API client or native modules.
 */

import {
  isStickerFileUrl,
  parseRecentStickers,
  parseUrl,
  type RecentStickerEntry as SharedRecentStickerEntry,
  type StickerChoice,
} from '@zilar/chat-core';

export interface StickerPack {
  id: string;
  title: string;
  ownerId?: string | undefined;
  visibility?: 'private' | 'server' | undefined;
  importedFrom?: string | undefined;
  stickers: StickerItem[];
}

export interface StickerPackDetail extends StickerPack {
  ownerHandle: string | null;
  inPanel: boolean;
}

export interface StickerItem {
  id: string;
  packId: string;
  url: string;
  emoji: string | null;
  width: number;
  height: number;
  mime: 'image/webp' | 'image/png';
}

export interface RecentStickerEntry extends SharedRecentStickerEntry {
  width: number;
  height: number;
  mime: 'image/webp' | 'image/png';
}

/**
 * Only a `/api/stickers/…/file` path on our API origin loads; the shared rule resolves through `new URL`, so `/api/stickers/../auth/file` cannot escape the route and receive the bearer token.
 */
export function isSameOriginStickerUrl(url: string, apiUrl: string): boolean {
  return isStickerFileUrl(url, apiOrigin(apiUrl));
}

export function apiOrigin(apiUrl: string): string {
  return parseUrl(apiUrl)?.origin ?? apiUrl.replace(/\/+$/, '');
}

/**
 * The bearer rides only to the matched API origin, so a caller that forgets `isSameOriginStickerUrl` still cannot leak the token cross-origin.
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

export const STICKER_PACK_HOST = 'chat.zilar.app';

export function stickerPackUrl(packId: string): string {
  return `https://${STICKER_PACK_HOST}/stickers/${encodeURIComponent(packId)}`;
}

export function stickerPackUrlText(packId: string): string {
  return `${STICKER_PACK_HOST}/stickers/${packId}`;
}

export const FALLBACK_STICKER_SIZE = 200;

export function readRecentStickers(raw: string | null | undefined): RecentStickerEntry[] {
  return parseRecentStickers(raw).map((entry) => ({
    ...entry,
    width: entry.width ?? FALLBACK_STICKER_SIZE,
    height: entry.height ?? FALLBACK_STICKER_SIZE,
    mime: entry.mime ?? 'image/png',
  }));
}

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
 * A user with packs but no recents sees stickers, not the create-on-web empty state.
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
