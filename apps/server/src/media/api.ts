// Media gallery module on the Effect `HttpApi` adapter (T-0560): the same
// method, path, step order, statuses, texts and payloads as the deleted
// router (`routes.ts`), mounted by the Effect edge (`apps/server/src/effect/edge.ts`).
// Handlers keep calling `allowedArchives` / `resolveChatFilter` / `indexChat`
// and the gallery read, which runs on effect/sql.
//
// The query is decoded manually inside the handler (Effect Schema, same rules
// as the old zod schema) instead of as an endpoint `query`, because the old
// route ran the archive check and the limiter *before* the decode (an invalid
// query still spends budget). 501 `media_unavailable` comes first, then the
// 429 limiter, then the 400 decode, then the 404 chat resolution — exactly
// like the old `requireSession` -> 501 -> limiter -> `safeParse` sequence.
import { Effect, Layer, Option, Schema } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
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
import { isDmBlocked } from '../blocks/service';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import type { mediaItems } from '../db/schema';
import { sqlRuntimeFor } from '../effect/sql';
import {
  CurrentUser,
  Session,
  failureResponse,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http-core';
import { HttpError } from '../errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import {
  allowedArchives,
  resolveChatFilter,
  type ArchivePool,
  type SearchOwner,
} from '../search/service';
import { indexChat, type MediaChatScope, type MediaKind } from './indexer';

export const MEDIA_RATE_LIMIT_MAX = 30;
export const MEDIA_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const MEDIA_DEFAULT_LIMIT = 50;
export const MEDIA_MAX_LIMIT = 100;

export const MEDIA_TYPES = ['media', 'files', 'links', 'voice'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

// The tab a client asks for maps to the indexed kinds it shows. `media` is the
// grid (images and gifs); the other tabs are one kind each.
const TYPE_KINDS: Record<MediaType, readonly MediaKind[]> = {
  media: ['image', 'gif'],
  files: ['file'],
  links: ['link'],
  voice: ['voice'],
};

export interface MediaRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  logger: Logger;
  /** Absent when XMPP_ARCHIVE_DATABASE_URL is unset → every request 501s. */
  archive?: ArchivePool;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
}

export interface MediaApiDependencies extends MediaRoutesDependencies {
  limiter?: RateLimiter;
}

// Replaces `querySchema` (zod): `chat` is 1..256 characters, `type` is one of
// the four tabs, `before` is a coerced positive int, `limit` is a coerced int
// 1..MEDIA_MAX_LIMIT. Strict, so an excess key fails like the old `.strict()`.
// Values arrive as strings from the query string, so the decode runs over the
// raw `URLSearchParams` view (first value wins, like the old `c.req.query()`).
const MediaQuery = Schema.Struct({
  chat: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  type: Schema.optional(Schema.Literals(MEDIA_TYPES)),
  before: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0))),
  limit: Schema.optional(
    Schema.NumberFromString.check(
      Schema.isInt(),
      Schema.isBetween({ minimum: 1, maximum: MEDIA_MAX_LIMIT }),
    ),
  ),
});

const STRICT_QUERY = { onExcessProperty: 'error' } as const;

function queryRecord(request: HttpServerRequest.HttpServerRequest): Record<string, string> {
  const queryIndex = request.originalUrl.indexOf('?');
  if (queryIndex === -1) {
    return {};
  }
  const params = new URLSearchParams(request.originalUrl.slice(queryIndex + 1));
  const record: Record<string, string> = {};
  for (const [key, value] of params) {
    if (!(key in record)) {
      record[key] = value;
    }
  }
  return record;
}

// Every optional `MediaItem` field is `Schema.optional(...)`, never `NullOr`,
// so an absent field stays absent in the JSON (the handler returns a raw
// response built by `toMediaItem`, like the old `c.json`).
const MediaItemView = Schema.Struct({
  messageId: Schema.String,
  chat: Schema.String,
  at: Schema.String,
  senderName: Schema.String,
  kind: Schema.Literals(['image', 'file', 'gif', 'voice', 'link']),
  url: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  size: Schema.optional(Schema.Number),
  mime: Schema.optional(Schema.String),
  width: Schema.optional(Schema.Number),
  height: Schema.optional(Schema.Number),
  durationMs: Schema.optional(Schema.Number),
  waveform: Schema.optional(Schema.Array(Schema.Number)),
  linkUrl: Schema.optional(Schema.String),
  linkHost: Schema.optional(Schema.String),
});

