// The per-user rate-limit middleware every Effect HTTP module repeats, built
// once. A tag declared in `@zilar/api-contract` gets its layer from
// `rateLimitLayer(tag, limiter, message)`; a module-local tag is declared with
// `makeRateLimit(tagName, message)` and provided with `.layer(limiter)`.
//
// Order is load-bearing: the middleware runs after `Session` and before the
// payload decode, so the budget is spent first, exactly like the old routes'
// `limiter.allow(user.id)` then service order.

import { CurrentUser } from '@zilar/api-contract';
import { Effect, Layer } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpApiMiddleware } from 'effect/http-api';
import { HttpError } from '../errors';
import type { RateLimiter } from '../rate-limit';
import { httpErrorResponse, requestIdOf } from './http-core';

type RateLimitTag<Self, Id extends string> = HttpApiMiddleware.ServiceClass<
  Self,
  Id,
  {
    requires: CurrentUser;
    provides: never;
    error: never;
    clientError: never;
    requiredForClient: false;
    security: never;
  }
>;

/**
 * The per-user budget for a rate-limit tag. It answers 429 `rate_limited` with
 * `message` once `limiter.allow(user.id)` is false, otherwise it runs the
 * endpoint.
 */
export function rateLimitLayer<Self, Id extends string>(
  tag: RateLimitTag<Self, Id>,
  limiter: Pick<RateLimiter, 'allow'>,
  message: string,
): Layer.Layer<Self> {
  return Layer.succeed(
    tag,
    tag.of(
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

export function makeRateLimit(tagName: string, message: string) {
  // `requires: CurrentUser` is satisfied by `Session`.
  class RateLimit extends HttpApiMiddleware.Service<RateLimit, { requires: CurrentUser }>()(
    tagName,
  ) {}

  function layer(limiter: Pick<RateLimiter, 'allow'>): Layer.Layer<RateLimit> {
    return rateLimitLayer(RateLimit, limiter, message);
  }

  return { Middleware: RateLimit, layer };
}
