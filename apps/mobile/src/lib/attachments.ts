/**
 * Dependency-free, so components import it without the API client or native modules.
 */

import { classifyMime, cleanFilename, mimeOrOctetStream } from '@zilar/chat-core';

export interface PendingMobileFile {
  uri: string;
  name?: string | undefined;
  mimeType?: string | undefined;
  size?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

/**
 * An SVG (or an empty or unknown type) is a file: it can carry script, so it is never rendered as an image.
 */
export function classifyMobileFile(file: Pick<PendingMobileFile, 'mimeType'>): 'image' | 'file' {
  return classifyMime(file.mimeType);
}

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
  const mime = mimeOrOctetStream(file.mimeType);
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
 * A fetch failure must not read as `untrusted`: after a restart an expired session or an offline fetch makes the load fail, and the wrong label sends the user after the wrong cause.
 */
export type ImageAttachmentRender = 'local' | 'image' | 'load-failed' | 'untrusted';

export function imageAttachmentRender(input: {
  trusted: boolean;
  broken: boolean;
  hasLocalUri: boolean;
}): ImageAttachmentRender {
  if (input.hasLocalUri) {
    return 'local';
  }
  if (!input.trusted) {
    return 'untrusted';
  }
  return input.broken ? 'load-failed' : 'image';
}

/**
 * Gallery assets carry a file name but no MIME. HEIC stays `image/heic`, never a picture.
 */
export function mimeForFileName(name: string, fallback: string): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'heic':
    case 'heif':
      return 'image/heic';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    default:
      return fallback;
  }
}

/**
 * Unknown types fall back to `bin`.
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

export const mimeForAsset = mimeOrOctetStream;
