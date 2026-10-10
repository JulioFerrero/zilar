// The layer of chain C's per-user rate-limit tags (T-0894). The tags live in
// the contract (`chain-c-middleware.ts`); the other chain C modules import this
// layer. The plain schema-error layer is chain A's `chainASchemaErrorLayer`.

import { Effect, Layer } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpApiMiddleware } from 'effect/http-api';
import { CurrentUser } from '@zilar/api-contract';
import { HttpError } from '../errors';
import { httpErrorResponse, requestIdOf } from '../effect/http-core';
import type { RateLimiter } from '../rate-limit';

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
 * The per-user budget for a contract rate-limit tag. It runs after `Session`
 * and before the payload decode, so the budget is spent first, exactly like
 * the old routes' `limiter.allow(user.id)` then service order.
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
