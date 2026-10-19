// The stickers module on the Effect `HttpApi` adapter. Step order per route:
// session, decode, limiter and service; a decode failure answers 400
// `invalid_request` with a fixed per-route message, and `decodePathId` keeps
// the old final id (404 on a bad escape). The binary routes declare no
// payload schema, so nothing is buffered before the handler: upload reads
// multipart or the raw stream, and the file GET answers a raw response.

import type { ServerCore } from '../app/deps';

import { HttpApi } from 'effect/http-api';
import { StickersGroup, StickersSchemaErrors, StickersUploadRateLimit } from '@zilar/api-contract';

import { rateLimitLayer } from '../effect/rate-limit-middleware';
import { mountGroups, schemaErrorLayerFor, type EffectApiMount } from '../effect/http-core';
import { limiter, type RateLimiter } from '../rate-limit';
import type { StickersRoutesDependencies } from './routes';
import { createStickersGroupLayer } from './api-handlers';
import { renderSchemaError } from './api-decode';

export type StickersApiDependencies = StickersRoutesDependencies & Pick<ServerCore, 'logger'>;

const StickersApi = HttpApi.make('stickers').add(StickersGroup);

export function createStickersApi(deps: StickersApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  // One limiter per api instance, built once, never per request.
  const injectedUploadLimiter = deps.uploadLimiter;
  // An injected limiter only has to say `allow`; `makeRateLimit` wants the full shape.
  const uploadLimiter: RateLimiter =
    injectedUploadLimiter === undefined
      ? limiter('stickerUpload', now)
      : { allow: (key) => injectedUploadLimiter.allow(key), size: 0 };

  const groupLayer = createStickersGroupLayer(StickersApi, deps);

  return mountGroups(StickersApi, groupLayer, {
    auth: deps.auth,
    logger,
    schemaErrors: schemaErrorLayerFor(StickersSchemaErrors, logger, renderSchemaError),
    // The upload budget runs first after the session, so it is endpoint
    // middleware; the Telegram import budget runs after the 501 token check and
    // the input parse, so it stays in its handler.
    afterSchema: rateLimitLayer(
      StickersUploadRateLimit,
      uploadLimiter,
      'Too many sticker uploads, try again later',
    ),
  });
}
