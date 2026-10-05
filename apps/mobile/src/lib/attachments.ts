/**
 * Attachment helpers (T-0150), the mobile twin of
 * `apps/web/src/lib/attachments.ts`.
 *
 * Dependency-free so components can import them without pulling the API
 * client or native modules (Vitest cannot resolve `@/` for component
 * modules — see `apps/mobile` test notes in T-0112). Every rule mirrors the
 * web twin: the browser `File`-based helpers are adapted to the picked-asset
 * shape below, and the trusted-media set is the same three hosts.
 */

import type { Attachment } from '@zilar/protocol';

/** Hard cap on an attachment: the ejabberd `mod_http_upload` `max_size`. */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/** Images the client treats as pictures. SVG is deliberately absent. */
const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

const FALLBACK_NAME = 'file';
const MAX_NAME_LENGTH = 255;

/**
 * A file the user picked on the device, before it is sent. The native picker
 * hands back a local URI plus optional metadata; the store uploads the bytes
 * and sends the same wire shape as web (same kind rules, same caption rules).
 */
export interface PendingMobileFile {
  /** Local `file://` URI of the picked bytes. */
  uri: string;
  /** Original file name (may be missing on some library assets). */
  name?: string | undefined;
  /** The picker-reported MIME type, or undefined when unknown. */
  mimeType?: string | undefined;
  /** Byte size, when the picker reported it. */
  size?: number | undefined;
  /** Pixel width of an image/video asset, when known. */
  width?: number | undefined;
  /** Pixel height of an image/video asset, when known. */
  height?: number | undefined;
}

/**
 * The picked asset's MIME decides whether a file is an image. An SVG (and
 * anything with an empty or unknown type) is a file: it can carry script, so
 * it is never rendered as an image. Mirrors web `classify`.
 */
export function classifyMobileFile(file: Pick<PendingMobileFile, 'mimeType'>): 'image' | 'file' {
  const mime = (file.mimeType ?? '').toLowerCase();
  return IMAGE_MIME_TYPES.has(mime) ? 'image' : 'file';
}

/**
 * Strips directory parts, control characters and surrounding whitespace from
 * a file name and caps it at 255 characters. An empty result becomes `file`.
 * Mirrors web `cleanFilename`.
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

/** The URL to follow only when it is http(s); anything else is not. */
export function safeHttpUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Just enough of the XMPP token to build the trusted media set: the
 * WebSocket service URL and the XMPP domain the server issued for this
 * session. Both are where the upload service answers in dev and production.
 */
export interface MediaTokenShape {
  service: string;
  domain: string;
}

/**
 * The hostnames the renderer auto-loads images from. Anything else becomes a
 * file card that only loads on tap, so a chat peer cannot make every viewer's
 * device fetch a tracking pixel from a third-party host.
 */
export function trustedMediaHosts(token: MediaTokenShape): ReadonlySet<string> {
  const hosts = new Set<string>();
  try {
    const serviceHost = new URL(token.service).hostname.toLowerCase();
    if (serviceHost !== '') {
      hosts.add(serviceHost);
    }
  } catch {
    // A malformed service URL just means we trust nothing from it; the domain
    // below still covers the production case.
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
 * as an http(s) URL — `javascript:`, `data:`, relative paths, garbage — is
 * untrusted.
 */
export function isTrustedMediaUrl(url: string, trustedHosts: ReadonlySet<string>): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    return trustedHosts.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * The attachment payload the store sends, built exactly as web does: kind
 * from the MIME, sanitized name, `application/octet-stream` fallback for an
 * unknown type, and the measured image size when known.
 */
export function attachmentDataFor(
  file: PendingMobileFile,
  url: string,
): {
  kind: 'image' | 'file';
  url: string;
  name: string;
  size: number;
  mime: string;
  width?: number;
  height?: number;
} {
  const kind = classifyMobileFile(file);
  const mime =
    file.mimeType === undefined || file.mimeType === ''
      ? 'application/octet-stream'
      : file.mimeType;
  const data: ReturnType<typeof attachmentDataFor> = {
    kind,
    url,
    name: cleanFilename(file.name ?? ''),
    size: file.size ?? 0,
    mime,
  };
  if (
    kind === 'image' &&
    file.width !== undefined &&
    file.height !== undefined &&
    Number.isInteger(file.width) &&
    Number.isInteger(file.height) &&
    file.width >= 1 &&
    file.height >= 1
  ) {
    data.width = file.width;
    data.height = file.height;
  }
  return data;
}

/**
 * The sanitizer for an incoming attachment payload, mirroring web's
 * `sanitizeIncomingAttachment`: an image (or GIF-video file) on an
 * untrusted host is downgraded to a file card that never auto-loads. Other
 * file attachments stay files: they never auto-load.
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

/** A file attachment the GIF send path would render as an inline video. */
function isGifVideoName(attachment: Attachment): boolean {
  if (attachment.kind !== 'file') {
    return false;
  }
  if (attachment.mime !== 'video/mp4' && attachment.mime !== 'video/webm') {
    return false;
  }
  return attachment.name.startsWith('gif-');
}

/**
 * Whether a file attachment renders as an inline auto-playing video: the GIF
 * send path names files `gif-<id>.<ext>` with a video mime (mp4/webm are
 * never images per `classifyMobileFile`). The URL must additionally be
 * trusted, so a hostile sender's arbitrary URL never auto-loads even if it
 * reaches the component past the store sanitizer (which renames untrusted
 * `gif-` attachments first; this is the second layer).
 */
export function isGifVideoAttachment(
  attachment: Attachment,
  trustedHosts: ReadonlySet<string>,
): boolean {
  if (!isGifVideoName(attachment)) {
    return false;
  }
  return isTrustedMediaUrl(attachment.url, trustedHosts);
}

/**
 * Strips the `gif-` prefix the inline-video match looks for, so an untrusted
 * GIF-video attachment renders as a tap-to-load file row. Never empty: a
 * bare `gif-` name becomes `file`.
 */
function unprefixedGifName(name: string): string {
  const stripped = name.slice('gif-'.length);
  return stripped === '' ? 'file' : stripped;
}

/**
 * The extension for an image-picker asset from its MIME type, used when the
 * asset has no file name. Unknown types fall back to `bin`.
 */
export function extensionForMime(mimeType: string | undefined): string {
  switch ((mimeType ?? '').toLowerCase()) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'video/mp4':
      return 'mp4';
    case 'video/quicktime':
      return 'mov';
    case 'application/pdf':
      return 'pdf';
    default:
      return 'bin';
  }
}

/** The effective MIME of a picked asset: the reported type or the fallback. */
export function mimeForAsset(mimeType: string | undefined): string {
  return mimeType === undefined || mimeType === '' ? 'application/octet-stream' : mimeType;
}
