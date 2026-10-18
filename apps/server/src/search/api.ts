// The archive query core lives in `routes.ts` (`runSearchEffect`); this module
// owns the query schema, the 501/429 guards and the adapter wiring.

import { Effect, Layer } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { CurrentUser, SearchGroup, SearchGuards, SearchSchemaErrors } from '@zilar/api-contract';
import { HttpError } from '../errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import {
  handler,
  httpErrorResponse,
  mountApi,
  requestIdOf,
  schemaErrorLayerFor,
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

// Any query decode failure is the fixed text. The archive and rate-limit guards
// run before the query is decoded, as before.
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
    Layer.provide(schemaErrorLayerFor(SearchSchemaErrors, logger, 'Invalid search query')),
  );

  return mountApi(SearchApi, apiLayer);
}
