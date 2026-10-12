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

import { Effect, Layer, Option, Schema } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import type { Logger } from 'pino';
import { HttpError } from '../errors';
import { readCapped } from '../http/read-capped';
import { Session, handler, mountApi, sessionLayer, type EffectApiMount } from '../effect/http-core';
import { createRateLimiter } from '../rate-limit';
import type { AvatarsRoutesDependencies } from './routes';
import {
  AVATAR_MAX_BYTES,
  AVATAR_READ_RATE_LIMIT_MAX,
  AVATAR_READ_RATE_LIMIT_WINDOW_MS,
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
  // T-1174 (SEC-7): the read budget, charged in `serve`.
  const readLimiter = createRateLimiter({
    max: AVATAR_READ_RATE_LIMIT_MAX,
    windowMs: AVATAR_READ_RATE_LIMIT_WINDOW_MS,
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
      .handle(
        'upload',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const kind = decodeAvatarKind(request.params.kind);
            const ownerId = yield* Effect.sync(() => decodePathId(request.params.ownerId));
            // The permission check runs before the rate-limit budget is
            // spent, so a stranger probing ids cannot burn the owner's
            // budget — and an unknown owner, a wrong kind and a stranger all
            // answer the same 404. That order is why the limiter stays here
            // and is not a `makeRateLimit` middleware (it would run first).
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
        ),
      )
      .handle(
        'remove',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const kind = decodeAvatarKind(request.params.kind);
            const ownerId = yield* Effect.sync(() => decodePathId(request.params.ownerId));
            yield* Effect.promise(() => deleteAvatar(serviceDeps(), kind, ownerId, user.id));
            return { ok: true as const };
          }),
        ),
      )
      // Streams the stored file. The id is a random unguessable uuid and a
      // signed-in session is required. User and AI pictures are a capability
      // for signed-in users (the URL is not listed anywhere a stranger can
      // enumerate). SEC-8 (T-1174): a public group's picture is served to any
      // signed-in user; a private group's only to a member — `readAvatarFile`
      // answers `null` for anyone else, so a non-member gets the same 404 as
      // an unknown id.
      .handle(
        'serve',
        handler(logger, async (request, user) => {
          // The read budget (600 per 10 min per user) is spent before the
          // lookup, so a caller cannot probe ids without paying.
          if (!readLimiter.allow(user.id)) {
            throw new HttpError(429, 'rate_limited', 'Too many avatar reads, try again later');
          }
          const avatarId = decodePathId(request.params.id);
          const file = await readAvatarFile(serviceDeps(), avatarId, user.id);
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
      ),
  );

  const apiLayer = HttpApiBuilder.layer(AvatarsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
  );

  return mountApi(AvatarsApi, apiLayer);
}
