// GIF search, trending and the media proxy on the Effect `HttpApi` adapter
// (T-0586): the same methods, paths, step order, statuses, texts, log fields,
// headers and SSRF checks as the deleted Hono router (`routes.ts`), mounted
// under Hono by `apps/server/src/effect/http.ts`.
//
// The queries are decoded manually inside the handlers (Effect Schema, same
// rules as the old zod schemas) instead of as endpoint `query`, because the
// old routes ran the provider check and the limiter *before* the decode (an
// invalid query still spends budget). Session -> 501 -> limiter -> 400 —
// exactly like the old `requireSession` -> provider check -> limiter ->
// `safeParse` sequence. The media route answers raw bytes with
// `HttpServerResponse.uint8Array` (see `voice/api.ts`); `HttpApiBuilder`
// returns a handler-returned `HttpServerResponse` untouched, headers included.
import { createHmac } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Effect, Layer, Option, Schema } from 'effect';
import { HttpServer, HttpServerRequest, HttpServerResponse, HttpRouter } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from 'effect/http-api';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import {
  CurrentUser,
  REQUEST_ID_HEADER,
  Session,
  failureResponse,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import { classifyIp } from '../sandbox/ip-guard';
import { GIPHY_MEDIA_HOSTS, createGiphyProvider } from './giphy';
import type { GifItem, GifPage, GifProvider } from './provider';
import {
  GIF_MEDIA_RATE_LIMIT_MAX,
  GIF_MEDIA_TYPES,
  GIF_PAGE_LIMIT,
  GIF_PROXY_MAX_BYTES,
  GIF_PROXY_TIMEOUT_MS,
  GIF_RATE_LIMIT_MAX,
  GIF_RATE_LIMIT_WINDOW_MS,
  fetchProxiedMedia,
  type GifsRoutesDependencies,
  type MediaFetch,
} from './routes';
import { createGifTokenIssuer, type GifTokenIssuer } from './token';

export interface GifsApiDependencies extends GifsRoutesDependencies {
  auth: Auth;
  config: ServerConfig;
  logger: Logger;
}

// Replaces `searchQuerySchema` (zod): strict, `q` is 1..100 characters,
// `pos?` is at most 128 characters. Values arrive as strings from the query
// string, so the decode runs over the raw `URLSearchParams` view (first value
// wins, like Hono's `c.req.query()`).
const GifSearchQuery = Schema.Struct({
  q: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(100))),
  pos: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(128)))),
});

// Replaces `trendingQuerySchema` (zod): strict, `pos?` is at most 128 chars.
const GifTrendingQuery = Schema.Struct({
  pos: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(128)))),
});

const STRICT_QUERY = { onExcessProperty: 'error' } as const;

function queryRecord(request: HttpServerRequest.HttpServerRequest): Record<string, string> {
  const queryIndex = request.originalUrl.indexOf('?');
  if (queryIndex === -1) {
    return {};
  }
  const params = new URLSearchParams(request.originalUrl.slice(queryIndex + 1));
  const record: Record<string, string> = {};
  for (const [key, value] of params) {
    if (!(key in record)) {
      record[key] = value;
    }
  }
  return record;
}

// Every field `shape` and `searchBody` produce, side by side with the old
// Hono bodies: `id`, `title`, `mediaToken`, `kind`, `width`, `height`, the
// optional `sizeBytes`, and the page's optional `nextPos`. An item with no
// media URL is dropped before encoding, so it never reaches the schema.
const GifResultItem = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  mediaToken: Schema.String,
  kind: Schema.Literals(['image', 'video']),
  width: Schema.Number,
  height: Schema.Number,
  sizeBytes: Schema.optional(Schema.Number),
});

const GifResultPage = Schema.Struct({
  items: Schema.Array(GifResultItem),
  nextPos: Schema.optional(Schema.String),
});

