import { Schema } from 'effect';
import {
  STICKER_PACK_TITLE_MAX,
  STICKER_PACK_TITLE_MIN,
  STICKER_PANEL_MAX,
  STICKERS_MAX_PER_PACK,
} from '@zilar/api-contract';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { StickerPackRow, StickerRow } from '../db/rows';
import { HttpError } from '../errors';

export const STICKER_PACKS_MAX_PER_USER = 100;
// The pack, title and panel limits are part of the wire contract
// (`@zilar/api-contract`, `stickers.ts`, T-0895), so the schemas there and this
// service share one value.
export { STICKER_PACK_TITLE_MAX, STICKER_PACK_TITLE_MIN, STICKER_PANEL_MAX, STICKERS_MAX_PER_PACK };
export const STICKER_EMOJI_MAX = 8;
export const DISCOVER_PAGE_SIZE = 30;

export const stickerVisibilitySchema = Schema.Literals(['private', 'server']);
export type StickerVisibility = typeof stickerVisibilitySchema.Type;

export type { StickerPackRow, StickerRow };

export interface StickerView {
  id: string;
  packId: string;
  emoji: string | null;
  mime: 'image/webp' | 'image/png';
  width: number;
  height: number;
  bytes: number;
  url: string;
}

export interface StickerPackView {
  id: string;
  ownerId: string;
  title: string;
  visibility: StickerVisibility;
  /** Set by the Telegram importer (`telegram:<name>`); absent otherwise. */
  importedFrom?: string;
  stickers: StickerView[];
  createdAt: string;
  updatedAt: string;
}

export interface StickersServiceDeps {
  db: ServerDatabase;
  /** Directory sticker files are stored under; resolved once, absolutely. */
  storageDir: string;
  /** Base path of the file route, e.g. `/api/stickers`. */
  fileBasePath?: string;
  audit?: AuditRecorder;
}

// A pack or panel write answers 503 for any failure that is not the module's
// own `HttpError`. A failure raised inside the effect/sql transaction keeps
// its `HttpError` instance (the pins pattern), so a 400 never becomes a 503.
// Exported for the packs and panel modules; not part of the barrel's surface.
export function mapStickerError(error: unknown): HttpError {
  return error instanceof HttpError
    ? error
    : new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
}

// The pack title, trimmed before the length checks, exactly like the old
// `.trim().min()/.max()`. The messages cannot use `{ message }` on the
// length checks (Effect 4.0.2 drops it), so the filters return the texts.
const packTitleSchema = Schema.Trim.pipe(
  Schema.check(
    Schema.makeFilter((value: string) =>
      value.length >= STICKER_PACK_TITLE_MIN
        ? undefined
        : `Too small: expected string to have >=${STICKER_PACK_TITLE_MIN} characters`,
    ),
    Schema.makeFilter((value: string) =>
      value.length <= STICKER_PACK_TITLE_MAX
        ? undefined
        : `Too big: expected string to have <=${STICKER_PACK_TITLE_MAX} characters`,
    ),
  ),
);

const packOrderSchema = Schema.Array(
  Schema.String.pipe(
    Schema.check(
      Schema.makeFilter((value: string) =>
        value.length >= 1 ? undefined : 'Too small: expected string to have >=1 characters',
      ),
      Schema.makeFilter((value: string) =>
        value.length <= 128 ? undefined : 'Too big: expected string to have <=128 characters',
      ),
    ),
  ),
).pipe(
  Schema.check(
    Schema.makeFilter((value: ReadonlyArray<string>) =>
      value.length <= STICKERS_MAX_PER_PACK
        ? undefined
        : `Too big: expected array to have <=${STICKERS_MAX_PER_PACK} items`,
    ),
  ),
);

const createPackBodySchema = Schema.Struct({
  title: packTitleSchema,
  visibility: Schema.optional(stickerVisibilitySchema),
});

export type CreatePackBody = typeof createPackBodySchema.Type;
export { createPackBodySchema };

const patchPackBodySchema = Schema.Struct({
  title: Schema.optional(packTitleSchema),
  visibility: Schema.optional(stickerVisibilitySchema),
  order: Schema.optional(packOrderSchema),
}).pipe(
  Schema.check(
    Schema.makeFilter((value) => (Object.keys(value).length > 0 ? undefined : 'Nothing to update')),
  ),
);

export type PatchPackBody = typeof patchPackBodySchema.Type;
export { patchPackBodySchema };

// Exported for the storage and telegram modules; not part of the barrel's surface.
export const emojiSchema = Schema.optional(
  Schema.String.pipe(
    Schema.check(
      Schema.makeFilter((value: string) =>
        value.length <= STICKER_EMOJI_MAX ? undefined : 'emoji must be at most 8 characters',
      ),
    ),
  ),
);

export type UploadStickerBody = { emoji?: string | undefined };
