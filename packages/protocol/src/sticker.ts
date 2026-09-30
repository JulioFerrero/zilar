import { z } from 'zod';

export const STICKER_MIME_VALUES = ['image/webp', 'image/png'] as const;

export type StickerMime = (typeof STICKER_MIME_VALUES)[number];

/**
 * One sticker inside a chat message. The bytes live at `url` (a
 * `/api/stickers/:id/file` URL on this server); clients that do not know
 * this payload show `emoji` (or nothing) as the body instead.
 */
export const StickerSchema = z.strictObject({
  pack_id: z.uuid(),
  sticker_id: z.uuid(),
  /** The server file URL at send time, used as a fallback. */
  url: z.url().max(2048),
  /** Shown when the client cannot render the sticker. */
  emoji: z.string().max(8).optional(),
  width: z.int().min(1).max(512),
  height: z.int().min(1).max(512),
  mime: z.enum(STICKER_MIME_VALUES),
});

export type Sticker = z.infer<typeof StickerSchema>;
