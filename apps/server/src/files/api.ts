// Files module on the Effect `HttpApi` adapter (T-0580): the same method,
// path, step order, statuses, texts, logs and headers as the old router
// (`routes.ts`), mounted by the Effect edge (`apps/server/src/effect/edge.ts`).
// Handlers keep calling `allowedArchives` / `resolveChatFilter` / `indexChat`;
// the file-row read runs on the `effect/sql` client.
//
// The query is decoded manually inside the handler (Effect Schema, same rules
// as the old zod schema) instead of as an endpoint `query`, because the old
// route ran the archive check and the limiter *before* the decode (an invalid
// query still spends budget). 501 `files_unavailable` comes first, then the
// 429 limiter, then the 400 decode, then the 404 resolutions — exactly like
// the old `requireSession` -> 501 -> limiter -> `safeParse` sequence.
//
// This is the first module that streams a response body: the upstream fetch
// body flows through as a web `ReadableStream` via `HttpServerResponse.raw`
// and is never read into memory.
import { Effect, Layer, Option, Schema } from 'effect';
import { HttpServer, HttpServerRequest, HttpRouter, HttpServerResponse } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { SqlClient } from 'effect/sql';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import { isDmBlocked } from '../blocks/service';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import {
  CurrentUser,
  Session,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http-core';
import { sqlRuntimeFor } from '../effect/sql';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import { allowedArchives, resolveChatFilter, type ArchivePool } from '../search/service';
import { indexChat } from '../media/indexer';
import { toInternalUploadUrl } from '../voice-transcription/routes';

export const FILES_RATE_LIMIT_MAX = 600;
export const FILES_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const FILES_FETCH_TIMEOUT_MS = 30 * 1000;

export interface FilesRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  logger: Logger;
  /** Absent when XMPP_ARCHIVE_DATABASE_URL is unset → every request 501s. */
  archive?: ArchivePool;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
  /** Injected in tests so the ejabberd fetch never touches the network. */
  fetchImpl?: typeof fetch;
}

// Replaces `querySchema` (zod): `chat` is 1..256 characters, `url` is
// 1..2048. Strict, so an excess key fails like the old `.strict()`. Values
// arrive as strings from the query string, so the decode runs over the raw
// `URLSearchParams` view (first value wins, like the old `c.req.query()`).
const FilesQuery = Schema.Struct({
  chat: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
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

function notFound(): HttpError {
  return new HttpError(404, 'not_found', 'File not found');
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
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
  const [row] = await sqlRuntimeFor(db).runPromise(
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

// Only these upstream headers reach the client; everything else (cookies,
// server banners, ejabberd internals) stays behind. `Content-Type` falls back
// to the indexed mime, then to a generic binary type.
function passthroughHeaders(upstream: Headers, row: FilesItemRow): Headers {
  const headers = new Headers();
  const contentType = upstream.get('content-type') ?? row.mime ?? 'application/octet-stream';
  headers.set('content-type', contentType);
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
  if (row.kind === 'file') {
    const name = row.name ?? 'file';
    headers.set('content-disposition', `attachment; filename*=UTF-8''${encodeRfc5987(name)}`);
  }
  return headers;
}

const FilesGroup = HttpApiGroup.make('files')
  // No payload or query schema: the handler decodes the query by hand (so
  // the 501/429 guards run first) and streams the upstream body itself.
  .add(HttpApiEndpoint.get('file', '/files'))
  .middleware(Session)
  // The edge forwards the full request path, so the router keeps the `/api` prefix.
  .prefix('/api');

const FilesApi = HttpApi.make('files').add(FilesGroup);

export const FILES_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/files' },
];

export function createFilesApi(deps: FilesRoutesDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const limiter = createRateLimiter({
    max: FILES_RATE_LIMIT_MAX,
    windowMs: FILES_RATE_LIMIT_WINDOW_MS,
    now,
  });
  const fetchImpl = deps.fetchImpl ?? fetch;

  const groupLayer = HttpApiBuilder.group(FilesApi, 'files', (handlers) =>
    handlers.handle('file', (request) => {
      const requestId = requestIdOf(request.request);
      return withErrorEnvelope(
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          if (deps.archive === undefined) {
            throw new HttpError(501, 'files_unavailable', 'Files are not configured');
          }
          if (!limiter.allow(user.id)) {
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

          // A rejection surfaces as a defect, which `yield*` does not throw
          // into a surrounding `try`; map it to a value instead.
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
            // A just-sent file has no indexed row yet: index this chat on demand
            // and look again. A failure is logged (ids and the error name only)
            // and the lookup below still answers.
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
                'files index failed',
              );
            }
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

          // Only the Range header crosses into ejabberd: cookies, auth and any
          // other caller header stay behind.
          const range = request.request.headers['range'];
          const fetched = yield* Effect.promise(() =>
            fetchImpl(internalUrl, {
              signal: AbortSignal.timeout(FILES_FETCH_TIMEOUT_MS),
              ...(range === undefined ? {} : { headers: { range } }),
            }),
          ).pipe(
            Effect.map((response) => ({ ok: true as const, response })),
            Effect.catchDefect((defect) => Effect.succeed({ ok: false as const, defect })),
          );
          if (!fetched.ok) {
            deps.logger.warn(
              { userId: user.id, err: errorName(fetched.defect) },
              'files fetch failed',
            );
            throw new HttpError(502, 'file_unavailable', 'The file could not be loaded');
          }
          const upstream = fetched.response;
          if (upstream.status === 200 || upstream.status === 206 || upstream.status === 416) {
            // The upstream web `ReadableStream` passes through untouched:
            // `raw` wraps it as-is and `toWeb` builds the answer with
            // `new Response(body.body, ...)`, so the bytes are never buffered.
            return HttpServerResponse.raw(upstream.body, {
              status: upstream.status,
              headers: passthroughHeaders(upstream.headers, row),
            });
          }
          throw new HttpError(502, 'file_unavailable', 'The file could not be loaded');
        }),
        logger,
        requestId,
      );
    }),
  );

  const apiLayer = HttpApiBuilder.layer(FilesApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
  );

  // The edge keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: FILES_API_ROUTES };
}
