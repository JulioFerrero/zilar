// The security edge of the media tool: the URL goes through `guardedGet` (https only,
// port 443, DNS pinned, private/loopback refused, no redirects), the bytes are sniffed,
// sized from the header alone and stripped of metadata before writing. SVG, HTML and
// JavaScript never sniff as allowed. Every refusal is a fixed sentence: no URL, host or
// remote text is echoed.
import { isUtf8 } from 'node:buffer';
import { Data, Effect, type Effect as EffectType } from 'effect';
import type { ServerDatabase } from '../db/client';
import type { CardMediaRow } from '../db/rows-agents';
import { readU16BE, readU16LE, readU24LE, readU32BE, readU32LE, writeU32LE } from '../media-bytes';
import { isPng, isWebp } from '../stickers/image';
import {
  guardedGet,
  type DnsLookup,
  type GuardedGetOptions,
  type PinnedFetcher,
} from '../web-tools/guarded-fetch';
import { wikipediaUserAgent } from '../web-tools/shared';
import { CardMediaQuotaError, storeCardMedia } from './service';

export const CARD_MEDIA_URL_MAX_LENGTH = 2048;
export const CARD_MEDIA_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const CARD_MEDIA_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const CARD_MEDIA_IMAGE_MAX_SIDE = 4096;
export const CARD_MEDIA_IMAGE_MAX_PIXELS = 16_000_000;

const IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const FILE_CONTENT_TYPES = ['application/pdf', 'text/csv', 'text/plain'] as const;

const REFUSED_URL = 'only https urls are allowed';
const REFUSED_URL_LENGTH = 'the url is too long';
const REFUSED_FETCH = 'the file could not be fetched';
const REFUSED_TOO_LARGE = 'the file is too large';
const REFUSED_IMAGE_TYPE = 'the file is not a supported image';
const REFUSED_IMAGE_PIXELS = 'the image is too large';
const REFUSED_IMAGE_STRUCTURE = 'the image could not be processed';
const REFUSED_FILE_TYPE = 'the file type is not supported';
const REFUSED_QUOTA = 'media quota reached';

export interface FetchCardMediaDeps {
  db: ServerDatabase;
  dir: string;
  resolver?: DnsLookup;
  fetcher?: PinnedFetcher;
}

export interface FetchCardMediaInput {
  aiId: string;
  roomJid: string;
  groupId?: string | null;
  topicId?: string | null;
  url: string;
  kind: 'image' | 'file';
  name?: string;
}

export interface FetchedCardMedia {
  id: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  name: string;
}

export type FetchCardMediaResult =
  { ok: true; media: FetchedCardMedia } | { ok: false; reason: string };

class MediaQuotaReached extends Data.TaggedError('MediaQuotaReached') {}

class MediaStoreFailed extends Data.TaggedError('MediaStoreFailed')<{ readonly cause: unknown }> {}

function refuse(reason: string): FetchCardMediaResult {
  return { ok: false, reason };
}

// The display name only; the bytes are stored under a server-made UUID. A supplied name
// is trimmed and capped, otherwise the last URL segment is reduced to a safe character set.
function displayName(raw: string | undefined, url: URL, fallback: string): string {
  const given = raw?.trim();
  if (given !== undefined && given !== '') {
    return given.slice(0, 100);
  }
  const segment = url.pathname
    .split('/')
    .filter((part) => part !== '')
    .pop();
  if (segment !== undefined) {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      decoded = segment;
    }
    const safe = decoded
      .replace(/[^A-Za-z0-9._ -]/g, '')
      .trim()
      .slice(0, 100);
    if (safe !== '') {
      return safe;
    }
  }
  return fallback;
}

function exceedsPixelLimit(width: number, height: number): boolean {
  return (
    width > CARD_MEDIA_IMAGE_MAX_SIDE ||
    height > CARD_MEDIA_IMAGE_MAX_SIDE ||
    width * height > CARD_MEDIA_IMAGE_MAX_PIXELS
  );
}

export function fetchCardMedia(
  deps: FetchCardMediaDeps,
  input: FetchCardMediaInput,
): Promise<FetchCardMediaResult> {
  return Effect.runPromise(fetchCardMediaEffect(deps, input));
}

