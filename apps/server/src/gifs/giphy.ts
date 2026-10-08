import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Data, Duration, Effect, Exit, Schema, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';
import { classifyIp } from '../sandbox/ip-guard';
import type { GifPage, GifProvider, GifSearchOptions } from './provider';
import { gifItemSchema, gifPageSchema } from './provider';

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

// Unknown keys are kept, like the old zod `.loose()`: Giphy adds renditions
// and fields as it likes and only the ones we read matter.
const passthrough = [Schema.Record(Schema.String, Schema.Unknown)] as const;

const renditionSchema = Schema.StructWithRest(
  struct({
    url: Schema.optional(Schema.String),
    mp4: Schema.optional(Schema.String),
    webp: Schema.optional(Schema.String),
    width: Schema.optional(Schema.String),
    height: Schema.optional(Schema.String),
    size: Schema.optional(Schema.String),
    mp4_size: Schema.optional(Schema.String),
    webp_size: Schema.optional(Schema.String),
  }),
  passthrough,
);

const gifObjectSchema = Schema.StructWithRest(
  struct({
    id: Schema.optional(Schema.String),
    title: Schema.optional(Schema.String),
    images: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
  passthrough,
);

const giphyResponseSchema = Schema.StructWithRest(
  struct({
    data: Schema.Array(Schema.Unknown),
    pagination: Schema.optional(
      Schema.StructWithRest(
        struct({
          offset: Schema.optional(Schema.Number),
          count: Schema.optional(Schema.Number),
          total_count: Schema.optional(Schema.Number),
        }),
        passthrough,
      ),
    ),
  }),
  passthrough,
);

function decodeRendition(value: unknown): typeof renditionSchema.Type | undefined {
  const decoded = Schema.decodeUnknownExit(renditionSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : undefined;
}

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
  const parsed = Schema.decodeUnknownExit(gifObjectSchema)(raw);
  if (!Exit.isSuccess(parsed)) {
    return undefined;
  }
  const images = parsed.value.images ?? {};
  const candidates = [
    decodeRendition(images['fixed_width']),
    decodeRendition(images['downsized']),
    decodeRendition(images['downsized_small']),
    decodeRendition(images['original']),
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
      id: typeof parsed.value.id === 'string' ? parsed.value.id.slice(0, 128) : 'unknown',
      title: (typeof parsed.value.title === 'string' ? parsed.value.title : '').slice(0, 100),
      previewUrl: url.toString(),
      ...(mp4 === undefined ? {} : { mp4Url: mp4.toString() }),
      gifUrl: url.toString(),
      width,
      height,
      ...(size === undefined ? {} : { sizeBytes: size }),
    };
    const validated = Schema.decodeUnknownExit(gifItemSchema)(item);
    if (Exit.isSuccess(validated)) {
      return validated.value;
    }
  }
  return undefined;
}

export function parseGiphyResponse(body: unknown): GifPage {
  const parsed = Schema.decodeUnknownExit(giphyResponseSchema)(body);
  if (!Exit.isSuccess(parsed)) {
    return { items: [] };
  }
  const items: GifPage['items'] = [];
  for (const raw of parsed.value.data) {
    const item = toItem(raw);
    if (item !== undefined) {
      items.push(item);
    }
  }
  const pagination = parsed.value.pagination;
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

const GIPHY_API_TIMEOUT_MS = 10_000;
const GIPHY_API_MAX_BYTES = 1024 * 1024;

// The internal failure mode: every resolve, filter, fetch and parse failure
// funnels into this one tagged error, which the `Promise` boundary maps to the
// neutral `GiphyError`. It carries no payload, so no provider detail leaks.
class GiphyRequestFailed extends Data.TaggedError('GiphyRequestFailed') {}

async function defaultResolver(host: string): Promise<string[]> {
  const records = await dnsLookup(host, { all: true });
  return records.map((record) => record.address);
}

// The API call itself goes through the same SSRF guard as the media proxy:
// https only, the documented endpoint host, resolve-then-pin, connect to the
// validated IP with SNI and Host kept, no redirects. The request is an
// interruptible effect: the timeout interrupts it and the finalizer destroys
// the socket, so a slow host never holds a connection.
const giphyRequestEffect = (
  url: URL,
  address: string,
): EffectType.Effect<{ status: number; body: string }, GiphyRequestFailed> =>
  Effect.callback<{ status: number; body: string }, GiphyRequestFailed>((resume) => {
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
          resume(Effect.succeed({ status, body: '' }));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > GIPHY_API_MAX_BYTES) {
            req.destroy(new Error('response too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resume(Effect.succeed({ status, body: Buffer.concat(chunks).toString('utf8') })),
        );
        res.on('error', () => resume(Effect.fail(new GiphyRequestFailed())));
      },
    );
    req.on('error', () => resume(Effect.fail(new GiphyRequestFailed())));
    req.end();
    return Effect.sync(() => {
      req.destroy();
    });
  });

/** The real `giphy` adapter behind the `GifProvider` port. */
export function createGiphyProvider(options: GiphyProviderOptions): GifProvider {
  const resolver = options.resolver ?? defaultResolver;

  const fetchApi = (
    url: URL,
    address: string,
  ): EffectType.Effect<{ status: number; body: string }, GiphyRequestFailed> => {
    const fetcher = options.fetcher;
    if (fetcher === undefined) {
      return giphyRequestEffect(url, address);
    }
    return Effect.tryPromise({
      try: () => fetcher(url, address),
      catch: () => new GiphyRequestFailed(),
    });
  };

  const call = Effect.fnUntraced(function* (
    path: string,
    query: Record<string, string>,
  ): EffectType.fn.Return<GifPage, GiphyRequestFailed> {
    const url = new URL(`https://${GIPHY_API_HOST}${path}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    const addresses = yield* Effect.tryPromise({
      try: () => resolver(GIPHY_API_HOST),
      catch: () => new GiphyRequestFailed(),
    });
    if (addresses.length === 0) {
      return yield* new GiphyRequestFailed();
    }
    for (const address of addresses) {
      if (isIP(address) === 0 || classifyIp(address) === 'blocked') {
        return yield* new GiphyRequestFailed();
      }
    }
    const first = addresses[0];
    if (first === undefined) {
      return yield* new GiphyRequestFailed();
    }
    const response = yield* fetchApi(url, first).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(GIPHY_API_TIMEOUT_MS),
        orElse: () => Effect.fail(new GiphyRequestFailed()),
      }),
    );
    if (response.status < 200 || response.status >= 300) {
      return yield* new GiphyRequestFailed();
    }
    let body: unknown;
    try {
      body = JSON.parse(response.body) as unknown;
    } catch {
      return yield* new GiphyRequestFailed();
    }
    return Schema.decodeUnknownSync(gifPageSchema)(parseGiphyResponse(body));
  });

  const runCall = (path: string, query: Record<string, string>): Promise<GifPage> =>
    Effect.runPromise(
      call(path, query).pipe(
        Effect.catchTags({
          GiphyRequestFailed: () => Effect.fail(new GiphyError()),
        }),
      ),
    );

  return {
    name: 'giphy',
    search(query: string, page: GifSearchOptions): Promise<GifPage> {
      return runCall('/v1/gifs/search', {
        api_key: options.apiKey,
        q: query.slice(0, 50),
        limit: String(page.limit),
        offset: page.pos ?? '0',
        rating: options.rating,
      });
    },
    trending(page: GifSearchOptions): Promise<GifPage> {
      return runCall('/v1/gifs/trending', {
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
