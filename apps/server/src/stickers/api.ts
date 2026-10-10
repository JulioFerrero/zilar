// Stickers module on the Effect `HttpApi` adapter (T-0582 part A, T-0602 part
// B): the same methods, paths, order, statuses, texts, bodies and headers as
// the deleted routers. Its service runs on effect/sql.
//
// All 14 routes are mounted here. The 12 JSON routes came first (part A); part
// B adds the multipart/raw upload (`POST /sticker-packs/:id/stickers`) and the
// file GET (`GET /stickers/:stickerId/file`).
//
// Step order per route (unchanged):
// - Telegram import: session -> token (501) -> body decode -> pack-input
//   parse (400 link text) -> limiter (429) -> import. The answer carries
//   `partial` only when true.
// - Upload: session -> upload limiter (429) -> content-type branch. Multipart
//   checks the declared length (413), parses the form, requires one `file`
//   (400) and validates the `emoji` (400). Raw bytes checks the declared
//   length, streams through `readCapped` (413), then decodes `x-emoji` (400).
// - File GET: session -> decode id -> read file. A bad escape, an unknown id
//   and a missing file all answer 404 `not_found`.
// - DELETE /sticker-favorites decodes the body from the query string.
// - Every other JSON route: session -> body/query decode -> service call.
// Decode failures answer 400 `invalid_request` with a fixed per-route message.
// `decodePathId` keeps the old final id (404 on a bad escape).
//
// The binary routes declare no payload schema, so nothing is buffered before
// the handler. The upload reads multipart via the web `Request`'s `formData()`
// and raw bytes via the request stream; the file GET answers a raw
// `HttpServerResponse.uint8Array`, which `HttpApiBuilder` returns untouched.
//
// T-0992 size split: the handlers live in `./api-handlers`, the hand-decodes
// and fixed error texts in `./api-decode`, and the upload body and its capped
// read in `./api-upload`. This path keeps the interface, the group, the layer
// and the mount.

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
  // One limiter per api instance, built once (never per request), like the
  // old factory and the avatars api.
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
    // The upload budget is the first step after the session, so it is a plain
    // endpoint middleware (the Telegram import budget is not: it runs after
    // the 501 token check and the input parse, so it stays in its handler).
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
