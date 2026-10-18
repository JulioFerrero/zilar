// The stickers module on the Effect `HttpApi` adapter. Step order per route:
// session, decode, limiter and service; a decode failure answers 400
// `invalid_request` with a fixed per-route message, and `decodePathId` keeps
// the old final id (404 on a bad escape). The binary routes declare no
// payload schema, so nothing is buffered before the handler: upload reads
// multipart or the raw stream, and the file GET answers a raw response.

import { Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { StickersGroup, StickersSchemaErrors, StickersUploadRateLimit } from '@zilar/api-contract';
import type { Logger } from 'pino';
import { rateLimitLayer } from '../effect/rate-limit-middleware';
import {
  mountApi,
  schemaErrorLayerFor,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import {
  STICKER_UPLOAD_RATE_LIMIT_MAX,
  STICKER_UPLOAD_RATE_LIMIT_WINDOW_MS,
  type StickersRoutesDependencies,
} from './routes';
import { createStickersGroupLayer } from './api-handlers';
import { renderSchemaError } from './api-decode';

export interface StickersApiDependencies extends StickersRoutesDependencies {
  logger: Logger;
}

const StickersApi = HttpApi.make('stickers').add(StickersGroup);

export function createStickersApi(deps: StickersApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  // One limiter per api instance, built once, never per request.
  const injectedUploadLimiter = deps.uploadLimiter;
  // An injected limiter only has to say `allow`; `makeRateLimit` wants the full shape.
  const uploadLimiter: RateLimiter =
    injectedUploadLimiter === undefined
      ? createRateLimiter({
          max: STICKER_UPLOAD_RATE_LIMIT_MAX,
          windowMs: STICKER_UPLOAD_RATE_LIMIT_WINDOW_MS,
          now,
        })
      : { allow: (key) => injectedUploadLimiter.allow(key), size: 0 };

  const groupLayer = createStickersGroupLayer(StickersApi, deps);

  const apiLayer = HttpApiBuilder.layer(StickersApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayerFor(StickersSchemaErrors, logger, renderSchemaError)),
    // The upload budget runs first after the session, so it is endpoint
    // middleware; the Telegram import budget runs after the 501 token check and
    // the input parse, so it stays in its handler.
    Layer.provide(
      rateLimitLayer(
        StickersUploadRateLimit,
        uploadLimiter,
        'Too many sticker uploads, try again later',
      ),
    ),
  );

  return mountApi(StickersApi, apiLayer);
}
