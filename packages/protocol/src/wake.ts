import { Schema } from 'effect';
import { IdSchema, JidSchema, struct } from './common';

export const WakeReasonSchema = struct({
  ai: JidSchema,
  score: Schema.Number.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
  ),
  reason: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(300))),
  message_ids: Schema.mutable(Schema.Array(IdSchema)).pipe(Schema.check(Schema.isMaxLength(50))),
});

export type WakeReason = typeof WakeReasonSchema.Type;
