// Background images on the Effect `HttpApi` adapter (T-0577): the same
// methods, paths, limiter order, statuses, texts, bodies and GET headers as
// the old Hono router (`routes.ts`), mounted under Hono by
// `apps/server/src/effect/http.ts`. The upload reads the raw body stream
// under a cap (`readCapped`, item 12) exactly like `voice/api.ts`; the file
// route answers raw bytes with `HttpServerResponse.uint8Array`, which
// `HttpApiBuilder` returns untouched, headers included.

import { Effect, Layer, Schema, Stream } from 'effect';
import { HttpServer, HttpServerRequest, HttpServerResponse, HttpRouter } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from 'effect/http-api';
import type { Logger } from 'pino';
import { HttpError } from '../errors';
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
// The Effect router hands the handler the same decoded param Hono's
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

// The upload result: every field of `BackgroundUploadResult`, side by side
// (`id`, `url`, `width`, `height`) — item 8.
const BackgroundUploadView = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
});

// The list item: every field of `BackgroundView` (`id`, `url`,
// `width|null`, `height|null`, `createdAt`) — item 8.
const BackgroundListItem = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  width: Schema.NullOr(Schema.Number),
  height: Schema.NullOr(Schema.Number),
  createdAt: Schema.String,
});

const BackgroundList = Schema.Struct({ backgrounds: Schema.Array(BackgroundListItem) });

const BackgroundIdParams = Schema.Struct({ id: Schema.String });

// A params decode failure renders like the old route's unknown-id answer: a
// 404 `not_found`. Params are plain strings so this never fires; the layer
// exists so the group middleware reads like the other modules.
class BackgroundsSchemaErrors extends HttpApiMiddleware.Service<BackgroundsSchemaErrors>()(
  'zilar/effect/http/BackgroundsSchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<BackgroundsSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(BackgroundsSchemaErrors, (error) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(404, 'not_found', error.cause.message || 'Background not found'),
      );
    }),
  );
}

// The upload budget runs before the body is read, exactly like the old
// route's `uploadLimiter.allow` -> declared-length -> `readCapped` order.
// `requires: CurrentUser` is satisfied by `Session`.
class BackgroundsUploadRateLimit extends HttpApiMiddleware.Service<
  BackgroundsUploadRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/BackgroundsUploadRateLimit') {}

function uploadRateLimitLayer(
  limiter: Pick<RateLimiter, 'allow'>,
): Layer.Layer<BackgroundsUploadRateLimit> {
  return Layer.succeed(
    BackgroundsUploadRateLimit,
    BackgroundsUploadRateLimit.of(
      Effect.fnUntraced(function* (httpEffect) {
        const user = yield* CurrentUser;
        if (!limiter.allow(user.id)) {
          const request = yield* HttpServerRequest.HttpServerRequest;
          return httpErrorResponse(
            requestIdOf(request),
            new HttpError(429, 'rate_limited', 'Too many background uploads, try again later'),
          );
        }
        return yield* httpEffect;
      }),
    ),
  );
}

const BackgroundsGroup = HttpApiGroup.make('backgrounds')
  .add(
    // No payload schema: the handler reads the raw body stream itself.
    HttpApiEndpoint.post('upload', '/backgrounds', {
      success: BackgroundUploadView,
    }).middleware(BackgroundsUploadRateLimit),
    HttpApiEndpoint.get('list', '/backgrounds', {
      success: BackgroundList,
    }),
    HttpApiEndpoint.get('getFile', '/backgrounds/:id', {
      params: BackgroundIdParams,
      success: Schema.Void,
    }),
    HttpApiEndpoint.delete('remove', '/backgrounds/:id', {
      params: BackgroundIdParams,
      success: Schema.Void,
    }),
  )
  .middleware(Session)
  .middleware(BackgroundsSchemaErrors)
  // The adapter forwards `c.req.raw` unchanged, so paths keep Hono's `/api`.
  .prefix('/api');

const BackgroundsApi = HttpApi.make('backgrounds').add(BackgroundsGroup);

export const BACKGROUNDS_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'POST', path: '/api/backgrounds' },
  { method: 'GET', path: '/api/backgrounds' },
  { method: 'GET', path: '/api/backgrounds/:id' },
  { method: 'DELETE', path: '/api/backgrounds/:id' },
];

export function createBackgroundsApi(deps: BackgroundsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const uploadLimiter =
    deps.uploadLimiter ??
    createRateLimiter({
      max: BACKGROUND_UPLOAD_RATE_LIMIT_MAX,
      windowMs: BACKGROUND_UPLOAD_RATE_LIMIT_WINDOW_MS,
      now: deps.now ?? Date.now,
    });

  const groupLayer = HttpApiBuilder.group(BackgroundsApi, 'backgrounds', (handlers) =>
    handlers
      // Uploads one image. The limiter middleware already charged the
      // budget, before the declared-length check and the capped read.
      .handle('upload', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
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
            const result = yield* Effect.promise(() =>
              uploadBackground(serviceDeps(deps), user.id, capped),
            );
            return HttpServerResponse.jsonUnsafe(result, { status: 201 });
          }),
          logger,
          requestId,
        );
      })
      // The owner's images, newest first.
      .handle('list', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const backgrounds = yield* Effect.promise(() => listBackgrounds(deps.db, user.id));
            return { backgrounds };
          }),
          logger,
          requestId,
        );
      })
      // Streams the stored file to its owner, or to a member of a group that
      // uses it as its background. A signed-in stranger and an unknown id
      // answer the same 404.
      .handle('getFile', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const rawId = request.params.id;
            const file = yield* Effect.promise(() =>
              readBackgroundFile(serviceDeps(deps), decodePathId(rawId), user.id),
            );
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
          logger,
          requestId,
        );
      })
      // Deletes one image owned by the caller. `false` is the same 404 as an
      // unknown id; success is an empty 204.
      .handle('remove', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const deleted = yield* Effect.promise(() =>
              deleteBackground(serviceDeps(deps), decodePathId(request.params.id), user.id),
            );
            if (!deleted) {
              throw new HttpError(404, 'not_found', 'Background not found');
            }
            return HttpServerResponse.empty({ status: 204 });
          }),
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(BackgroundsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
    Layer.provide(uploadRateLimitLayer(uploadLimiter)),
  );

  // Hono keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: BACKGROUNDS_API_ROUTES };
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
