import type { Attachment } from '@zilar/protocol';
import { formatFileSize, isTrustedMediaUrl } from './media';
import { parseUrl } from './url';

// Hard cap on an attachment: the ejabberd `mod_http_upload` `max_size`.
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

// SVG is deliberately absent from the image types: it can carry script.
const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

const GENERIC_MIME_TYPES: ReadonlySet<string> = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
]);

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    return '';
  }
  return name.slice(dot + 1).toUpperCase();
}

export function formatFileMeta(size: number, name: string): string {
  return [formatFileSize(size), fileExtension(name)].filter((part) => part !== '').join(' ');
}

// Only this type is opened inline in a browser tab; active types (HTML, SVG) are never opened that way.
export function isPdfAttachment(attachment: Pick<Attachment, 'name' | 'mime'>): boolean {
  const mime = attachment.mime.trim().toLowerCase();
  if (mime === 'application/pdf') {
    return true;
  }
  return GENERIC_MIME_TYPES.has(mime) && fileExtension(attachment.name) === 'PDF';
}

// Whether the MIME is a raster image; SVG (it can carry script) and unknown types are files.
export function classifyMime(mime: string | undefined): 'image' | 'file' {
  return IMAGE_MIME_TYPES.has((mime ?? '').toLowerCase()) ? 'image' : 'file';
}

// The URL to follow only when it is http(s); `javascript:`, `data:` and garbage are not.
export function safeHttpUrl(url: string): string | undefined {
  const parsed = parseUrl(url);
  return parsed !== undefined && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
    ? url
    : undefined;
}

export function mimeOrOctetStream(mime: string | undefined): string {
  return mime === undefined || mime === '' ? 'application/octet-stream' : mime;
}

/** Trusted-host gate: http(s) on one of the store's media hosts, so a hostile
 *  URL, `javascript:`, `data:` or garbage never loads. */
export function isLoadableMediaUrl(url: string, trustedHosts: ReadonlySet<string>): boolean {
  if (safeHttpUrl(url) === undefined) {
    return false;
  }
  return isTrustedMediaUrl(url, trustedHosts);
}
