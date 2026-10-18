import { Layer } from 'effect';
import { HttpServer, HttpRouter } from 'effect/http';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { PinsGroup, PinsWriteRateLimit } from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/recorder';
import type { ServerConfig } from '../config/load';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import {
  handler,
  schemaErrorLayer,
  sessionLayer,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http-core';
import { rateLimitLayer } from '../effect/rate-limit-middleware';
import { listPins, pinMessage, unpinMessage, type PinsServiceDeps } from './service';

export const PINS_WRITE_RATE_LIMIT_MAX = 60;
export const PINS_WRITE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

const PinsApi = HttpApi.make('pins').add(PinsGroup);

export interface PinsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  audit?: AuditRecorder;
  logger: Logger;
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
      .handle(
        'list',
        handler(logger, async (request, user) => ({
          pins: await listPins(serviceDeps(), request.query.chat, user.id),
        })),
      )
      // The write budget was already charged, before the payload decode.
      .handle(
        'create',
        handler(logger, (request, user) =>
          pinMessage(serviceDeps(), { ...request.payload, actorId: user.id }),
        ),
      )
      // The write budget was already charged.
      .handle(
        'remove',
        handler(logger, (request, user) => unpinMessage(serviceDeps(), request.params.id, user.id)),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(PinsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
    // The write budget runs before the payload is decoded: an invalid body still spends
    // budget.
    Layer.provide(
      rateLimitLayer(PinsWriteRateLimit, writeLimiter, 'Too many pins, try again later'),
    ),
  );

  const { handler: effectHandler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler: effectHandler, routes: PINS_API_ROUTES };
}
