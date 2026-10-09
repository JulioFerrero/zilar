// Avatars module on the Effect `HttpApi` adapter (T-0576): the same methods,
// paths, statuses, texts, bodies, headers, limiter order and streaming cap as
// the deleted router (`routes.ts`), mounted by the Effect edge
// (`apps/server/src/effect/edge.ts`). Its service runs on effect/sql.
//
// The PUT upload declares no payload schema, so nothing is buffered or decoded
// before the handler: the handler reads `request.request.stream` chunk by
// chunk and stops as soon as the running total passes the cap (`readCapped`),
// exactly like the old `c.req.raw.body` reader (see `voice/api.ts`). The GET
// reply is a raw `HttpServerResponse.uint8Array`; `HttpApiBuilder` returns a
// handler-returned `HttpServerResponse` untouched, headers included.
//
// Step order on PUT is permission check -> limiter -> declared-length check
// -> streaming cap, so the limiter runs inside the handler (after
// `checkAvatarWritePermission`), exactly like the old route.

import { Effect, Layer, Option, Schema, Stream } from 'effect';
import { HttpServer, HttpServerResponse, HttpRouter } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import type { Logger } from 'pino';
import { HttpError } from '../errors';
import {
  CurrentUser,
  Session,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http-core';
import { createRateLimiter } from '../rate-limit';
import type { AvatarsRoutesDependencies } from './routes';
import {
  AVATAR_MAX_BYTES,
  AVATAR_UPLOAD_RATE_LIMIT_MAX,
  AVATAR_UPLOAD_RATE_LIMIT_WINDOW_MS,
  avatarOwnerKindSchema,
  checkAvatarWritePermission,
  deleteAvatar,
  readAvatarFile,
  uploadAvatar,
  type AvatarKind,
  type AvatarsServiceDeps,
} from './service';

export interface AvatarsApiDependencies extends AvatarsRoutesDependencies {
  logger: Logger;
}

// The upload answer carries exactly what `uploadAvatar` returns (`{ url }`);
// the remove answer is the old `{ ok: true }` body.
const AvatarUploadView = Schema.Struct({ url: Schema.String });
const AvatarRemoveView = Schema.Struct({ ok: Schema.Literal(true) });

// Path params decode as plain strings; the kind is validated inside each
// handler so an unknown kind answers 404 `not_found`, never a 400.
const AvatarOwnerParams = Schema.Struct({ kind: Schema.String, ownerId: Schema.String });
const AvatarIdParams = Schema.Struct({ id: Schema.String });

const AvatarsGroup = HttpApiGroup.make('avatars')
  .add(
    HttpApiEndpoint.put('upload', '/avatars/:kind/:ownerId', {
      params: AvatarOwnerParams,
      success: AvatarUploadView,
    }),
    HttpApiEndpoint.delete('remove', '/avatars/:kind/:ownerId', {
      params: AvatarOwnerParams,
      success: AvatarRemoveView,
    }),
    // No success schema: the handler answers raw bytes with custom headers.
    HttpApiEndpoint.get('serve', '/avatars/:id', {
      params: AvatarIdParams,
    }),
  )
  .middleware(Session)
  // The edge forwards the full request path, so the router keeps the `/api` prefix.
  .prefix('/api');

const AvatarsApi = HttpApi.make('avatars').add(AvatarsGroup);

export const AVATARS_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'PUT', path: '/api/avatars/:kind/:ownerId' },
  { method: 'DELETE', path: '/api/avatars/:kind/:ownerId' },
  { method: 'GET', path: '/api/avatars/:id' },
];

// A malformed percent escape is an unknown owner (404), not a server error.
// The Effect router hands out decoded params, so
// this second decode is idempotent on normal ids and keeps the old final id.
function decodePathId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(404, 'not_found', 'Avatar not found');
  }
}

function decodeAvatarKind(raw: string): AvatarKind {
  const kind = Schema.decodeUnknownOption(avatarOwnerKindSchema)(raw);
  if (Option.isNone(kind)) {
    throw new HttpError(404, 'not_found', 'Avatar not found');
  }
  return kind.value;
}

