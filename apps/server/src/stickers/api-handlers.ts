import { Effect, Option, Schema } from 'effect';
import { HttpServerResponse, HttpServerRequest } from 'effect/http';
import { HttpApiBuilder, type HttpApi } from 'effect/http-api';
import { ImportTelegramPayload, StickersGroup, type StickerPackDetail } from '@zilar/api-contract';
import { handler, requestIdOf } from '../effect/http-core';
import { HttpError, xmppUnavailable } from '../errors';
import { readCapped } from '../http/read-capped';
import { limiter } from '../rate-limit';
import { addPanelPack, removePanelPack, reorderPanelPacks } from './panel';
import { createPack, deletePack, discoverPacks, listPanelPacks, patchPack } from './packs';
import {
  deleteSticker,
  readStickerFile,
  loadPackStickers,
  requireVisiblePack,
  toPackView,
  toStickerView,
  uploadSticker,
} from './storage';
import { importTelegramPack, type TelegramImportDeps } from './telegram';
import { type StickerRow, type StickersServiceDeps, type StickerView } from './schemas';
import { createTelegramClient } from './telegram/client';
import { parseTelegramPackInput } from './telegram/pack-input';
import { TelegramImportError } from './telegram/errors';
import { type TelegramClient } from './telegram/set';
import {
  DiscoverQuery,
  FavoriteBody,
  STRICT_PAYLOAD,
  decodePathId,
  discoverQueryRecord,
  favoriteQueryRecord,
  parseJsonOrNull,
  spendTelegramImportBudget,
} from './api-decode';
import { type StickersApiDependencies } from './api';
import { SqlClient } from 'effect/sql';
import { runSql } from '../effect/sql';
import { STICKER_MAX_UPLOAD_BYTES } from './image';
// The upload request: the raw request plus the `:id` path param, since the
// route declares no payload schema.
interface UploadStickerRequest {
  readonly request: HttpServerRequest.HttpServerRequest;
  readonly params: { readonly id: string };
}

function runUploadSticker(
  request: UploadStickerRequest,
  user: { readonly id: string },
  serviceDeps: () => StickersServiceDeps,
) {
  return Effect.gen(function* () {
    const contentType = request.request.headers['content-type'] ?? '';
    let bytes: Uint8Array;
    let emoji: string | undefined;
    if (contentType.includes('multipart/form-data')) {
      // `formData()` buffers before size can be checked, so a declared length is
      // required; a chunked body with none would otherwise be read whole.
      const declaredHeader = request.request.headers['content-length'];
      const declared = declaredHeader === undefined ? Number.NaN : Number(declaredHeader);
      if (!Number.isFinite(declared) || declared < 0) {
        // `HttpError` only carries statuses the API answers with and 411 is not
        // one, so this fixed envelope is returned directly.
        return HttpServerResponse.jsonUnsafe(
          {
            error: {
              code: 'length_required',
              message: 'The upload must declare its length',
              requestId: requestIdOf(request.request),
            },
          },
          { status: 411 },
        );
      }
      if (declared > STICKER_MAX_UPLOAD_BYTES + 64 * 1024) {
        throw new HttpError(413, 'sticker_too_large', 'The file is larger than 4 MiB');
      }
      const webRequest = yield* HttpServerRequest.toWeb(request.request).pipe(Effect.orDie);
      const form = yield* Effect.promise(() => webRequest.formData().catch(() => null));
      if (!form) {
        throw new HttpError(400, 'invalid_request', 'The upload must carry one file');
      }
      const file = form.get('file');
      if (!(file instanceof File)) {
        throw new HttpError(400, 'invalid_request', 'The upload must carry one file');
      }
      const buffer = new Uint8Array(
        yield* Effect.promise(() => file.arrayBuffer().catch(() => new ArrayBuffer(0))),
      );
      if (buffer.byteLength > STICKER_MAX_UPLOAD_BYTES) {
        throw new HttpError(413, 'sticker_too_large', 'The file is larger than 4 MiB');
      }
      bytes = buffer;
      const rawEmoji = form.get('emoji');
      if (typeof rawEmoji === 'string' && rawEmoji !== '') {
        emoji = rawEmoji;
      }
      if (emoji !== undefined && emoji.length > 8) {
        throw new HttpError(
          400,
          'invalid_request',
          'Too big: expected string to have <=8 characters',
        );
      }
    } else {
      // Raw bytes: the client POSTs the file with an optional `x-emoji` header.
      const declared = Number(request.request.headers['content-length'] ?? '');
      if (Number.isFinite(declared) && declared > STICKER_MAX_UPLOAD_BYTES) {
        throw new HttpError(413, 'sticker_too_large', 'The file is larger than 4 MiB');
      }
      const capped = yield* readCapped(request.request.stream, STICKER_MAX_UPLOAD_BYTES).pipe(
        Effect.orDie,
      );
      if (capped === undefined) {
        throw new HttpError(413, 'sticker_too_large', 'The file is larger than 4 MiB');
      }
      bytes = capped;
      const rawEmoji = request.request.headers['x-emoji'];
      if (rawEmoji !== undefined && rawEmoji !== '') {
        // Header values are latin1, so the client percent-encodes the emoji; decode
        // at most 64 characters and let the service validate the length.
        let decodedEmoji = rawEmoji;
        if (decodedEmoji.includes('%')) {
          try {
            decodedEmoji = decodeURIComponent(decodedEmoji.slice(0, 64));
          } catch {
            throw new HttpError(400, 'invalid_request', 'The emoji header is not valid');
          }
        }
        emoji = decodedEmoji;
      }
    }
    const packId = yield* Effect.sync(() => decodePathId(request.params.id));
    return yield* Effect.promise(() =>
      uploadSticker(serviceDeps(), packId, user.id, bytes, emoji === undefined ? {} : { emoji }),
    );
  });
}

