// Fetch one https page through the sandbox guard (https only, port 443, no credentials or
// redirects, DNS pinned, private/loopback/link-local refused) and read its head metadata.
// An image preview answers a server path, not the remote URL, so the image fetch is never
// an open proxy. Never log the URL or the page text: the host and the outcome only.
import { createHash } from 'node:crypto';
import type { LinkPreview } from '@zilar/api-contract';
import type { Logger } from 'pino';
import { Effect } from 'effect';
import { decodeHtmlEntities } from '../markup/entities';
import { firstElement, nextOpenTag, stripComments } from '../markup/scan';
import { guardedGet, type GuardedGetResult } from '../web-tools/guarded-fetch';

// effect-plain: pure head-metadata parsing; malformed input yields null, no I/O
const MAX_INPUT_CHARS = 256 * 1024;
const MAX_TITLE_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 300;
const MAX_IMAGE_CHARS = 2000;

interface LinkPreviewData {
  title?: string;
  description?: string;
  siteName?: string;
  /**
   * The resolved, https-only `og:image` (or `twitter:image`), kept as the remote URL: the
   * fetcher swaps it for a server path backed by its cache.
   */
  imageUrl?: string;
}

/**
 * Reads og: then twitter: then `<title>`/description, decodes entities and trims. Caps the
 * title at 200 and the description at 300 characters; the image is resolved against
 * `pageUrl`, https only and at most 2,000 characters. `null` when there is no title or
 * description.
 */
export function parseLinkPreview(html: string, pageUrl?: string): LinkPreviewData | null {
  const input = html.length > MAX_INPUT_CHARS ? html.slice(0, MAX_INPUT_CHARS) : html;
  const withoutComments = stripComments(input);
  const meta = metaContent(withoutComments);
  const title = cap(
    pick(meta.get('og:title'), meta.get('twitter:title'), titleTagText(withoutComments)),
    MAX_TITLE_CHARS,
  );
  const description = cap(
    pick(meta.get('og:description'), meta.get('twitter:description'), meta.get('description')),
    MAX_DESCRIPTION_CHARS,
  );
  const siteName = pick(meta.get('og:site_name'));
  const imageUrl = resolveImageUrl(pick(meta.get('og:image'), meta.get('twitter:image')), pageUrl);
  if (title === undefined && description === undefined) {
    return null;
  }
  return {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(siteName === undefined ? {} : { siteName }),
    ...(imageUrl === undefined ? {} : { imageUrl }),
  };
}

// Keep the image only when the resolved URL is https and at most 2,000 characters.
function resolveImageUrl(
  value: string | undefined,
  pageUrl: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  let resolved: string;
  try {
    resolved = pageUrl === undefined ? value : new URL(value, pageUrl).toString();
  } catch {
    return undefined;
  }
  if (!/^https:\/\//i.test(resolved)) {
    return undefined;
  }
  return cap(resolved, MAX_IMAGE_CHARS);
}

// The first non-empty value (entities decoded, whitespace collapsed).
function pick(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const cleaned = value === undefined ? '' : cleanText(value);
    if (cleaned.length > 0) {
      return cleaned;
    }
  }
  return undefined;
}

function cleanText(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, ' ').trim();
}

function cap(value: string | undefined, max: number): string | undefined {
  if (value === undefined || value.length <= max) {
    return value;
  }
  return value.slice(0, max);
}

// Every `<meta>` tag keyed by `property` (og:) or `name`; the first tag for a key wins.
function metaContent(html: string): Map<string, string> {
  const found = new Map<string, string>();
  let cursor = 0;
  while (true) {
    const tag = nextOpenTag(html, 'meta', cursor);
    if (tag === null) {
      break;
    }
    const attributes = readAttributes(tag.attrs);
    const key = (attributes.get('property') ?? attributes.get('name') ?? '').trim().toLowerCase();
    const content = attributes.get('content');
    if (key.length > 0 && content !== undefined && !found.has(key)) {
      found.set(key, content);
    }
    cursor = tag.end;
  }
  return found;
}

function titleTagText(html: string): string | undefined {
  return firstElement(html, 'title')?.inner;
}

// Attribute order varies, so each tag is parsed into a name -> value map.
function readAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of tag.matchAll(pattern)) {
    const name = match[1]?.toLowerCase();
    if (name === undefined || attributes.has(name)) {
      continue;
    }
    attributes.set(name, match[3] ?? match[4] ?? match[5] ?? '');
  }
  return attributes;
}

export const LINK_PREVIEW_TIMEOUT_MS = 8000;
export const LINK_PREVIEW_MAX_BYTES = 512 * 1024;
export const LINK_PREVIEW_HIT_TTL_MS = 24 * 60 * 60 * 1000;
export const LINK_PREVIEW_MISS_TTL_MS = 60 * 60 * 1000;
export const LINK_PREVIEW_MAX_ENTRIES = 2000;

// The image side: at most 200 images and 50 MB in total (oldest first), and the key map
// is capped the same way. A full 2 MB cap and no truncation: a partial image is not an image.
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

export type LinkPreviewFetcher = (url: string) => Promise<GuardedGetResult>;

export interface LinkPreviewOptions {
  logger?: Logger;
  now?: () => number;
  fetcher?: LinkPreviewFetcher;
}

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
 * Unfurls one URL. A hit lasts 24 h and a `null` answer 1 h; concurrent calls share one
 * fetch. Never fails: redirect, error, non-HTML or no title/description all answer `null`.
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
 * The image behind one preview key. An unknown or expired key answers `null`, so a caller
 * can never fetch outside the cache.
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
    // A bot User-Agent (Wikimedia and others refuse requests without one), an HTML
    // Accept, and only the first 512 KB of a big page: the `<head>` is in the first few KB.
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
    // Image types only, so SVG or HTML is refused; no truncation and a 2 MB cap.
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

// `guardedGet` already refuses redirects, errors and non-allowed content types; only
// `text/html` is parsed here.
function previewOf(result: GuardedGetResult, pageUrl: string): LinkPreviewData | null {
  if (!result.ok || result.body.contentType !== 'text/html') {
    return null;
  }
  return parseLinkPreview(result.body.text, pageUrl);
}

// The key is the SHA-256 of the remote URL: stable, and not reversible, so a guessed key
// still learns nothing about the URL.
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
  // A concurrent request for the same key can reach here twice, so replace the accounted
  // size rather than adding to it.
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
