// T-1234: fetch one https page through the sandbox guard and read its head
// metadata, with a small in-memory cache.
//
// The guard (`web-tools/guarded-fetch.ts`) is the same one the AI web tools
// use: https only, port 443, no credentials, no redirects, the DNS answer
// pinned and every resolved address classified (private, loopback and
// link-local are refused). `anyPublicHost` drops only the exact-host
// allowlist, because a preview follows a URL a person pasted, not a fixed
// site list.
//
// T-1252: a preview with an image mints a key for the remote image URL and
// answers the server path `/api/link-preview/image/<key>` instead. The remote
// URL stays in `imageKeys`, so `fetchLinkPreviewImage` can only fetch a URL a
// cached preview already saw — never an open proxy. The image bytes are
// fetched through the same guard with an image-only content-type allowlist
// and cached in memory.
//
// The body is a `Promise` over the guard's own `Promise` edge
// (`docs/EFFECT_GUIDE.md`), lifted into an `Effect` at the public edge. Never
// log the URL or the page text: the host and the outcome only.
import { createHash } from 'node:crypto';
import type { LinkPreview } from '@zilar/api-contract';
import type { Logger } from 'pino';
import { Effect } from 'effect';
import { guardedGet, type GuardedGetResult } from '../web-tools/guarded-fetch';
import { parseLinkPreview, type LinkPreviewData } from './parse';

export const LINK_PREVIEW_TIMEOUT_MS = 8000;
export const LINK_PREVIEW_MAX_BYTES = 512 * 1024;
export const LINK_PREVIEW_HIT_TTL_MS = 24 * 60 * 60 * 1000;
export const LINK_PREVIEW_MISS_TTL_MS = 60 * 60 * 1000;
export const LINK_PREVIEW_MAX_ENTRIES = 2000;

// T-1252: the image side. The bytes cache holds at most 200 images and 50 MB
// in total (oldest first), and the key map is capped the same way. Images are
// fetched with the same 8 s deadline but a full 2 MB cap and no truncation: a
// partial image is not an image.
export const LINK_PREVIEW_IMAGE_TIMEOUT_MS = 8000;
export const LINK_PREVIEW_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const LINK_PREVIEW_IMAGE_MAX_ENTRIES = 200;
export const LINK_PREVIEW_IMAGE_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const LINK_PREVIEW_IMAGE_CONTENT_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

/** The guarded GET, injectable in tests. */
export type LinkPreviewFetcher = (url: string) => Promise<GuardedGetResult>;

export interface LinkPreviewOptions {
  logger?: Logger;
  now?: () => number;
  fetcher?: LinkPreviewFetcher;
}

/** T-1252: the bytes of one preview image, with its upstream content type. */
export interface LinkPreviewImage {
  contentType: string;
  bytes: Uint8Array;
}

interface CacheEntry {
  at: number;
  ttl: number;
  value: LinkPreview | null;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<LinkPreview | null>>();

// key -> remote image URL, minted only for a cached preview with an image.
const imageKeys = new Map<string, { at: number; url: string }>();
// key -> fetched image bytes.
const imageBytes = new Map<string, { at: number; contentType: string; bytes: Uint8Array }>();
let imageBytesTotal = 0;

/** The cache key: the URL without its fragment (a fragment never changes the page). */
export function normalizePreviewUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  url.hash = '';
  return url.toString();
}

/**
 * Unfurls one URL. A hit lasts 24 h and a `null` answer 1 h; both are cached.
 * Two concurrent calls for the same URL share one fetch. Never fails: a
 * redirect, an error, a non-HTML answer or a page with no title and no
 * description all answer `null`.
 */
export function fetchLinkPreview(
  rawUrl: string,
  options: LinkPreviewOptions = {},
): Effect.Effect<LinkPreview | null> {
  return Effect.suspend(() => {
    const key = normalizePreviewUrl(rawUrl);
    if (key === null) {
      return Effect.succeed(null);
    }
    const now = options.now ?? Date.now;
    const cached = cache.get(key);
    if (cached !== undefined) {
      if (now() - cached.at < cached.ttl) {
        return Effect.succeed(cached.value);
      }
      cache.delete(key);
    }
    const running = inFlight.get(key);
    const task = running ?? startLoad(key, options, now);
    return Effect.promise(() => task);
  });
}

/**
 * T-1252: the bytes of the image behind one preview key. An unknown or
 * expired key answers `null` (the route renders 404), so a caller can never
 * fetch anything outside the cache. A fetched image is served from memory
 * afterwards.
 */
export function fetchLinkPreviewImage(
  key: string,
  options: LinkPreviewOptions = {},
): Effect.Effect<LinkPreviewImage | null> {
  return Effect.suspend(() => {
    const now = options.now ?? Date.now;
    const entry = imageKeys.get(key);
    if (entry === undefined) {
      return Effect.succeed(null);
    }
    if (now() - entry.at >= LINK_PREVIEW_HIT_TTL_MS) {
      imageKeys.delete(key);
      return Effect.succeed(null);
    }
    const cached = imageBytes.get(key);
    if (cached !== undefined) {
      return Effect.succeed({ contentType: cached.contentType, bytes: cached.bytes });
    }
    return Effect.promise(() => loadImage(key, entry.url, options, now));
  });
}

/** Forgets the in-memory caches (tests only). */
export function resetLinkPreviewCache(): void {
  cache.clear();
  inFlight.clear();
  imageKeys.clear();
  imageBytes.clear();
  imageBytesTotal = 0;
}

function startLoad(
  key: string,
  options: LinkPreviewOptions,
  now: () => number,
): Promise<LinkPreview | null> {
  const task = load(key, options, now).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, task);
  return task;
}

