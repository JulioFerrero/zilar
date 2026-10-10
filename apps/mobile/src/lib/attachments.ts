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

import { cleanFilename, isGifVideoName, isTrustedMediaUrl, parseUrl } from '@zilar/chat-core';
import type { Attachment } from '@zilar/protocol';

export {
  cleanFilename,
  formatFileSize,
  isTrustedMediaUrl,
  sanitizeIncomingAttachment,
  trustedMediaHosts,
  type MediaTokenShape,
} from '@zilar/chat-core';

/** Hard cap on an attachment: the ejabberd `mod_http_upload` `max_size`. */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/** Images the client treats as pictures. SVG is deliberately absent. */
const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

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

/** The URL to follow only when it is http(s); anything else is not. */
export function safeHttpUrl(url: string): string | undefined {
  const parsed = parseUrl(url);
  if (parsed === undefined) {
    return undefined;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : undefined;
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
