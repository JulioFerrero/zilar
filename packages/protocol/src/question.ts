import { Schema } from 'effect';
import { JidSchema, struct } from './common';

// `id` is the `ai_questions` row id, `ai` the asking AI's bare JID (the chips reply to it).
export const QuestionSchema = struct({
  id: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
  ai: JidSchema,
  question: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(300))),
  options: Schema.mutable(
    Schema.Array(Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(40)))),
  ).pipe(Schema.check(Schema.isMinLength(2), Schema.isMaxLength(4))),
});

export type Question = typeof QuestionSchema.Type;
