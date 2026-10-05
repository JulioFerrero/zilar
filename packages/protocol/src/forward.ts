import { z } from 'zod';

/**
 * Where a forwarded message came from, captured at forward time. The target
 * chat cannot be assumed to resolve the origin JID, so the sender name travels
 * on the wire as text.
 *
 * `chat_id`/`chat_name` are set together only for a public origin. A private
 * topic must omit both so target members never learn the private room JID.
 */
export const ForwardOriginSchema = z
  .strictObject({
    /** Bare JID or user id of the original author. */
    sender_id: z.string().min(1).max(255),
    /** Display name captured at forward time. */
    sender_name: z.string().min(1).max(120),
    /** Source room JID; only for a public origin. */
    chat_id: z.string().min(1).max(255).optional(),
    /** Source room name; only for a public origin. */
    chat_name: z.string().min(1).max(120).optional(),
    /** Sender-generated id of the original message. */
    original_id: z.string().min(1).max(255).optional(),
    /** Original send time. */
    original_at: z.iso.datetime(),
  })
  .refine((value) => (value.chat_id === undefined) === (value.chat_name === undefined), {
    message: 'chat_id and chat_name must both be present or both be absent',
  });

export type ForwardOrigin = z.infer<typeof ForwardOriginSchema>;
