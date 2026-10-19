// Step order is security-relevant: 501 `files_unavailable`, then the 429 limiter, then the
// 400 query decode, then the 404 resolutions. The upstream body streams through, never
// read into memory.
import type { ServerCore } from '../app/deps';
import { Effect, Option, Schema } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { SqlClient } from 'effect/sql';

import { isDmBlocked } from '../blocks/service';

import type { ServerDatabase } from '../db/client';
import { errorClassName } from '../effect/error-utils';
import { mountGroups, Session, handler, type EffectApiMount } from '../effect/http-core';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { queryRecord, STRICT_QUERY } from '../http/query-record';
import { createRateLimiter, limiter, RATE_LIMITS } from '../rate-limit';
import { allowedArchives, resolveChatFilter, type ArchivePool } from '../search/service';
import { indexChatOnDemand } from '../media/indexer';
import { toInternalUploadUrl } from '../voice-transcription/routes';
import { defaultInternalFetch, type InternalFetch } from './internal-fetch';

export const FILES_FETCH_TIMEOUT_MS = 30 * 1000;

export interface FilesRoutesDependencies extends Pick<
  ServerCore,
  'auth' | 'db' | 'config' | 'logger'
> {
  archive?: ArchivePool;
  now?: () => number;
  rateLimitMax?: number;
  internalFetch?: InternalFetch;
}

// `chat` is 1..256 characters and `url` 1..2048; strict, and values arrive as strings
// from the query string (first value wins).
const FilesQuery = Schema.Struct({
  chat: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
  // A cache-buster for a retried image load: a new `retry` on every attempt so a 404 is
  // not served from the browser cache. It never reaches the lookup.
  retry: Schema.optional(Schema.String.check(Schema.isMaxLength(32))),
});

function notFound(): HttpError {
  return new HttpError(404, 'not_found', 'File not found');
}

type FilesItemRow = {
  kind: string;
  mime: string | null;
  name: string | null;
};

async function findFileRow(
  db: ServerDatabase,
  archiveOwner: string,
  chatJid: string,
  url: string,
): Promise<FilesItemRow | undefined> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<FilesItemRow>`SELECT kind, mime, name FROM media_items
        WHERE archive_owner = ${archiveOwner}
          AND chat_jid = ${chatJid}
          AND url = ${url}
          AND deleted = false
          AND kind <> 'link'
        LIMIT 1`;
    }),
  );
  return row;
}

// RFC 5987 ext-value: percent-encode, then tighten the four characters
// `encodeURIComponent` leaves raw but the grammar does not allow.
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value)
    .replaceAll("'", '%27')
    .replaceAll('(', '%28')
    .replaceAll(')', '%29')
    .replaceAll('*', '%2A');
}

// Only raster images, mp4/webm video and audio may render inline on the app origin.
// Everything else, SVG and HTML included, is an attachment: script in it would run with
// the user's session (SEC-1).
const INLINE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
]);

function isInlineMediaType(mime: string): boolean {
  if (INLINE_MEDIA_TYPES.has(mime)) {
    return true;
  }
  return mime.startsWith('audio/');
}

