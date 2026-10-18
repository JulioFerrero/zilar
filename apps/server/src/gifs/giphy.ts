import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Data, Duration, Effect, Schema, type Effect as EffectType } from 'effect';
import { classifyIp } from '@zilar/desk/egress/ip-guard';
import { GIPHY_MEDIA_HOSTS, parseGiphyResponse } from './giphy-parse';
import type { GifPage, GifProvider, GifSearchOptions } from './provider';
import { gifPageSchema } from './provider';

export { GIPHY_MEDIA_HOSTS, parseGiphyResponse };

export const GIPHY_API_HOST = 'api.giphy.com';

const GIPHY_RATINGS = ['g', 'pg', 'pg-13', 'r'] as const;

export type GiphyRating = (typeof GIPHY_RATINGS)[number];

export interface GiphyProviderOptions {
  apiKey: string;
  rating: GiphyRating;
  fetcher?: GiphyFetcher;
  resolver?: (host: string) => Promise<string[]>;
}

/**
 * The provider call failed. The message stays neutral, so no provider detail reaches the
 * client; the routes turn it into a retryable 502.
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

// Every failure funnels into this tagged error, which carries no payload, so no provider
// detail leaks.
class GiphyRequestFailed extends Data.TaggedError('GiphyRequestFailed') {}

async function defaultResolver(host: string): Promise<string[]> {
  const records = await dnsLookup(host, { all: true });
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