async function getPackDetail(
  deps: StickersServiceDeps,
  packId: string,
  userId: string,
): Promise<StickerPackDetail> {
  const pack = await requireVisiblePack(deps, packId, userId);
  const [handleRow] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ handle: string }>`SELECT handle FROM handles
        WHERE user_id = ${pack.ownerId} LIMIT 1`;
    }),
  );
  const [panelRow] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ packId: string }>`SELECT pack_id FROM user_sticker_packs
        WHERE user_id = ${userId} AND pack_id = ${packId} LIMIT 1`;
    }),
  );
  return {
    ...toPackView(deps, pack, await loadPackStickers(deps, packId)),
    ownerHandle: handleRow?.handle ?? null,
    inPanel: panelRow !== undefined,
  };
}

// The Telegram import payload is a short pack link; read the body under this
// cap so an oversized or endless chunked body is refused before parsing.
const TELEGRAM_IMPORT_MAX_BODY_BYTES = 64 * 1024;

export function createStickersGroupLayer(
  api: HttpApi.HttpApi<'stickers', typeof StickersGroup>,
  deps: StickersApiDependencies,
) {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  // The default resolver keeps the env-only read for callers that do not wire
  // the integrations module (unit tests).
  const getBotToken =
    deps.getBotToken ??
    (async (): Promise<string | null> => {
      const token = deps.config.TELEGRAM_BOT_TOKEN;
      return token === undefined || token === '' ? null : token;
    });
  const telegramImportLimiter = deps.importLimiter ?? limiter('telegramImport', now);

  function serviceDeps(): StickersServiceDeps {
    return {
      db: deps.db,
      storageDir: deps.storageDir,
      ...(deps.audit === undefined ? {} : { audit: deps.audit }),
      ...(deps.converter === undefined ? {} : { converter: deps.converter }),
    };
  }

  function importDeps(): TelegramImportDeps {
    return {
      ...serviceDeps(),
      ...(deps.now === undefined ? {} : { now: deps.now }),
    };
  }

  return HttpApiBuilder.group(api, 'stickers', (handlers) =>
    handlers
      .handle(
        'listPacks',
        handler(logger, async (_request, user) => ({
          packs: await listPanelPacks(serviceDeps(), user.id),
        })),
      )
      .handle(
        'createPack',
        handler(logger, (request, user) =>
          createPack(serviceDeps(), user.id, { ...request.payload }),
        ),
      )
      // The query is decoded manually because the contract's `RawQueryValue` keys
      // never fail in the router, so an invalid query answers the fixed 400.
      .handle(
        'discover',
        handler(logger, (request) => {
          const decoded = Schema.decodeUnknownOption(DiscoverQuery)(
            discoverQueryRecord(request.request),
          );
          if (Option.isNone(decoded)) {
            throw new HttpError(
              400,
              'invalid_request',
              'q must be at most 60 characters and cursor at most 128',
            );
          }
          return discoverPacks(serviceDeps(), decoded.value.q, decoded.value.cursor);
        }),
      )
      // The pack link: the id is decoded like every path id, so a malformed
      // escape is the same 404 as an unknown pack.
      .handle(
        'getPack',
        handler(logger, (request, user) =>
          getPackDetail(serviceDeps(), decodePathId(request.params.id), user.id),
        ),
      )
      // The body is decoded manually after the 501 token check: the framework
      // decode used to run first and answered 400 instead of `import_unavailable`.
      // Same reason the endpoint uses `handleRaw`.
      .handleRaw(
        'importTelegram',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const token = yield* Effect.promise(() => getBotToken());
            if (token === null) {
              throw new HttpError(501, 'import_unavailable', 'Telegram import is not configured');
            }
            const body = yield* readCapped(
              request.request.stream,
              TELEGRAM_IMPORT_MAX_BODY_BYTES,
            ).pipe(Effect.orDie);
            if (body === undefined) {
              throw new HttpError(413, 'request_too_large', 'The import body is too large');
            }
            const raw = parseJsonOrNull(new TextDecoder().decode(body));
            const decoded = Schema.decodeUnknownOption(ImportTelegramPayload, STRICT_PAYLOAD)(raw);
            if (Option.isNone(decoded)) {
              throw new HttpError(
                400,
                'invalid_request',
                'input must be a string of 1 to 512 characters, with no other keys',
              );
            }
            // The budget is consumed only by a well-formed request for a real pack
            // name; garbage fails before the limiter.
            try {
              parseTelegramPackInput(decoded.value.input);
            } catch (error) {
              if (error instanceof TelegramImportError) {
                throw new HttpError(400, 'invalid_request', 'That sticker pack link is not valid');
              }
              throw error;
            }
            yield* Effect.sync(() => spendTelegramImportBudget(telegramImportLimiter, user.id));
            const client: TelegramClient = deps.telegramClient ?? createTelegramClient(token);
            const result = yield* Effect.promise(() =>
              importTelegramPack(importDeps(), user.id, decoded.value.input, client),
            );
            return {
              pack: result.pack,
              imported: result.imported,
              skippedAnimated: result.skippedAnimated,
              skippedInvalid: result.skippedInvalid,
              ...(result.partial ? { partial: true as const } : {}),
            };
          }),
        ),
      )
      .handle(
        'patchPack',
        handler(logger, (request, user) =>
          patchPack(serviceDeps(), decodePathId(request.params.id), user.id, {
            ...request.payload,
          }),
        ),
      )
      .handle(
        'deletePack',
        handler(logger, (request, user) =>
          deletePack(serviceDeps(), decodePathId(request.params.id), user.id),
        ),
      )
      .handle(
        'deleteSticker',
        handler(logger, async (request, user) => {
          const packId = decodePathId(request.params.id);
          const stickerId = decodePathId(request.params.stickerId);
          await deleteSticker(serviceDeps(), packId, stickerId, user.id);
          return { ok: true as const };
        }),
      )
      .handle(
        'reorderPanel',
        handler(logger, async (request, user) => {
          await reorderPanelPacks(serviceDeps(), user.id, { ...request.payload });
          return { ok: true as const };
        }),
      )
      .handle(
        'addPanelPack',
        handler(logger, async (request, user) => {
          await addPanelPack(serviceDeps(), decodePathId(request.params.packId), user.id);
          return { ok: true as const };
        }),
      )
      .handle(
        'removePanelPack',
        handler(logger, async (request, user) => {
          await removePanelPack(serviceDeps(), decodePathId(request.params.packId), user.id);
          return { ok: true as const };
        }),
      )
      .handle(
        'listFavorites',
        handler(logger, async (_request, user) => ({
          favorites: await listFavorites(serviceDeps(), user.id),
        })),
      )
      .handle(
        'addFavorite',
        handler(logger, (request, user) =>
          addFavorite(serviceDeps(), user.id, request.payload.sticker_id),
        ),
      )
      .handle(
        'removeFavorite',
        handler(logger, async (request, user) => {
          const decoded = Schema.decodeUnknownOption(
            FavoriteBody,
            STRICT_PAYLOAD,
          )(favoriteQueryRecord(request.request));
          if (Option.isNone(decoded)) {
            throw new HttpError(
              400,
              'invalid_request',
              'sticker_id must be a UUID, with no other keys',
            );
          }
          await removeFavorite(serviceDeps(), user.id, decoded.value.sticker_id);
          return { ok: true as const };
        }),
      )
      .handle(
        'uploadSticker',
        handler(logger, (request: UploadStickerRequest, user) =>
          runUploadSticker(request, user, serviceDeps),
        ),
      )
      // Streams the stored file. The id is a random unguessable uuid and a
      // signed-in session is required, but the URL is a capability: an unknown id
      // and a malformed escape answer the same 404.
      .handle(
        'serveFile',
        handler(logger, async (request) => {
          let stickerId: string;
          try {
            stickerId = decodeURIComponent(request.params.stickerId);
          } catch {
            throw new HttpError(404, 'not_found', 'Sticker not found');
          }
          const file = await readStickerFile(serviceDeps(), stickerId);
          if (!file) {
            throw new HttpError(404, 'not_found', 'Sticker not found');
          }
          return HttpServerResponse.uint8Array(file.bytes, {
            status: 200,
            headers: {
              'content-type': file.mime,
              'content-length': String(file.size),
              'x-content-type-options': 'nosniff',
              'content-disposition': 'inline',
              'cache-control': 'public, max-age=31536000, immutable',
              'content-security-policy': "default-src 'none'; sandbox",
            },
          });
        }),
      ),
  );
}

