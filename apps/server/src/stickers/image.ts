// Magic-byte detection and header parsing for sticker uploads (T-0120).
//
// Only `image/webp` (static or animated) and `image/png` are ever stored.
// The type is detected from magic bytes — never from the client's
// `Content-Type` or file name — and the width/height are parsed from the
// headers by small pure functions, with no new dependency.

export const STICKER_MAX_BYTES = 512 * 1024;
export const STICKER_MAX_DIMENSION = 512;
/** Decoded pixels (width × height × RGBA) stay under this: a PNG header
 *  claiming 60 000 × 60 000 is a decompression bomb, not a sticker. */
export const STICKER_MAX_DECODED_BYTES = 4 * 1024 * 1024;

export type StickerMime = 'image/webp' | 'image/png';

export interface StickerImageInfo {
  mime: StickerMime;
  width: number;
  height: number;
}

export type StickerProbeError =
  | 'too_small'
  | 'unknown_type'
  | 'truncated'
  | 'invalid_dimensions'
  | 'too_large'
  | 'decode_too_large'
  | 'unsupported_layout'
  | 'animated';

/** True when the bytes carry an animated image: an animated WebP (VP8X with
 *  the animation flag) or an APNG (an `acTL` chunk before any `IDAT`). */
export function isAnimatedImage(bytes: Uint8Array): boolean {
  return isAnimatedWebp(bytes) || isAnimatedPng(bytes);
}

/** A VP8X WebP whose animation flag (bit 1 of the flags byte) is set. */
export function isAnimatedWebp(bytes: Uint8Array): boolean {
  if (!isWebp(bytes) || bytes.length < 21) {
    return false;
  }
  const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (chunk !== 'VP8X') {
    return false;
  }
  // VP8X chunk: 4-byte chunk size at 16..19, then flags at 20, reserved at
  // 21..23, then canvas (width-1, height-1). Bit 1 of the flags is the
  // animation bit. parseWebp already read the canvas at 24/27.
  if (bytes.length < 21) {
    return false;
  }
  return (bytes[20]! & 0x02) !== 0;
}

/** A PNG with an `acTL` chunk before the first `IDAT`: an APNG. Chunks are
 *  walked by length (never by trusting a claimed size past the buffer end),
 *  so a truncated file simply answers false. */
export function isAnimatedPng(bytes: Uint8Array): boolean {
  if (!isPng(bytes)) {
    return false;
  }
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readU32BE(bytes, offset);
    if (!Number.isSafeInteger(length) || length > bytes.length) {
      return false;
    }
    const name = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    if (name === 'acTL') {
      return true;
    }
    if (name === 'IDAT') {
      return false;
    }
    if (offset + 12 + length > bytes.length) {
      return false;
    }
    offset += 12 + length;
  }
  return false;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50] as const;

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) {
    return false;
  }
  return magic.every((value, index) => bytes[index] === value);
}

export function isPng(bytes: Uint8Array): boolean {
  return startsWith(bytes, PNG_MAGIC);
}

export function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 && startsWith(bytes, RIFF_MAGIC) && startsWith(bytes.subarray(8), WEBP_MAGIC)
  );
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! * 0x1000000 +
      bytes[offset + 1]! * 0x10000 +
      bytes[offset + 2]! * 0x100 +
      bytes[offset + 3]!) >>>
    0
  );
}

function readU24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! + bytes[offset + 1]! * 0x100 + bytes[offset + 2]! * 0x10000;
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! + bytes[offset + 1]! * 0x100;
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! +
      bytes[offset + 1]! * 0x100 +
      bytes[offset + 2]! * 0x10000 +
      bytes[offset + 3]! * 0x1000000) >>>
    0
  );
}

/** Validates sticker dimensions: integers in [1, 512] × [1, 512], and the
 *  decoded RGBA frame must fit in 4 MiB. */
function checkDimensions(
  width: number,
  height: number,
): { ok: true } | { ok: false; error: StickerProbeError } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return { ok: false, error: 'invalid_dimensions' };
  }
  if (width > STICKER_MAX_DIMENSION || height > STICKER_MAX_DIMENSION) {
    return { ok: false, error: 'too_large' };
  }
  if (width * height * 4 > STICKER_MAX_DECODED_BYTES) {
    return { ok: false, error: 'decode_too_large' };
  }
  return { ok: true };
}

/** Parses the IHDR of a PNG: 8-byte magic + 4-byte length + `IHDR` + 8
 *  bytes of width/height. Truncated headers fail closed. */
