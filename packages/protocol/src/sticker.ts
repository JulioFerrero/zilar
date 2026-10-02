import { z } from 'zod';

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
export const StickerSchema = z.strictObject({
  pack_id: z.uuid(),
  sticker_id: z.uuid(),
  /** The server file URL at send time, used as a fallback. */
  url: z
    .string()
    .min(1)
    .max(2048)
    .refine(
      (value) =>
        value.startsWith('/api/stickers/') ||
        value.startsWith('http://') ||
        value.startsWith('https://'),
      { message: 'sticker url must be a /api/stickers/ path or an http(s) URL' },
    ),
  /** Shown when the client cannot render the sticker. */
  emoji: z.string().max(8).optional(),
  width: z.int().min(1).max(512),
  height: z.int().min(1).max(512),
  mime: z.enum(STICKER_MIME_VALUES),
});

export type Sticker = z.infer<typeof StickerSchema>;
