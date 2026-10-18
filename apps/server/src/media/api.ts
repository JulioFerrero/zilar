// Step order is security-relevant: 501 `media_unavailable`, then the 429 limiter, then
// the 400 query decode, then the 404 chat resolution.
import { Effect, Layer, Option, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { HttpServerResponse, type HttpServerRequest } from 'effect/http';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { LinkPreviewGroup, MediaGroup } from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import { isDmBlocked } from '../blocks/service';
import type { ServerConfig } from '../config/load';
import type { ServerDatabase } from '../db/client';
import type { MediaItemRow } from '../db/rows';
import { runSql } from '../effect/sql';
import {
  handler,
  mountApi,
  schemaErrorLayer,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import { HttpError } from '../errors';
import { queryRecord, STRICT_QUERY } from '../http/query-record';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { allowedArchives, resolveChatFilter, type ArchivePool } from '../search/service';
import { senderNamesByJid } from '../xmpp/archive-sender';
import { fetchLinkPreview, fetchLinkPreviewImage } from '../link-preview/fetch';
import { indexChatOnDemand, type MediaKind } from './indexer';
import { roomSenderJids, senderNameFor, toMediaItem } from './items';

export const MEDIA_RATE_LIMIT_MAX = 30;
export const MEDIA_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const MEDIA_DEFAULT_LIMIT = 50;
export const MEDIA_MAX_LIMIT = 100;
// The link-preview budget, a read route capped per user like the gallery.
export const LINK_PREVIEW_RATE_LIMIT_MAX = 60;
export const LINK_PREVIEW_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const LINK_PREVIEW_MAX_URL_CHARS = 2000;

export const MEDIA_TYPES = ['media', 'files', 'links', 'voice'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

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
  archive?: ArchivePool;
  now?: () => number;
}

export interface MediaApiDependencies extends MediaRoutesDependencies {
  limiter?: RateLimiter;
  linkPreviewLimiter?: RateLimiter;
}

// `chat` is 1..256 characters; `type` one of the four tabs; `before` a positive int,
// `limit` 1..MEDIA_MAX_LIMIT. Strict, values arrive as strings (first value wins).
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

function linkPreviewUrl(request: HttpServerRequest.HttpServerRequest): string | null {
  const url = queryRecord(request).url;
  if (url === undefined || url.length === 0 || url.length > LINK_PREVIEW_MAX_URL_CHARS) {
    return null;
  }
  return /^https:\/\//i.test(url) ? url : null;
}

const MediaApi = HttpApi.make('media').add(MediaGroup, LinkPreviewGroup);

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
  const linkPreviewLimiter =
    deps.linkPreviewLimiter ??
    createRateLimiter({
      max: LINK_PREVIEW_RATE_LIMIT_MAX,
      windowMs: LINK_PREVIEW_RATE_LIMIT_WINDOW_MS,
      now,
    });

  const groupLayer = HttpApiBuilder.group(MediaApi, 'media', (handlers) =>
    handlers.handle(
      'gallery',
      handler(logger, (request, user) =>
        Effect.gen(function* () {
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

          // Index the chat on demand. A failure is logged with ids only and the stored
          // rows still answer.
          const archive = deps.archive;
          yield* Effect.promise(() =>
            indexChatOnDemand({
              archive,
              db: deps.db,
              archiveOwner,
              chatJid,
              scope: filter,
              now: new Date(now()),
              logger: deps.logger,
              userId: user.id,
              logMessage: 'media index failed',
            }),
          );

          const rows = yield* Effect.promise(() =>
            runSql(
              deps.db,
              Effect.gen(function* () {
                const sql = yield* SqlClient.SqlClient;
                // `kinds` is never empty, but an empty `IN ()` would be a syntax error, so
                // the guard returns no rows.
                if (kinds.length === 0) {
                  return [] as MediaItemRow[];
                }
                const beforeCondition =
                  before === undefined ? sql`` : sql`AND at_micros < ${before}`;
                const raw = yield* sql<Record<string, unknown>>`SELECT * FROM media_items
                  WHERE archive_owner = ${archiveOwner} AND chat_jid = ${chatJid} AND deleted = false AND kind IN ${sql.in(kinds)} ${beforeCondition}
                  ORDER BY at_micros DESC, id ASC
                  LIMIT ${limit + 1}`;
                return raw.map((row) => ({
                  ...(row as unknown as MediaItemRow),
                  atMicros: Number((row as { atMicros: string | number }).atMicros),
                }));
              }),
            ),
          );

          const hasMore = rows.length > limit;
          const page = hasMore ? rows.slice(0, limit) : rows;
          // One batched name lookup for the page's room senders: the name comes from
          // `bare_peer`, never the nick, and a failed lookup must not fail the page.
          const roomNames = yield* Effect.promise(() =>
            senderNamesByJid(deps.db, roomSenderJids(page)),
          ).pipe(Effect.catchDefect(() => Effect.succeed(new Map<string, string>())));
          const items = page.map((row) =>
            toMediaItem(
              row,
              senderNameFor(row, filter, allowed, deps.config.xmpp.domain, roomNames),
            ),
          );
          const last = page[page.length - 1];
          const next = hasMore && last !== undefined ? String(last.atMicros) : null;

          return { items, next };
        }),
      ),
    ),
  );

  // The preview answers 200 with the unfurled head, 204 when the page has neither title
  // nor description, and a 400 for a non-https or overlong URL. Everything the guard
  // refuses is an empty answer. `image` serves bytes behind a key a cached preview
  // minted, so the remote URL never reaches a client; an unknown key is a 404.
  const linkPreviewGroupLayer = HttpApiBuilder.group(MediaApi, 'linkPreview', (handlers) =>
    handlers
      .handle(
        'get',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            if (!linkPreviewLimiter.allow(user.id)) {
              throw new HttpError(429, 'rate_limited', 'Too many requests, try again later');
            }
            const url = linkPreviewUrl(request.request);
            if (url === null) {
              throw new HttpError(400, 'invalid_request', 'Invalid link preview url');
            }
            const preview = yield* fetchLinkPreview(url, { logger });
            if (preview === null) {
              return HttpServerResponse.empty();
            }
            return preview;
          }),
        ),
      )
      .handle(
        'image',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            if (!linkPreviewLimiter.allow(user.id)) {
              throw new HttpError(429, 'rate_limited', 'Too many requests, try again later');
            }
            const image = yield* fetchLinkPreviewImage(request.params.key, { logger });
            if (image === null) {
              throw new HttpError(404, 'not_found', 'Link preview image not found');
            }
            return HttpServerResponse.uint8Array(image.bytes, {
              status: 200,
              headers: {
                'content-type': image.contentType,
                'content-length': String(image.bytes.byteLength),
                'cache-control': 'private, max-age=86400',
                'x-content-type-options': 'nosniff',
              },
            });
          }),
        ),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(MediaApi).pipe(
    Layer.provide(Layer.merge(groupLayer, linkPreviewGroupLayer)),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(MediaApi, apiLayer);
}
