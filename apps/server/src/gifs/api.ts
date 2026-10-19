// Step order is security-relevant: session, provider check (501), then the limiter, then
// the 400 query decode, so an invalid query still spends budget.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Layer, Option, Schema, Exit } from 'effect';
import { HttpServer, HttpServerResponse, HttpRouter } from 'effect/http';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { GifsGroup } from '@zilar/api-contract';

import type { ServerConfig } from '../config/load';
import { classifyIp } from '@zilar/desk/egress/ip-guard';
import {
  REQUEST_ID_HEADER,
  handler,
  reflectRoutes,
  schemaErrorLayer,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import { HttpError } from '../errors';
import { queryRecord, STRICT_QUERY } from '../http/query-record';
import { limiter } from '../rate-limit';
import { GIPHY_MEDIA_HOSTS, createGiphyProvider } from './giphy';
import type { GifItem, GifPage, GifProvider } from './provider';
import {
  GIF_MEDIA_TYPES,
  GIF_PAGE_LIMIT,
  GIF_PROXY_MAX_BYTES,
  GIF_PROXY_TIMEOUT_MS,
  fetchProxiedMedia,
  type GifsRoutesDependencies,
  type MediaFetch,
} from './routes';
import { struct } from '@zilar/protocol';

const GIF_TOKEN_TTL_MS = 15 * 60 * 1000;

const tokenPayloadSchema = struct({
  u: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
  m: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(2048))),
  e: Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0))),
});

/**
 * HMAC-signed, expiring after 15 minutes, bound to the exact provider URL and user id: a
 * token for user A fails for user B, and any edit fails the signature.
 */
interface GifTokenIssuer {
  issue(userId: string, mediaUrl: string): string;
  verify(token: string, userId: string): string | undefined;
}

function createGifTokenIssuer(options: { secret: string; now?: () => number }): GifTokenIssuer {
  const now = options.now ?? Date.now;
  const secret = options.secret;

  return {
    issue(userId: string, mediaUrl: string): string {
      const payload = JSON.stringify({ u: userId, m: mediaUrl, e: now() + GIF_TOKEN_TTL_MS });
      const signature = createHmac('sha256', secret).update(payload).digest('base64url');
      return `${Buffer.from(payload, 'utf8').toString('base64url')}.${signature}`;
    },

    verify(token: string, userId: string): string | undefined {
      const dot = token.indexOf('.');
      if (dot <= 0) {
        return undefined;
      }
      const encoded = token.slice(0, dot);
      const signature = token.slice(dot + 1);
      let payload: string;
      try {
        payload = Buffer.from(encoded, 'base64url').toString('utf8');
      } catch {
        return undefined;
      }
      const expected = createHmac('sha256', secret).update(payload).digest('base64url');
      const left = Buffer.from(signature);
      const right = Buffer.from(expected);
      if (left.length !== right.length || !timingSafeEqual(left, right)) {
        return undefined;
      }
      const exit = Schema.decodeUnknownExit(tokenPayloadSchema)(JSON.parse(payload));
      if (!Exit.isSuccess(exit)) {
        return undefined;
      }
      if (exit.value.u !== userId) {
        return undefined;
      }
      if (exit.value.e <= now()) {
        return undefined;
      }
      return exit.value.m;
    },
  };
}
// `q` is 1..100 characters, `pos?` at most 128; values arrive as strings from the query
// string (first value wins).
const GifSearchQuery = Schema.Struct({
  q: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(100))),
  pos: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(128)))),
});

// Strict; `pos?` is at most 128 chars.
const GifTrendingQuery = Schema.Struct({
  pos: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(128)))),
});

const GifsApi = HttpApi.make('gifs').add(GifsGroup);

async function resolvePublicAddress(host: string): Promise<string | undefined> {
  let addresses: string[];
  try {
    const records = await lookup(host, { all: true });
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
  // Bound per feature so a token minted elsewhere can never pass as a GIF token.
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

export function createGifsApi(deps: GifsRoutesDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const searchLimiter = limiter('gif', now);
  const mediaLimiter = limiter('gifMedia', now);

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

  // A provider failure is a retryable 502, never an empty 200, so the panel shows Retry.
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
      .handle(
        'search',
        handler(logger, async (request, user) => {
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
          const page = await searchOrFail(() =>
            providerFor().search(query.q, {
              limit: GIF_PAGE_LIMIT,
              ...(query.pos === undefined ? {} : { pos: query.pos }),
            }),
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
      )
      .handle(
        'trending',
        handler(logger, async (request, user) => {
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
          const page = await searchOrFail(() =>
            providerFor().trending({
              limit: GIF_PAGE_LIMIT,
              ...(query.pos === undefined ? {} : { pos: query.pos }),
            }),
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
      )
      .handle(
        'media',
        handler(logger, async (request, user) => {
          if (!providerConfigured(deps.config) && deps.provider === undefined) {
            throw new HttpError(501, 'gifs_unavailable', 'GIF search is not configured');
          }
          if (!mediaLimiter.allow(user.id)) {
            throw new HttpError(429, 'rate_limited', 'Too many GIF requests, try again later');
          }
          let rawToken: string;
          try {
            rawToken = decodeURIComponent(request.params.token);
          } catch {
            throw new HttpError(404, 'not_found', 'GIF media not found');
          }
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
          const address = await resolvePublicAddress(host);
          if (address === undefined) {
            throw new HttpError(404, 'not_found', 'GIF media not found');
          }
          const fetched = await mediaFetcher(url, address).catch(() => {
            throw new HttpError(502, 'gif_media_failed', 'Could not load the GIF media');
          });
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
      ),
  );

  const apiLayer = HttpApiBuilder.layer(GifsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  // The edge keeps the request log (redacted path); the router's own logger would print
  // full URLs. A media token is ~200 characters, so the 100-char segment cap is raised.
  const { handler: effectHandler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true, routerConfig: { maxParamLength: 4096 } },
  );

  const mediaPrefix = '/api/gifs/media/';
  const edgeHandler: EffectApiMount['handler'] = async (request) => {
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

  return { handler: edgeHandler, routes: reflectRoutes(GifsApi) };
}
