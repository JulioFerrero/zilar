// Stickers module on the Effect `HttpApi` adapter (T-0582, part A): the
// same methods, paths, order, statuses, texts and bodies as the Hono JSON
// routes in `routes.ts`. Handlers keep calling the drizzle service; the DB
// rewrite is a separate lane.
//
// Only the 12 JSON routes move here. The multipart upload
// (`POST /sticker-packs/:id/stickers`) and the file GET
// (`GET /stickers/:stickerId/file`) stay on Hono in `routes.ts` (part B).
//
// Step order per route (unchanged):
// - Telegram import: session -> token (501) -> body decode -> pack-input
//   parse (400 link text) -> limiter (429) -> import. The answer carries
//   `partial` only when true.
// - DELETE /sticker-favorites decodes the body from the query string.
// - Every other JSON route: session -> body/query decode -> service call.
// Decode failures answer 400 `invalid_request` with the first message,
// mirroring the old `issues[0]?.message` texts (see the legacy schemas).
// `decodePathId` keeps the old final id (404 on a bad escape).

import { Effect, Layer, Option, Schema } from 'effect';
import { HttpServer, HttpServerRequest, HttpServerResponse, HttpRouter } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from 'effect/http-api';
import type { Logger } from 'pino';
import { z } from 'zod';
import {
  CurrentUser,
  Session,
  failureResponse,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import type { StickersRoutesDependencies } from './routes';
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
  removeFavorite,
  removePanelPack,
  reorderPanelPacks,
  STICKER_PANEL_MAX,
  STICKERS_MAX_PER_PACK,
  STICKER_PACK_TITLE_MAX,
  STICKER_PACK_TITLE_MIN,
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

// Replaces `createPackBodySchema` (zod): strict, trimmed title 1..60,
// optional visibility. Strictness comes from the endpoint's
// `PayloadParseOptions` below.
const CreatePackBody = Schema.Struct({
  title: Schema.Trim.pipe(
    Schema.check(
      Schema.isMinLength(STICKER_PACK_TITLE_MIN),
      Schema.isMaxLength(STICKER_PACK_TITLE_MAX),
    ),
  ),
  visibility: Schema.optional(StickerVisibility),
});

// Replaces `patchPackBodySchema` (zod): all optional, strict, plus the
// byte-identical "Nothing to update" refine (a `makeFilter`, because Effect
// 4.0.2 drops `{ message }` on length checks).
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

// Replaces `discoverQuerySchema` (zod): optional `q` <= 60, `cursor` <= 128.
// The route decodes manually with the legacy schema for the exact
// `issues[0].message`; this Schema is kept for parity documentation only.
const DiscoverQuery = Schema.Struct({
  q: Schema.optional(Schema.String.check(Schema.isMaxLength(60))),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),
});

// Replaces `telegramImportBodySchema` (zod): strict, `input` 1..512. The
// import route decodes this manually in its handler (after the 501 token
// check), so strictness comes from `STRICT_PAYLOAD` below.
const TelegramImportBody = Schema.Struct({
  input: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
});

const STRICT_PAYLOAD = { onExcessProperty: 'error' } as const;

// Replaces `reorderPanelBodySchema` (zod): strict, ids 1..128, at most 200.
const ReorderPanelBody = Schema.Struct({
  order: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))).check(
    Schema.isMaxLength(STICKER_PANEL_MAX),
  ),
});

// Replaces `favoriteBodySchema` (zod): strict, `sticker_id: uuid`.
const FavoriteBody = Schema.Struct({
  sticker_id: Schema.String.pipe(Schema.check(Schema.isUUID())),
});

// The legacy zod bodies, kept only to reproduce the exact `issues[0].message`
// texts for an invalid body (the pattern from `handles/api.ts` and
// `contact-requests/api.ts`). Each runs on the cached body only when the
// Schema decode failed.
const stickerVisibilityZod = z.enum(['private', 'server']);
const legacyCreatePackBodySchema = z
  .object({
    title: z.string().trim().min(STICKER_PACK_TITLE_MIN).max(STICKER_PACK_TITLE_MAX),
    visibility: stickerVisibilityZod.optional(),
  })
  .strict();
