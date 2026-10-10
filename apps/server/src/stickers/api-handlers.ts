// The stickers HTTP handlers and their group layer, split out of `./api` by
// T-0992. The 14 routes keep their methods, paths, order, statuses, texts,
// bodies and headers; only the file they live in changed. The upload body
// lives in `./api-upload`, and the hand-decodes and fixed error texts in
// `./api-decode`.

import { Effect, Option, Schema } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { HttpApiBuilder, type HttpApi } from 'effect/http-api';
import { ImportTelegramPayload, StickersGroup } from '@zilar/api-contract';
import { handler } from '../effect/http-core';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import { TELEGRAM_IMPORT_RATE_LIMIT_MAX, TELEGRAM_IMPORT_RATE_LIMIT_WINDOW_MS } from './routes';
import {
  addFavorite,
  addPanelPack,
  createPack,
  deletePack,
  deleteSticker,
  discoverPacks,
  importTelegramPack,
  listFavorites,
  listPanelPacks,
  patchPack,
  readStickerFile,
  removeFavorite,
  removePanelPack,
  reorderPanelPacks,
  type StickersServiceDeps,
  type TelegramImportDeps,
} from './service';
import {
  createTelegramClient,
  parseTelegramPackInput,
  TelegramImportError,
  type TelegramClient,
} from './telegram-import';
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
import { runUploadSticker, type UploadStickerRequest } from './api-upload';
import type { StickersApiDependencies } from './api';

export function createStickersGroupLayer(
  api: HttpApi.HttpApi<'stickers', typeof StickersGroup>,
  deps: StickersApiDependencies,
) {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  // The default resolver keeps the legacy env-only read for callers that do
  // not wire the integrations module (unit tests of these routes).
  const getBotToken =
    deps.getBotToken ??
    (async (): Promise<string | null> => {
      const token = deps.config.TELEGRAM_BOT_TOKEN;
      return token === undefined || token === '' ? null : token;
    });
  const telegramImportLimiter =
    deps.importLimiter ??
    createRateLimiter({
      max: TELEGRAM_IMPORT_RATE_LIMIT_MAX,
      windowMs: TELEGRAM_IMPORT_RATE_LIMIT_WINDOW_MS,
      now,
    });

  function serviceDeps(): StickersServiceDeps {
    return {
      db: deps.db,
      storageDir: deps.storageDir,
      ...(deps.audit === undefined ? {} : { audit: deps.audit }),
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
      // The query is decoded manually inside the handler (the contract's
      // `RawQueryValue` keys never fail in the router) so an invalid query
      // answers the fixed 400 message, like the media gallery's hand decode.
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
      // The body is decoded manually inside the handler, after the 501
      // token check: the framework-level payload decode used to run before
      // any handler code, so a malformed body answered 400 instead of the
      // specified 501 `import_unavailable` (the old order is session ->
      // token -> body -> pack-input parse -> limiter -> import). For the same
      // reason the endpoint is served with `handleRaw`.
      .handleRaw(
        'importTelegram',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const token = yield* Effect.promise(() => getBotToken());
            if (token === null) {
              throw new HttpError(501, 'import_unavailable', 'Telegram import is not configured');
            }
            const raw = parseJsonOrNull(yield* Effect.orDie(request.request.text));
            const decoded = Schema.decodeUnknownOption(ImportTelegramPayload, STRICT_PAYLOAD)(raw);
            if (Option.isNone(decoded)) {
              throw new HttpError(
                400,
                'invalid_request',
                'input must be a string of 1 to 512 characters, with no other keys',
              );
            }
            // The budget is consumed only by a well-formed request for a real
            // pack name: garbage input fails here, before the limiter runs.
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
      // The id comes from the query string; the endpoint declares no body.
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
      // The multipart/raw upload (part B, T-0602): the body lives in
      // `./api-upload`.
      .handle(
        'uploadSticker',
        handler(logger, (request: UploadStickerRequest, user) =>
          runUploadSticker(request, user, serviceDeps),
        ),
      )
      // Streams the stored file. The id is a random unguessable uuid and a
      // signed-in session is required, but the URL is a capability for
      // signed-in users. An unknown id and a malformed escape answer the same
      // 404; the strict headers match the old route byte for byte.
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