// Path params decode as plain strings; the token is verified inside the
// handler so a bad token answers 404 `not_found`, never a 400.
const GifMediaParams = Schema.Struct({ token: Schema.String });

class GifsSchemaErrors extends HttpApiMiddleware.Service<GifsSchemaErrors>()(
  'zilar/effect/http/GifsSchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<GifsSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(GifsSchemaErrors, (error) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', error.cause.message || 'Invalid request'),
      );
    }),
  );
}

const GifsGroup = HttpApiGroup.make('gifs')
  .add(
    HttpApiEndpoint.get('search', '/gifs/search', {
      success: GifResultPage,
    }),
    HttpApiEndpoint.get('trending', '/gifs/trending', {
      success: GifResultPage,
    }),
    // No success schema: the handler answers raw bytes with custom headers.
    HttpApiEndpoint.get('media', '/gifs/media/:token', {
      params: GifMediaParams,
    }),
  )
  .middleware(Session)
  // The framework never decodes a body or query here, so this layer only
  // guards against a future endpoint adding one; the query decode runs
  // manually in each handler with its fixed text.
  .middleware(GifsSchemaErrors)
  // The adapter forwards `c.req.raw` unchanged, so paths keep Hono's `/api`.
  .prefix('/api');

const GifsApi = HttpApi.make('gifs').add(GifsGroup);

export const GIFS_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/gifs/search' },
  { method: 'GET', path: '/api/gifs/trending' },
  { method: 'GET', path: '/api/gifs/media/:token' },
];

async function resolvePublicAddress(host: string): Promise<string | undefined> {
  let addresses: string[];
  try {
    const records = await dnsLookup(host, { all: true });
    addresses = records.map((record) => record.address);
  } catch {
    return undefined;
  }
  if (addresses.length === 0) {
    return undefined;
  }
  for (const address of addresses) {
    if (isIP(address) === 0 || classifyIp(address) === 'blocked') {
      return undefined;
    }
  }
  return addresses[0];
}

function providerConfigured(config: ServerConfig): boolean {
  return config.GIF_PROVIDER !== undefined && config.GIF_API_KEY !== undefined;
}

function tokenSecret(config: ServerConfig): string {
  // The session/signing secret signs media tokens. Bound per feature so a
  // token minted elsewhere can never pass as a GIF token.
  return createHmac('sha256', config.BETTER_AUTH_SECRET).update('gifs-media').digest('hex');
}

interface ShapedGifItem {
  id: string;
  title: string;
  mediaToken: string;
  kind: 'image' | 'video';
  width: number;
  height: number;
  sizeBytes?: number | undefined;
}

