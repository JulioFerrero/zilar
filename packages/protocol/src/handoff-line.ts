import { Schema } from 'effect';
import { JidSchema, struct } from './common';

// T-1572: the small handoff line an AI reply carries when it hands work to
// another AI ("Dev-1 → QA-1 · Check it on an iPhone"). `from` is the sending
// AI's bare JID, `to` is the handed-off targets (at most two, like the
// mentions `wire()` adds), and `task` is the reply text after the last
// mention, collapsed to one line and cut to 200 characters. It may be empty.
export const HandoffLineSchema = struct({
  from: JidSchema,
  to: Schema.mutable(Schema.Array(JidSchema)).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(2)),
  ),
  task: Schema.String.pipe(Schema.check(Schema.isMaxLength(200))),
});

export type HandoffLine = typeof HandoffLineSchema.Type;
