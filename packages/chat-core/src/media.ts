import type { Attachment } from '@zilar/protocol';
import { parseUrl } from './url';

const FALLBACK_NAME = 'file';
const MAX_NAME_LENGTH = 255;

/**
 * Strips directory parts, control characters and surrounding whitespace from a
 * file name and caps it at 255 characters. An empty result becomes `file`.
 */
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

/** Human size for preview bars and file cards, e.g. `2.4 MB`. */
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

/**
 * Just enough of the XMPP token to build the trusted media set: the WebSocket
 * service URL and the XMPP domain the server issued for this session. Both are
 * where the upload service answers in dev and production.
 */
export interface MediaTokenShape {
  service: string;
  domain: string;
}

/**
 * The hostnames the renderer auto-loads images from. Anything else becomes a
 * file card that only loads on click, so a chat peer cannot make every viewer
 * fetch a tracking pixel from a third-party host.
 */
export function trustedMediaHosts(token: MediaTokenShape): ReadonlySet<string> {
  const hosts = new Set<string>();
  // A malformed service URL just means we trust nothing from it; the domain
  // below still covers the production case.
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

/**
 * Whether `url` is http(s) and its hostname matches one of `trustedHosts`
 * (case-insensitive, scheme- and port-agnostic). Anything that does not parse
 * as an http(s) URL (`javascript:`, `data:`, relative paths, garbage) is
 * untrusted.
 */
export function isTrustedMediaUrl(url: string, trustedHosts: ReadonlySet<string>): boolean {
  const parsed = parseUrl(url);
  if (parsed === undefined || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return false;
  }
  return trustedHosts.has(parsed.hostname.toLowerCase());
}

/**
 * The mime and file extension for GIF-tab bytes, taken from the proxied blob's
 * real content type and validated against the four types the media proxy
 * serves. An unexpected type (e.g. mock-mode art) falls back to the search
 * result's kind so mock sends keep working.
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

/** A file attachment the GIF send path would render as an inline video. */
export function isGifVideoName(attachment: Attachment): boolean {
  if (attachment.kind !== 'file') {
    return false;
  }
  if (attachment.mime !== 'video/mp4' && attachment.mime !== 'video/webm') {
    return false;
  }
  return attachment.name.startsWith('gif-');
}

/**
 * Strips the `gif-` prefix the inline-video match looks for, so an untrusted
 * GIF-video attachment renders as a click-to-load file card. Never empty: a
 * bare `gif-` name becomes `file`.
 */
function unprefixedGifName(name: string): string {
  const stripped = name.slice('gif-'.length);
  return stripped === '' ? FALLBACK_NAME : stripped;
}

/**
 * An incoming image attachment on an untrusted host would auto-fetch from
 * whatever URL a chat peer put in the payload, leaking the viewer's IP to that
 * host. Downgrade it to a file card so the bytes are only loaded on click.
 * The same holds for a GIF-video file attachment (`gif-` name, video mime): on
 * an untrusted host the `gif-` prefix is stripped (breaking the inline-video
 * match) and the dimensions dropped. Other file attachments stay files: they
 * never auto-load.
 */
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
    // A downgraded GIF-video (`gif-` name, video mime; the GIF send path
    // sometimes emits kind `image` with the real blob mime) must not keep the
    // prefix. Other image names keep theirs (a bare `gif-` becomes `file`).
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
