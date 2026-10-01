import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { z } from 'zod';
import { classifyIp } from '../sandbox/ip-guard';
import type { GifPage, GifProvider, GifSearchOptions } from './provider';
import { gifPageSchema } from './provider';

// Giphy media hosts, from the public docs' rendition URLs
// (`mediaN.giphy.com/media/<id>/…`). The API endpoint host is allowed too,
// because a hostile adapter response could otherwise smuggle it in — every
// URL in an item re-checks this list, so the allowlist is enforced on the
// parsed item, not just on what the adapter intended to return.
export const GIPHY_MEDIA_HOSTS = [
  'media0.giphy.com',
  'media1.giphy.com',
  'media2.giphy.com',
  'media3.giphy.com',
  'media4.giphy.com',
  'media.giphy.com',
  'i.giphy.com',
  'api.giphy.com',
] as const;

export const GIPHY_API_HOST = 'api.giphy.com';

const GIPHY_RATINGS = ['g', 'pg', 'pg-13', 'r'] as const;

export type GiphyRating = (typeof GIPHY_RATINGS)[number];

const renditionSchema = z
  .object({
    url: z.string().optional(),
    mp4: z.string().optional(),
    webp: z.string().optional(),
    width: z.string().optional(),
    height: z.string().optional(),
    size: z.string().optional(),
    mp4_size: z.string().optional(),
    webp_size: z.string().optional(),
  })
  .loose();

const gifObjectSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    images: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

const giphyResponseSchema = z
  .object({
    data: z.array(z.unknown()),
    pagination: z
      .object({
        offset: z.number().optional(),
        count: z.number().optional(),
        total_count: z.number().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function httpsOnAllowlist(url: string): URL | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:') {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
  if (!(GIPHY_MEDIA_HOSTS as readonly string[]).includes(host)) {
    return undefined;
  }
  return parsed;
}

// Picks one playable rendition per GIF object: the fixed-width mp4 when
// present (small, loops in the client), else the fixed-width gif/webp, else
// the original. Anything off the media allowlist is dropped, which drops the
// whole item — never a provider URL the UI did not vet.
function toItem(raw: unknown): GifPage['items'][number] | undefined {
  const parsed = gifObjectSchema.safeParse(raw);
  if (!parsed.success) {
    return undefined;
  }
  const images = parsed.data.images ?? {};
  const fixed: unknown = images['fixed_width'];
  const downsized: unknown = images['downsized'];
  const downsizedSmall: unknown = images['downsized_small'];
  const original: unknown = images['original'];
  const fixedRendition = renditionSchema.safeParse(fixed);
  const downsizedRendition = renditionSchema.safeParse(downsized);
  const smallRendition = renditionSchema.safeParse(downsizedSmall);
  const originalRendition = renditionSchema.safeParse(original);
  const candidates = [
    fixedRendition.success ? fixedRendition.data : undefined,
    downsizedRendition.success ? downsizedRendition.data : undefined,
    smallRendition.success ? smallRendition.data : undefined,
    originalRendition.success ? originalRendition.data : undefined,
  ];
  for (const candidate of candidates) {
    if (candidate === undefined) {
      continue;
    }
    const mp4 = candidate.mp4 !== undefined ? httpsOnAllowlist(candidate.mp4) : undefined;
    const url =
      candidate.url !== undefined
        ? httpsOnAllowlist(candidate.url)
        : candidate.webp !== undefined
          ? httpsOnAllowlist(candidate.webp)
          : undefined;
    if (url === undefined) {
      continue;
    }
    const width = positiveInt(candidate.width) ?? 200;
    const height = positiveInt(candidate.height) ?? 200;
    const size =
      positiveInt(candidate.mp4_size) ??
      positiveInt(candidate.size) ??
      positiveInt(candidate.webp_size);
    const item = {
      id: typeof parsed.data.id === 'string' ? parsed.data.id.slice(0, 128) : 'unknown',
      title: (typeof parsed.data.title === 'string' ? parsed.data.title : '').slice(0, 100),
      previewUrl: url.toString(),
      ...(mp4 === undefined ? {} : { mp4Url: mp4.toString() }),
      gifUrl: url.toString(),
      width,
      height,
      ...(size === undefined ? {} : { sizeBytes: size }),
    };
    const validated = z
      .object({
        id: z.string().min(1).max(128),
        title: z.string().max(100),
        previewUrl: z.url().max(2048),
        mp4Url: z.url().max(2048).optional(),
        gifUrl: z.url().max(2048).optional(),
        width: z.number().int().min(1).max(20000),
        height: z.number().int().min(1).max(20000),
        sizeBytes: z
          .number()
          .int()
          .min(0)
          .max(100 * 1024 * 1024)
          .optional(),
      })
      .safeParse(item);
    if (validated.success) {
      return validated.data;
    }
  }
  return undefined;
}

export function parseGiphyResponse(body: unknown): GifPage {
  const parsed = giphyResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { items: [] };
  }
  const items: GifPage['items'] = [];
  for (const raw of parsed.data.data) {
    const item = toItem(raw);
    if (item !== undefined) {
      items.push(item);
    }
  }
  const pagination = parsed.data.pagination;
  const offset = pagination?.offset ?? 0;
  const count = pagination?.count ?? items.length;
  const total = pagination?.total_count ?? offset + count;
  const next = offset + count < total ? String(offset + count) : undefined;
  return { items, ...(next === undefined ? {} : { nextPos: next }) };
}

export interface GiphyProviderOptions {
  apiKey: string;
  rating: GiphyRating;
  fetcher?: GiphyFetcher;
  resolver?: (host: string) => Promise<string[]>;
}

/**
 * The provider call failed (DNS, blocked resolution, network, non-2xx, bad
 * JSON). The message stays neutral — no provider detail ever reaches the
 * client — and the routes turn it into a retryable 502.
 */
export class GiphyError extends Error {
  constructor() {
    super('GIF provider request failed');
    this.name = 'GiphyError';
  }
}

export type GiphyFetcher = (url: URL, address: string) => Promise<{ status: number; body: string }>;

async function defaultResolver(host: string): Promise<string[]> {
  const records = await dnsLookup(host, { all: true });
  return records.map((record) => record.address);
}

// The API call itself goes through the same SSRF guard as the media proxy:
// https only, the documented endpoint host, resolve-then-pin, connect to the
// validated IP with SNI and Host kept, no redirects, 10 s timeout.
async function fetchGiphyApi(
  url: URL,
  address: string,
  timeoutMs: number,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: address,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        servername: url.hostname,
        headers: { host: url.hostname, accept: 'application/json', connection: 'close' },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, body: '' });
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > 1024 * 1024) {
            req.destroy(new Error('response too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', (error: Error) => reject(error));
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('fetch timeout')));
    req.on('timeout', () => req.destroy(new Error('fetch timeout')));
    req.on('error', (error: Error) => reject(error));
    req.end();
  });
}

