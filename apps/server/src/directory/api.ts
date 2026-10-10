// Public directory module on the Effect `HttpApi` adapter (T-0514): the same
// methods, paths, limiter order and answers as the deleted router.
// Its store runs on effect/sql.

import { Layer, Schema } from 'effect';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import type { Logger } from 'pino';
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
// budget.
const DirectoryRateLimit = makeRateLimit(
  'zilar/effect/http/DirectoryRateLimit',
  'Too many attempts, try again later',
);

const DirectoryGroup = HttpApiGroup.make('directory')
  .add(
    HttpApiEndpoint.get('search', '/directory', {
      query: DirectoryQuery,
      success: DirectoryPage,
    }).middleware(DirectoryRateLimit.Middleware),
    HttpApiEndpoint.get('byHandle', '/groups/by-handle/:handle', {
      params: { handle: Schema.String },
      success: DirectoryEntry,
    }).middleware(DirectoryRateLimit.Middleware),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the router keeps the `/api` prefix.
  .prefix('/api');

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
    Layer.provide(DirectoryRateLimit.layer(limiter)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(DirectoryApi, apiLayer);
}
