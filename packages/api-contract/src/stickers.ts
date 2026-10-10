// User-made sticker packs, the panel, favorites and the Telegram importer
// (T-0120 to T-0123, T-0582, T-0602, T-0895). The panel lists mine in order
// (with stickers), discover lists `server`-visible packs, and files are served
// same-origin so the renderer can auto-load them without leaking the viewer's
// IP.
//
// Three routes are decoded by hand in the server handlers and declare only
// what the derived client needs to type and encode the call:
//
// - `discover` and `removeFavorite` read their query by hand, with a fixed 400
//   text per route, so their query keys are `RawQueryValue` (the router never
//   rejects them).
// - `importTelegram` declares its payload but is served with `handleRaw`: it
//   decodes its body after the 501 token check, so a missing token never
//   spends the import budget.
//
// `uploadSticker` and `serveFile` carry raw bytes (multipart or the image
// itself), so they stay outside the derived client.

import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { Session, StickersSchemaErrors, StickersUploadRateLimit } from './middleware';
import { RawQueryValue } from './raw-query';

export const STICKERS_MAX_PER_PACK = 120;
export const STICKER_PACK_TITLE_MIN = 1;
export const STICKER_PACK_TITLE_MAX = 60;
export const STICKER_PANEL_MAX = 200;

export const StickerVisibility = Schema.Literals(['private', 'server']);

export type StickerVisibility = typeof StickerVisibility.Type;

/** Trimmed title 1..60, optional visibility; strict (an excess key is a 400). */
export const CreateStickerPackPayload = Schema.Struct({
  title: Schema.Trim.pipe(
    Schema.check(
      Schema.isMinLength(STICKER_PACK_TITLE_MIN),
      Schema.isMaxLength(STICKER_PACK_TITLE_MAX),
    ),
  ),
  visibility: Schema.optional(StickerVisibility),
});

/** All optional and strict, plus the "Nothing to update" refine. */
export const PatchStickerPackPayload = Schema.Struct({
  title: Schema.optional(
    Schema.Trim.pipe(
      Schema.check(
        Schema.isMinLength(STICKER_PACK_TITLE_MIN),
        Schema.isMaxLength(STICKER_PACK_TITLE_MAX),
      ),
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

/** Strict, ids 1..128, at most 200. */
export const ReorderStickerPanelPayload = Schema.Struct({
  order: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))).check(
    Schema.isMaxLength(STICKER_PANEL_MAX),
  ),
});

/** Strict, `sticker_id` is a UUID. */
export const AddStickerFavoritePayload = Schema.Struct({
  sticker_id: Schema.String.pipe(Schema.check(Schema.isUUID())),
});

/** A Telegram pack name or link, 1..512 characters; strict when decoded by the server. */
export const ImportTelegramPayload = Schema.Struct({
  input: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
});

export const Sticker = Schema.Struct({
  id: Schema.String,
  packId: Schema.String,
  emoji: Schema.NullOr(Schema.String),
  mime: Schema.Literals(['image/webp', 'image/png']),
  width: Schema.Number,
  height: Schema.Number,
  bytes: Schema.Number,
  url: Schema.String,
});

export type Sticker = typeof Sticker.Type;

export const StickerPack = Schema.Struct({
  id: Schema.String,
  ownerId: Schema.String,
  title: Schema.String,
  visibility: StickerVisibility,
  // Set by the Telegram importer (`telegram:<name>`); absent otherwise.
  importedFrom: Schema.optional(Schema.String),
  stickers: Schema.Array(Sticker),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type StickerPack = typeof StickerPack.Type;

export const StickerPackList = Schema.Struct({ packs: Schema.Array(StickerPack) });

export const StickerDiscoverPage = Schema.Struct({
  packs: Schema.Array(StickerPack),
  next: Schema.NullOr(Schema.String),
});

export const StickerFavorites = Schema.Struct({ favorites: Schema.Array(Sticker) });

export const StickerDeletePackResult = Schema.Struct({ warning: Schema.String });

export const StickerOk = Schema.Struct({ ok: Schema.Boolean });

/** The Telegram import answer: `partial` is present only when true. */
export const TelegramImportResult = Schema.Struct({
  pack: StickerPack,
  imported: Schema.Number,
  skippedAnimated: Schema.Number,
  skippedInvalid: Schema.Number,
  partial: Schema.optional(Schema.Boolean),
});

export type TelegramImportResult = typeof TelegramImportResult.Type;

export const StickersGroup = HttpApiGroup.make('stickers')
  .add(
    HttpApiEndpoint.get('listPacks', '/sticker-packs', {
      success: StickerPackList,
    }),
    HttpApiEndpoint.post('createPack', '/sticker-packs', {
      payload: CreateStickerPackPayload,
      success: StickerPack.pipe(HttpApiSchema.status(201)),
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.get('discover', '/sticker-packs/discover', {
      query: { q: RawQueryValue, cursor: RawQueryValue },
      success: StickerDiscoverPage,
    }),
    HttpApiEndpoint.post('importTelegram', '/sticker-packs/import/telegram', {
      payload: ImportTelegramPayload,
      success: TelegramImportResult,
    }),
    HttpApiEndpoint.patch('patchPack', '/sticker-packs/:id', {
      params: { id: Schema.String },
      payload: PatchStickerPackPayload,
      success: StickerPack,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.delete('deletePack', '/sticker-packs/:id', {
      params: { id: Schema.String },
      success: StickerDeletePackResult,
    }),
    HttpApiEndpoint.delete('deleteSticker', '/sticker-packs/:id/stickers/:stickerId', {
      params: { id: Schema.String, stickerId: Schema.String },
      success: StickerOk,
    }),
    HttpApiEndpoint.put('reorderPanel', '/sticker-panel', {
      payload: ReorderStickerPanelPayload,
      success: StickerOk,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.put('addPanelPack', '/sticker-panel/:packId', {
      params: { packId: Schema.String },
      success: StickerOk,
    }),
    HttpApiEndpoint.delete('removePanelPack', '/sticker-panel/:packId', {
      params: { packId: Schema.String },
      success: StickerOk,
    }),
    HttpApiEndpoint.get('listFavorites', '/sticker-favorites', {
      success: StickerFavorites,
    }),
    HttpApiEndpoint.put('addFavorite', '/sticker-favorites', {
      payload: AddStickerFavoritePayload,
      success: Sticker,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.delete('removeFavorite', '/sticker-favorites', {
      query: { sticker_id: RawQueryValue },
      success: StickerOk,
    }),
    // Binary routes: the upload reads its multipart/raw body in the handler,
    // and the file GET answers raw bytes with custom headers.
    HttpApiEndpoint.post('uploadSticker', '/sticker-packs/:id/stickers', {
      params: { id: Schema.String },
      success: Sticker.pipe(HttpApiSchema.status(201)),
    }).middleware(StickersUploadRateLimit),
    HttpApiEndpoint.get('serveFile', '/stickers/:stickerId/file', {
      params: { stickerId: Schema.String },
      success: HttpApiSchema.Empty(200),
    }),
  )
  .middleware(Session)
  .middleware(StickersSchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
