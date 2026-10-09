// Handles module on the Effect `HttpApi` adapter (T-0498): the same methods,
// paths, query and body rules and status codes as the deleted router
// (`routes.ts`), mounted by the Effect edge (`apps/server/src/effect/edge.ts`).
// Its store runs on effect/sql.

import { Effect, Layer, Schema } from 'effect';
import { HttpServer, HttpServerRequest, HttpServerResponse, HttpRouter } from 'effect/http';
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
// spends budget. `requires: CurrentUser` is satisfied by `Session`.
class HandlesCheckRateLimit extends HttpApiMiddleware.Service<
  HandlesCheckRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/HandlesCheckRateLimit') {}

function checkRateLimitLayer(checkLimiter: RateLimiter): Layer.Layer<HandlesCheckRateLimit> {
  return Layer.succeed(
    HandlesCheckRateLimit,
    HandlesCheckRateLimit.of(
      Effect.fnUntraced(function* (httpEffect) {
        const user = yield* CurrentUser;
        if (!checkLimiter.allow(user.id)) {
          const request = yield* HttpServerRequest.HttpServerRequest;
          return httpErrorResponse(
            requestIdOf(request),
            new HttpError(429, 'rate_limited', 'Too many attempts, try again later'),
          );
        }
        return yield* httpEffect;
      }),
    ),
  );
}

const HandlesGroup = HttpApiGroup.make('handles')
  .add(
    HttpApiEndpoint.get('check', '/handles/check', {
      query: HandleCheckQuery,
      success: HandleCheckResult,
    }).middleware(HandlesCheckRateLimit),
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

export const HANDLES_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/handles/check' },
  { method: 'PUT', path: '/api/me/handle' },
];

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
      .handle('check', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            // The check budget was already charged by `HandlesCheckRateLimit`,
            // before the query decode.
            const user = yield* CurrentUser;
            if (request.query.kind === 'group') {
              return yield* Effect.promise(() =>
                checkGroupHandleAvailability(db, request.query.handle),
              );
            }
            return yield* Effect.promise(() =>
              checkHandleAvailability(db, user.id, request.query.handle),
            );
          }),
          logger,
          requestId,
        );
      })
      // Claims (or changes) the caller's handle in one store transaction.
      .handle('claim', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            // Saving the exact current value is a no-op: answer without
            // spending the claim budget. The store re-checks inside its
            // transaction, so this is only a fast path.
            const current = yield* Effect.promise(() => handleForUser(db, user.id));
            if (current !== null && current === request.payload.handle.trim()) {
              return { handle: current };
            }
            if (!claimLimiter.allow(user.id)) {
              return httpErrorResponse(
                requestId,
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
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(HandlesApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
    Layer.provide(checkRateLimitLayer(checkLimiter)),
  );

  // The edge keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: HANDLES_API_ROUTES };
}
