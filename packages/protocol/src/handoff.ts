import { Schema } from 'effect';
import { ArtifactRefSchema, BudgetSchema, IdSchema, JidSchema, struct } from './common';

export const HandoffSchema = struct({
  task_id: IdSchema,
  from: JidSchema,
  to: JidSchema,
  objective: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  context_summary: Schema.String.pipe(Schema.check(Schema.isMaxLength(2000))),
  acceptance: Schema.mutable(Schema.Array(Schema.String.pipe(Schema.check(Schema.isMinLength(1))))),
  constraints: Schema.mutable(
    Schema.Array(Schema.String.pipe(Schema.check(Schema.isMinLength(1)))),
  ),
  artifacts: Schema.mutable(Schema.Array(ArtifactRefSchema)),
  budget: BudgetSchema,
  return_format: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  reply_to: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
});

// `to` is the handed-off targets (at most two, like mentions); `task` is the reply text after the last mention, collapsed to one line and cut to 200 characters.
export const HandoffLineSchema = struct({
  from: JidSchema,
  to: Schema.mutable(Schema.Array(JidSchema)).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(2)),
  ),
  task: Schema.String.pipe(Schema.check(Schema.isMaxLength(200))),
});

export type HandoffLine = typeof HandoffLineSchema.Type;