async function load(
  key: string,
  options: LinkPreviewOptions,
  now: () => number,
): Promise<LinkPreview | null> {
  const fetcher = options.fetcher ?? defaultFetcher;
  const result = await fetcher(key);
  const parsed = previewOf(result, key);
  const preview = parsed === null ? null : toView(parsed, now());
  cache.set(key, {
    at: now(),
    ttl: preview === null ? LINK_PREVIEW_MISS_TTL_MS : LINK_PREVIEW_HIT_TTL_MS,
    value: preview,
  });
  dropOldest();
  options.logger?.debug({ host: hostOf(key), ok: preview !== null }, 'link preview fetched');
  return preview;
}

function defaultFetcher(url: string): Promise<GuardedGetResult> {
  return guardedGet(url, {
    allowedHosts: [],
    anyPublicHost: true,
    // T-1240: a bot User-Agent (Wikimedia and others refuse requests without
    // one) with an HTML Accept, and read only the first 512 KB of a big page
    // instead of failing it as too large: the `<head>` is in the first few KB.
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; ZilarBot/1.0; +https://chat.zilar.app)',
      accept: 'text/html,application/xhtml+xml',
    },
    timeoutMs: LINK_PREVIEW_TIMEOUT_MS,
    maxResponseBytes: LINK_PREVIEW_MAX_BYTES,
    truncateAtMax: true,
  });
}

function defaultImageFetcher(url: string): Promise<GuardedGetResult> {
  return guardedGet(url, {
    allowedHosts: [],
    anyPublicHost: true,
    // T-1252: image types only, so an SVG or an HTML page is refused. No
    // truncation and a 2 MB cap: a too-large image is a miss, not a partial
    // file.
    allowedContentTypes: LINK_PREVIEW_IMAGE_CONTENT_TYPES,
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; ZilarBot/1.0; +https://chat.zilar.app)',
      accept: 'image/jpeg,image/png,image/webp,image/gif',
    },
    timeoutMs: LINK_PREVIEW_IMAGE_TIMEOUT_MS,
    maxResponseBytes: LINK_PREVIEW_IMAGE_MAX_BYTES,
    truncateAtMax: false,
  });
}

// `guardedGet` already refuses redirects, errors and any non-allowed content
// type; only `text/html` is parsed here. `pageUrl` is the fetched URL, used to
// resolve a relative `og:image` (T-1252).
function previewOf(result: GuardedGetResult, pageUrl: string): LinkPreviewData | null {
  if (!result.ok || result.body.contentType !== 'text/html') {
    return null;
  }
  return parseLinkPreview(result.body.text, pageUrl);
}

// T-1252: the key is the SHA-256 of the remote image URL: stable (the same
// image shares one cache entry) and not reversible, so a client that guesses
// a key still learns nothing about the URL.
function toView(data: LinkPreviewData, at: number): LinkPreview {
  const fields: Pick<LinkPreview, 'title' | 'description' | 'siteName'> = {
    ...(data.title === undefined ? {} : { title: data.title }),
    ...(data.description === undefined ? {} : { description: data.description }),
    ...(data.siteName === undefined ? {} : { siteName: data.siteName }),
  };
  if (data.imageUrl === undefined) {
    return fields;
  }
  const key = imageKeyFor(data.imageUrl);
  imageKeys.set(key, { at, url: data.imageUrl });
  dropOldestImageKey();
  return { ...fields, image: `/api/link-preview/image/${key}` };
}

function imageKeyFor(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

async function loadImage(
  key: string,
  url: string,
  options: LinkPreviewOptions,
  now: () => number,
): Promise<LinkPreviewImage | null> {
  const result = await defaultImageFetcher(url);
  if (
    !result.ok ||
    result.body.contentType === null ||
    !LINK_PREVIEW_IMAGE_CONTENT_TYPES.includes(result.body.contentType)
  ) {
    options.logger?.debug({ host: hostOf(url), ok: false }, 'link preview image fetched');
    return null;
  }
  const image: LinkPreviewImage = {
    contentType: result.body.contentType,
    bytes: result.body.bytes,
  };
  // A concurrent request for the same key can reach here twice, so replace the
  // accounted size rather than adding to it.
  const previous = imageBytes.get(key);
  if (previous !== undefined) {
    imageBytesTotal -= previous.bytes.byteLength;
  }
  imageBytes.set(key, { at: now(), ...image });
  imageBytesTotal += image.bytes.byteLength;
  dropOldestImage();
  options.logger?.debug({ host: hostOf(url), ok: true }, 'link preview image fetched');
  return image;
}

// `Map` keeps insertion order, so the first key is the oldest entry.
function dropOldest(): void {
  dropOldestKey(cache, LINK_PREVIEW_MAX_ENTRIES);
}

function dropOldestImageKey(): void {
  dropOldestKey(imageKeys, LINK_PREVIEW_IMAGE_MAX_ENTRIES);
}

function dropOldestKey<T>(map: Map<string, T>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) {
      return;
    }
    map.delete(oldest);
  }
}

function dropOldestImage(): void {
  while (
    imageBytes.size > LINK_PREVIEW_IMAGE_MAX_ENTRIES ||
    imageBytesTotal > LINK_PREVIEW_IMAGE_MAX_TOTAL_BYTES
  ) {
    const oldest = imageBytes.keys().next().value;
    if (oldest === undefined) {
      return;
    }
    const entry = imageBytes.get(oldest);
    imageBytes.delete(oldest);
    imageBytesTotal -= entry?.bytes.byteLength ?? 0;
  }
}

function hostOf(key: string): string {
  try {
    return new URL(key).hostname;
  } catch {
    return '';
  }
}
