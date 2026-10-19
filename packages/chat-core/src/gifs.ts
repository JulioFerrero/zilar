import type { Attachment } from '@zilar/protocol';

import { isGifVideoName, isTrustedMediaUrl } from './media';

export interface GifItem {
  /** Attribution only; the id is never fetched from the provider. */
  id: string;
  title: string;
  /** Same-origin proxy, never the provider. */
  url: string;
  kind: 'image' | 'video';
  width: number;
  height: number;
  sizeBytes?: number | undefined;
}

const availability: { value: boolean | undefined } = { value: undefined };

// `undefined` means unknown: a network error keeps the answer unknown so a transient outage does not permanently hide the tab.
export function gifsAvailability(): boolean | undefined {
  return availability.value;
}

export function setGifsAvailability(value: boolean): void {
  availability.value = value;
}

/**
 * The URL must be trusted, so a hostile sender's URL never auto-loads even past the store sanitizer.
 * A browser also accepts a relative `/api/` path, which is same-origin by construction.
 */
export function isGifVideoAttachment(
  attachment: Attachment,
  trustedHosts: ReadonlySet<string>,
  allowApiPath = false,
): boolean {
  if (!isGifVideoName(attachment)) {
    return false;
  }
  if (allowApiPath && attachment.url.startsWith('/api/')) {
    return true;
  }
  return isTrustedMediaUrl(attachment.url, trustedHosts);
}
