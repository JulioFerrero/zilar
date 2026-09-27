import { z } from 'zod';
import { ArtifactRefSchema, BudgetSchema, IdSchema, JidSchema } from './common';

export const TaskStateSchema = z.enum([
  'submitted',
  'working',
  'input-required',
  'completed',
  'failed',
  'canceled',
  'rejected',
]);

export type TaskState = z.infer<typeof TaskStateSchema>;

export const TaskSchema = z.strictObject({
  id: IdSchema,
  room: JidSchema,
  title: z.string().min(1).max(200),
  owner: JidSchema.optional(),
  state: TaskStateSchema,
  depends_on: z.array(IdSchema),
  acceptance: z.array(z.string()),
  budget: BudgetSchema.optional(),
  source_message_id: IdSchema.optional(),
  artifacts: z.array(ArtifactRefSchema),
});

export type Task = z.infer<typeof TaskSchema>;

export const DecisionSchema = z.strictObject({
  id: IdSchema,
  text: z.string().min(1).max(1000),
  author: JidSchema,
  source_message_id: IdSchema.optional(),
});

export type Decision = z.infer<typeof DecisionSchema>;

export const BoardArtifactSchema = ArtifactRefSchema.extend({ id: IdSchema });

export type BoardArtifact = z.infer<typeof BoardArtifactSchema>;

export const BoardUpdateSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('task.created'), room: JidSchema, task: TaskSchema }),
  z.strictObject({ op: z.literal('task.updated'), room: JidSchema, task: TaskSchema }),
  z.strictObject({ op: z.literal('decision.added'), room: JidSchema, decision: DecisionSchema }),
  z.strictObject({
    op: z.literal('artifact.added'),
    room: JidSchema,
    artifact: BoardArtifactSchema,
  }),
]);

export type BoardUpdate = z.infer<typeof BoardUpdateSchema>;
