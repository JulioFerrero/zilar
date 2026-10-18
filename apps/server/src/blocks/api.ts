import { Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { BlocksGroup, BlocksReadRateLimit, BlocksWriteRateLimit } from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/recorder';
import type { ServerConfig } from '../config/load';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import {
  handler,
  mountApi,
  schemaErrorLayer,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import { rateLimitLayer } from '../effect/rate-limit-middleware';
import { blockUser, listBlockedUsers, unblockUser, type BlocksDeps } from './service';

export const BLOCK_WRITE_RATE_LIMIT_MAX = 30;
export const BLOCK_WRITE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const BLOCK_READ_RATE_LIMIT_MAX = 120;
export const BLOCK_READ_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export interface BlocksRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  audit?: AuditRecorder;
  config?: ServerConfig;
  adminClient?: EjabberdAdminClient;
  now?: () => number;
  writeLimiter?: RateLimiter;
  readLimiter?: RateLimiter;
}

export interface BlocksApiDependencies extends BlocksRoutesDependencies {
  logger: Logger;
}

// The write budget runs before the service.
const RATE_LIMIT_MESSAGE = 'Too many attempts, try again later';

const BlocksApi = HttpApi.make('blocks').add(BlocksGroup);

function serviceFor(deps: BlocksRoutesDependencies): BlocksDeps {
  return {
    db: deps.db,
    ...(deps.audit === undefined ? {} : { audit: deps.audit }),
    ...(deps.adminClient === undefined ? {} : { adminClient: deps.adminClient }),
    ...(deps.config === undefined ? {} : { domain: deps.config.xmpp.domain }),
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

  // Roster cleanup after a block warns, never fails; the warn needs the request logger.
  const serviceWithLogger = { ...service, logger };

  const groupLayer = HttpApiBuilder.group(BlocksApi, 'blocks', (handlers) =>
    handlers
      .handle(
        'block',
        handler(logger, (request, user) =>
          blockUser(serviceWithLogger, user.id, request.params.userId),
        ),
      )
      .handle(
        'unblock',
        handler(logger, (request, user) => unblockUser(service, user.id, request.params.userId)),
      )
      .handle(
        'list',
        handler(logger, (_request, user) => listBlockedUsers(service, user.id)),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(BlocksApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
    Layer.provide(rateLimitLayer(BlocksWriteRateLimit, writeLimiter, RATE_LIMIT_MESSAGE)),
    Layer.provide(rateLimitLayer(BlocksReadRateLimit, readLimiter, RATE_LIMIT_MESSAGE)),
  );

  return mountApi(BlocksApi, apiLayer);
}