const MediaPage = Schema.Struct({
  items: Schema.Array(MediaItemView),
  next: Schema.NullOr(Schema.String),
});

export interface MediaItem {
  messageId: string;
  chat: string;
  at: string;
  senderName: string;
  kind: MediaKind;
  url?: string;
  name?: string;
  size?: number;
  mime?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  waveform?: number[];
  linkUrl?: string;
  linkHost?: string;
}

type MediaItemRow = typeof mediaItems.$inferSelect;

function runSql<A>(
  db: ServerDatabase,
  effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

// The effect/sql gallery read returns the same columns in the same camelCase
// shape as the row above. `at_micros` is int8, which the pg driver
// hands back as a string, so it is `string | number` here and converted to a
// number when mapping (the values fit in a double).

// The part of a JID before `/`, lowercased: the comparison key for sender
// direction, mirroring search's `bareJid`.
function bareJid(jid: string): string {
  return jid.split('/')[0]?.toLowerCase() ?? '';
}

// The nick is the part after `/` in a room stanza's `from`; an empty nick (or
// no resource at all) answers "Unknown", like search's `senderNameFor`.
function roomNick(senderJid: string): string {
  const nick = senderJid.split('/')[1]?.trim() ?? '';
  return nick === '' ? 'Unknown' : nick;
}

function senderNameFor(
  row: MediaItemRow,
  filter: MediaChatScope,
  allowed: SearchOwner,
  domain: string,
): string {
  if (filter.kind === 'room') {
    return roomNick(row.senderJid);
  }
  // In a DM the caller's own outgoing messages carry their own bare JID as
  // the stanza `from`; anything else is the peer.
  const ownBareJid = `${allowed.ownLocalpart}@${domain.toLowerCase()}`;
  if (bareJid(row.senderJid) === ownBareJid) {
    return 'You';
  }
  return allowed.peerNames.get(filter.peer) ?? 'Unknown';
}

// Absent fields are omitted from the payload, never sent as `null`.
function toMediaItem(row: MediaItemRow, senderName: string): MediaItem {
  return {
    messageId: row.messageId,
    chat: row.chatJid,
    at: new Date(Math.floor(row.atMicros / 1000)).toISOString(),
    senderName,
    kind: row.kind,
    ...(row.url === null ? {} : { url: row.url }),
    ...(row.name === null ? {} : { name: row.name }),
    ...(row.size === null ? {} : { size: row.size }),
    ...(row.mime === null ? {} : { mime: row.mime }),
    ...(row.width === null ? {} : { width: row.width }),
    ...(row.height === null ? {} : { height: row.height }),
    ...(row.durationMs === null ? {} : { durationMs: row.durationMs }),
    ...(row.waveform === null ? {} : { waveform: row.waveform }),
    ...(row.linkUrl === null ? {} : { linkUrl: row.linkUrl }),
    ...(row.linkHost === null ? {} : { linkHost: row.linkHost }),
  };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

class MediaSchemaErrors extends HttpApiMiddleware.Service<MediaSchemaErrors>()(
  'zilar/effect/http/MediaSchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<MediaSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(MediaSchemaErrors, (error) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', error.cause.message || 'Invalid request'),
      );
    }),
  );
}

const MediaGroup = HttpApiGroup.make('media')
  .add(
    HttpApiEndpoint.get('gallery', '/media', {
      success: MediaPage,
    }),
  )
  .middleware(Session)
  // The framework never decodes a body or params here, so this layer only
  // guards against a future endpoint adding one; the query decode runs
  // manually in the handler with its fixed text.
  .middleware(MediaSchemaErrors)
  // The edge forwards the full request path, so the router keeps the `/api` prefix.
  .prefix('/api');

const MediaApi = HttpApi.make('media').add(MediaGroup);

export const MEDIA_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/media' },
];

