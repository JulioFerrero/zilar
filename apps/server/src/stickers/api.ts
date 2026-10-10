// Stickers module on the Effect `HttpApi` adapter (T-0582 part A, T-0602 part
// B): the same methods, paths, order, statuses, texts, bodies and headers as
// the deleted routers. Its service runs on effect/sql.
//
// All 14 routes live here. The 12 JSON routes came first (part A); part B adds
// the multipart/raw upload (`POST /sticker-packs/:id/stickers`) and the file
// GET (`GET /stickers/:stickerId/file`).
//
// Step order per route (unchanged):
// - Telegram import: session -> token (501) -> body decode -> pack-input
//   parse (400 link text) -> limiter (429) -> import. The answer carries
//   `partial` only when true.
// - Upload: session -> upload limiter (429) -> content-type branch. Multipart
//   checks the declared length (413), parses the form, requires one `file`
//   (400) and validates the `emoji` (400). Raw bytes checks the declared
//   length, streams through `readCapped` (413), then decodes `x-emoji` (400).
// - File GET: session -> decode id -> read file. A bad escape, an unknown id
//   and a missing file all answer 404 `not_found`.
// - DELETE /sticker-favorites decodes the body from the query string.
// - Every other JSON route: session -> body/query decode -> service call.
// Decode failures answer 400 `invalid_request` with a fixed per-route message.
// `decodePathId` keeps the old final id (404 on a bad escape).
//
// The binary routes declare no payload schema, so nothing is buffered before
// the handler. The upload reads multipart via the web `Request`'s `formData()`
// and raw bytes via the request stream; the file GET answers a raw
// `HttpServerResponse.uint8Array`, which `HttpApiBuilder` returns untouched.

import { Effect, Layer, Option, Schema, Stream } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from 'effect/http-api';
import type { Logger } from 'pino';
import {
  Session,
  failureResponse,
  handler,
  mountApi,
  requestIdOf,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import { makeRateLimit } from '../effect/rate-limit-middleware';
import { HttpError } from '../errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import type { StickersRoutesDependencies } from './routes';
import {
  STICKER_UPLOAD_RATE_LIMIT_MAX,
  STICKER_UPLOAD_RATE_LIMIT_WINDOW_MS,
  TELEGRAM_IMPORT_RATE_LIMIT_MAX,
  TELEGRAM_IMPORT_RATE_LIMIT_WINDOW_MS,
} from './routes';
import { STICKER_MAX_BYTES } from './image';
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
  STICKER_PANEL_MAX,
  STICKERS_MAX_PER_PACK,
  STICKER_PACK_TITLE_MAX,
  STICKER_PACK_TITLE_MIN,
  uploadSticker,
  type StickersServiceDeps,
  type TelegramImportDeps,
} from './service';
import {
  createTelegramClient,
  parseTelegramPackInput,
  TelegramImportError,
  type TelegramClient,
} from './telegram-import';

export interface StickersApiDependencies extends StickersRoutesDependencies {
  logger: Logger;
}

const StickerVisibility = Schema.Literals(['private', 'server']);

// Strict, trimmed title 1..60, optional visibility. Strictness comes from
// the endpoint's `PayloadParseOptions` below.
const CreatePackBody = Schema.Struct({
  title: Schema.Trim.pipe(
    Schema.check(
      Schema.isMinLength(STICKER_PACK_TITLE_MIN),
      Schema.isMaxLength(STICKER_PACK_TITLE_MAX),
    ),
  ),
  visibility: Schema.optional(StickerVisibility),
});

// All optional and strict, plus the "Nothing to update" refine (a
// `makeFilter`, because Effect 4.0.2 drops `{ message }` on length checks).
const PatchPackBody = Schema.Struct({
  title: Schema.optional(
    Schema.Trim.pipe(
      Schema.check(Schema.isMinLength(STICKER_PACK_TITLE_MIN), Schema.isMaxLength(60)),
    ),
  ),
  visibility: Schema.optional(StickerVisibility),
  order: Schema.optional(
    Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))).check(
      Schema.isMaxLength(STICKERS_MAX_PER_PACK),
    ),
  ),
}).pipe(
  Schema.check(
    Schema.makeFilter((value) => (Object.keys(value).length > 0 ? undefined : 'Nothing to update')),
  ),
);

// Optional `q` <= 60, `cursor` <= 128. The route decodes the query manually
// with this Schema (the endpoint declares no query) so an invalid query
// answers the fixed 400 message.
const DiscoverQuery = Schema.Struct({
  q: Schema.optional(Schema.String.check(Schema.isMaxLength(60))),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),
});

