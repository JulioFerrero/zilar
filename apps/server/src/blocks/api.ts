// Blocks module on the Effect `HttpApi` adapter (T-0514): the same methods,
// paths, limiter order and answers as the deleted Hono router, mounted under
// Hono by `apps/server/src/effect/http.ts`. Handlers keep calling the drizzle
// store; the DB rewrite is a separate lane.
//
// `createBlocksRoutes` is kept next to the Effect mount because
// `blocks.test.ts` imports it from `./routes` and mounts it on a Hono wrapper
// to exercise the injected rate limiters. `routes.ts` re-exports it.

import { Effect, Layer, Schema } from 'effect';
import { HttpServer, HttpServerRequest, HttpRouter } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from 'effect/http-api';
import { Hono } from 'hono';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import {
  CurrentUser,
  Session,
  httpErrorResponse,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http';
import { blockUser, listBlockedUsers, unblockUser } from './service';

export const BLOCK_WRITE_RATE_LIMIT_MAX = 30;
export const BLOCK_WRITE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const BLOCK_READ_RATE_LIMIT_MAX = 120;
export const BLOCK_READ_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export interface BlocksRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  audit?: AuditRecorder;
  /** Injected in tests so the rate window can advance without waiting. */
  now?: () => number;
  writeLimiter?: RateLimiter;
  readLimiter?: RateLimiter;
}

export interface BlocksApiDependencies extends BlocksRoutesDependencies {
  logger: Logger;
}

// `{ blocked: true }` on PUT, `{ blocked: false }` on DELETE.
const BlockResult = Schema.Struct({ blocked: Schema.Boolean });

const BlockedUser = Schema.Struct({
  userId: Schema.String,
  name: Schema.String,
  handle: Schema.NullOr(Schema.String),
  image: Schema.NullOr(Schema.String),
  jid: Schema.NullOr(Schema.String),
});

const BlockedList = Schema.Struct({ blocked: Schema.Array(BlockedUser) });

// The write budget runs before the service, exactly like the old route's
// `writeLimiter.allow` -> `blockUser` order. `requires: CurrentUser` is
// satisfied by `Session`.
class BlocksWriteRateLimit extends HttpApiMiddleware.Service<
  BlocksWriteRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/BlocksWriteRateLimit') {}

class BlocksReadRateLimit extends HttpApiMiddleware.Service<
  BlocksReadRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/BlocksReadRateLimit') {}

function writeRateLimitLayer(limiter: RateLimiter): Layer.Layer<BlocksWriteRateLimit> {
  return Layer.succeed(
    BlocksWriteRateLimit,
    BlocksWriteRateLimit.of(
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

function readRateLimitLayer(limiter: RateLimiter): Layer.Layer<BlocksReadRateLimit> {
  return Layer.succeed(
    BlocksReadRateLimit,
    BlocksReadRateLimit.of(
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

const BlocksGroup = HttpApiGroup.make('blocks')
  .add(
    HttpApiEndpoint.put('block', '/blocks/:userId', {
      params: { userId: Schema.String },
      success: BlockResult,
    }).middleware(BlocksWriteRateLimit),
    HttpApiEndpoint.delete('unblock', '/blocks/:userId', {
      params: { userId: Schema.String },
      success: BlockResult,
    }).middleware(BlocksWriteRateLimit),
    HttpApiEndpoint.get('list', '/blocks', {
      success: BlockedList,
    }).middleware(BlocksReadRateLimit),
  )
  .middleware(Session)
  // The adapter forwards `c.req.raw` unchanged, so paths keep Hono's `/api`.
  .prefix('/api');

const BlocksApi = HttpApi.make('blocks').add(BlocksGroup);

export const BLOCKS_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'PUT', path: '/api/blocks/:userId' },
  { method: 'DELETE', path: '/api/blocks/:userId' },
  { method: 'GET', path: '/api/blocks' },
];

function serviceFor(deps: BlocksRoutesDependencies): {
  db: ServerDatabase;
  audit?: AuditRecorder;
} {
  return {
    db: deps.db,
    ...(deps.audit === undefined ? {} : { audit: deps.audit }),
  };
}

export function createBlocksApi(deps: BlocksApiDependencies): EffectApiMount {
  const now = deps.now ?? Date.now;
  const logger = deps.logger;
  const writeLimiter =
    deps.writeLimiter ??
    createRateLimiter({
      max: BLOCK_WRITE_RATE_LIMIT_MAX,
      windowMs: BLOCK_WRITE_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const readLimiter =
    deps.readLimiter ??
    createRateLimiter({
      max: BLOCK_READ_RATE_LIMIT_MAX,
      windowMs: BLOCK_READ_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const service = serviceFor(deps);

  const groupLayer = HttpApiBuilder.group(BlocksApi, 'blocks', (handlers) =>
    handlers
      // Blocks `:userId`, idempotent. Unknown users answer 404, yourself 400.
      .handle('block', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            return yield* Effect.promise(() => blockUser(service, user.id, request.params.userId));
          }),
          logger,
          requestId,
        );
      })
      // Unblocks `:userId`, idempotent.
      .handle('unblock', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            return yield* Effect.promise(() =>
              unblockUser(service, user.id, request.params.userId),
            );
          }),
          logger,
          requestId,
        );
      })
      // The blocker's list, newest first.
      .handle('list', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            return yield* Effect.promise(() => listBlockedUsers(service, user.id));
          }),
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(BlocksApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(writeRateLimitLayer(writeLimiter)),
    Layer.provide(readRateLimitLayer(readLimiter)),
  );

  // Hono keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: BLOCKS_API_ROUTES };
}

// The legacy Hono factory, kept only so `blocks.test.ts` can mount the routes
// on its own wrapper with an injected limiter. Production uses
// `createBlocksApi`. Behavior is byte-identical to the deleted `routes.ts`.
export function createBlocksRoutes(deps: BlocksRoutesDependencies): Hono {
  const routes = new Hono();
  const now = deps.now ?? Date.now;
  const writeLimiter =
    deps.writeLimiter ??
    createRateLimiter({
      max: BLOCK_WRITE_RATE_LIMIT_MAX,
      windowMs: BLOCK_WRITE_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const readLimiter =
    deps.readLimiter ??
    createRateLimiter({
      max: BLOCK_READ_RATE_LIMIT_MAX,
      windowMs: BLOCK_READ_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const service = serviceFor(deps);

  // Blocks `:userId`, idempotent. Unknown users answer 404, yourself 400.
  routes.put('/blocks/:userId', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!writeLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
    }
    return c.json(await blockUser(service, user.id, c.req.param('userId')));
  });

  // Unblocks `:userId`, idempotent: unblocking someone never blocked still
  // answers success.
  routes.delete('/blocks/:userId', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!writeLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
    }
    return c.json(await unblockUser(service, user.id, c.req.param('userId')));
  });

  // The blocker's list, newest first.
  routes.get('/blocks', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (!readLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
    }
    return c.json(await listBlockedUsers(service, user.id));
  });

  return routes;
}
