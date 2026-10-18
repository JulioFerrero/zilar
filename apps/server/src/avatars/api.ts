import { Effect, Layer, Option, Schema } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { type Logger } from 'pino';
import { HttpError } from '../errors';
import { readCapped } from '../http/read-capped';
import { Session, handler, mountApi, sessionLayer, type EffectApiMount } from '../effect/http-core';
import { createRateLimiter } from '../rate-limit';
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
import { type Auth } from '../auth/auth';
import { type ServerConfig } from '../config/load';
import { type AuditRecorder } from '../audit/recorder';
import { type ServerDatabase } from '../db/client';
interface AvatarsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  storageDir: string;
  audit?: AuditRecorder;
  now?: () => number;
  uploadLimiter?: { allow: (key: string) => boolean };
}

export interface AvatarsApiDependencies extends AvatarsRoutesDependencies {
  logger: Logger;
}

const AvatarUploadView = Schema.Struct({ url: Schema.String });
const AvatarRemoveView = Schema.Struct({ ok: Schema.Literal(true) });

// The kind is validated inside each handler, so an unknown kind answers 404, never 400.
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
    HttpApiEndpoint.get('serve', '/avatars/:id', {
      params: AvatarIdParams,
    }),
  )
  .middleware(Session)
  // The edge forwards the full path, so the router keeps the `/api` prefix.
  .prefix('/api');

const AvatarsApi = HttpApi.make('avatars').add(AvatarsGroup);

// A malformed percent escape is an unknown owner (404), not a server error.
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
  // The read budget, charged per viewer in `serve`.
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
            // The permission check runs before the rate-limit budget is spent, so a stranger
            // probing ids cannot burn the owner's budget, and unknown/wrong-kind/stranger all
            // answer the same 404. That order is why the limiter is not middleware.
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
      // The id is an unguessable uuid and a session is required: the URL is a capability.
      // SEC-8: a public group's picture is served to any signed-in user, a private one only
      // to a member; `readAvatarFile` answers `null` otherwise, the same 404 as unknown.
      .handle(
        'serve',
        handler(logger, async (request, user) => {
          // The read budget (600 per 10 min per user) is spent before the lookup, so ids
          // cannot be probed for free.
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