export function createGifsApi(deps: GifsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const searchLimiter = createRateLimiter({
    max: GIF_RATE_LIMIT_MAX,
    windowMs: GIF_RATE_LIMIT_WINDOW_MS,
    now,
  });
  const mediaLimiter = createRateLimiter({
    max: GIF_MEDIA_RATE_LIMIT_MAX,
    windowMs: GIF_RATE_LIMIT_WINDOW_MS,
    now,
  });

  const issuer: GifTokenIssuer = createGifTokenIssuer({ secret: tokenSecret(deps.config), now });
  const mediaFetcher: MediaFetch =
    deps.mediaFetcher ??
    ((requestUrl, validated) =>
      fetchProxiedMedia(requestUrl, validated, {
        timeoutMs: GIF_PROXY_TIMEOUT_MS,
        maxBytes: GIF_PROXY_MAX_BYTES,
      }));

  function providerFor(): GifProvider {
    if (deps.provider !== undefined) {
      return deps.provider;
    }
    const apiKey = deps.config.GIF_API_KEY;
    const configured = deps.config.GIF_PROVIDER !== undefined && apiKey !== undefined;
    if (!configured || apiKey === undefined) {
      throw new HttpError(501, 'gifs_unavailable', 'GIF search is not configured');
    }
    return createGiphyProvider({
      apiKey,
      rating: deps.config.GIF_RATING,
    });
  }

  function shape(item: GifItem, userId: string): ShapedGifItem | undefined {
    const mediaUrl = item.mp4Url ?? item.gifUrl;
    if (mediaUrl === undefined) {
      return undefined;
    }
    return {
      id: item.id,
      title: item.title,
      mediaToken: issuer.issue(userId, mediaUrl),
      ...(item.mp4Url === undefined ? { kind: 'image' as const } : { kind: 'video' as const }),
      width: item.width,
      height: item.height,
      ...(item.sizeBytes === undefined ? {} : { sizeBytes: item.sizeBytes }),
    };
  }

  function searchBody(
    userId: string,
    page: { items: GifItem[]; nextPos?: string | undefined },
  ): { items: ShapedGifItem[]; nextPos?: string | undefined } {
    return {
      items: page.items.flatMap((item) => {
        const shaped = shape(item, userId);
        return shaped === undefined ? [] : [shaped];
      }),
      ...(page.nextPos === undefined ? {} : { nextPos: page.nextPos }),
    };
  }

  // A provider failure is retryable (502), never an empty 200: the panel
  // shows its Retry state instead of "No GIFs found". A provider refusal
  // (HttpError) passes through untouched.
  function searchOrFail(promise: () => Promise<GifPage>): Promise<GifPage> {
    return promise().catch((error: unknown) => {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(502, 'gif_search_failed', 'GIF search failed, try again later');
    });
  }

  const groupLayer = HttpApiBuilder.group(GifsApi, 'gifs', (handlers) =>
    handlers
      .handle('search', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            if (!providerConfigured(deps.config) && deps.provider === undefined) {
              throw new HttpError(501, 'gifs_unavailable', 'GIF search is not configured');
            }
            if (!searchLimiter.allow(user.id)) {
              throw new HttpError(429, 'rate_limited', 'Too many GIF requests, try again later');
            }
            const decoded = Schema.decodeUnknownOption(
              GifSearchQuery,
              STRICT_QUERY,
            )(queryRecord(request.request));
            if (Option.isNone(decoded)) {
              throw new HttpError(400, 'invalid_request', 'Invalid GIF search');
            }
            const query = decoded.value;
            const start = performance.now();
            const page = yield* Effect.promise(() =>
              searchOrFail(() =>
                providerFor().search(query.q, {
                  limit: GIF_PAGE_LIMIT,
                  ...(query.pos === undefined ? {} : { pos: query.pos }),
                }),
              ),
            );
            // The log carries counts and durations only — never the search text.
            deps.logger.info(
              {
                userId: user.id,
                results: page.items.length,
                durationMs: Math.round(performance.now() - start),
              },
              'gifs_search',
            );
            return searchBody(user.id, page);
          }),
          logger,
          requestId,
        );
      })
      .handle('trending', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            if (!providerConfigured(deps.config) && deps.provider === undefined) {
              throw new HttpError(501, 'gifs_unavailable', 'GIF search is not configured');
            }
            if (!searchLimiter.allow(user.id)) {
              throw new HttpError(429, 'rate_limited', 'Too many GIF requests, try again later');
            }
            const decoded = Schema.decodeUnknownOption(
              GifTrendingQuery,
              STRICT_QUERY,
            )(queryRecord(request.request));
            if (Option.isNone(decoded)) {
              throw new HttpError(400, 'invalid_request', 'Invalid GIF request');
            }
            const query = decoded.value;
            const start = performance.now();
            const page = yield* Effect.promise(() =>
              searchOrFail(() =>
                providerFor().trending({
                  limit: GIF_PAGE_LIMIT,
                  ...(query.pos === undefined ? {} : { pos: query.pos }),
                }),
              ),
            );
            deps.logger.info(
              {
                userId: user.id,
                results: page.items.length,
                durationMs: Math.round(performance.now() - start),
              },
              'gifs_trending',
            );
            return searchBody(user.id, page);
          }),
          logger,
          requestId,
        );
      })
      .handle('media', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            if (!providerConfigured(deps.config) && deps.provider === undefined) {
              throw new HttpError(501, 'gifs_unavailable', 'GIF search is not configured');
            }
            if (!mediaLimiter.allow(user.id)) {
              throw new HttpError(429, 'rate_limited', 'Too many GIF requests, try again later');
            }
            // The Effect router hands out decoded params (like Hono's
            // `c.req.param`), so this second decode is idempotent on normal
            // tokens and keeps the old 404 on a bad escape.
            const rawToken = yield* Effect.sync(() => {
              try {
                return decodeURIComponent(request.params.token);
              } catch {
                throw new HttpError(404, 'not_found', 'GIF media not found');
              }
            });
            const mediaUrl = issuer.verify(rawToken, user.id);
            if (mediaUrl === undefined) {
              // An unknown token and one the caller may not use answer the same 404.
              throw new HttpError(404, 'not_found', 'GIF media not found');
            }
            let url: URL;
            try {
              url = new URL(mediaUrl);
            } catch {
              throw new HttpError(404, 'not_found', 'GIF media not found');
            }
            if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
              throw new HttpError(404, 'not_found', 'GIF media not found');
            }
            const host = url.hostname.toLowerCase();
            if (!(GIPHY_MEDIA_HOSTS as readonly string[]).includes(host)) {
              throw new HttpError(404, 'not_found', 'GIF media not found');
            }
            const address = yield* Effect.promise(() => resolvePublicAddress(host));
            if (address === undefined) {
              throw new HttpError(404, 'not_found', 'GIF media not found');
            }
            const fetched = yield* Effect.promise(() =>
              mediaFetcher(url, address).catch(() => {
                throw new HttpError(502, 'gif_media_failed', 'Could not load the GIF media');
              }),
            );
            if (fetched.status < 200 || fetched.status >= 300) {
              throw new HttpError(502, 'gif_media_failed', 'Could not load the GIF media');
            }
            if (!(GIF_MEDIA_TYPES as readonly string[]).includes(fetched.contentType)) {
              throw new HttpError(502, 'gif_media_failed', 'Could not load the GIF media');
            }
            return HttpServerResponse.uint8Array(fetched.body, {
              status: 200,
              headers: {
                'content-type': fetched.contentType,
                'content-length': String(fetched.body.byteLength),
                'x-content-type-options': 'nosniff',
                'cache-control': 'private, max-age=86400',
              },
            });
          }),
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(GifsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  // Hono keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  // The router caps a path segment at 100 characters by default, but a media
  // token is ~200 characters (base64url payload + signature), so the cap is
  // raised; the token itself is still validated inside the handler.
  const { handler: effectHandler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true, routerConfig: { maxParamLength: 4096 } },
  );

  // The Effect router answers its own misses with an empty 404 (its internal
  // `safeDecodeURI` rejects a malformed percent escape before any handler
  // runs), so a bad token escape under the media prefix keeps the old
  // `not_found` envelope here at the edge.
  const mediaPrefix = '/api/gifs/media/';
  const handler: EffectApiMount['handler'] = async (request) => {
    const response = await effectHandler(request);
    if (response.status !== 404) {
      return response;
    }
    const requestUrl = new URL(request.url);
    const pathname = requestUrl.pathname;
    if (!pathname.startsWith(mediaPrefix) || pathname.length <= mediaPrefix.length) {
      return response;
    }
    const requestId = request.headers.get(REQUEST_ID_HEADER) ?? '';
    return HttpServerResponse.toWeb(
      HttpServerResponse.jsonUnsafe(
        { error: { code: 'not_found', message: 'GIF media not found', requestId } },
        { status: 404 },
      ),
    );
  };

  return { handler, routes: GIFS_API_ROUTES };
}
