// A query value the router accepts untouched, for the endpoints whose server
// handler decodes the query by hand (gifs, the media gallery, sticker
// discover and favorite delete).
//
// Those handlers run a guard first (the 501 provider check, the limiter) and
// answer their own fixed 400 text, so the framework must not reject anything
// before the handler runs. A string or a repeated key (a list) always
// decodes, so the framework never fails; the handler still reads the raw URL
// and applies its strict rules. The derived client uses the declared keys to
// type and encode the query.

import { Schema } from 'effect';

export const RawQueryValue = Schema.optional(
  Schema.Union([Schema.String, Schema.Array(Schema.String)]),
);
