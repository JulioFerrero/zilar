import { Result, Schema } from 'effect';
import { ARGS_HASH_PATTERN } from '@zilar/protocol';

// `approved_always` runs like `approved_once`; the standing rule it creates is
// separate.
export type ApprovalStatus =
  'pending' | 'approved_once' | 'approved_always' | 'denied' | 'consumed';

export type ApprovalDecision = 'approve_once' | 'approve_always' | 'deny';

export const MAX_PENDING_APPROVALS_PER_AI = 50;
export const MAX_APPROVAL_EXPIRY_MS = 24 * 60 * 60 * 1000;

const actionSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100));
const summarySchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500));
const detailsSchema = Schema.optional(Schema.String.check(Schema.isMaxLength(20000)));
const argsHashSchema = Schema.String.check(Schema.isPattern(ARGS_HASH_PATTERN));
export const noteSchema = Schema.optional(Schema.String.check(Schema.isMaxLength(500)));
const requestedBySchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(3071));
const groupIdSchema = Schema.optional(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
);
const topicIdSchema = Schema.optional(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
);
const aiIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));

const worstCaseSchema = Schema.Struct({
  currency: Schema.Literals(['EUR', 'USD']),
  amount: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});

// Only the refine text reaches callers; every other failure becomes the fixed
// text, because Effect's default messages may quote the input value.
const GROUP_TOPIC_REFINE_MESSAGE = 'groupId and topicId must be set together';
export const INVALID_APPROVAL_REQUEST_MESSAGE = 'Invalid approval request';

export const CreateApprovalInputSchema = Schema.Struct({
  aiId: aiIdSchema,
  groupId: groupIdSchema,
  topicId: topicIdSchema,
  action: actionSchema,
  summary: summarySchema,
  details: detailsSchema,
  argsHash: argsHashSchema,
  worstCase: Schema.optional(worstCaseSchema),
  requestedBy: requestedBySchema,
  expiresAt: Schema.Date,
}).pipe(
  // Group and topic ids travel together: the scope is (AI, topic).
  Schema.check(
    Schema.makeFilter((data) =>
      (data.groupId === undefined) === (data.topicId === undefined)
        ? undefined
        : GROUP_TOPIC_REFINE_MESSAGE,
    ),
  ),
);

export type CreateApprovalInput = typeof CreateApprovalInputSchema.Type;

// Unknown keys are rejected; any failure other than the refine falls back to the
// fixed text, so a value is never echoed.
export function parseCreateApprovalInput(input: unknown): CreateApprovalInput {
  const result = Schema.decodeUnknownResult(CreateApprovalInputSchema, {
    onExcessProperty: 'error',
  })(input);
  if (Result.isSuccess(result)) {
    return result.success;
  }
  const message = result.failure.message.includes(GROUP_TOPIC_REFINE_MESSAGE)
    ? GROUP_TOPIC_REFINE_MESSAGE
    : INVALID_APPROVAL_REQUEST_MESSAGE;
  throw new ApprovalServiceError('invalid_request', message);
}

export type AlwaysEligiblePredicate = (action: string) => boolean;

export interface CreatedApprovalRule {
  id: string;
  action: string;
  groupId: string | null;
  topicId: string | null;
  created: boolean;
}

export interface PublicApproval {
  id: string;
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  /** Null for personal chats; the route blanks it for an invisible topic. */
  topicName: string | null;
  action: string;
  summary: string;
  details: string | null;
  argsHash: string;
  worstCase: { currency: 'EUR' | 'USD'; amount: number } | null;
  requestedBy: string;
  status: ApprovalStatus | 'expired';
  decidedAt: Date | null;
  note: string | null;
  expiresAt: Date;
  createdAt: Date;
  // True when the adapter opted in via `allowAlways` and reports no cost.
  alwaysEligible: boolean;
  // Resolved server-side to avoid an N+1. Only visible topics reach the list,
  // and role membership is not secret, so no names leak.
  approverNames: string[];
}

// Routes map this to 4xx with a stable code; unknown or unauthorized ids return
// null instead, so they answer 404.
export class ApprovalServiceError extends Error {
  readonly errorCode:
    | 'invalid_request'
    | 'expired'
    | 'not_pending'
    | 'pending_limit'
    | 'ai_not_in_group'
    | 'always_not_allowed'
    | 'always_requires_admin';

  constructor(errorCode: ApprovalServiceError['errorCode'], message: string) {
    super(message);
    this.name = 'ApprovalServiceError';
    this.errorCode = errorCode;
  }
}