// Favorites: one user's starred stickers, at most 200, ordered by when
// starred. Any sticker the caller knows the id of may be favorited; there is
// no visibility check, so starring never becomes a private-pack oracle.

export const STICKER_FAVORITES_MAX = 200;

const favoriteBodySchema = Schema.Struct({
  sticker_id: Schema.String.pipe(Schema.check(Schema.isUUID())),
});

export type FavoriteBody = typeof favoriteBodySchema.Type;
export { favoriteBodySchema };

export async function listFavorites(
  deps: StickersServiceDeps,
  userId: string,
): Promise<StickerView[]> {
  const links = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ stickerId: string }>`SELECT sticker_id FROM sticker_favorites
        WHERE user_id = ${userId}
        ORDER BY added_at ASC, sticker_id ASC`;
    }),
  );
  if (links.length === 0) {
    return [];
  }
  // One query for all sticker rows, never one per favorite; the links are the
  // caller's own rows, so the result stays per-user.
  const ids = links.map((link) => link.stickerId);
  const rows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerRow>`SELECT * FROM stickers WHERE id IN ${sql.in(ids)}`;
    }),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const views: StickerView[] = [];
  for (const link of links) {
    const row = byId.get(link.stickerId);
    if (row) {
      views.push(toStickerView(deps, row));
    }
  }
  return views;
}

