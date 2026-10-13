import type { Attachment } from '@zilar/protocol';
import { formatFileSize } from './media';

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
