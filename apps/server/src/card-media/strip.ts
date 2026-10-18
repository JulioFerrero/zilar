// Metadata is removed before the bytes get a row and an id. Pixels are never re-encoded:
// only the carrying segments are dropped. A structure the walker cannot follow returns
// `null`, and the caller refuses the file rather than storing it uncleaned.
import { readU16BE, readU32BE, readU32LE, writeU32LE } from '../media-bytes';
import { readJpegMarker, type ImageMime } from './sniff';

const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt']);
const JPEG_KEEP_APP = new Set([0xe0, 0xe2]);
const WEBP_DROP = new Set(['EXIF', 'XMP ']);

function fourcc(bytes: Uint8Array, offset: number): string | null {
  if (offset + 4 > bytes.length) {
    return null;
  }
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!,
  );
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function stripPng(bytes: Uint8Array): Uint8Array | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || !signature.every((value, index) => bytes[index] === value)) {
    return null;
  }
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let offset = 8;
  let sawEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = readU32BE(bytes, offset);
    const type = fourcc(bytes, offset + 4);
    if (length === null || type === null) {
      return null;
    }
    const end = offset + 12 + length;
    if (end > bytes.length) {
      return null;
    }
    if (!PNG_DROP.has(type)) {
      parts.push(bytes.subarray(offset, end));
    }
    offset = end;
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  return sawEnd ? concat(parts) : null;
}

// JPEG: copy the SOI and header segments except APPn, keeping only APP0 (JFIF) and APP2
// (ICC) before the first scan. After a scan starts, keep entropy-coded data, restart
// markers and later SOS segments; drop between-scan APPn/COM and stop at the first EOI.
function stripJpeg(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  let inScan = false;
  let sawScan = false;
  while (offset < bytes.length) {
    if (inScan) {
      // 0xFF00 is stuffed data, 0xFFD0-0xFFD7 restart markers and 0xFFFF fill: all stay
      // inside the entropy-coded run.
      const scanStart = offset;
      let markerAt = -1;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const next = bytes[offset + 1];
        if (next === undefined) {
          return null;
        }
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          offset += 2;
          continue;
        }
        if (next === 0xff) {
          offset += 1;
          continue;
        }
        markerAt = offset;
        break;
      }
      if (markerAt < 0) {
        return null;
      }
      if (markerAt > scanStart) {
        parts.push(bytes.subarray(scanStart, markerAt));
      }
      offset = markerAt;
      inScan = false;
      continue;
    }

    const start = offset;
    const found = readJpegMarker(bytes, offset);
    if (found === null) return null;
    const { marker } = found;
    offset = found.offset;
    if (marker === 0x00) {
      return null;
    }
    if (marker === 0xd9) {
      parts.push(bytes.subarray(start, offset));
      return concat(parts);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.subarray(start, offset));
      continue;
    }
    const length = readU16BE(bytes, offset);
    if (length === null || length < 2 || offset + length > bytes.length) {
      return null;
    }
    const end = offset + length;
    if (marker === 0xda) {
      parts.push(bytes.subarray(start, end));
      offset = end;
      inScan = true;
      sawScan = true;
      continue;
    }
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isCom = marker === 0xfe;
    const drop = sawScan ? isApp || isCom : isApp && !JPEG_KEEP_APP.has(marker);
    if (!drop) {
      parts.push(bytes.subarray(start, end));
    }
    offset = end;
  }
  return null;
}

// Keep every chunk except EXIF and XMP, clear their VP8X flags, and rewrite the RIFF
// size from the bytes actually kept.
function stripWebp(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 12) {
    return null;
  }
  const riff = fourcc(bytes, 0);
  const webp = fourcc(bytes, 8);
  if (riff !== 'RIFF' || webp !== 'WEBP') {
    return null;
  }
  const parts: Uint8Array[] = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = fourcc(bytes, offset);
    const size = readU32LE(bytes, offset + 4);
    if (type === null || size === null) {
      return null;
    }
    const end = offset + 8 + size + (size % 2);
    if (end > bytes.length) {
      return null;
    }
    if (type === 'VP8X' && size >= 1) {
      // Byte 0 of the VP8X payload: bit 3 is EXIF, bit 2 is XMP.
      const chunk = bytes.subarray(offset, end).slice();
      chunk[8] = chunk[8]! & ~0x0c;
      parts.push(chunk);
    } else if (!WEBP_DROP.has(type)) {
      parts.push(bytes.subarray(offset, end));
    }
    offset = end;
  }
  if (offset !== bytes.length) {
    return null;
  }
  const body = concat(parts);
  const out = new Uint8Array(12 + body.byteLength);
  out.set(bytes.subarray(0, 4), 0);
  writeU32LE(out, 4, out.byteLength - 8);
  out.set(bytes.subarray(8, 12), 8);
  out.set(body, 12);
  return out;
}

export function stripImageMetadata(bytes: Uint8Array, mime: ImageMime): Uint8Array | null {
  switch (mime) {
    case 'image/png':
      return stripPng(bytes);
    case 'image/jpeg':
      return stripJpeg(bytes);
    case 'image/webp':
      return stripWebp(bytes);
  }
}
