/**
 * GIF helpers (T-0148), the mobile twin of the web GIF path in
 * `apps/web/src/lib/attachments.ts` (`gifBlobType`) and
 * `apps/web/src/components/GifPanel.tsx` (`gifPreviewUrl`,
 * `gifsAvailability`).
 *
 * Dependency-free so components can import them without pulling the API
 * client or native modules (Vitest cannot resolve `@/` for component
 * modules — see `apps/mobile` test notes in T-0112).
 */

import { parseUrl } from '@zilar/chat-core';

/** One GIF search result the panel may show. */
export interface GifItem {
  id: string;
  title: string;
  /** Same-origin proxy URL for the media bytes, or app-made mock art. */
  url: string;
  kind: 'image' | 'video';
  width: number;
  height: number;
  sizeBytes?: number | undefined;
}

/** The media types the `/api/gifs/media/:token` proxy serves. */
const GIF_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
]);

/**
 * The mime and file extension for GIF-tab bytes, taken from the proxied
 * blob's real content type and validated against the four types the media
 * proxy serves. An unexpected type (e.g. mock-mode art) falls back to the
 * search result's kind so mock sends keep working. Mirrors web `gifBlobType`.
 */
export function gifBlobType(
  blobType: string,
  kind: 'image' | 'video',
): { mime: string; extension: string } {
  switch (blobType) {
    case 'image/gif':
      return { mime: 'image/gif', extension: 'gif' };
    case 'image/webp':
      return { mime: 'image/webp', extension: 'webp' };
    case 'video/mp4':
      return { mime: 'video/mp4', extension: 'mp4' };
    case 'video/webm':
      return { mime: 'video/webm', extension: 'webm' };
    default:
      return kind === 'video'
        ? { mime: 'video/mp4', extension: 'mp4' }
        : { mime: 'image/gif', extension: 'gif' };
  }
}

/** Whether a media response type is one the GIF proxy serves. */
export function isGifMediaType(contentType: string): boolean {
  return GIF_MEDIA_TYPES.has(contentType);
}

/**
 * The file name for a GIF-tab send: the `gif-<id>.<ext>` shape the
 * inline-video match (`isGifVideoAttachment`) looks for, so sent videos
 * play inline like on web. Mirrors the web composer's `sendGif`.
 */
export function gifFileName(id: string, extension: string): string {
  return `gif-${id.slice(0, 16)}.${extension}`;
}

/**
 * Whether the availability probe has run and what it said: `false` after a
 * 501 `gifs_unavailable`, `true` once the provider answered, `undefined`
 * before the first probe. Network errors keep the answer unknown (the tab
 * stays, the panel shows Retry) so a transient outage does not permanently
 * hide the tab. Mirrors web's `gifsAvailability` cache.
 */
const gifsAvailabilityCache: { value: boolean | undefined } = { value: undefined };

export function gifsAvailability(): boolean | undefined {
  return gifsAvailabilityCache.value;
}

export function setGifsAvailability(value: boolean): void {
  gifsAvailabilityCache.value = value;
}

export function resetGifsAvailability(): void {
  gifsAvailabilityCache.value = undefined;
}

/** How long the panel waits after the last keystroke before searching. */
export const GIF_SEARCH_DEBOUNCE_MS = 300;

/** The provider attribution line, as the provider requires. */
export const GIF_ATTRIBUTION = 'Powered by Giphy';

/**
 * Whether a GIF preview URL may be auto-loaded: only the same-origin proxy
 * path — a relative `/api/gifs/media/…` path, or an absolute URL on the
 * Zilar API origin with that path (the API client builds absolute URLs for
 * native fetch; relative paths resolve against the API origin, exactly like
 * web). Anything else — a provider URL, a hostile absolute URL, a `data:`
 * URI (mock art is app-generated, never fetched), garbage — never loads;
 * the row shows a placeholder instead.
 *
 * Preview requests carry the session bearer to the API origin only (the
 * media token binds the user, but the token rides the header there anyway),
 * so the panel cannot leak the session token cross-origin.
 */
export function isLoadableGifPreviewUrl(url: string, apiUrl: string): boolean {
  const path = '/api/gifs/media/';
  if (url.startsWith(path)) {
    return true;
  }
  const api = parseUrl(apiUrl);
  if (api === undefined) {
    return false;
  }
  const parsed = parseUrl(url);
  if (parsed === undefined) {
    return false;
  }
  return parsed.origin === api.origin && parsed.pathname.startsWith(path);
}
