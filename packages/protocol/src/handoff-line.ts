import { Schema } from 'effect';
import { JidSchema, struct } from './common';

// `to` is the handed-off targets (at most two, like mentions); `task` is the reply text after the last mention, collapsed to one line and cut to 200 characters.
export const HandoffLineSchema = struct({
  from: JidSchema,
  to: Schema.mutable(Schema.Array(JidSchema)).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(2)),
  ),
  task: Schema.String.pipe(Schema.check(Schema.isMaxLength(200))),
});

export type HandoffLine = typeof HandoffLineSchema.Type;
