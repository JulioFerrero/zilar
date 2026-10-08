import { Schema } from 'effect';
import { struct } from './common';

export const STICKER_MIME_VALUES = ['image/webp', 'image/png'] as const;

export type StickerMime = (typeof STICKER_MIME_VALUES)[number];

/**
 * One sticker inside a chat message. The bytes live at `url`: either the
 * absolute server file URL at send time, or the relative
 * `/api/stickers/:id/file` path the server API returns (clients resolve it
 * against the Zilar API origin). Clients that do not know this payload show
 * `emoji` (or nothing) as the body instead. Rendering still fetches only
 * same-origin sticker URLs (see `isSameOriginStickerUrl` on web).
 */
export const StickerSchema = struct({
  pack_id: Schema.String.pipe(Schema.check(Schema.isUUID())),
  sticker_id: Schema.String.pipe(Schema.check(Schema.isUUID())),
  /** The server file URL at send time, used as a fallback. */
  url: Schema.String.pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(2048),
      Schema.makeFilter((value) =>
        value.startsWith('/api/stickers/') ||
        value.startsWith('http://') ||
        value.startsWith('https://')
          ? undefined
          : 'sticker url must be a /api/stickers/ path or an http(s) URL',
      ),
    ),
  ),
  /** Shown when the client cannot render the sticker. */
  emoji: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(8)))),
  width: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(512)),
  ),
  height: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(512)),
  ),
  mime: Schema.Literals(STICKER_MIME_VALUES),
});

export type Sticker = typeof StickerSchema.Type;
