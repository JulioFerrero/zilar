// Blocks module on the Effect `HttpApi` adapter (T-0514): the same methods,
// paths, limiter order and answers as the old router, mounted by the Effect
// edge (`apps/server/src/effect/edge.ts`). Its store runs on effect/sql.

import { Layer, Schema } from 'effect';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { makeRateLimit } from '../effect/rate-limit-middleware';
import {
  SchemaErrors,
  Session,
  handler,
  mountApi,
  schemaErrorLayer,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
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
const RATE_LIMIT_MESSAGE = 'Too many attempts, try again later';
const BlocksWriteRateLimit = makeRateLimit(
  'zilar/effect/http/BlocksWriteRateLimit',
  RATE_LIMIT_MESSAGE,
);
const BlocksReadRateLimit = makeRateLimit(
  'zilar/effect/http/BlocksReadRateLimit',
  RATE_LIMIT_MESSAGE,
);

const BlocksGroup = HttpApiGroup.make('blocks')
  .add(
    HttpApiEndpoint.put('block', '/blocks/:userId', {
      params: { userId: Schema.String },
      success: BlockResult,
    }).middleware(BlocksWriteRateLimit.Middleware),
    HttpApiEndpoint.delete('unblock', '/blocks/:userId', {
      params: { userId: Schema.String },
      success: BlockResult,
    }).middleware(BlocksWriteRateLimit.Middleware),
    HttpApiEndpoint.get('list', '/blocks', {
      success: BlockedList,
    }).middleware(BlocksReadRateLimit.Middleware),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the router keeps the `/api` prefix.
  .prefix('/api');

const BlocksApi = HttpApi.make('blocks').add(BlocksGroup);

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
      .handle(
        'block',
        handler(logger, (request, user) => blockUser(service, user.id, request.params.userId)),
      )
      // Unblocks `:userId`, idempotent.
      .handle(
        'unblock',
        handler(logger, (request, user) => unblockUser(service, user.id, request.params.userId)),
      )
      // The blocker's list, newest first.
      .handle(
        'list',
        handler(logger, (_request, user) => listBlockedUsers(service, user.id)),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(BlocksApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
    Layer.provide(BlocksWriteRateLimit.layer(writeLimiter)),
    Layer.provide(BlocksReadRateLimit.layer(readLimiter)),
  );

  return mountApi(BlocksApi, apiLayer);
}
