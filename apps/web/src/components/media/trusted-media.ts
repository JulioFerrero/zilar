import { isTrustedMediaUrl } from '@zilar/chat-core';

/**
 * Whether an inline `<video preload="metadata">` may auto-load from `url`. A
 * root-relative `/api/` path is same-origin by construction; an absolute URL
 * must be http(s) on a trusted media host. Anything else (`data:`, `blob:`, a
 * peer's arbitrary host) must stay a click-to-load file card: a chat peer can
 * put any URL in the payload, and the player fetches it on render, leaking the
 * reader's IP. The same trust test the GIF path applies before auto-loading
 * (`GifMessage.tsx:isTrustedGifUrl`).
 */
export function isTrustedInlineVideoUrl(url: string, trustedHosts: ReadonlySet<string>): boolean {
  if (url.startsWith('/api/')) {
    return true;
  }
  return isTrustedMediaUrl(url, trustedHosts);
}
