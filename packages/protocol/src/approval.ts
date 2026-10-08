import { Schema } from 'effect';
import { IdSchema, IsoDateTimeSchema, JidSchema, MoneySchema, struct } from './common';

export const ARGS_HASH_PATTERN = /^[0-9a-f]{64}$/;

export const ApprovalRequestSchema = struct({
  id: IdSchema,
  room: JidSchema,
  ai: JidSchema,
  action: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(100))),
  summary: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(500))),
  details: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(20000)))),
  args_hash: Schema.String.pipe(Schema.check(Schema.isPattern(ARGS_HASH_PATTERN))),
  worst_case_cost: Schema.optional(MoneySchema),
  requested_by: JidSchema,
  expires_at: IsoDateTimeSchema,
});

export type ApprovalRequest = typeof ApprovalRequestSchema.Type;

export const ApprovalDecisionSchema = struct({
  approval_id: IdSchema,
  decision: Schema.Literals(['approve_once', 'approve_always', 'deny']),
  note: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(500)))),
  decided_by: JidSchema,
  decided_at: IsoDateTimeSchema,
});

export type ApprovalDecision = typeof ApprovalDecisionSchema.Type;
