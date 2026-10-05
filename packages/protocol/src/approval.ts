import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema, JidSchema, MoneySchema } from './common';

export const ARGS_HASH_PATTERN = /^[0-9a-f]{64}$/;

export const ApprovalRequestSchema = z.strictObject({
  id: IdSchema,
  room: JidSchema,
  ai: JidSchema,
  action: z.string().min(1).max(100),
  summary: z.string().min(1).max(500),
  details: z.string().max(20000).optional(),
  args_hash: z.string().regex(ARGS_HASH_PATTERN),
  worst_case_cost: MoneySchema.optional(),
  requested_by: JidSchema,
  expires_at: IsoDateTimeSchema,
});

export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const ApprovalDecisionSchema = z.strictObject({
  approval_id: IdSchema,
  decision: z.enum(['approve_once', 'approve_always', 'deny']),
  note: z.string().max(500).optional(),
  decided_by: JidSchema,
  decided_at: IsoDateTimeSchema,
});

export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
