// Background images on the Effect `HttpApi` adapter (T-0577): the same
// methods, paths, limiter order, statuses, texts, bodies and GET headers as
// the old router (`routes.ts`), mounted by the Effect edge
// (`apps/server/src/effect/edge.ts`). The upload reads the raw body stream
// under a cap (`readCapped`, item 12) exactly like `voice/api.ts`; the file
// route answers raw bytes with `HttpServerResponse.uint8Array`, which
// `HttpApiBuilder` returns untouched, headers included.

import { Effect, Layer, Stream } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { BackgroundsGroup, BackgroundsUploadRateLimit } from '@zilar/api-contract';
import type { Logger } from 'pino';
import { rateLimitLayer } from '../effect/rate-limit-middleware';
import { HttpError } from '../errors';
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

// A malformed percent escape is an unknown image (404), not a server error.
// The Effect router hands the handler the same decoded param the old router's
// `c.req.param()` gave (see `chat-prefs/api.ts`), so the lookup decodes it
// again while the etag keeps the param as received — the same final id and
// etag as the old route for the test inputs (plain uuids).
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

// The group and the reply schemas live in the shared contract
// (`@zilar/api-contract`, `backgrounds.ts`, T-0895). The upload declares no
// payload: the handler reads the raw body stream itself.
const BackgroundsApi = HttpApi.make('backgrounds').add(BackgroundsGroup);

export function createBackgroundsApi(deps: BackgroundsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const injected = deps.uploadLimiter;
  // An injected limiter only has to say `allow`; `makeRateLimit` wants the full shape.
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
      // Uploads one image. The limiter middleware already charged the
      // budget, before the declared-length check and the capped read.
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
      // The owner's images, newest first.
      .handle(
        'list',
        handler(logger, async (_request, user) => ({
          backgrounds: await listBackgrounds(deps.db, user.id),
        })),
      )
      // Streams the stored file to its owner, or to a member of a group that
      // uses it as its background. A signed-in stranger and an unknown id
      // answer the same 404.
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
      // Deletes one image owned by the caller. `false` is the same 404 as an
      // unknown id; success is an empty 204.
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
    // The upload budget runs before the body is read, exactly like the old
    // route's `uploadLimiter.allow` -> declared-length -> `readCapped` order.
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

// Reads the body stream chunk by chunk and stops as soon as the cap is
// passed, so a large upload never has to fit in memory. `undefined` means the
// cap was exceeded; the over-cap chunk itself is not collected.
function readCapped<E, R>(
  stream: Stream.Stream<Uint8Array, E, R>,
  cap: number,
): Effect.Effect<Uint8Array | undefined, E, R> {
  return Effect.gen(function* () {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let exceeded = false;
    yield* Stream.runForEachWhile(stream, (chunk) =>
      Effect.sync(() => {
        total += chunk.byteLength;
        if (total > cap) {
          exceeded = true;
          return false;
        }
        chunks.push(chunk);
        return true;
      }),
    );

    if (exceeded) {
      return undefined;
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  });
}
