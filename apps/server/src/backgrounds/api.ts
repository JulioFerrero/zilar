import { Effect, Layer } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { BackgroundsGroup, BackgroundsUploadRateLimit } from '@zilar/api-contract';
import type { Logger } from 'pino';
import { rateLimitLayer } from '../effect/rate-limit-middleware';
import { HttpError } from '../errors';
import { readCapped } from '../http/read-capped';
import {
  handler,
  mountApi,
  schemaErrorLayer,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import type { BackgroundsRoutesDependencies } from './routes';
import {
  BACKGROUND_MAX_BYTES,
  BACKGROUND_UPLOAD_RATE_LIMIT_MAX,
  BACKGROUND_UPLOAD_RATE_LIMIT_WINDOW_MS,
  deleteBackground,
  listBackgrounds,
  readBackgroundFile,
  uploadBackground,
  type BackgroundsServiceDeps,
} from './service';

export interface BackgroundsApiDependencies extends BackgroundsRoutesDependencies {
  logger: Logger;
}

function decodePathId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(404, 'not_found', 'Background not found');
  }
}

function serviceDeps(deps: BackgroundsApiDependencies): BackgroundsServiceDeps {
  return { db: deps.db, storageDir: deps.storageDir };
}

const BackgroundsApi = HttpApi.make('backgrounds').add(BackgroundsGroup);

export function createBackgroundsApi(deps: BackgroundsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const injected = deps.uploadLimiter;
  const uploadLimiter: RateLimiter =
    injected === undefined
      ? createRateLimiter({
          max: BACKGROUND_UPLOAD_RATE_LIMIT_MAX,
          windowMs: BACKGROUND_UPLOAD_RATE_LIMIT_WINDOW_MS,
          now: deps.now ?? Date.now,
        })
      : { allow: (key) => injected.allow(key), size: 0 };

  const groupLayer = HttpApiBuilder.group(BackgroundsApi, 'backgrounds', (handlers) =>
    handlers
      // The limiter middleware charges the budget before the declared-length check
      // and the capped read.
      .handle(
        'upload',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            // The type comes from the magic bytes, never from this header.
            const declared = Number(request.request.headers['content-length'] ?? '');
            if (Number.isFinite(declared) && declared > BACKGROUND_MAX_BYTES) {
              throw new HttpError(
                413,
                'background_too_large',
                'The background image is larger than 1 MiB',
              );
            }
            const capped = yield* readCapped(request.request.stream, BACKGROUND_MAX_BYTES).pipe(
              Effect.orDie,
            );
            if (capped === undefined) {
              throw new HttpError(
                413,
                'background_too_large',
                'The background image is larger than 1 MiB',
              );
            }
            return yield* Effect.promise(() =>
              uploadBackground(serviceDeps(deps), user.id, capped),
            );
          }),
        ),
      )
      .handle(
        'list',
        handler(logger, async (_request, user) => ({
          backgrounds: await listBackgrounds(deps.db, user.id),
        })),
      )
      // The owner, or a member of a group using the image; a signed-in stranger and an
      // unknown id answer the same 404.
      .handle(
        'getFile',
        handler(logger, async (request, user) => {
          const rawId = request.params.id;
          const file = await readBackgroundFile(serviceDeps(deps), decodePathId(rawId), user.id);
          if (!file) {
            throw new HttpError(404, 'not_found', 'Background not found');
          }
          return HttpServerResponse.uint8Array(file.bytes, {
            status: 200,
            headers: {
              'content-type': file.mime,
              'content-length': String(file.size),
              'x-content-type-options': 'nosniff',
              'content-security-policy': "default-src 'none'",
              // The id never changes for a stored file, so immutable is safe.
              'cache-control': 'private, max-age=31536000, immutable',
              etag: `"${rawId}"`,
            },
          });
        }),
      )
      .handle(
        'remove',
        handler(logger, async (request, user) => {
          const deleted = await deleteBackground(
            serviceDeps(deps),
            decodePathId(request.params.id),
            user.id,
          );
          if (!deleted) {
            throw new HttpError(404, 'not_found', 'Background not found');
          }
        }),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(BackgroundsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
    // The upload budget runs before the body is read.
    Layer.provide(
      rateLimitLayer(
        BackgroundsUploadRateLimit,
        uploadLimiter,
        'Too many background uploads, try again later',
      ),
    ),
  );

  return mountApi(BackgroundsApi, apiLayer);
}