/** The real `giphy` adapter behind the `GifProvider` port. */
export function createGiphyProvider(options: GiphyProviderOptions): GifProvider {
  const resolver = options.resolver ?? defaultResolver;

  async function call(path: string, query: Record<string, string>): Promise<GifPage> {
    const url = new URL(`https://${GIPHY_API_HOST}${path}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    const addresses = await resolver(GIPHY_API_HOST).catch(() => [] as string[]);
    if (addresses.length === 0) {
      throw new GiphyError();
    }
    for (const address of addresses) {
      if (isIP(address) === 0 || classifyIp(address) === 'blocked') {
        throw new GiphyError();
      }
    }
    const fetcher: GiphyFetcher =
      options.fetcher ?? ((requestUrl, address) => fetchGiphyApi(requestUrl, address, 10_000));
    const first = addresses[0];
    if (first === undefined) {
      throw new GiphyError();
    }
    let response: { status: number; body: string };
    try {
      response = await fetcher(url, first);
    } catch {
      throw new GiphyError();
    }
    if (response.status < 200 || response.status >= 300) {
      throw new GiphyError();
    }
    let body: unknown;
    try {
      body = JSON.parse(response.body) as unknown;
    } catch {
      throw new GiphyError();
    }
    return gifPageSchema.parse(parseGiphyResponse(body));
  }

  return {
    name: 'giphy',
    search(query: string, page: GifSearchOptions): Promise<GifPage> {
      return call('/v1/gifs/search', {
        api_key: options.apiKey,
        q: query.slice(0, 50),
        limit: String(page.limit),
        offset: page.pos ?? '0',
        rating: options.rating,
      });
    },
    trending(page: GifSearchOptions): Promise<GifPage> {
      return call('/v1/gifs/trending', {
        api_key: options.apiKey,
        limit: String(page.limit),
        offset: page.pos ?? '0',
        rating: options.rating,
      });
    },
  };
}

/** A fake provider for tests: deterministic pages, never the network. */
export function createFakeGifProvider(items: GifPage['items'] = []): GifProvider {
  const seed: GifPage['items'] =
    items.length > 0
      ? items
      : [
          {
            id: 'fake-1',
            title: 'Fake cat',
            previewUrl: 'https://media1.giphy.com/media/fake-1/200w.gif',
            mp4Url: 'https://media1.giphy.com/media/fake-1/200w.mp4',
            gifUrl: 'https://media1.giphy.com/media/fake-1/200w.gif',
            width: 200,
            height: 150,
          },
          {
            id: 'fake-2',
            title: 'Fake dog',
            previewUrl: 'https://media2.giphy.com/media/fake-2/200w.gif',
            width: 200,
            height: 200,
          },
        ];
  return {
    name: 'fake',
    search(query: string, page: GifSearchOptions): Promise<GifPage> {
      const filtered = seed.filter((item) =>
        item.title.toLowerCase().includes(query.toLowerCase()),
      );
      return Promise.resolve(paginate(filtered, page));
    },
    trending(page: GifSearchOptions): Promise<GifPage> {
      return Promise.resolve(paginate(seed, page));
    },
  };
}

function paginate(items: GifPage['items'], page: GifSearchOptions): GifPage {
  const offset = Number(page.pos ?? '0');
  const start = Number.isInteger(offset) && offset > 0 ? offset : 0;
  const slice = items.slice(start, start + page.limit);
  const next = start + page.limit < items.length ? String(start + page.limit) : undefined;
  return { items: slice, ...(next === undefined ? {} : { nextPos: next }) };
}
