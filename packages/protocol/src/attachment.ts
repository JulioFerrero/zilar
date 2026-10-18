import { Schema } from 'effect';
import { isUrl, struct } from './common';

// The largest attachment the protocol accepts: 100 MB.
export const MAX_ATTACHMENT_PROTOCOL_BYTES = 100 * 1024 * 1024;

export const AttachmentSchema = struct({
  kind: Schema.Literals(['image', 'file']),
  url: Schema.String.pipe(
    Schema.check(
      Schema.isMaxLength(8192),
      Schema.makeFilter((value) => (isUrl(value) ? undefined : 'must be a URL')),
    ),
  ),
  name: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(255))),
  size: Schema.Int.pipe(
    Schema.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(MAX_ATTACHMENT_PROTOCOL_BYTES),
    ),
  ),
  mime: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(100))),
  width: Schema.optional(
    Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(20000)),
    ),
  ),
  height: Schema.optional(
    Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(20000)),
    ),
  ),
});

export type Attachment = typeof AttachmentSchema.Type;
