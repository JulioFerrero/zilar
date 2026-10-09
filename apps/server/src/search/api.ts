// Search module on the Effect `HttpApi` adapter (T-0558): the same method,
// path, step order, statuses and bodies as the deleted router
// (`routes.ts`), mounted by the Effect edge (`apps/server/src/effect/edge.ts`).
// The archive query core lives in `routes.ts` (`runSearch`); this module
// owns the Effect query schema, the 501/429 guards and the adapter wiring.

import { Effect, Layer, Schema } from 'effect';
import { HttpServer, HttpServerRequest, HttpRouter } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from 'effect/http-api';
import type { Logger } from 'pino';
import { HttpError } from '../errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import {
  CurrentUser,
  Session,
  failureResponse,
  httpErrorResponse,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http-core';
import {
  SEARCH_MAX_LIMIT,
  SEARCH_RATE_LIMIT_MAX,
  SEARCH_RATE_LIMIT_WINDOW_MS,
  runSearch,
  type SearchRoutesDependencies,
} from './routes';

export type { SearchRoutesDependencies };

// Replaces `querySchema` (zod): `q` 1..100 raw characters (the handler trims
// and requires 2..100), optional `chat` 1..256, optional `limit` and `before`
// coerced from strings like the old `z.coerce.number()`. Strict, so an
// excess key fails like the old `.strict()`.
const SearchQuery = Schema.Struct({
  q: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  chat: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
  limit: Schema.optional(
    Schema.NumberFromString.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(SEARCH_MAX_LIMIT),
    ),
  ),
  before: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0))),
});

// Lists every field of `SearchItem` plus the optional cursor: the success
// schema is an encoder, so an omitted field would silently disappear.
const SearchItemView = Schema.Struct({
  chatJid: Schema.String,
  messageId: Schema.String,
  senderName: Schema.String,
  at: Schema.String,
  snippet: Schema.String,
  marks: Schema.mutable(Schema.Array(Schema.Tuple([Schema.Number, Schema.Number]))),
  match: Schema.optional(Schema.Literals(['exact', 'fuzzy'])),
});

const SearchResultView = Schema.Struct({
  items: Schema.Array(SearchItemView),
  nextBefore: Schema.optional(Schema.String),
});

// Any query decode failure is the fixed text `Invalid search query`, exactly
// like the old route.
class SearchSchemaErrors extends HttpApiMiddleware.Service<SearchSchemaErrors>()(
  'zilar/effect/http/SearchSchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<SearchSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(SearchSchemaErrors, () =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', 'Invalid search query'),
      );
    }),
  );
}

// The archive and rate-limit guards run before the query is decoded, exactly
// like the old route's session -> 501 -> limiter -> decode order. `requires:
// CurrentUser` is satisfied by `Session`.
class SearchGuards extends HttpApiMiddleware.Service<SearchGuards, { requires: CurrentUser }>()(
  'zilar/effect/http/SearchGuards',
) {}

function guardsLayer(
  deps: SearchRoutesDependencies,
  limiter: RateLimiter,
): Layer.Layer<SearchGuards> {
  return Layer.succeed(
    SearchGuards,
    SearchGuards.of(
      Effect.fnUntraced(function* (httpEffect) {
        const user = yield* CurrentUser;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const requestId = requestIdOf(request);
        if (deps.archive === undefined) {
          return httpErrorResponse(
            requestId,
            new HttpError(501, 'search_unavailable', 'Message search is not configured'),
          );
        }
        if (!limiter.allow(user.id)) {
          return httpErrorResponse(
            requestId,
            new HttpError(429, 'rate_limited', 'Too many searches, try again later'),
          );
        }
        return yield* httpEffect;
      }),
    ),
  );
}

const SearchGroup = HttpApiGroup.make('search')
  .add(
    HttpApiEndpoint.get('search', '/search', {
      query: SearchQuery,
      success: SearchResultView,
    })
      .annotate(HttpApi.QueryParseOptions, { onExcessProperty: 'error' })
      .middleware(SearchGuards),
  )
  .middleware(Session)
  .middleware(SearchSchemaErrors)
  // The edge forwards the full request path, so the router keeps the `/api` prefix.
  .prefix('/api');

const SearchApi = HttpApi.make('search').add(SearchGroup);

export const SEARCH_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/search' },
];

export function createSearchApi(deps: SearchRoutesDependencies): EffectApiMount {
  const logger = deps.logger;
  const limiter = createRateLimiter({
    max: SEARCH_RATE_LIMIT_MAX,
    windowMs: SEARCH_RATE_LIMIT_WINDOW_MS,
    now: deps.now ?? Date.now,
  });

  const groupLayer = HttpApiBuilder.group(SearchApi, 'search', (handlers) =>
    handlers.handle('search', (request) => {
      const requestId = requestIdOf(request.request);
      return withErrorEnvelope(
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const query = request.query;
          return yield* Effect.promise(() =>
            runSearch(deps, user.id, {
              q: query.q,
              ...(query.chat === undefined ? {} : { chat: query.chat }),
              ...(query.limit === undefined ? {} : { limit: query.limit }),
              ...(query.before === undefined ? {} : { before: query.before }),
            }),
          );
        }),
        logger,
        requestId,
      );
    }),
  );

  const apiLayer = HttpApiBuilder.layer(SearchApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(guardsLayer(deps, limiter)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  // The edge keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: SEARCH_API_ROUTES };
}
