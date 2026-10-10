import { Result, Schema } from 'effect';
import { ARGS_HASH_PATTERN } from '@zilar/protocol';

// `approved_always` is treated exactly like `approved_once` for the
// single-use path; T-0099 adds a separate standing-rule flow that the
// decision route triggers when the adapter is always-eligible and the
// decider chose `approve_always`.
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

// The only validation text the callers ever see is the refine below; every
// other failure is mapped to `Invalid approval request` so no input value can
// reach an error message (Effect's default texts may quote the value).
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
  // T-0110: the scope is (AI, topic) — group and topic ids travel together.
  Schema.check(
    Schema.makeFilter((data) =>
      (data.groupId === undefined) === (data.topicId === undefined)
        ? undefined
        : GROUP_TOPIC_REFINE_MESSAGE,
    ),
  ),
);

export type CreateApprovalInput = typeof CreateApprovalInputSchema.Type;

// Strict decode (unknown keys rejected, like the old `z.strictObject`). The
// refine text is preserved; any other failure falls back to the fixed generic
// text, so a value is never echoed.
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

// T-0099: the predicate the routes pass to `decideApproval` so the
// service can accept or refuse an `approve_always` decision. Absent =
// "nothing is always-eligible", so `approve_always` is refused with 400
// `always_not_allowed`.
export type AlwaysEligiblePredicate = (action: string) => boolean;

// T-0099: the result of an `approve_always` decision, returned by the
// service so the route can write the matching audit entries (one for
// `approval.decided` and one for `approval_rule.created`). The decision
// itself is still a normal approval — the rule sits next to it.
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
  /** The topic the request was raised in. Null for personal chats. */
  topicId: string | null;
  /** The topic's name, or null for personal chats. The route blanks this
   *  for topics the viewer cannot see (which cannot happen for a returned
   *  row); the field stays for the client. */
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
  // T-0099: `true` when the action is on the always-eligible list (the
  // adapter opted in via `allowAlways: true` and reports no cost). The
  // client uses this to decide whether to show the "Approve always"
  // button.
  alwaysEligible: boolean;
  // T-0134: the display names of the holders of the topic's approver role,
  // resolved server-side so the card does not call `getTopic` per approval
  // (N+1). Sorted by name, empty for personal chats and topics without an
  // approver role. Only topics the viewer can see ever reach the list, and
  // role membership is not secret, so no names leak.
  approverNames: string[];
}

// Thrown for validation and quota failures so routes can map them to 4xx with
// stable codes. Unknown or unauthorised ids return null instead, so routes
// answer 404.
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
