// Search module on the Effect `HttpApi` adapter (T-0558): the same method,
// path, step order, statuses and bodies as the deleted router
// (`routes.ts`), mounted by the Effect edge (`apps/server/src/effect/edge.ts`).
// The archive query core lives in `routes.ts` (`runSearchEffect`); this module
// owns the Effect query schema, the 501/429 guards and the adapter wiring.

import { Effect, Layer } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiMiddleware } from 'effect/http-api';
import { CurrentUser, SearchGroup, SearchGuards, SearchSchemaErrors } from '@zilar/api-contract';
import type { Logger } from 'pino';
import { HttpError } from '../errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import {
  failureResponse,
  handler,
  httpErrorResponse,
  mountApi,
  requestIdOf,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import {
  SEARCH_RATE_LIMIT_MAX,
  SEARCH_RATE_LIMIT_WINDOW_MS,
  runSearchEffect,
  type SearchRoutesDependencies,
} from './routes';

export type { SearchRoutesDependencies };

// The schemas, the group and the middleware tags live in the shared contract
// (`@zilar/api-contract`, T-0894).
//
// Any query decode failure is the fixed text `Invalid search query`, exactly
// like the old route.
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

const SearchApi = HttpApi.make('search').add(SearchGroup);

export function createSearchApi(deps: SearchRoutesDependencies): EffectApiMount {
  const logger = deps.logger;
  const limiter = createRateLimiter({
    max: SEARCH_RATE_LIMIT_MAX,
    windowMs: SEARCH_RATE_LIMIT_WINDOW_MS,
    now: deps.now ?? Date.now,
  });

  const groupLayer = HttpApiBuilder.group(SearchApi, 'search', (handlers) =>
    handlers.handle(
      'search',
      handler(logger, (request, user) => {
        const query = request.query;
        return runSearchEffect(deps, user.id, {
          q: query.q,
          ...(query.chat === undefined ? {} : { chat: query.chat }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
          ...(query.before === undefined ? {} : { before: query.before }),
        }).pipe(Effect.orDie);
      }),
    ),
  );

  const apiLayer = HttpApiBuilder.layer(SearchApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(guardsLayer(deps, limiter)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(SearchApi, apiLayer);
}
