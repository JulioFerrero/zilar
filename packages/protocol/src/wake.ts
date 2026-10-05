import { z } from 'zod';
import { IdSchema, JidSchema } from './common';

export const WakeReasonSchema = z.strictObject({
  ai: JidSchema,
  score: z.number().min(0).max(1),
  reason: z.string().min(1).max(300),
  message_ids: z.array(IdSchema).max(50),
});

export type WakeReason = z.infer<typeof WakeReasonSchema>;