export function createAvatarsApi(deps: AvatarsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const uploadLimiter =
    deps.uploadLimiter ??
    createRateLimiter({
      max: AVATAR_UPLOAD_RATE_LIMIT_MAX,
      windowMs: AVATAR_UPLOAD_RATE_LIMIT_WINDOW_MS,
      now,
    });

  function serviceDeps(): AvatarsServiceDeps {
    return {
      db: deps.db,
      storageDir: deps.storageDir,
      ...(deps.audit === undefined ? {} : { audit: deps.audit }),
    };
  }

  const groupLayer = HttpApiBuilder.group(AvatarsApi, 'avatars', (handlers) =>
    handlers
      .handle('upload', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const kind = decodeAvatarKind(request.params.kind);
            const ownerId = yield* Effect.sync(() => decodePathId(request.params.ownerId));
            // The permission check runs before the rate-limit budget is
            // spent, so a stranger probing ids cannot burn the owner's
            // budget — and an unknown owner, a wrong kind and a stranger all
            // answer the same 404.
            yield* Effect.promise(() =>
              checkAvatarWritePermission(deps.db, kind, ownerId, user.id),
            );
            if (!uploadLimiter.allow(user.id)) {
              throw new HttpError(429, 'rate_limited', 'Too many avatar uploads, try again later');
            }
            // The type comes from the magic bytes, never from this header.
            const declared = Number(request.request.headers['content-length'] ?? '');
            if (Number.isFinite(declared) && declared > AVATAR_MAX_BYTES) {
              throw new HttpError(413, 'avatar_too_large', 'The picture is larger than 256 KiB');
            }
            const capped = yield* readCapped(request.request.stream, AVATAR_MAX_BYTES).pipe(
              Effect.orDie,
            );
            if (capped === undefined) {
              throw new HttpError(413, 'avatar_too_large', 'The picture is larger than 256 KiB');
            }
            return yield* Effect.promise(() =>
              uploadAvatar(serviceDeps(), kind, ownerId, user.id, capped),
            );
          }),
          logger,
          requestId,
        );
      })
      .handle('remove', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const kind = decodeAvatarKind(request.params.kind);
            const ownerId = yield* Effect.sync(() => decodePathId(request.params.ownerId));
            yield* Effect.promise(() => deleteAvatar(serviceDeps(), kind, ownerId, user.id));
            return { ok: true as const };
          }),
          logger,
          requestId,
        );
      })
      // Streams the stored file. The id is a random unguessable uuid and a
      // signed-in session is required — but the URL is a capability for
      // signed-in users, not a secret: anyone handed the exact URL who is
      // signed in can load it. Private-group pictures are therefore not
      // listed anywhere a stranger can enumerate (no directory, no member
      // list for non-admins), yet no per-viewer membership check runs here.
      .handle('serve', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            yield* CurrentUser;
            const avatarId = yield* Effect.sync(() => decodePathId(request.params.id));
            const file = yield* Effect.promise(() => readAvatarFile(serviceDeps(), avatarId));
            // An unknown id and a missing file answer the same 404.
            if (!file) {
              throw new HttpError(404, 'not_found', 'Avatar not found');
            }
            return HttpServerResponse.uint8Array(file.bytes, {
              status: 200,
              headers: {
                'content-type': file.mime,
                'content-length': String(file.size),
                'x-content-type-options': 'nosniff',
                'content-security-policy': "default-src 'none'",
                // The id changes on every replacement, so immutable is safe.
                'cache-control': 'private, max-age=31536000, immutable',
                etag: `"${avatarId}"`,
              },
            });
          }),
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(AvatarsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
  );

  // The edge keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: AVATARS_API_ROUTES };
}

// Reads the body stream chunk by chunk and stops as soon as the cap is passed,
// so a large upload never has to fit in memory. `undefined` means the cap was
// exceeded; the over-cap chunk itself is not collected.
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