export async function addFavorite(
  deps: StickersServiceDeps,
  userId: string,
  stickerId: string,
): Promise<StickerView> {
  const [row] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerRow>`SELECT * FROM stickers WHERE id = ${stickerId} LIMIT 1`;
    }),
  );
  // An unknown id and an invisible one answer the same 404; starring is
  // idempotent, so no existence signal leaks.
  if (!row) {
    throw new HttpError(404, 'not_found', 'Sticker not found');
  }
  try {
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${`sticker-favorites:${userId}`}))`;
            // A re-star is idempotent even at the cap: check for the row before
            // counting, so a retry at 200 favorites still 200s.
            const [existing] = yield* sql<{
              stickerId: string;
            }>`SELECT sticker_id FROM sticker_favorites
              WHERE user_id = ${userId} AND sticker_id = ${stickerId} LIMIT 1`;
            if (existing) {
              return;
            }
            const [counter] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
              FROM sticker_favorites WHERE user_id = ${userId}`;
            if (Number(counter?.total ?? 0) >= STICKER_FAVORITES_MAX) {
              return yield* Effect.fail(
                new HttpError(
                  400,
                  'favorites_full',
                  `A user has at most ${STICKER_FAVORITES_MAX} favorites`,
                ),
              );
            }
            yield* sql`INSERT INTO sticker_favorites (user_id, sticker_id)
              VALUES (${userId}, ${stickerId}) ON CONFLICT DO NOTHING`;
          }),
        );
      }),
    );
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw xmppUnavailable();
  }
  return toStickerView(deps, row);
}

export async function removeFavorite(
  deps: StickersServiceDeps,
  userId: string,
  stickerId: string,
): Promise<void> {
  // Unstarring an absent favorite is still `{ ok: true }`, so the answer
  // reveals nothing about what the caller has starred.
  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM sticker_favorites
        WHERE user_id = ${userId} AND sticker_id = ${stickerId}`;
    }),
  );
}
