import { isTrustedMediaUrl } from '@zilar/chat-core';

/**
 * A root-relative `/api/` path is same-origin by construction; an absolute URL
 * must be http(s) on a trusted media host. Anything else (`data:`, `blob:`, a
 * peer's arbitrary host) stays a click-to-load file card: a peer can put any
 * URL in the payload, and `<video preload="metadata">` fetches it on render,
 * leaking the reader's IP.
 */
export function isTrustedInlineVideoUrl(url: string, trustedHosts: ReadonlySet<string>): boolean {
  if (url.startsWith('/api/')) {
    return true;
  }
  return isTrustedMediaUrl(url, trustedHosts);
}
