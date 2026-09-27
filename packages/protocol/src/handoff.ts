import { z } from 'zod';
import { ArtifactRefSchema, BudgetSchema, IdSchema, JidSchema } from './common';

export const HandoffSchema = z.strictObject({
  task_id: IdSchema,
  from: JidSchema,
  to: JidSchema,
  objective: z.string().min(1),
  context_summary: z.string().max(2000),
  acceptance: z.array(z.string().min(1)),
  constraints: z.array(z.string().min(1)),
  artifacts: z.array(ArtifactRefSchema),
  budget: BudgetSchema,
  return_format: z.string().min(1),
  reply_to: z.string().min(1),
});

export type Handoff = z.infer<typeof HandoffSchema>;