const legacyPatchPackBodySchema = z
  .object({
    title: z.string().trim().min(STICKER_PACK_TITLE_MIN).max(STICKER_PACK_TITLE_MAX).optional(),
    visibility: stickerVisibilityZod.optional(),
    order: z.array(z.string().min(1).max(128)).max(STICKERS_MAX_PER_PACK).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
const legacyTelegramImportBodySchema = z.object({ input: z.string().min(1).max(512) }).strict();
const legacyReorderPanelBodySchema = z
  .object({ order: z.array(z.string().min(1).max(128)).max(STICKER_PANEL_MAX) })
  .strict();
const legacyFavoriteBodySchema = z.object({ sticker_id: z.uuid() }).strict();

function legacyMessage(schema: z.ZodType, body: unknown): string {
  const parsed = schema.safeParse(body);
  return parsed.success
    ? 'Invalid request'
    : (parsed.error.issues[0]?.message ?? 'Invalid request');
}

// Mirrors `c.req.json().catch(() => null)`: an unparseable or empty body is
// `null`, which the legacy schema reports as `expected object, received null`.
function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The legacy zod query schema, kept only to reproduce its exact
// `issues[0].message` for an invalid discover query.
const legacyDiscoverQuerySchema = z.object({
  q: z.string().max(60).optional(),
  cursor: z.string().max(128).optional(),
});

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

// Applied to the group so a payload decode failure renders like the old zod
// path: 400 `invalid_request` with the same `issues[0].message`. The body
// was already read (and cached) by the failed payload decode. The discover
// and favorite-delete routes decode manually in their handlers, so they never
// reach this layer with a query failure.
class StickersSchemaErrors extends HttpApiMiddleware.Service<StickersSchemaErrors>()(
  'zilar/effect/http/StickersSchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<StickersSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(StickersSchemaErrors, () =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const body = parseJsonOrNull(yield* Effect.orDie(request.text));
      const message = matchLegacyBodyMessage(request.originalUrl, body);
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', message),
      );
    }),
  );
}

