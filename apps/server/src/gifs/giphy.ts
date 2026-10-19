import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { Data, Duration, Effect, Exit, Schema, type Effect as EffectType } from 'effect';
import { classifyIp } from '@zilar/desk/egress/ip-guard';
import { struct } from '@zilar/protocol';
import type { GifPage, GifProvider, GifSearchOptions } from './provider';
import { gifItemSchema, gifPageSchema } from './provider';

const GIPHY_API_HOST = 'api.giphy.com';

const GIPHY_RATINGS = ['g', 'pg', 'pg-13', 'r'] as const;

type GiphyRating = (typeof GIPHY_RATINGS)[number];

interface GiphyProviderOptions {
  apiKey: string;
  rating: GiphyRating;
  fetcher?: GiphyFetcher;
  resolver?: (host: string) => Promise<string[]>;
}

/**
 * The provider call failed. The message stays neutral, so no provider detail reaches the
 * client; the routes turn it into a retryable 502.
 */
class GiphyError extends Error {
  constructor() {
    super('GIF provider request failed');
    this.name = 'GiphyError';
  }
}

type GiphyFetcher = (url: URL, address: string) => Promise<{ status: number; body: string }>;

const GIPHY_API_TIMEOUT_MS = 10_000;
const GIPHY_API_MAX_BYTES = 1024 * 1024;

// Every failure funnels into this tagged error, which carries no payload, so no provider
// detail leaks.
class GiphyRequestFailed extends Data.TaggedError('GiphyRequestFailed') {}

async function defaultResolver(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true });
  return records.map((record) => record.address);
}

// The API call uses the same SSRF guard as the media proxy: https only, the documented
// host, resolve-then-pin, SNI and Host kept, no redirects. The request is interruptible,
// so a timeout destroys the socket.
const giphyRequestEffect = (
  url: URL,
  address: string,
): EffectType.Effect<{ status: number; body: string }, GiphyRequestFailed> =>
  Effect.callback<{ status: number; body: string }, GiphyRequestFailed>((resume) => {
    const req = request(
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
// Giphy media hosts from the public docs. The API endpoint host is allowed too, because a
// hostile response could smuggle it in; every URL in an item re-checks this allowlist.
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

// One playable rendition per GIF object (fixed-width mp4, then gif/webp, then the
// original). Anything off the media allowlist drops the whole item.
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

function parseGiphyResponse(body: unknown): GifPage {
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
