/**
 * Motion sniffing for picked sticker files: GIF, video (WebM/MP4/MOV),
 * animated WebP and APNG keep their motion, so a caller must not flatten
 * them to a still. The kind is read from the bytes only, never from the
 * name or type. Callers read at most the first `STICKER_SNIFF_BYTES` bytes
 * and hand that slice to `sniffMotionBytes`.
 */

export type MotionKind = 'gif' | 'video' | 'animated-webp' | 'apng';

/** The leading bytes a motion sniff reads (64 KiB). */
export const STICKER_SNIFF_BYTES = 65536;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
/** `ftyp` major brands that are still photos (HEIF/AVIF), never video. */
const STILL_FTYP_BRANDS = new Set([
  'avif',
  'avis',
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'mif1',
  'msf1',
]);

export function sniffMotionBytes(bytes: Uint8Array): MotionKind | null {
  if (startsWithAscii(bytes, 0, 'GIF87a') || startsWithAscii(bytes, 0, 'GIF89a')) {
    return 'gif';
  }
  // EBML (`1A 45 DF A3`) is WebM/Matroska; `ftyp` at offset 4 is MP4/MOV.
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return 'video';
  }
  // An `ftyp` box also opens still HEIF/AVIF photos, so only a major brand
  // outside the still set counts as video; the rest go down the still path,
  // where the browser decodes them or reports them (T-1501 Review).
  if (startsWithAscii(bytes, 4, 'ftyp')) {
    return STILL_FTYP_BRANDS.has(asciiAt(bytes, 8, 4)) ? null : 'video';
  }
  if (isAnimatedWebp(bytes)) {
    return 'animated-webp';
  }
  if (isApng(bytes)) {
    return 'apng';
  }
  return null;
}

/** RIFF/WEBP with a VP8X chunk whose animation flag (0x02) is set. */
function isAnimatedWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 21 &&
    startsWithAscii(bytes, 0, 'RIFF') &&
    startsWithAscii(bytes, 8, 'WEBP') &&
    startsWithAscii(bytes, 12, 'VP8X') &&
    (bytes[20]! & 0x02) !== 0
  );
}

/** PNG signature, then chunks until an `acTL` (APNG) or the first `IDAT`. */
function isApng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) {
    return false;
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      return false;
    }
  }
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const dataLength = readUint32BE(bytes, offset);
    const type = asciiAt(bytes, offset + 4, 4);
    if (type === 'acTL') {
      return true;
    }
    if (type === 'IDAT') {
      return false;
    }
    offset += 12 + dataLength;
  }
  return false;
}

function startsWithAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) {
    return false;
  }
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[offset + i] !== text.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  let text = '';
  for (let i = 0; i < length; i += 1) {
    text += String.fromCharCode(bytes[offset + i] ?? 0);
  }
  return text;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) >>> 0) +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  );
}
