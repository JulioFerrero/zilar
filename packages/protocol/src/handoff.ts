import { z } from 'zod';

const jid = z.string().min(1).includes('@');
const nonEmptyString = z.string().min(1);

const artifactKind = z.enum(['message', 'screenshot', 'pr', 'preview', 'file', 'report']);

export const HandoffSchema = z.object({
  task_id: nonEmptyString,
  from: jid,
  to: jid,
  objective: nonEmptyString,
  context_summary: z.string().max(2000),
  acceptance: z.array(nonEmptyString),
  constraints: z.array(nonEmptyString),
  artifacts: z.array(z.object({ kind: artifactKind, ref: nonEmptyString })),
  budget: z.object({ currency: z.enum(['EUR', 'USD']), max: z.number().positive() }),
  return_format: nonEmptyString,
  reply_to: nonEmptyString,
});

export type Handoff = z.infer<typeof HandoffSchema>;
