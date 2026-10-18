import { Effect, Layer } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { HandlesCheckRateLimit, HandlesGroup, HandlesSchemaErrors } from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { rateLimitLayer } from '../effect/rate-limit-middleware';
import {
  handler,
  httpErrorResponse,
  mountApi,
  requestIdOf,
  schemaErrorLayerFor,
  sessionLayer,
  type SchemaErrorRender,
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

// Applied to the group so a bad decode renders the module's typed envelope.
const renderSchemaError: SchemaErrorRender = (error) =>
  Effect.succeed(
    error.kind === 'Query'
      ? HttpServerResponse.jsonUnsafe({ available: false, reason: 'invalid' })
      : new HttpError(
          400,
          'invalid_request',
          'handle must be a string of 1 to 64 characters, with no other keys',
        ),
  );

const RATE_LIMITED_MESSAGE = 'Too many attempts, try again later';

const HandlesApi = HttpApi.make('handles').add(HandlesGroup);

export interface HandlesApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  audit?: AuditRecorder;
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
      // The check budget was already charged before the query decode.
      .handle(
        'check',
        handler(logger, (request, user) =>
          request.query.kind === 'group'
            ? checkGroupHandleAvailability(db, request.query.handle)
            : checkHandleAvailability(db, user.id, request.query.handle),
        ),
      )
      .handle(
        'claim',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            // Saving the current value is a no-op fast path; the store re-checks inside
            // its transaction.
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
    Layer.provide(schemaErrorLayerFor(HandlesSchemaErrors, logger, renderSchemaError)),
    // The check budget runs before the query decode: an invalid query still spends budget.
    Layer.provide(rateLimitLayer(HandlesCheckRateLimit, checkLimiter, RATE_LIMITED_MESSAGE)),
  );

  return mountApi(HandlesApi, apiLayer);
}
