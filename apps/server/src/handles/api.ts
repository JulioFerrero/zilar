// Handles module on the Effect `HttpApi` adapter (T-0498): the same methods,
// paths, query and body rules and status codes as the deleted router
// (`routes.ts`), mounted by the Effect edge (`apps/server/src/effect/edge.ts`).
// Its store runs on effect/sql.

import { Effect, Layer, Schema } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from 'effect/http-api';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { makeRateLimit } from '../effect/rate-limit-middleware';
import {
  Session,
  failureResponse,
  handler,
  httpErrorResponse,
  mountApi,
  requestIdOf,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import {
  checkGroupHandleAvailability,
  checkHandleAvailability,
  claimHandle,
  handleForUser,
  reapExpiredRetiredHandles,
} from './store';

export const HANDLE_CHECK_RATE_LIMIT_MAX = 30;
export const HANDLE_CHECK_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const HANDLE_CLAIM_RATE_LIMIT_MAX = 10;
export const HANDLE_CLAIM_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

// The check query. A decode failure is a success answer, not an error: the
// middleware below turns it into `{ available: false, reason: 'invalid' }`.
const HandleCheckQuery = Schema.Struct({
  handle: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  // `kind=group` asks for a public group or channel; absent (or `user`) keeps
  // the T-0163 user answer.
  kind: Schema.optional(Schema.Literals(['user', 'group'])),
});

const HandleCheckResult = Schema.Struct({
  available: Schema.Boolean,
  reason: Schema.optional(Schema.Literals(['invalid', 'reserved', 'taken'])),
});

// The claim body: 1..64 characters; the store re-checks the shape and reserved
// words. The payload decode is strict (`PayloadParseOptions` below) so an excess
// key fails.
const HandleClaimBody = Schema.Struct({
  handle: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
});

const HandleClaimResult = Schema.Struct({ handle: Schema.String });

// Applied to the group so a query or payload decode failure renders as the
// module's typed envelope: an invalid check query is a 200 `invalid` answer,
// an invalid claim body is a 400 `invalid_request` error.
class HandlesSchemaErrors extends HttpApiMiddleware.Service<HandlesSchemaErrors>()(
  'zilar/effect/http/HandlesSchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<HandlesSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(HandlesSchemaErrors, (error) =>
    Effect.gen(function* () {
      if (error.kind === 'Query') {
        return HttpServerResponse.jsonUnsafe({ available: false, reason: 'invalid' });
      }
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(
          400,
          'invalid_request',
          'handle must be a string of 1 to 64 characters, with no other keys',
        ),
      );
    }),
  );
}

// Runs the check budget before the query is decoded, exactly like the old
// route's `checkLimiter.allow` -> `safeParse` order: an invalid query still
// spends budget.
const HandlesCheckRateLimit = makeRateLimit(
  'zilar/effect/http/HandlesCheckRateLimit',
  'Too many attempts, try again later',
);

const HandlesGroup = HttpApiGroup.make('handles')
  .add(
    HttpApiEndpoint.get('check', '/handles/check', {
      query: HandleCheckQuery,
      success: HandleCheckResult,
    }).middleware(HandlesCheckRateLimit.Middleware),
    HttpApiEndpoint.put('claim', '/me/handle', {
      payload: HandleClaimBody,
      success: HandleClaimResult,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
  )
  .middleware(Session)
  .middleware(HandlesSchemaErrors)
  // The edge forwards the full request path, so the router keeps the `/api` prefix.
  .prefix('/api');

const HandlesApi = HttpApi.make('handles').add(HandlesGroup);

export interface HandlesApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  audit?: AuditRecorder;
  /** Injected in tests so the rate windows can advance without waiting. */
  now?: () => number;
  checkLimiter?: RateLimiter;
  claimLimiter?: RateLimiter;
  logger: Logger;
}

export function createHandlesApi(deps: HandlesApiDependencies): EffectApiMount {
  const now = deps.now ?? Date.now;
  const db = deps.db;
  const logger = deps.logger;
  const checkLimiter =
    deps.checkLimiter ??
    createRateLimiter({
      max: HANDLE_CHECK_RATE_LIMIT_MAX,
      windowMs: HANDLE_CHECK_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const claimLimiter =
    deps.claimLimiter ??
    createRateLimiter({
      max: HANDLE_CLAIM_RATE_LIMIT_MAX,
      windowMs: HANDLE_CLAIM_RATE_LIMIT_WINDOW_MS,
      now,
    });

  const groupLayer = HttpApiBuilder.group(HandlesApi, 'handles', (handlers) =>
    handlers
      // Live availability for the typed handle: `{ available, reason? }`.
      // The check budget was already charged by `HandlesCheckRateLimit`,
      // before the query decode.
      .handle(
        'check',
        handler(logger, (request, user) =>
          request.query.kind === 'group'
            ? checkGroupHandleAvailability(db, request.query.handle)
            : checkHandleAvailability(db, user.id, request.query.handle),
        ),
      )
      // Claims (or changes) the caller's handle in one store transaction.
      .handle(
        'claim',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            // Saving the exact current value is a no-op: answer without
            // spending the claim budget. The store re-checks inside its
            // transaction, so this is only a fast path.
            const current = yield* Effect.promise(() => handleForUser(db, user.id));
            if (current !== null && current === request.payload.handle.trim()) {
              return { handle: current };
            }
            if (!claimLimiter.allow(user.id)) {
              return httpErrorResponse(
                requestIdOf(request.request),
                new HttpError(429, 'rate_limited', 'Too many attempts, try again later'),
              );
            }
            const claimed = yield* Effect.promise(() =>
              claimHandle(db, user.id, request.payload.handle),
            );
            yield* Effect.promise(() => reapExpiredRetiredHandles(db));
            void deps.audit?.record({
              actorUserId: user.id,
              aiId: null,
              groupId: null,
              action: 'handle.claimed',
              subjectId: user.id,
              argsHash: null,
              costCurrency: null,
              costAmount: null,
              result: 'ok',
              detail: null,
            });
            return claimed;
          }),
        ),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(HandlesApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
    Layer.provide(HandlesCheckRateLimit.layer(checkLimiter)),
  );

  return mountApi(HandlesApi, apiLayer);
}
