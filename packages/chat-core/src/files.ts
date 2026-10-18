import type { Attachment } from '@zilar/protocol';
import { formatFileSize } from './media';
import { parseUrl } from './url';

/** Hard cap on an attachment: the ejabberd `mod_http_upload` `max_size`. */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/** Images the clients treat as pictures. SVG is deliberately absent: it can carry script. */
const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

/**
 * Types that say nothing about the bytes, so the file name's extension is the
 * only hint a client has. A `.pdf` name on one of these is treated as a PDF.
 */
const GENERIC_MIME_TYPES: ReadonlySet<string> = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
]);

/** The upper-case extension of a file name, or '' when it has none. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    return '';
  }
  return name.slice(dot + 1).toUpperCase();
}

/**
 * "3.9 KB PDF": the human size plus the upper-case extension, Telegram-style
 * (the file bubble's subtitle on web and mobile). Without an extension only the
 * size is kept, so a name-less type never leaves a stray space.
 */
export function formatFileMeta(size: number, name: string): string {
  return [formatFileSize(size), fileExtension(name)].filter((part) => part !== '').join(' ');
}

/**
 * Whether an attachment is a PDF: its MIME is `application/pdf`, or the MIME is
 * generic and the name ends in `.pdf`. Only this type is opened inline in a
 * browser tab (T-1322); active types (HTML, SVG) are never opened that way.
 */
export function isPdfAttachment(attachment: Pick<Attachment, 'name' | 'mime'>): boolean {
  const mime = attachment.mime.trim().toLowerCase();
  if (mime === 'application/pdf') {
    return true;
  }
  return GENERIC_MIME_TYPES.has(mime) && fileExtension(attachment.name) === 'PDF';
}

/** Whether the MIME is a raster image; SVG (it can carry script) and unknown types are files. */
export function classifyMime(mime: string | undefined): 'image' | 'file' {
  return IMAGE_MIME_TYPES.has((mime ?? '').toLowerCase()) ? 'image' : 'file';
}

/** The URL to follow only when it is http(s); `javascript:`, `data:` and garbage are not. */
export function safeHttpUrl(url: string): string | undefined {
  const parsed = parseUrl(url);
  return parsed !== undefined && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
    ? url
    : undefined;
}

/** The MIME to send: the reported type, or `application/octet-stream` when it is empty. */
export function mimeOrOctetStream(mime: string | undefined): string {
  return mime === undefined || mime === '' ? 'application/octet-stream' : mime;
}
