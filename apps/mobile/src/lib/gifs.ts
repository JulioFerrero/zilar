/**
 * Dependency-free, so components import it without the API client or native modules.
 */

import { parseUrl } from '@zilar/chat-core';

const GIF_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
]);

export function isGifMediaType(contentType: string): boolean {
  return GIF_MEDIA_TYPES.has(contentType);
}

/**
 * The `gif-<id>.<ext>` name is what `isGifVideoAttachment` looks for, so sent videos play inline.
 */
export function gifFileName(id: string, extension: string): string {
  return `gif-${id.slice(0, 16)}.${extension}`;
}

export const GIF_ATTRIBUTION = 'Powered by Giphy';

/**
 * Only the same-origin proxy path loads (relative, or absolute on the API origin); a provider URL, a `data:` URI or garbage shows a placeholder. The bearer rides to the API origin only, so the panel cannot leak it cross-origin.
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