// Picks the legacy body schema by the request path (the method is implied by
// the route): every path below carries exactly one JSON body shape.
function matchLegacyBodyMessage(url: string, body: unknown): string {
  const path = url.split('?')[0] ?? url;
  if (path.endsWith('/sticker-packs/import/telegram')) {
    return legacyMessage(legacyTelegramImportBodySchema, body);
  }
  if (path.endsWith('/sticker-panel')) {
    return legacyMessage(legacyReorderPanelBodySchema, body);
  }
  if (path.endsWith('/sticker-favorites')) {
    return legacyMessage(legacyFavoriteBodySchema, body);
  }
  if (path.endsWith('/sticker-packs')) {
    return legacyMessage(legacyCreatePackBodySchema, body);
  }
  return legacyMessage(legacyPatchPackBodySchema, body);
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
const PanelPackParams = Schema.Struct({ packId: Schema.String });

const StickersGroup = HttpApiGroup.make('stickers')
  .add(
    HttpApiEndpoint.get('listPacks', '/sticker-packs', {
      success: PackList,
    }),
    HttpApiEndpoint.post('createPack', '/sticker-packs', {
      payload: CreatePackBody,
      success: StickerPackViewSchema,
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
  )
  .middleware(Session)
  .middleware(StickersSchemaErrors)
  // The adapter forwards `c.req.raw` unchanged, so paths keep Hono's `/api`.
  .prefix('/api');

const StickersApi = HttpApi.make('stickers').add(StickersGroup);

export const STICKERS_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/sticker-packs' },
  { method: 'POST', path: '/api/sticker-packs' },
  { method: 'GET', path: '/api/sticker-packs/discover' },
  { method: 'POST', path: '/api/sticker-packs/import/telegram' },
  { method: 'PATCH', path: '/api/sticker-packs/:id' },
  { method: 'DELETE', path: '/api/sticker-packs/:id' },
  { method: 'DELETE', path: '/api/sticker-packs/:id/stickers/:stickerId' },
  { method: 'PUT', path: '/api/sticker-panel' },
  { method: 'PUT', path: '/api/sticker-panel/:packId' },
  { method: 'DELETE', path: '/api/sticker-panel/:packId' },
  { method: 'GET', path: '/api/sticker-favorites' },
  { method: 'PUT', path: '/api/sticker-favorites' },
  { method: 'DELETE', path: '/api/sticker-favorites' },
];

// A malformed percent escape is an unknown id (404), not a server error.
// The Effect router hands out decoded params (like Hono's `c.req.param`), so
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
      .handle('listPacks', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const packs = yield* Effect.promise(() => listPanelPacks(serviceDeps(), user.id));
            return { packs };
          }),
          logger,
          requestId,
        );
      })
      .handle('createPack', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const pack = yield* Effect.promise(() =>
              createPack(serviceDeps(), user.id, { ...request.payload }),
            );
            return HttpServerResponse.jsonUnsafe(pack, { status: 201 });
          }),
          logger,
          requestId,
        );
      })
      // The query is decoded manually inside the handler (Schema, same rules
      // as the old zod schema) with the legacy first-issue text, like the
      // media gallery's hand decode.
      .handle('discover', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            yield* CurrentUser;
            const record = discoverQueryRecord(request.request);
            const legacy = legacyDiscoverQuerySchema.safeParse(record);
            if (!legacy.success) {
              throw new HttpError(
                400,
                'invalid_request',
                legacy.error.issues[0]?.message ?? 'Invalid request',
              );
            }
            const page = yield* Effect.promise(() =>
              discoverPacks(serviceDeps(), legacy.data.q, legacy.data.cursor),
            );
            return page;
          }),
          logger,
          requestId,
        );
      })
      // The body is decoded manually inside the handler, after the 501
      // token check: the framework-level payload decode used to run before
      // any handler code, so a malformed body answered 400 instead of the
      // specified 501 `import_unavailable` (the old order is session ->
      // token -> body -> pack-input parse -> limiter -> import). The
      // legacy-message replay keeps the exact old `issues[0].message`.
      .handle('importTelegram', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
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
                legacyMessage(legacyTelegramImportBodySchema, raw),
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
          logger,
          requestId,
        );
      })
      .handle('patchPack', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const packId = yield* Effect.sync(() => decodePathId(request.params.id));
            const pack = yield* Effect.promise(() =>
              patchPack(serviceDeps(), packId, user.id, { ...request.payload }),
            );
            return pack;
          }),
          logger,
          requestId,
        );
      })
      .handle('deletePack', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const packId = yield* Effect.sync(() => decodePathId(request.params.id));
            return yield* Effect.promise(() => deletePack(serviceDeps(), packId, user.id));
          }),
          logger,
          requestId,
        );
      })
      .handle('deleteSticker', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const packId = yield* Effect.sync(() => decodePathId(request.params.id));
            const stickerId = yield* Effect.sync(() => decodePathId(request.params.stickerId));
            yield* Effect.promise(() => deleteSticker(serviceDeps(), packId, stickerId, user.id));
            return { ok: true as const };
          }),
          logger,
          requestId,
        );
      })
      .handle('reorderPanel', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            yield* Effect.promise(() =>
              reorderPanelPacks(serviceDeps(), user.id, { ...request.payload }),
            );
            return { ok: true as const };
          }),
          logger,
          requestId,
        );
      })
      .handle('addPanelPack', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const packId = yield* Effect.sync(() => decodePathId(request.params.packId));
            yield* Effect.promise(() => addPanelPack(serviceDeps(), packId, user.id));
            return { ok: true as const };
          }),
          logger,
          requestId,
        );
      })
      .handle('removePanelPack', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const packId = yield* Effect.sync(() => decodePathId(request.params.packId));
            yield* Effect.promise(() => removePanelPack(serviceDeps(), packId, user.id));
            return { ok: true as const };
          }),
          logger,
          requestId,
        );
      })
      .handle('listFavorites', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const favorites = yield* Effect.promise(() => listFavorites(serviceDeps(), user.id));
            return { favorites };
          }),
          logger,
          requestId,
        );
      })
      .handle('addFavorite', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const favorite = yield* Effect.promise(() =>
              addFavorite(serviceDeps(), user.id, request.payload.sticker_id),
            );
            return favorite;
          }),
          logger,
          requestId,
        );
      })
      // The id comes from the query string, like the old
      // `favoriteBodySchema.safeParse(c.req.query())`.
      .handle('removeFavorite', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const record = favoriteQueryRecord(request.request);
            const parsed = legacyFavoriteBodySchema.safeParse(record);
            if (!parsed.success) {
              throw new HttpError(
                400,
                'invalid_request',
                parsed.error.issues[0]?.message ?? 'Invalid request',
              );
            }
            yield* Effect.promise(() =>
              removeFavorite(serviceDeps(), user.id, parsed.data.sticker_id),
            );
            return { ok: true as const };
          }),
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(StickersApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  // Hono keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: STICKERS_API_ROUTES };
}

// Referenced for parity documentation (the discover route decodes manually).
void DiscoverQuery;
