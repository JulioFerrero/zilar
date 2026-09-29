import { z } from 'zod';

/** The largest attachment the protocol accepts: 100 MB. */
export const MAX_ATTACHMENT_PROTOCOL_BYTES = 100 * 1024 * 1024;

/**
 * A file or image carried by a message. The bytes live at `url` (an
 * XEP-0363 download URL); the message body carries the caption.
 */
export const AttachmentSchema = z.strictObject({
  kind: z.enum(['image', 'file']),
  /** The XEP-0363 download URL the receiver fetches the bytes from. */
  url: z.url().max(8192),
  /** The original file name, shown on file cards. */
  name: z.string().min(1).max(255),
  size: z.int().min(0).max(MAX_ATTACHMENT_PROTOCOL_BYTES),
  mime: z.string().min(1).max(100),
  /** Images only: the pixel width, used to reserve space before it loads. */
  width: z.int().min(1).max(20000).optional(),
  /** Images only: the pixel height, used to reserve space before it loads. */
  height: z.int().min(1).max(20000).optional(),
});

export type Attachment = z.infer<typeof AttachmentSchema>;
