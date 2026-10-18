// Magic-byte detection and header parsing for sticker uploads. Only
// `image/webp` (static or animated) and `image/png` are stored; the type
// comes from magic bytes, never the client's `Content-Type` or file name,
// and width/height are parsed from headers without a dependency.
import { readU16LE, readU24LE, readU32BE, readU32LE } from '../media-bytes';

export const STICKER_MAX_BYTES = 512 * 1024;
export const STICKER_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const STICKER_MAX_DIMENSION = 512;
/** Decoded pixels (width × height × RGBA) stay under this: a PNG header
 *  claiming 60 000 × 60 000 is a decompression bomb. */
export const STICKER_MAX_DECODED_BYTES = 4 * 1024 * 1024;

export interface StickerProbeLimits {
  maxBytes?: number;
  maxDimension?: number;
  maxDecodedBytes?: number;
}

export type StickerMime = 'image/webp' | 'image/png';

export interface StickerImageInfo {
  mime: StickerMime;
  width: number;
  height: number;
  /** True for an animated WebP (VP8X animation flag) or an APNG (`acTL`
   *  before any `IDAT`); set by the parser, never a failure. */
  animated: boolean;
}

export type StickerProbeError =
  | 'too_small'
  | 'unknown_type'
  | 'truncated'
  | 'invalid_dimensions'
  | 'too_large'
  | 'decode_too_large'
  | 'unsupported_layout';

export function isAnimatedWebp(bytes: Uint8Array): boolean {
  if (!isWebp(bytes) || bytes.length < 21) {
    return false;
  }
  const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (chunk !== 'VP8X') {
    return false;
  }
  if (bytes.length < 21) {
    return false;
  }
  return (bytes[20]! & 0x02) !== 0;
}

export function isAnimatedPng(bytes: Uint8Array): boolean {
  if (!isPng(bytes)) {
    return false;
  }
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readU32BE(bytes, offset);
    if (length === null || !Number.isSafeInteger(length) || length > bytes.length) {
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

/** Validates dimensions: integers in [1, 512] × [1, 512], and the decoded
 *  RGBA frame must fit in 4 MiB. */
function checkDimensions(
  width: number,
  height: number,
  limits: StickerProbeLimits = {},
): { ok: true } | { ok: false; error: StickerProbeError } {
  const maxDimension = limits.maxDimension ?? STICKER_MAX_DIMENSION;
  const maxDecodedBytes = limits.maxDecodedBytes ?? STICKER_MAX_DECODED_BYTES;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return { ok: false, error: 'invalid_dimensions' };
  }
  if (width > maxDimension || height > maxDimension) {
    return { ok: false, error: 'too_large' };
  }
  if (width * height * 4 > maxDecodedBytes) {
    return { ok: false, error: 'decode_too_large' };
  }
  return { ok: true };
}

function parsePng(
  bytes: Uint8Array,
  limits: StickerProbeLimits = {},
): { ok: true; info: StickerImageInfo } | { ok: false; error: StickerProbeError } {
  if (bytes.length < 24) {
    return { ok: false, error: 'truncated' };
  }
  const ihdrLength = readU32BE(bytes, 8);
  if (ihdrLength === null || ihdrLength < 13) {
    return { ok: false, error: 'truncated' };
  }
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return { ok: false, error: 'unsupported_layout' };
  }
  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  if (width === null || height === null) {
    return { ok: false, error: 'truncated' };
  }
  const checked = checkDimensions(width, height, limits);
  if (!checked.ok) {
    return checked;
  }
  return { ok: true, info: { mime: 'image/png', width, height, animated: isAnimatedPng(bytes) } };
}

/** Parses a WebP RIFF container: VP8 (lossy) and VP8L (lossless) carry the
 *  canvas directly, VP8X (extended, incl. animated) carries it minus one;
 *  anything else is rejected. */
function parseWebp(
  bytes: Uint8Array,
  limits: StickerProbeLimits = {},
): { ok: true; info: StickerImageInfo } | { ok: false; error: StickerProbeError } {
  if (bytes.length < 21) {
    return { ok: false, error: 'truncated' };
  }
  const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (chunk === 'VP8 ') {
    if (bytes.length < 30) {
      return { ok: false, error: 'truncated' };
    }
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      return { ok: false, error: 'unsupported_layout' };
    }
    const rawWidth = readU16LE(bytes, 26);
    const rawHeight = readU16LE(bytes, 28);
    if (rawWidth === null || rawHeight === null) {
      return { ok: false, error: 'truncated' };
    }
    const width = rawWidth & 0x3fff;
    const height = rawHeight & 0x3fff;
    const checked = checkDimensions(width, height, limits);
    if (!checked.ok) {
      return checked;
    }
    return { ok: true, info: { mime: 'image/webp', width, height, animated: false } };
  }
  if (chunk === 'VP8L') {
    if (bytes.length < 25) {
      return { ok: false, error: 'truncated' };
    }
    if (bytes[20] !== 0x2f) {
      return { ok: false, error: 'unsupported_layout' };
    }
    const bits = readU32LE(bytes, 21);
    if (bits === null) {
      return { ok: false, error: 'truncated' };
    }
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    const checked = checkDimensions(width, height, limits);
    if (!checked.ok) {
      return checked;
    }
    return { ok: true, info: { mime: 'image/webp', width, height, animated: false } };
  }
  if (chunk === 'VP8X') {
    if (bytes.length < 30) {
      return { ok: false, error: 'truncated' };
    }
    const rawWidth = readU24LE(bytes, 24);
    const rawHeight = readU24LE(bytes, 27);
    if (rawWidth === null || rawHeight === null) {
      return { ok: false, error: 'truncated' };
    }
    const width = rawWidth + 1;
    const height = rawHeight + 1;
    const checked = checkDimensions(width, height, limits);
    if (!checked.ok) {
      return checked;
    }
    return {
      ok: true,
      info: { mime: 'image/webp', width, height, animated: isAnimatedWebp(bytes) },
    };
  }
  return { ok: false, error: 'unsupported_layout' };
}

export type StickerProbeResult =
  { ok: true; info: StickerImageInfo } | { ok: false; error: StickerProbeError };

/** Detects and validates a sticker upload from its bytes: only PNG and WebP
 *  within the size and dimension limits, with an `animated` flag for callers
 *  that accept only stills. Never trusts the content type or file name. */
export function probeStickerBytes(
  bytes: Uint8Array,
  limits: StickerProbeLimits = {},
): StickerProbeResult {
  if (bytes.byteLength === 0) {
    return { ok: false, error: 'too_small' };
  }
  if (bytes.byteLength > (limits.maxBytes ?? STICKER_MAX_BYTES)) {
    return { ok: false, error: 'too_large' };
  }
  if (isPng(bytes)) {
    return parsePng(bytes, limits);
  }
  if (isWebp(bytes)) {
    return parseWebp(bytes, limits);
  }
  if (bytes.byteLength < 12) {
    return { ok: false, error: 'too_small' };
  }
  return { ok: false, error: 'unknown_type' };
}

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
