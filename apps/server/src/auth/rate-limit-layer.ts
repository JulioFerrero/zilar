// The layer of a per-user rate-limit tag declared in `@zilar/api-contract`
// (T-0895). `makeRateLimit` (`effect/rate-limit-middleware.ts`) builds the tag
// class on the server side; a group that moved into the contract declares the
// class there, so this takes the contract's class and builds only the layer.
// Order is the same: it runs after `Session` and before the payload decode.

import { Effect, Layer } from 'effect';
import type { Context } from 'effect';
import { HttpServerRequest } from 'effect/http';
import type { HttpApiMiddleware } from 'effect/http-api';
import { CurrentUser } from '@zilar/api-contract';
import { httpErrorResponse, requestIdOf } from '../effect/http-core';
import { HttpError } from '../errors';
import type { RateLimiter } from '../rate-limit';

export function rateLimitLayer<Id>(
  tag: Context.Service<Id, HttpApiMiddleware.HttpApiMiddleware<never, never, CurrentUser>>,
  message: string,
  limiter: RateLimiter,
): Layer.Layer<Id> {
  return Layer.succeed(
    tag,
    Effect.fnUntraced(function* (httpEffect) {
      const user = yield* CurrentUser;
      if (!limiter.allow(user.id)) {
        const request = yield* HttpServerRequest.HttpServerRequest;
        return httpErrorResponse(requestIdOf(request), new HttpError(429, 'rate_limited', message));
      }
      return yield* httpEffect;
    }),
  );
}
