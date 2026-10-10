// Public directory module on the Effect `HttpApi` adapter (T-0514): the same
// methods, paths, limiter order and answers as the deleted router.
// Its store runs on effect/sql.

import { Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { DirectoryGroup, DirectoryRateLimit } from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { rateLimitLayer } from '../blocks/chain-c-layers';
import { chainASchemaErrorLayer } from '../groups/schema-errors';
import { handler, mountApi, sessionLayer, type EffectApiMount } from '../effect/http-core';
import { publicGroupForHandle, searchDirectory, type GroupKind } from './service';

export const DIRECTORY_RATE_LIMIT_MAX = 30;
export const DIRECTORY_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

// The schemas, the group and the middleware tags live in the shared contract
// (`@zilar/api-contract`, T-0894).

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

const DirectoryApi = HttpApi.make('directory').add(DirectoryGroup);

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
      .handle(
        'search',
        handler(logger, async (request, user) => {
          const page = await searchDirectory(deps.db, user.id, {
            query: request.query.q,
            kind: request.query.kind,
            cursor: request.query.cursor,
          });
          return { entries: page.entries.map(toEntry), next: page.next };
        }),
      )
      // Exact match of one public group by `@handle`.
      .handle(
        'byHandle',
        handler(logger, async (request, user) =>
          toEntry(await publicGroupForHandle(deps.db, user.id, request.params.handle)),
        ),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(DirectoryApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    // The read budget runs before the query is decoded, exactly like the old
    // route's `limiter.allow` -> `safeParse` order: an invalid query still
    // spends budget.
    Layer.provide(
      rateLimitLayer(DirectoryRateLimit, limiter, 'Too many attempts, try again later'),
    ),
    Layer.provide(chainASchemaErrorLayer(logger)),
  );

  return mountApi(DirectoryApi, apiLayer);
}
