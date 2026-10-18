import { Schema } from 'effect';
import { IsoDateTimeZuluSchema, struct } from './common';

// The target chat cannot resolve the origin JID, so the sender name travels on the wire as text.
// `chat_id`/`chat_name` are set together only for a public origin; a private topic must omit both so target members never learn the private room JID.
export const ForwardOriginSchema = struct({
  sender_id: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(255))),
  sender_name: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(120))),
  chat_id: Schema.optional(
    Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(255))),
  ),
  chat_name: Schema.optional(
    Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(120))),
  ),
  original_id: Schema.optional(
    Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(255))),
  ),
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
