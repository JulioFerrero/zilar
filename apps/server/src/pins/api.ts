// Pins module on the Effect `HttpApi` adapter (T-0525): the same methods,
// paths, limiter order, statuses and bodies as the deleted router
// (`routes.ts`), mounted by the Effect edge (`apps/server/src/effect/edge.ts`).
// Its service runs on effect/sql.
//
// The schemas, the group and its middleware tags live in the shared contract
// (`@zilar/api-contract`, T-0864); this file keeps the handlers and layers.

import { Effect, Layer } from 'effect';
import { HttpServer, HttpServerRequest, HttpRouter } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiMiddleware } from 'effect/http-api';
import { CurrentUser, PinsGroup, PinsSchemaErrors, PinsWriteRateLimit } from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import {
  failureResponse,
  httpErrorResponse,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http-core';
import { listPins, pinMessage, unpinMessage, type PinsServiceDeps } from './service';

export const PINS_WRITE_RATE_LIMIT_MAX = 60;
export const PINS_WRITE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

// Applied to the group so a query or payload decode failure renders like the
// old zod path: 400 `invalid_request`. No test asserts the exact text, so the
// Effect Schema message is used (the old text was the first zod issue).
function schemaErrorLayer(logger: Logger): Layer.Layer<PinsSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(PinsSchemaErrors, (error) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', error.cause.message),
      );
    }),
  );
}

// Runs the write budget before the payload is decoded, exactly like the old
// POST/DELETE routes' `writeLimiter.allow` -> decode order: an invalid body
// still spends budget. `requires: CurrentUser` is satisfied by `Session`.
function writeRateLimitLayer(limiter: RateLimiter): Layer.Layer<PinsWriteRateLimit> {
  return Layer.succeed(
    PinsWriteRateLimit,
    PinsWriteRateLimit.of(
      Effect.fnUntraced(function* (httpEffect) {
        const user = yield* CurrentUser;
        if (!limiter.allow(user.id)) {
          const request = yield* HttpServerRequest.HttpServerRequest;
          return httpErrorResponse(
            requestIdOf(request),
            new HttpError(429, 'rate_limited', 'Too many pins, try again later'),
          );
        }
        return yield* httpEffect;
      }),
    ),
  );
}

const PinsApi = HttpApi.make('pins').add(PinsGroup);

export interface PinsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  audit?: AuditRecorder;
  logger: Logger;
  /** Injected in tests so the rate window can advance without waiting. */
  now?: () => number;
  writeLimiter?: RateLimiter;
}

export const PINS_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/pins' },
  { method: 'POST', path: '/api/pins' },
  { method: 'DELETE', path: '/api/pins/:id' },
];

export function createPinsApi(deps: PinsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const writeLimiter =
    deps.writeLimiter ??
    createRateLimiter({
      max: PINS_WRITE_RATE_LIMIT_MAX,
      windowMs: PINS_WRITE_RATE_LIMIT_WINDOW_MS,
      now: deps.now ?? Date.now,
    });

  function serviceDeps(): PinsServiceDeps {
    return {
      db: deps.db,
      domain: deps.config.xmpp.domain,
      mucDomain: deps.config.xmpp.mucDomain,
      ...(deps.audit === undefined ? {} : { audit: deps.audit }),
    };
  }

  const groupLayer = HttpApiBuilder.group(PinsApi, 'pins', (handlers) =>
    handlers
      // The pinned messages of one chat, newest first.
      .handle('list', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const pins = yield* Effect.promise(() =>
              listPins(serviceDeps(), request.query.chat, user.id),
            );
            return { pins };
          }),
          logger,
          requestId,
        );
      })
      // Pins one message (201, declared by the contract). The write budget
      // was already charged, before the payload decode.
      .handle('create', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            return yield* Effect.promise(() =>
              pinMessage(serviceDeps(), { ...request.payload, actorId: user.id }),
            );
          }),
          logger,
          requestId,
        );
      })
      // Unpins one message. The write budget was already charged.
      .handle('remove', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            return yield* Effect.promise(() =>
              unpinMessage(serviceDeps(), request.params.id, user.id),
            );
          }),
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(PinsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
    Layer.provide(writeRateLimitLayer(writeLimiter)),
  );

  // The edge keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: PINS_API_ROUTES };
}
