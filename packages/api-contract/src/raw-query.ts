// The router accepts the value untouched, because each handler runs its guard first and answers its own fixed 400, so the framework must not reject before it runs.

import { Schema } from 'effect';

export const RawQueryValue = Schema.optional(
  Schema.Union([Schema.String, Schema.Array(Schema.String)]),
);
