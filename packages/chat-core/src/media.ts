import type { Attachment } from '@zilar/protocol';
import { parseUrl } from './url';

const FALLBACK_NAME = 'file';
const MAX_NAME_LENGTH = 255;

// Strips directory parts, control characters and surrounding whitespace, and caps the name at 255 characters; an empty result becomes `file`.
export function cleanFilename(name: string): string {
  const withoutPath = name.split(/[/\\]/).pop() ?? '';
  const withoutControl = Array.from(withoutPath)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join('');
  const trimmed = withoutControl.trim();
  if (trimmed.length === 0) {
    return FALLBACK_NAME;
  }
  return trimmed.slice(0, MAX_NAME_LENGTH);
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

// Appends a cache-busting counter so a retried source is not served from cache.
export function withMediaRetry(url: string, retry: number): string {
  if (retry <= 0 || url === '') {
    return url;
  }
  return `${url}${url.includes('?') ? '&' : '?'}retry=${retry}`;
}

export interface MediaTokenShape {
  service: string;
  domain: string;
}

// Anything outside these hosts becomes a click-to-load file card, so a chat peer cannot make every viewer fetch a tracking pixel from a third-party host.
export function trustedMediaHosts(token: MediaTokenShape): ReadonlySet<string> {
  const hosts = new Set<string>();
  // A malformed service URL means we trust nothing from it; the domain still covers production.
  const serviceHost = parseUrl(token.service)?.hostname.toLowerCase();
  if (serviceHost !== undefined && serviceHost !== '') {
    hosts.add(serviceHost);
  }
  const domain = token.domain.trim().toLowerCase();
  if (domain !== '') {
    hosts.add(domain);
    hosts.add(`upload.${domain}`);
  }
  return hosts;
}

// Case-insensitive, scheme- and port-agnostic; anything that does not parse as an http(s) URL is untrusted.
export function isTrustedMediaUrl(url: string, trustedHosts: ReadonlySet<string>): boolean {
  const parsed = parseUrl(url);
  if (parsed === undefined || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return false;
  }
  return trustedHosts.has(parsed.hostname.toLowerCase());
}

// Validated against the four types the media proxy serves; an unexpected type falls back to the search result's kind so mock sends keep working.
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

export function isGifVideoName(attachment: Attachment): boolean {
  if (attachment.kind !== 'file') {
    return false;
  }
  if (attachment.mime !== 'video/mp4' && attachment.mime !== 'video/webm') {
    return false;
  }
  return attachment.name.startsWith('gif-');
}

// Strips the `gif-` prefix so an untrusted GIF-video attachment renders as a click-to-load file card.
function unprefixedGifName(name: string): string {
  const stripped = name.slice('gif-'.length);
  return stripped === '' ? FALLBACK_NAME : stripped;
}

// An untrusted host would auto-fetch from a URL a chat peer put in the payload, leaking the viewer's IP; downgrade it to a file card so bytes load only on click.
export function sanitizeIncomingAttachment(
  attachment: Attachment,
  token: MediaTokenShape | undefined,
): Attachment {
  if (attachment.kind !== 'image' && !isGifVideoName(attachment)) {
    return attachment;
  }
  const trusted = token === undefined ? undefined : trustedMediaHosts(token);
  if (trusted !== undefined && isTrustedMediaUrl(attachment.url, trusted)) {
    return attachment;
  }
  if (attachment.kind === 'image') {
    // A downgraded GIF-video must not keep the `gif-` prefix, or the inline-video match would still load it.
    const downgraded: Attachment = {
      ...attachment,
      kind: 'file',
      name: attachment.name.startsWith('gif-')
        ? unprefixedGifName(attachment.name)
        : attachment.name,
    };
    delete downgraded.width;
    delete downgraded.height;
    return downgraded;
  }
  const renamed: Attachment = { ...attachment, name: unprefixedGifName(attachment.name) };
  delete renamed.width;
  delete renamed.height;
  return renamed;
}
