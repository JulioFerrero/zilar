import { Schema } from 'effect';
import { IsoDateTimeZuluSchema, struct } from './common';

/**
 * Where a forwarded message came from, captured at forward time. The target
 * chat cannot be assumed to resolve the origin JID, so the sender name travels
 * on the wire as text.
 *
 * `chat_id`/`chat_name` are set together only for a public origin. A private
 * topic must omit both so target members never learn the private room JID.
 */
export const ForwardOriginSchema = struct({
  /** Bare JID or user id of the original author. */
  sender_id: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(255))),
  /** Display name captured at forward time. */
  sender_name: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(120))),
  /** Source room JID; only for a public origin. */
  chat_id: Schema.optional(
    Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(255))),
  ),
  /** Source room name; only for a public origin. */
  chat_name: Schema.optional(
    Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(120))),
  ),
  /** Sender-generated id of the original message. */
  original_id: Schema.optional(
    Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(255))),
  ),
  /** Original send time. */
  original_at: IsoDateTimeZuluSchema,
}).pipe(
  Schema.check(
    Schema.makeFilter((value) =>
      (value.chat_id === undefined) === (value.chat_name === undefined)
        ? undefined
        : 'chat_id and chat_name must both be present or both be absent',
    ),
  ),
);

export type ForwardOrigin = typeof ForwardOriginSchema.Type;
