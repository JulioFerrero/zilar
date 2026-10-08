import { Schema } from 'effect';
import { isUrl, struct } from './common';

/** The largest attachment the protocol accepts: 100 MB. */
export const MAX_ATTACHMENT_PROTOCOL_BYTES = 100 * 1024 * 1024;

/**
 * A file or image carried by a message. The bytes live at `url` (an
 * XEP-0363 download URL); the message body carries the caption.
 */
export const AttachmentSchema = struct({
  kind: Schema.Literals(['image', 'file']),
  /** The XEP-0363 download URL the receiver fetches the bytes from. */
  url: Schema.String.pipe(
    Schema.check(
      Schema.isMaxLength(8192),
      Schema.makeFilter((value) => (isUrl(value) ? undefined : 'must be a URL')),
    ),
  ),
  /** The original file name, shown on file cards. */
  name: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(255))),
  size: Schema.Int.pipe(
    Schema.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(MAX_ATTACHMENT_PROTOCOL_BYTES),
    ),
  ),
  mime: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(100))),
  /** Images only: the pixel width, used to reserve space before it loads. */
  width: Schema.optional(
    Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(20000)),
    ),
  ),
  /** Images only: the pixel height, used to reserve space before it loads. */
  height: Schema.optional(
    Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(20000)),
    ),
  ),
});

export type Attachment = typeof AttachmentSchema.Type;