// Strict, `input` 1..512. The import route decodes this manually in its
// handler (after the 501 token check), so strictness comes from
// `STRICT_PAYLOAD` below.
const TelegramImportBody = Schema.Struct({
  input: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
});

const STRICT_PAYLOAD = { onExcessProperty: 'error' } as const;

// Strict, ids 1..128, at most 200.
const ReorderPanelBody = Schema.Struct({
  order: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))).check(
    Schema.isMaxLength(STICKER_PANEL_MAX),
  ),
});

// Strict, `sticker_id: uuid`.
const FavoriteBody = Schema.Struct({
  sticker_id: Schema.String.pipe(Schema.check(Schema.isUUID())),
});

// Mirrors `c.req.json().catch(() => null)`: an unparseable or empty body is
// `null`, which the per-route message treats as an invalid body.
function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function discoverQueryRecord(request: HttpServerRequest.HttpServerRequest): Record<string, string> {
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

function favoriteQueryRecord(request: HttpServerRequest.HttpServerRequest): Record<string, string> {
  return discoverQueryRecord(request);
}

// Applied to the group so a payload decode failure renders as 400
// `invalid_request` with the fixed per-route message. The body was already
// read (and cached) by the failed payload decode. The discover and
// favorite-delete routes decode manually in their handlers, so they never
// reach this layer.
class StickersSchemaErrors extends HttpApiMiddleware.Service<StickersSchemaErrors>()(
  'zilar/effect/http/StickersSchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<StickersSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(StickersSchemaErrors, () =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const body = parseJsonOrNull(yield* Effect.orDie(request.text));
      const message = matchSchemaErrorMessage(request.originalUrl, body);
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', message),
      );
    }),
  );
}

