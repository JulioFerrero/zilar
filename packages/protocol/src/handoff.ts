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
