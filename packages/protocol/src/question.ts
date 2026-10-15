import { Schema } from 'effect';
import { JidSchema, struct } from './common';

// T-1576: the question card an AI posts to the people in a room: the question
// text and 2-4 short options. `id` is the `ai_questions` row id, `ai` the
// asking AI's bare JID (the chips reply to it). Rendering the chips is a later
// step; until then a client shows the message text.
export const QuestionSchema = struct({
  id: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
  ai: JidSchema,
  question: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(300))),
  options: Schema.mutable(
    Schema.Array(Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(40)))),
  ).pipe(Schema.check(Schema.isMinLength(2), Schema.isMaxLength(4))),
});

export type Question = typeof QuestionSchema.Type;