export function createMediaApi(deps: MediaApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const limiter =
    deps.limiter ??
    createRateLimiter({
      max: MEDIA_RATE_LIMIT_MAX,
      windowMs: MEDIA_RATE_LIMIT_WINDOW_MS,
      now,
    });

  const groupLayer = HttpApiBuilder.group(MediaApi, 'media', (handlers) =>
    handlers.handle('gallery', (request) => {
      const requestId = requestIdOf(request.request);
      return withErrorEnvelope(
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          if (deps.archive === undefined) {
            throw new HttpError(501, 'media_unavailable', 'Media gallery is not configured');
          }
          if (!limiter.allow(user.id)) {
            throw new HttpError(429, 'rate_limited', 'Too many requests, try again later');
          }
          const decoded = Schema.decodeUnknownOption(
            MediaQuery,
            STRICT_QUERY,
          )(queryRecord(request.request));
          if (Option.isNone(decoded)) {
            throw new HttpError(400, 'invalid_request', 'Invalid media query');
          }
          const query = decoded.value;

          const allowed = yield* Effect.promise(() =>
            allowedArchives(deps.db, deps.config, user.id),
          );
          const filter = resolveChatFilter(allowed, query.chat);
          // Unknown and invisible chats answer the same 404.
          if (filter === null) {
            throw new HttpError(404, 'not_found', 'Chat not found');
          }
          if (
            filter.kind === 'dm' &&
            (yield* Effect.promise(() => isDmBlocked(deps.db, user.id, filter.peer)))
          ) {
            throw new HttpError(404, 'not_found', 'Chat not found');
          }

          const archiveOwner = filter.kind === 'room' ? filter.room : allowed.ownLocalpart;
          const chatJid = filter.kind === 'room' ? filter.room : filter.peer;
          const kinds = [...TYPE_KINDS[query.type ?? 'media']];
          const limit = query.limit ?? MEDIA_DEFAULT_LIMIT;
          const before = query.before;

          // Index the chat on demand. A failure is logged (ids and the error
          // name only, never message contents) and the rows already stored
          // still answer. A rejection surfaces as a defect, which `yield*`
          // does not throw into a surrounding `try`; map it to a value
          // instead.
          const archive = deps.archive;
          const indexed = yield* Effect.promise(() =>
            indexChat({
              archive,
              db: deps.db,
              archiveOwner,
              chatJid,
              scope: filter,
              now: new Date(now()),
            }),
          ).pipe(
            Effect.map(() => ({ ok: true as const })),
            Effect.catchDefect((defect) => Effect.succeed({ ok: false as const, defect })),
          );
          if (!indexed.ok) {
            deps.logger.warn(
              { userId: user.id, err: errorName(indexed.defect) },
              'media index failed',
            );
          }

          const rows = yield* Effect.promise(() =>
            runSql(
              deps.db,
              Effect.gen(function* () {
                const sql = yield* SqlClient.SqlClient;
                // `kinds` is never empty here (every tab maps to at least one
                // kind), but an empty `IN ()` would be a syntax error, so the
                // guard returns no rows instead of running one.
                if (kinds.length === 0) {
                  return [] as MediaItemRow[];
                }
                const beforeCondition =
                  before === undefined ? sql`` : sql`AND at_micros < ${before}`;
                const raw = yield* sql<Record<string, unknown>>`SELECT * FROM media_items
                  WHERE archive_owner = ${archiveOwner} AND chat_jid = ${chatJid} AND deleted = false AND kind IN ${sql.in(kinds)} ${beforeCondition}
                  ORDER BY at_micros DESC, id ASC
                  LIMIT ${limit + 1}`;
                // One extra row answers "is there another page?" without a
                // count.
                return raw.map((row) => ({
                  ...(row as unknown as MediaItemRow),
                  atMicros: Number((row as { atMicros: string | number }).atMicros),
                }));
              }),
            ),
          );

          const hasMore = rows.length > limit;
          const page = hasMore ? rows.slice(0, limit) : rows;
          const items = page.map((row) =>
            toMediaItem(row, senderNameFor(row, filter, allowed, deps.config.xmpp.domain)),
          );
          const last = page[page.length - 1];
          const next = hasMore && last !== undefined ? String(last.atMicros) : null;

          return { items, next };
        }),
        logger,
        requestId,
      );
    }),
  );

  const apiLayer = HttpApiBuilder.layer(MediaApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  // The edge keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: MEDIA_API_ROUTES };
}
