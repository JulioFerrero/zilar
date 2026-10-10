// The per-user rate-limit middleware every Effect HTTP module repeats, built
// once. A module declares `const WriteLimit = makeRateLimit(tag, message)`,
// puts `WriteLimit.Middleware` on its endpoints and provides
// `WriteLimit.layer(limiter)`.
//
// Order is load-bearing: the middleware runs after `Session` and before the
// payload decode, so the budget is spent first, exactly like the old routes'
// `limiter.allow(user.id)` then service order.

import { Effect, Layer } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpApiMiddleware } from 'effect/http-api';
import { HttpError } from '../errors';
import type { RateLimiter } from '../rate-limit';
import { CurrentUser, httpErrorResponse, requestIdOf } from './http-core';

export function makeRateLimit(tagName: string, message: string) {
  // `requires: CurrentUser` is satisfied by `Session`.
  class RateLimit extends HttpApiMiddleware.Service<RateLimit, { requires: CurrentUser }>()(
    tagName,
  ) {}

  function layer(limiter: RateLimiter): Layer.Layer<RateLimit> {
    return Layer.succeed(
      RateLimit,
      RateLimit.of(
        Effect.fnUntraced(function* (httpEffect) {
          const user = yield* CurrentUser;
          if (!limiter.allow(user.id)) {
            const request = yield* HttpServerRequest.HttpServerRequest;
            return httpErrorResponse(
              requestIdOf(request),
              new HttpError(429, 'rate_limited', message),
            );
          }
          return yield* httpEffect;
        }),
      ),
    );
  }

  return { Middleware: RateLimit, layer };
}
