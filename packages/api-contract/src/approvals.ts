// Approvals (T-0076) and approval rules (T-0100): the requests an AI raises
// before it acts, the decisions on them, and the standing "always" rules.
// Dates travel as ISO strings and stay strings in the clients.

import { Effect, Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { ApprovalsSchemaErrors, Session } from './middleware';

export const APPROVAL_STATUSES = [
  'pending',
  'approved_once',
  'approved_always',
  'denied',
  'consumed',
  'expired',
] as const;

export const ApprovalStatus = Schema.Literals(APPROVAL_STATUSES);

export type ApprovalStatus = typeof ApprovalStatus.Type;

export const APPROVAL_DECISIONS = ['approve_once', 'approve_always', 'deny'] as const;

export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** Strict: an excess key is a 400. `note` is bounded like the protocol schema. */
export const ApprovalDecisionPayload = Schema.Struct({
  decision: Schema.Literals(APPROVAL_DECISIONS),
  note: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
});

const WorstCase = Schema.Struct({
  currency: Schema.Literals(['EUR', 'USD']),
  amount: Schema.Number,
});

/**
 * One approval as the caller sees it. `topicId`/`topicName` are optional so
 * older payloads parse (a missing topic reads like a group approval);
 * `alwaysEligible` and `approverNames` default when an older server omits
 * them, and the card then hides the third button and the approver line.
 */
export const PublicApproval = Schema.Struct({
  id: Schema.String,
  aiId: Schema.String,
  groupId: Schema.NullOr(Schema.String),
  topicId: Schema.optional(Schema.NullOr(Schema.String)),
  topicName: Schema.optional(Schema.NullOr(Schema.String)),
  action: Schema.String,
  summary: Schema.String,
  details: Schema.NullOr(Schema.String),
  argsHash: Schema.String,
  worstCase: Schema.NullOr(WorstCase),
  requestedBy: Schema.String,
  status: ApprovalStatus,
  decidedAt: Schema.NullOr(Schema.String),
  note: Schema.NullOr(Schema.String),
  expiresAt: Schema.String,
  createdAt: Schema.String,
  alwaysEligible: Schema.Boolean.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(false))),
  approverNames: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
  ),
});

export type PublicApproval = typeof PublicApproval.Type;

/** One standing rule. `topicId`/`topicName` are optional so older payloads parse. */
export const ApprovalRule = Schema.Struct({
  id: Schema.String,
  action: Schema.String,
  scope: Schema.Literals(['personal', 'group']),
  groupId: Schema.NullOr(Schema.String),
  topicId: Schema.optional(Schema.NullOr(Schema.String)),
  topicName: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.String,
  createdBy: Schema.String,
});

export type ApprovalRule = typeof ApprovalRule.Type;

const ApprovalIdParams = Schema.Struct({ id: Schema.String });

export const ApprovalsGroup = HttpApiGroup.make('approvals')
  .add(
    HttpApiEndpoint.get('list', '/approvals', {
      success: Schema.Array(PublicApproval),
    }),
    HttpApiEndpoint.get('detail', '/approvals/:id', {
      params: ApprovalIdParams,
      success: PublicApproval,
    }),
    HttpApiEndpoint.post('decide', '/approvals/:id/decision', {
      params: ApprovalIdParams,
      payload: ApprovalDecisionPayload,
      success: PublicApproval,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.get('aiRules', '/ais/:id/approval-rules', {
      params: ApprovalIdParams,
      success: Schema.Array(ApprovalRule),
    }),
    HttpApiEndpoint.get('groupRules', '/groups/:id/approval-rules', {
      params: ApprovalIdParams,
      success: Schema.Array(ApprovalRule),
    }),
    HttpApiEndpoint.delete('revokeRule', '/approval-rules/:id', {
      params: ApprovalIdParams,
      success: HttpApiSchema.NoContent,
    }),
  )
  .middleware(Session)
  .middleware(ApprovalsSchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