function isEmptyRecord(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

// Picks the fixed message by the request path (the method is implied by the
// route): every path below carries exactly one JSON body shape. The patch
// route reads the cached body only to tell `{}` apart.
function matchSchemaErrorMessage(url: string, body: unknown): string {
  const path = url.split('?')[0] ?? url;
  if (path.endsWith('/sticker-packs/import/telegram')) {
    return 'input must be a string of 1 to 512 characters, with no other keys';
  }
  if (path.endsWith('/sticker-panel')) {
    return `order must be a list of at most ${STICKER_PANEL_MAX} sticker ids, with no other keys`;
  }
  if (path.endsWith('/sticker-favorites')) {
    return 'sticker_id must be a UUID, with no other keys';
  }
  if (path.endsWith('/sticker-packs')) {
    return 'title must be 1 to 60 characters and visibility private or server, with no other keys';
  }
  if (isEmptyRecord(body)) {
    return 'Nothing to update';
  }
  return `title must be 1 to 60 characters, visibility private or server and order at most ${STICKERS_MAX_PER_PACK} ids, with no other keys`;
}

// Runs the Telegram import budget after the pack-input parse, exactly like
// the old route's limiter position (item 9): garbage input fails before the
// 3/hour budget is spent. Kept in the handler (not endpoint middleware) so
// the 501 token check runs first: a missing token must never spend budget.
function spendTelegramImportBudget(
  limiter: { allow: (key: string) => boolean },
  userId: string,
): void {
  if (!limiter.allow(userId)) {
    throw new HttpError(429, 'rate_limited', 'Too many Telegram imports, try again later');
  }
}

// Every field of `StickerView`, so the success encoding never strips one.
const StickerViewSchema = Schema.Struct({
  id: Schema.String,
  packId: Schema.String,
  emoji: Schema.NullOr(Schema.String),
  mime: Schema.Literals(['image/webp', 'image/png']),
  width: Schema.Number,
  height: Schema.Number,
  bytes: Schema.Number,
  url: Schema.String,
});

// Every field of `StickerPackView`; `importedFrom` is optional because the
// service omits it when absent.
const StickerPackViewSchema = Schema.Struct({
  id: Schema.String,
  ownerId: Schema.String,
  title: Schema.String,
  visibility: StickerVisibility,
  importedFrom: Schema.optional(Schema.String),
  stickers: Schema.Array(StickerViewSchema),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

// The create and upload routes answer 201 with the same bodies.
const StickerPackCreated = StickerPackViewSchema.pipe(HttpApiSchema.status(201));
const StickerCreated = StickerViewSchema.pipe(HttpApiSchema.status(201));

const PackList = Schema.Struct({ packs: Schema.Array(StickerPackViewSchema) });

const DeletePackResult = Schema.Struct({ warning: Schema.String });

const DiscoverPage = Schema.Struct({
  packs: Schema.Array(StickerPackViewSchema),
  next: Schema.NullOr(Schema.String),
});

const OkResult = Schema.Struct({ ok: Schema.Literal(true) });

// The Telegram import answer: `partial` is present only when true.
const TelegramImportResult = Schema.Struct({
  pack: StickerPackViewSchema,
  imported: Schema.Number,
  skippedAnimated: Schema.Number,
  skippedInvalid: Schema.Number,
  partial: Schema.optional(Schema.Literal(true)),
});

const FavoritesList = Schema.Struct({ favorites: Schema.Array(StickerViewSchema) });

const PackIdParams = Schema.Struct({ id: Schema.String });
const StickerParams = Schema.Struct({ id: Schema.String, stickerId: Schema.String });
const StickerFileParams = Schema.Struct({ stickerId: Schema.String });
const PanelPackParams = Schema.Struct({ packId: Schema.String });

// The upload budget is the first step after the session, so it is a plain
// endpoint middleware (the Telegram import budget is not: it runs after the
// 501 token check and the input parse, so it stays in its handler).
const StickersUploadRateLimit = makeRateLimit(
  'zilar/effect/http/StickersUploadRateLimit',
  'Too many sticker uploads, try again later',
);

const StickersGroup = HttpApiGroup.make('stickers')
  .add(
    HttpApiEndpoint.get('listPacks', '/sticker-packs', {
      success: PackList,
    }),
    HttpApiEndpoint.post('createPack', '/sticker-packs', {
      payload: CreatePackBody,
      success: StickerPackCreated,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.get('discover', '/sticker-packs/discover', {
      success: DiscoverPage,
    }),
    HttpApiEndpoint.post('importTelegram', '/sticker-packs/import/telegram', {
      success: TelegramImportResult,
    }),
    HttpApiEndpoint.patch('patchPack', '/sticker-packs/:id', {
      params: PackIdParams,
      payload: PatchPackBody,
      success: StickerPackViewSchema,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.delete('deletePack', '/sticker-packs/:id', {
      params: PackIdParams,
      success: DeletePackResult,
    }),
    HttpApiEndpoint.delete('deleteSticker', '/sticker-packs/:id/stickers/:stickerId', {
      params: StickerParams,
      success: OkResult,
    }),
    HttpApiEndpoint.put('reorderPanel', '/sticker-panel', {
      payload: ReorderPanelBody,
      success: OkResult,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.put('addPanelPack', '/sticker-panel/:packId', {
      params: PanelPackParams,
      success: OkResult,
    }),
    HttpApiEndpoint.delete('removePanelPack', '/sticker-panel/:packId', {
      params: PanelPackParams,
      success: OkResult,
    }),
    HttpApiEndpoint.get('listFavorites', '/sticker-favorites', {
      success: FavoritesList,
    }),
    HttpApiEndpoint.put('addFavorite', '/sticker-favorites', {
      payload: FavoriteBody,
      success: StickerViewSchema,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.delete('removeFavorite', '/sticker-favorites', {
      success: OkResult,
    }),
    // Binary routes (T-0602). The upload declares no payload schema, so the
    // multipart/raw body is read in the handler; the file GET answers raw
    // bytes with custom headers.
    HttpApiEndpoint.post('uploadSticker', '/sticker-packs/:id/stickers', {
      params: PackIdParams,
      success: StickerCreated,
    }).middleware(StickersUploadRateLimit.Middleware),
    // The handler answers the raw bytes itself (status 200, file headers).
    HttpApiEndpoint.get('serveFile', '/stickers/:stickerId/file', {
      params: StickerFileParams,
      success: HttpApiSchema.Empty(200),
    }),
  )
  .middleware(Session)
  .middleware(StickersSchemaErrors)
  // The edge forwards the full request path, so the router keeps the `/api` prefix.
  .prefix('/api');

const StickersApi = HttpApi.make('stickers').add(StickersGroup);

// A malformed percent escape is an unknown id (404), not a server error.
// The Effect router hands out decoded params (like the old `c.req.param`), so
// this second decode is idempotent on normal ids and keeps the old final id.
function decodePathId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(404, 'not_found', 'Sticker pack not found');
  }
}

export function createStickersApi(deps: StickersApiDependencies): EffectApiMount {
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
  // One limiter per api instance, built once (never per request), like the
  // old factory and the avatars api.
  const injectedUploadLimiter = deps.uploadLimiter;
  // An injected limiter only has to say `allow`; `makeRateLimit` wants the full shape.
  const uploadLimiter: RateLimiter =
    injectedUploadLimiter === undefined
      ? createRateLimiter({
          max: STICKER_UPLOAD_RATE_LIMIT_MAX,
          windowMs: STICKER_UPLOAD_RATE_LIMIT_WINDOW_MS,
          now,
        })
      : { allow: (key) => injectedUploadLimiter.allow(key), size: 0 };

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

  const groupLayer = HttpApiBuilder.group(StickersApi, 'stickers', (handlers) =>
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
      // The query is decoded manually inside the handler (the endpoint
      // declares no query) so an invalid query answers the fixed 400 message,
      // like the media gallery's hand decode.
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
      // reason the endpoint cannot declare `TelegramImportBody` as its payload.
      .handle(
        'importTelegram',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const token = yield* Effect.promise(() => getBotToken());
            if (token === null) {
              throw new HttpError(501, 'import_unavailable', 'Telegram import is not configured');
            }
            const raw = parseJsonOrNull(yield* Effect.orDie(request.request.text));
            const decoded = Schema.decodeUnknownOption(TelegramImportBody, STRICT_PAYLOAD)(raw);
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
      // The multipart/raw upload (part B, T-0602). The limiter middleware
      // already charged the budget (session -> limiter -> content-type branch
      // -> upload). The multipart branch checks the declared length before
      // parsing the form, so an over-cap body is rejected without buffering
      // it; the raw branch streams through `readCapped`, which stops as soon
      // as the cap is passed. The 201 body carries every `StickerView` field.
      .handle(
        'uploadSticker',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const contentType = request.request.headers['content-type'] ?? '';
            let bytes: Uint8Array;
            let emoji: string | undefined;
            if (contentType.includes('multipart/form-data')) {
              const declared = Number(request.request.headers['content-length'] ?? '');
              if (Number.isFinite(declared) && declared > STICKER_MAX_BYTES + 64 * 1024) {
                throw new HttpError(413, 'sticker_too_large', 'The sticker is larger than 512 KiB');
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
              if (buffer.byteLength > STICKER_MAX_BYTES) {
                throw new HttpError(413, 'sticker_too_large', 'The sticker is larger than 512 KiB');
              }
              bytes = buffer;
              const rawEmoji = form.get('emoji');
              if (typeof rawEmoji === 'string' && rawEmoji !== '') {
                emoji = rawEmoji;
              }
              // Byte-identical to the old zod `z.string().max(8)` message.
              if (emoji !== undefined && emoji.length > 8) {
                throw new HttpError(
                  400,
                  'invalid_request',
                  'Too big: expected string to have <=8 characters',
                );
              }
            } else {
              // Raw bytes: the client POSTs the file with an optional
              // `x-emoji` header.
              const declared = Number(request.request.headers['content-length'] ?? '');
              if (Number.isFinite(declared) && declared > STICKER_MAX_BYTES) {
                throw new HttpError(413, 'sticker_too_large', 'The sticker is larger than 512 KiB');
              }
              const capped = yield* readCapped(request.request.stream, STICKER_MAX_BYTES).pipe(
                Effect.orDie,
              );
              if (capped === undefined) {
                throw new HttpError(413, 'sticker_too_large', 'The sticker is larger than 512 KiB');
              }
              bytes = capped;
              const rawEmoji = request.request.headers['x-emoji'];
              if (rawEmoji !== undefined && rawEmoji !== '') {
                // Header values are latin1 ByteStrings, so the client
                // percent-encodes the emoji; decode at most the first 64
                // characters, then let the service validate the length.
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
              uploadSticker(
                serviceDeps(),
                packId,
                user.id,
                bytes,
                emoji === undefined ? {} : { emoji },
              ),
            );
          }),
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

  const apiLayer = HttpApiBuilder.layer(StickersApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
    Layer.provide(StickersUploadRateLimit.layer(uploadLimiter)),
  );

  return mountApi(StickersApi, apiLayer);
}

// Reads the body stream chunk by chunk and stops as soon as the cap is passed,
// so a large upload never has to fit in memory. `undefined` means the cap was
// exceeded; the over-cap chunk itself is not collected.
function readCapped<E, R>(
  stream: Stream.Stream<Uint8Array, E, R>,
  cap: number,
): Effect.Effect<Uint8Array | undefined, E, R> {
  return Effect.gen(function* () {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let exceeded = false;
    yield* Stream.runForEachWhile(stream, (chunk) =>
      Effect.sync(() => {
        total += chunk.byteLength;
        if (total > cap) {
          exceeded = true;
          return false;
        }
        chunks.push(chunk);
        return true;
      }),
    );

    if (exceeded) {
      return undefined;
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  });
}

// Referenced for parity documentation (the discover route decodes manually).
void DiscoverQuery;
