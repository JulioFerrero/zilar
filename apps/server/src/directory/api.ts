// Public directory module on the Effect `HttpApi` adapter (T-0514): the same
// methods, paths, limiter order and answers as the deleted router.
// Its store runs on effect/sql.

import { Effect, Layer, Schema } from 'effect';
import { HttpServer, HttpServerRequest, HttpRouter } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from 'effect/http-api';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
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
import { publicGroupForHandle, searchDirectory, type GroupKind } from './service';

export const DIRECTORY_RATE_LIMIT_MAX = 30;
export const DIRECTORY_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

// Replaces `directoryQuerySchema` (zod): all optional; `q` and `cursor` are
// capped, `kind` is one of the two public kinds. The old route reported the
// first zod issue as the 400 message; no test asserts that text, so the
// Effect Schema issue message is used instead.
const DirectoryQuery = Schema.Struct({
  q: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
  kind: Schema.optional(Schema.Literals(['group', 'channel'])),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
});

const DirectoryEntry = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(['group', 'channel']),
  title: Schema.String,
  handle: Schema.String,
  description: Schema.NullOr(Schema.String),
  memberCount: Schema.Number,
  joined: Schema.Boolean,
  avatarUrl: Schema.optional(Schema.String),
});

const DirectoryPage = Schema.Struct({
  entries: Schema.Array(DirectoryEntry),
  next: Schema.NullOr(Schema.String),
});

export interface DirectoryApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  /** Injected in tests so the rate window can advance without waiting. */
  now?: () => number;
  limiter?: RateLimiter;
  logger: Logger;
}

function toEntry(row: {
  id: string;
  kind: GroupKind;
  title: string;
  handle: string;
  description: string | null;
  memberCount: number;
  joined: boolean;
  avatarUrl?: string | undefined;
}) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    handle: row.handle,
    description: row.description,
    memberCount: row.memberCount,
    joined: row.joined,
    ...(row.avatarUrl === undefined ? {} : { avatarUrl: row.avatarUrl }),
  };
}

// The read budget runs before the query is decoded, exactly like the old
// route's `limiter.allow` -> `safeParse` order: an invalid query still spends
// budget. `requires: CurrentUser` is satisfied by `Session`.
class DirectoryRateLimit extends HttpApiMiddleware.Service<
  DirectoryRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/DirectoryRateLimit') {}

function rateLimitLayer(limiter: RateLimiter): Layer.Layer<DirectoryRateLimit> {
  return Layer.succeed(
    DirectoryRateLimit,
    DirectoryRateLimit.of(
      Effect.fnUntraced(function* (httpEffect) {
        const user = yield* CurrentUser;
        if (!limiter.allow(user.id)) {
          const request = yield* HttpServerRequest.HttpServerRequest;
          return httpErrorResponse(
            requestIdOf(request),
            new HttpError(429, 'rate_limited', 'Too many attempts, try again later'),
          );
        }
        return yield* httpEffect;
      }),
    ),
  );
}

// Turns a query decode failure into the module's old 400 `invalid_request`
// answer.
class DirectorySchemaErrors extends HttpApiMiddleware.Service<DirectorySchemaErrors>()(
  'zilar/effect/http/DirectorySchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<DirectorySchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(DirectorySchemaErrors, (error) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', error.cause.message),
      );
    }),
  );
}

const DirectoryGroup = HttpApiGroup.make('directory')
  .add(
    HttpApiEndpoint.get('search', '/directory', {
      query: DirectoryQuery,
      success: DirectoryPage,
    }).middleware(DirectoryRateLimit),
    HttpApiEndpoint.get('byHandle', '/groups/by-handle/:handle', {
      params: { handle: Schema.String },
      success: DirectoryEntry,
    }).middleware(DirectoryRateLimit),
  )
  .middleware(Session)
  .middleware(DirectorySchemaErrors)
  // The edge forwards the full request path, so the router keeps the `/api` prefix.
  .prefix('/api');

const DirectoryApi = HttpApi.make('directory').add(DirectoryGroup);

export const DIRECTORY_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/directory' },
  { method: 'GET', path: '/api/groups/by-handle/:handle' },
];

export function createDirectoryApi(deps: DirectoryApiDependencies): EffectApiMount {
  const now = deps.now ?? Date.now;
  const logger = deps.logger;
  const limiter =
    deps.limiter ??
    createRateLimiter({
      max: DIRECTORY_RATE_LIMIT_MAX,
      windowMs: DIRECTORY_RATE_LIMIT_WINDOW_MS,
      now,
    });

  const groupLayer = HttpApiBuilder.group(DirectoryApi, 'directory', (handlers) =>
    handlers
      // Searches public groups and channels only. `q` filters by handle or
      // title prefix, optional `kind`, 20 per page with a cursor.
      .handle('search', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const page = yield* Effect.promise(() =>
              searchDirectory(deps.db, user.id, {
                query: request.query.q,
                kind: request.query.kind,
                cursor: request.query.cursor,
              }),
            );
            return { entries: page.entries.map(toEntry), next: page.next };
          }),
          logger,
          requestId,
        );
      })
      // Exact match of one public group by `@handle`.
      .handle('byHandle', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const entry = yield* Effect.promise(() =>
              publicGroupForHandle(deps.db, user.id, request.params.handle),
            );
            return toEntry(entry);
          }),
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(DirectoryApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(rateLimitLayer(limiter)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  // The edge keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: DIRECTORY_API_ROUTES };
}
