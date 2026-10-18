// The security edge of the media tool: the URL goes through `guardedGet` (https only,
// port 443, DNS pinned, private/loopback refused, no redirects), the bytes are sniffed,
// sized from the header alone and stripped of metadata before writing. SVG, HTML and
// JavaScript never sniff as allowed. Every refusal is a fixed sentence: no URL, host or
// remote text is echoed.
import { Data, Effect, type Effect as EffectType } from 'effect';
import type { ServerDatabase } from '../db/client';
import type { CardMediaRow } from '../db/rows-agents';
import {
  guardedGet,
  type DnsLookup,
  type GuardedGetOptions,
  type PinnedFetcher,
} from '../web-tools/guarded-fetch';
import { wikipediaUserAgent } from '../web-tools/shared';
import { CardMediaQuotaError, storeCardMedia } from './service';
import { sniffFile, sniffImage } from './sniff';
import { stripImageMetadata } from './strip';

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
