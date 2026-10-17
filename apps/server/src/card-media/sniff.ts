// T-1862: the card media fetcher trusts bytes, never the declared content
// type or the file name. `sniffImage` reads the dimensions from the header
// alone (no decode), so an oversized or decompression-bomb image is refused
// before it can reach a phone. `sniffFile` accepts PDF and plain text only.
import { isUtf8 } from 'node:buffer';
import { isPng, isWebp } from '../stickers/image';

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export type FileMime = 'application/pdf' | 'text/csv' | 'text/plain';

export interface SniffedImage {
  mime: ImageMime;
  width: number;
  height: number;
}

const PNG_IHDR = [0x49, 0x48, 0x44, 0x52] as const;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) {
    return false;
  }
  return magic.every((value, index) => bytes[index] === value);
}

function readU16BE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 2 > bytes.length) {
    return null;
  }
  return bytes[offset]! * 0x100 + bytes[offset + 1]!;
}

function readU16LE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 2 > bytes.length) {
    return null;
  }
  return bytes[offset]! + bytes[offset + 1]! * 0x100;
}

function readU24LE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 3 > bytes.length) {
    return null;
  }
  return bytes[offset]! + bytes[offset + 1]! * 0x100 + bytes[offset + 2]! * 0x10000;
}

function readU32BE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 4 > bytes.length) {
    return null;
  }
  return (
    (bytes[offset]! * 0x1000000 +
      bytes[offset + 1]! * 0x10000 +
      bytes[offset + 2]! * 0x100 +
      bytes[offset + 3]!) >>>
    0
  );
}

function readU32LE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 4 > bytes.length) {
    return null;
  }
  return (
    (bytes[offset]! +
      bytes[offset + 1]! * 0x100 +
      bytes[offset + 2]! * 0x10000 +
      bytes[offset + 3]! * 0x1000000) >>>
    0
  );
}

// PNG: 8-byte signature, then the first chunk must be IHDR, whose payload
// starts with 4-byte width and height.
function sniffPng(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < 24 || !PNG_IHDR.every((value, index) => bytes[12 + index] === value)) {
    return null;
  }
  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  if (width === null || height === null || width < 1 || height < 1) {
    return null;
  }
  return { mime: 'image/png', width, height };
}

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

// JPEG: walk the marker segments up to the first SOFn. Its payload holds the
// 1-byte precision, then 2-byte height and 2-byte width.
function sniffJpeg(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      return null;
    }
    let marker = bytes[offset + 1];
    if (marker === undefined) {
      return null;
    }
    offset += 2;
    while (marker === 0xff) {
      marker = bytes[offset];
      if (marker === undefined) {
        return null;
      }
      offset += 1;
    }
    // TEM and the restart markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    // Anything without a frame header before the scan or the end is not a
    // JPEG we can measure.
    if (marker === 0x00 || marker === 0xd8 || marker === 0xd9 || marker === 0xda) {
      return null;
    }
    const length = readU16BE(bytes, offset);
    if (length === null || length < 2 || offset + length > bytes.length) {
      return null;
    }
    if (SOF_MARKERS.has(marker)) {
      if (length < 7) {
        return null;
      }
      const height = readU16BE(bytes, offset + 3);
      const width = readU16BE(bytes, offset + 5);
      if (width === null || height === null || width < 1 || height < 1) {
        return null;
      }
      return { mime: 'image/jpeg', width, height };
    }
    offset += length;
  }
  return null;
}

// WebP: RIFF container. VP8 (lossy), VP8L (lossless) and VP8X (extended)
// each carry the canvas size in a different layout.
function sniffWebp(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < 21) {
    return null;
  }
  const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (chunk === 'VP8 ') {
    if (bytes.length < 30 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      return null;
    }
    const width = readU16LE(bytes, 26);
    const height = readU16LE(bytes, 28);
    if (width === null || height === null) {
      return null;
    }
    return { mime: 'image/webp', width: width & 0x3fff, height: height & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (bytes.length < 25 || bytes[20] !== 0x2f) {
      return null;
    }
    const bits = readU32LE(bytes, 21);
    if (bits === null) {
      return null;
    }
    return {
      mime: 'image/webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === 'VP8X') {
    if (bytes.length < 30) {
      return null;
    }
    const width = readU24LE(bytes, 24);
    const height = readU24LE(bytes, 27);
    if (width === null || height === null) {
      return null;
    }
    return { mime: 'image/webp', width: width + 1, height: height + 1 };
  }
  return null;
}

export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (isPng(bytes)) {
    return sniffPng(bytes);
  }
  if (isWebp(bytes)) {
    return sniffWebp(bytes);
  }
  return sniffJpeg(bytes);
}

// The bytes must decode as UTF-8 and contain no NUL. A name ending in `.csv`
// only chooses the label; the text itself is what makes it a text file.
export function sniffFile(bytes: Uint8Array, name: string): FileMime | null {
  if (bytes.length === 0) {
    return null;
  }
  if (startsWith(bytes, PDF_MAGIC)) {
    return 'application/pdf';
  }
  if (bytes.includes(0) || !isUtf8(bytes)) {
    return null;
  }
  return name.toLowerCase().endsWith('.csv') ? 'text/csv' : 'text/plain';
}