function parsePng(
  bytes: Uint8Array,
): { ok: true; info: StickerImageInfo } | { ok: false; error: StickerProbeError } {
  if (bytes.length < 24) {
    return { ok: false, error: 'truncated' };
  }
  if (readU32BE(bytes, 8) < 13) {
    return { ok: false, error: 'truncated' };
  }
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return { ok: false, error: 'unsupported_layout' };
  }
  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  const checked = checkDimensions(width, height);
  if (!checked.ok) {
    return checked;
  }
  return { ok: true, info: { mime: 'image/png', width, height } };
}

/**
 * Parses a WebP RIFF container: `RIFF <len> WEBP <VP8 |VP8L |VP8X …>`.
 * VP8 (lossy, static or animated frames share the first frame's size) and
 * VP8L (lossless) carry the canvas directly; VP8X (extended, incl. animated)
 * carries the canvas size minus one. Anything else is rejected.
 */
function parseWebp(
  bytes: Uint8Array,
): { ok: true; info: StickerImageInfo } | { ok: false; error: StickerProbeError } {
  if (bytes.length < 21) {
    return { ok: false, error: 'truncated' };
  }
  const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (chunk === 'VP8 ') {
    // Lossy bitstream: 3-byte frame tag + 3-byte start code 9D 01 2A, then
    // 14-bit width and 14-bit height.
    if (bytes.length < 30) {
      return { ok: false, error: 'truncated' };
    }
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      return { ok: false, error: 'unsupported_layout' };
    }
    const width = readU16LE(bytes, 26) & 0x3fff;
    const height = readU16LE(bytes, 28) & 0x3fff;
    const checked = checkDimensions(width, height);
    if (!checked.ok) {
      return checked;
    }
    return { ok: true, info: { mime: 'image/webp', width, height } };
  }
  if (chunk === 'VP8L') {
    // Lossless: 1-byte signature 0x2F, then 14-bit (width-1) and 14-bit
    // (height-1) packed across 4 bytes.
    if (bytes.length < 25) {
      return { ok: false, error: 'truncated' };
    }
    if (bytes[20] !== 0x2f) {
      return { ok: false, error: 'unsupported_layout' };
    }
    const bits = readU32LE(bytes, 21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    const checked = checkDimensions(width, height);
    if (!checked.ok) {
      return checked;
    }
    return { ok: true, info: { mime: 'image/webp', width, height } };
  }
  if (chunk === 'VP8X') {
    // Extended: 1 flag byte + 3 reserved/FIXED bytes, then 24-bit
    // (width-1) and 24-bit (height-1).
    if (bytes.length < 30) {
      return { ok: false, error: 'truncated' };
    }
    const width = readU24LE(bytes, 24) + 1;
    const height = readU24LE(bytes, 27) + 1;
    const checked = checkDimensions(width, height);
    if (!checked.ok) {
      return checked;
    }
    return { ok: true, info: { mime: 'image/webp', width, height } };
  }
  return { ok: false, error: 'unsupported_layout' };
}

export type StickerProbeResult =
  { ok: true; info: StickerImageInfo } | { ok: false; error: StickerProbeError };

/**
 * Detects and validates a sticker upload from its bytes. Accepts only PNG
 * and WebP within the size and dimension limits; SVG, GIF, APNG and anything
 * else fail as `unknown_type` (magic bytes never match) or as an explicit
 * layout error. Never trusts the caller's content type or file name.
 */
export function probeStickerBytes(bytes: Uint8Array): StickerProbeResult {
  if (bytes.byteLength === 0) {
    return { ok: false, error: 'too_small' };
  }
  if (bytes.byteLength > STICKER_MAX_BYTES) {
    return { ok: false, error: 'too_large' };
  }
  if (isPng(bytes)) {
    const parsed = parsePng(bytes);
    if (!parsed.ok) {
      return parsed;
    }
    if (isAnimatedPng(bytes)) {
      return { ok: false, error: 'animated' };
    }
    return parsed;
  }
  if (isWebp(bytes)) {
    const parsed = parseWebp(bytes);
    if (!parsed.ok) {
      return parsed;
    }
    if (isAnimatedWebp(bytes)) {
      return { ok: false, error: 'animated' };
    }
    return parsed;
  }
  if (bytes.byteLength < 12) {
    return { ok: false, error: 'too_small' };
  }
  return { ok: false, error: 'unknown_type' };
}

/** Maps a probe failure to the public error code of the upload route.
 *  `animated` maps to `sticker_not_image`: stickers accept animated WebP,
 *  so callers that need the distinction (avatars) check the probe error
 *  itself instead of this code. */
export function probeErrorCode(
  error: StickerProbeError,
): 'sticker_not_image' | 'sticker_too_large' {
  switch (error) {
    case 'too_large':
    case 'decode_too_large':
      return 'sticker_too_large';
    default:
      return 'sticker_not_image';
  }
}