const fetchCardMediaEffect = Effect.fnUntraced(function* (
  deps: FetchCardMediaDeps,
  input: FetchCardMediaInput,
): EffectType.fn.Return<FetchCardMediaResult, MediaStoreFailed> {
  if (input.url.length > CARD_MEDIA_URL_MAX_LENGTH) {
    return refuse(REFUSED_URL_LENGTH);
  }
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return refuse(REFUSED_URL);
  }
  if (url.protocol !== 'https:') {
    return refuse(REFUSED_URL);
  }

  const isImage = input.kind === 'image';
  const maxBytes = isImage ? CARD_MEDIA_IMAGE_MAX_BYTES : CARD_MEDIA_FILE_MAX_BYTES;
  const name = displayName(input.name, url, isImage ? 'image' : 'file');

  const options: GuardedGetOptions = {
    allowedHosts: [],
    anyPublicHost: true,
    allowedContentTypes: isImage ? IMAGE_CONTENT_TYPES : FILE_CONTENT_TYPES,
    maxResponseBytes: maxBytes,
    // Wikimedia answers 403 without a User-Agent; send the same descriptive one as the web tools.
    headers: { 'user-agent': wikipediaUserAgent(), accept: isImage ? 'image/*' : '*/*' },
  };
  if (deps.resolver !== undefined) {
    options.resolver = deps.resolver;
  }
  if (deps.fetcher !== undefined) {
    options.fetcher = deps.fetcher;
  }

  const fetched = yield* Effect.promise(() => guardedGet(input.url, options));
  if (!fetched.ok) {
    return refuse(fetched.summary === 'response too large' ? REFUSED_TOO_LARGE : REFUSED_FETCH);
  }
  const bytes = fetched.body.bytes;
  // The real transport enforces the cap; this guards an injected or future transport.
  if (bytes.byteLength > maxBytes) {
    return refuse(REFUSED_TOO_LARGE);
  }

  let mime: string;
  let width: number | undefined;
  let height: number | undefined;
  let cleaned: Uint8Array;
  if (isImage) {
    const image = sniffImage(bytes);
    if (image === null) {
      return refuse(REFUSED_IMAGE_TYPE);
    }
    if (exceedsPixelLimit(image.width, image.height)) {
      return refuse(REFUSED_IMAGE_PIXELS);
    }
    const stripped = stripImageMetadata(bytes, image.mime);
    if (stripped === null) {
      return refuse(REFUSED_IMAGE_STRUCTURE);
    }
    mime = image.mime;
    width = image.width;
    height = image.height;
    cleaned = stripped;
  } else {
    const file = sniffFile(bytes, name);
    if (file === null) {
      return refuse(REFUSED_FILE_TYPE);
    }
    mime = file;
    cleaned = bytes;
  }

  const row: CardMediaRow | null = yield* Effect.tryPromise({
    try: () =>
      storeCardMedia(deps.db, deps.dir, {
        aiId: input.aiId,
        roomJid: input.roomJid,
        groupId: input.groupId ?? null,
        topicId: input.topicId ?? null,
        mime,
        name,
        width: width ?? null,
        height: height ?? null,
        bytes: cleaned,
      }),
    catch: (error) =>
      error instanceof CardMediaQuotaError
        ? new MediaQuotaReached()
        : new MediaStoreFailed({ cause: error }),
  }).pipe(Effect.catchTag('MediaQuotaReached', () => Effect.succeed(null)));
  if (row === null) {
    return refuse(REFUSED_QUOTA);
  }

  const media: FetchedCardMedia = { id: row.id, mime: row.mime, size: row.size, name: row.name };
  if (width !== undefined) {
    media.width = width;
  }
  if (height !== undefined) {
    media.height = height;
  }
  return { ok: true, media };
});
// Metadata is removed before the bytes get a row and an id. Pixels are never re-encoded:
// only the carrying segments are dropped. A structure the walker cannot follow returns
// `null`, and the caller refuses the file rather than storing it uncleaned.
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

// The fetcher trusts bytes, never the declared type or file name. Dimensions come from
// the header alone (no decode), so a decompression bomb is refused before it reaches a
// phone. `sniffFile` accepts PDF and plain text only.
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

export function readJpegMarker(
  bytes: Uint8Array,
  offset: number,
): { marker: number; offset: number } | null {
  if (bytes[offset] !== 0xff) return null;
  let marker = bytes[offset + 1];
  if (marker === undefined) return null;
  offset += 2;
  while (marker === 0xff) {
    marker = bytes[offset];
    if (marker === undefined) return null;
    offset += 1;
  }
  return { marker, offset };
}

function sniffJpeg(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset < bytes.length) {
    const found = readJpegMarker(bytes, offset);
    if (found === null) {
      return null;
    }
    const { marker } = found;
    offset = found.offset;
    // TEM and the restart markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
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

// WebP: RIFF container; VP8, VP8L and VP8X each lay the canvas size out differently.
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

// Must decode as UTF-8 with no NUL: a `.csv` name only chooses the label, the text is
// what makes it a text file.
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