// Only these upstream headers reach the client; cookies and ejabberd internals stay
// behind. The effective type is the sender's word, so SVG and HTML are forced to
// `application/octet-stream` as attachments, and every reply carries a sandbox CSP.
function passthroughHeaders(upstream: Headers, row: FilesItemRow): Headers {
  const headers = new Headers();
  const declared = upstream.get('content-type') ?? row.mime ?? 'application/octet-stream';
  const mime = declared.split(';')[0]?.trim().toLowerCase() ?? 'application/octet-stream';
  const active = mime === 'image/svg+xml' || mime === 'text/html';
  headers.set('content-type', active ? 'application/octet-stream' : declared);
  for (const name of [
    'content-length',
    'content-range',
    'accept-ranges',
    'etag',
    'last-modified',
  ]) {
    const value = upstream.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  headers.set('cache-control', 'private, max-age=3600');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('content-security-policy', "default-src 'none'; sandbox");
  if (row.kind === 'file' || active || !isInlineMediaType(mime)) {
    const name = row.name ?? 'file';
    headers.set('content-disposition', `attachment; filename*=UTF-8''${encodeRfc5987(name)}`);
  }
  return headers;
}

const FilesGroup = HttpApiGroup.make('files')
  .add(HttpApiEndpoint.get('file', '/files'))
  .middleware(Session)
  .prefix('/api');

const FilesApi = HttpApi.make('files').add(FilesGroup);

export function createFilesApi(deps: FilesRoutesDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const fileLimiter =
    deps.rateLimitMax === undefined
      ? limiter('files', now)
      : createRateLimiter({ ...RATE_LIMITS.files, max: deps.rateLimitMax, now });
  const internalFetch = deps.internalFetch ?? defaultInternalFetch;
  // ejabberd resolves the upload vhost from the Host header, so the internal fetch carries
  // the public host, not `ejabberd:5280`.
  const uploadHost = new URL(deps.config.PUBLIC_URL).host;

  const groupLayer = HttpApiBuilder.group(FilesApi, 'files', (handlers) =>
    handlers.handle(
      'file',
      handler(logger, (request, user) =>
        Effect.gen(function* () {
          if (deps.archive === undefined) {
            throw new HttpError(501, 'files_unavailable', 'Files are not configured');
          }
          if (!fileLimiter.allow(user.id)) {
            throw new HttpError(429, 'rate_limited', 'Too many requests, try again later');
          }
          const decoded = Schema.decodeUnknownOption(
            FilesQuery,
            STRICT_QUERY,
          )(queryRecord(request.request));
          if (Option.isNone(decoded)) {
            throw new HttpError(400, 'invalid_request', 'Invalid file query');
          }
          const query = decoded.value;
          const internalUrl = toInternalUploadUrl(query.url, deps.config);
          if (internalUrl === null) {
            throw notFound();
          }

          const allowed = yield* Effect.promise(() =>
            allowedArchives(deps.db, deps.config, user.id),
          );
          const filter = resolveChatFilter(allowed, query.chat);
          // Unknown and invisible chats answer the same 404 as every other refusal.
          if (filter === null) {
            throw notFound();
          }
          if (
            filter.kind === 'dm' &&
            (yield* Effect.promise(() => isDmBlocked(deps.db, user.id, filter.peer)))
          ) {
            throw notFound();
          }

          const archiveOwner = filter.kind === 'room' ? filter.room : allowed.ownLocalpart;
          const chatJid = filter.kind === 'room' ? filter.room : filter.peer;

          // A rejection surfaces as a defect, which `yield*` does not throw into a
          // surrounding `try`; map it to a value instead.
          const firstLookup = yield* Effect.promise(() =>
            findFileRow(deps.db, archiveOwner, chatJid, query.url),
          ).pipe(
            Effect.map((row) => ({ found: true as const, row })),
            Effect.catchDefect((defect) => Effect.succeed({ found: false as const, defect })),
          );
          if (!firstLookup.found) {
            return yield* Effect.die(firstLookup.defect);
          }
          let row = firstLookup.row;
          if (row === undefined) {
            // A just-sent file has no indexed row yet: index this chat on demand and look
            // again. A failure is logged and the lookup below answers.
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
                logMessage: 'files index failed',
              }),
            );
            const secondLookup = yield* Effect.promise(() =>
              findFileRow(deps.db, archiveOwner, chatJid, query.url),
            ).pipe(
              Effect.map((found) => ({ found: true as const, row: found })),
              Effect.catchDefect((defect) => Effect.succeed({ found: false as const, defect })),
            );
            if (!secondLookup.found) {
              return yield* Effect.die(secondLookup.defect);
            }
            row = secondLookup.row;
          }
          if (row === undefined) {
            throw notFound();
          }

          // Only the Range header crosses into ejabberd.
          const range = request.request.headers['range'];
          const fetched = yield* Effect.promise(() =>
            internalFetch(internalUrl, {
              host: uploadHost,
              ...(range === undefined ? {} : { range }),
              signal: AbortSignal.timeout(FILES_FETCH_TIMEOUT_MS),
            }),
          ).pipe(
            Effect.map((response) => ({ ok: true as const, response })),
            Effect.catchDefect((defect) => Effect.succeed({ ok: false as const, defect })),
          );
          if (!fetched.ok) {
            deps.logger.warn(
              { userId: user.id, err: errorClassName(fetched.defect) },
              'files fetch failed',
            );
            throw new HttpError(502, 'file_unavailable', 'The file could not be loaded');
          }
          const upstream = fetched.response;
          if (upstream.status === 200 || upstream.status === 206 || upstream.status === 416) {
            // The upstream web `ReadableStream` passes through untouched: `raw` wraps it and
            // `toWeb` builds the answer, so the bytes are never buffered.
            return HttpServerResponse.raw(upstream.body, {
              status: upstream.status,
              headers: passthroughHeaders(upstream.headers, row),
            });
          }
          // A non-200/206/416 upstream becomes the fixed 502; log only the status, never
          // the URL or token, and release the unread body.
          void upstream.body.cancel().catch(() => {});
          deps.logger.warn({ userId: user.id, status: upstream.status }, 'files upstream status');
          throw new HttpError(502, 'file_unavailable', 'The file could not be loaded');
        }),
      ),
    ),
  );

  return mountGroups(FilesApi, groupLayer, {
    auth: deps.auth,
    logger,
  });
}
