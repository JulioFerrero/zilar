import { Schema } from 'effect';
import { ArtifactRefSchema, BudgetSchema, IdSchema, JidSchema, struct } from './common';

export const TaskStateSchema = Schema.Literals([
  'submitted',
  'working',
  'input-required',
  'completed',
  'failed',
  'canceled',
  'rejected',
]);

export const TaskSchema = struct({
  id: IdSchema,
  room: JidSchema,
  title: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
  owner: Schema.optional(JidSchema),
  state: TaskStateSchema,
  depends_on: Schema.mutable(Schema.Array(IdSchema)),
  acceptance: Schema.mutable(Schema.Array(Schema.String)),
  budget: Schema.optional(BudgetSchema),
  source_message_id: Schema.optional(IdSchema),
  artifacts: Schema.mutable(Schema.Array(ArtifactRefSchema)),
});

export type Task = typeof TaskSchema.Type;

export const DecisionSchema = struct({
  id: IdSchema,
  text: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(1000))),
  author: JidSchema,
  source_message_id: Schema.optional(IdSchema),
});

export const BoardArtifactSchema = Schema.Struct({
  ...ArtifactRefSchema.fields,
  id: Schema.mutableKey(IdSchema),
});

export const BoardUpdateSchema = Schema.Union([
  struct({ op: Schema.Literal('task.created'), room: JidSchema, task: TaskSchema }),
  struct({ op: Schema.Literal('task.updated'), room: JidSchema, task: TaskSchema }),
  struct({
    op: Schema.Literal('decision.added'),
    room: JidSchema,
    decision: DecisionSchema,
  }),
  struct({
    op: Schema.Literal('artifact.added'),
    room: JidSchema,
    artifact: BoardArtifactSchema,
  }),
]);
